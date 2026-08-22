import { useState, useEffect, useMemo } from "react";
import { RefreshCw, Settings, X, Activity, ChevronDown, ChevronUp, Trash2, EyeOff, Eye, TrendingUp, Plus, Wallet, DollarSign } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis,
  Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
} from "recharts";
import { api } from "../api/client";
import { Spinner } from "../components/ui/Spinner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtProfit(val) {
  if (val === null || val === undefined) return "—";
  const n = Number(val);
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function fmtCurrency(val) {
  if (val === null || val === undefined) return "—";
  return Number(val).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pnlColor(val) {
  if (val === null || val === undefined) return "var(--text-secondary)";
  return Number(val) >= 0 ? "var(--accent)" : "var(--danger)";
}

function ddPercent(account) {
  if (!account.initial_balance || !account.max_total_dd_pct) return null;
  const currentDD = account.initial_balance - account.balance;
  const maxDD     = account.initial_balance * (account.max_total_dd_pct / 100);
  return Math.min(Math.max((currentDD / maxDD) * 100, 0), 100);
}

function dailyDdPercent(account) {
  if (!account.initial_balance || !account.max_daily_dd_pct) return null;
  const maxDailyDD = account.initial_balance * (account.max_daily_dd_pct / 100);
  const usedDD     = Math.abs(Math.min(0, account.daily_pnl || 0));
  return Math.min((usedDD / maxDailyDD) * 100, 100);
}

function targetPercent(account) {
  if (!account.initial_balance || !account.profit_target_pct) return null;
  const target = account.initial_balance * (account.profit_target_pct / 100);
  const profit = (account.balance || 0) - account.initial_balance;
  return Math.min(Math.max((profit / target) * 100, 0), 100);
}

const MONTH_NAMES = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

function fmtMonth(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function sortAccounts(accounts) {
  const order = { "Prop": 0, "Live": 1, "Demo": 2, "Altro": 3 };
  return [...accounts].sort((a, b) => (order[a.account_type] ?? 3) - (order[b.account_type] ?? 3));
}

// Offline se non arriva segnale da più di 11 minuti (copre sia 1min che 5min interval EA)
const OFFLINE_THRESHOLD_MS = 11 * 60 * 1000;

function isOffline(account, serverNow) {
  if (!account.last_update) return false;
  const lastSeen  = new Date(account.last_update);
  if (isNaN(lastSeen.getTime())) return false;
  const reference = serverNow ?? new Date();
  const diffMs    = reference.getTime() - lastSeen.getTime();
  return diffMs > OFFLINE_THRESHOLD_MS;
}

function fmtLastSeen(account, serverNow) {
  if (!account.last_update) return null;
  const lastSeen  = new Date(account.last_update);
  if (isNaN(lastSeen.getTime())) return null;
  const reference = serverNow ?? new Date();
  const diffMin   = Math.floor((reference.getTime() - lastSeen.getTime()) / 60000);
  if (diffMin < 1)  return "< 1 min fa";
  if (diffMin < 60) return `${diffMin} min fa`;
  const diffH = Math.floor(diffMin / 60);
  return `${diffH}h ${diffMin % 60}min fa`;
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ pct, color, label, sublabel }) {
  return (
    <div style={{ marginBottom: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
        <span style={{ fontSize: 11, fontFamily: "var(--font-data)", color }}>{sublabel}</span>
      </div>
      <div style={{ height: 5, background: "var(--bg-elevated)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

// ─── Tooltip grafico ──────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem 0.75rem", fontSize: 12 }}>
      <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.value >= 0 ? "var(--accent)" : "var(--danger)", fontFamily: "var(--font-data)" }}>
          {p.name}: {typeof p.value === "number" ? fmtCurrency(p.value) : p.value}
        </div>
      ))}
    </div>
  );
}

// ─── Modale: registra prelievo ─────────────────────────────────────────────────
function WithdrawalModal({ accounts, onClose, onSaved }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [amount, setAmount]       = useState("");
  const [date, setDate]           = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote]           = useState("");
  const [saving, setSaving]       = useState(false);

  const inputStyle = {
    width: "100%", background: "var(--bg-elevated)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)", padding: "0.5rem 0.75rem",
    fontSize: 13, outline: "none",
  };
  const labelStyle = { fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4, letterSpacing: "0.04em" };

  async function handleSave() {
    if (!accountId || !amount || Number(amount) <= 0) return;
    setSaving(true);
    try {
      await api.createTransaction(accountId, { type: "withdrawal", amount: Number(amount), transaction_date: date, note: note || null });
      onSaved?.();
      onClose();
    } catch (e) {
      console.error("Errore salvataggio prelievo:", e);
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.5rem", width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Registra prelievo</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div>
            <label style={labelStyle}>CONTO</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} style={inputStyle}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>IMPORTO ($)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="es. 500" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>DATA</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>NOTA (opzionale)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="es. Bonifico verso conto banca" style={inputStyle} />
          </div>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem" }}>
            <button onClick={onClose} style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>Annulla</button>
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Salvataggio..." : "Salva prelievo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modale: aggiungi guadagno extra (prop/altro) ──────────────────────────────
function ExtraEarningModal({ onClose, onSaved }) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote]     = useState("");
  const [saving, setSaving] = useState(false);

  const inputStyle = {
    width: "100%", background: "var(--bg-elevated)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)", padding: "0.5rem 0.75rem",
    fontSize: 13, outline: "none",
  };
  const labelStyle = { fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4, letterSpacing: "0.04em" };

  async function handleSave() {
    if (!amount || Number(amount) === 0) return;
    setSaving(true);
    try {
      await api.createExtraEarning({ year: Number(year), month: Number(month), amount: Number(amount), source: source || null, note: note || null });
      onSaved?.();
      onClose();
    } catch (e) {
      console.error("Errore salvataggio guadagno extra:", e);
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.5rem", width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Aggiungi guadagno extra</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle}>MESE</label>
              <select value={month} onChange={e => setMonth(e.target.value)} style={inputStyle}>
                {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>ANNO</label>
              <input type="number" value={year} onChange={e => setYear(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>IMPORTO ($)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="es. 1200" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>FONTE (opzionale)</label>
            <input value={source} onChange={e => setSource(e.target.value)} placeholder="es. Payout prop firm, affiliazione..." style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>NOTA (opzionale)</label>
            <input value={note} onChange={e => setNote(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem" }}>
            <button onClick={onClose} style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>Annulla</button>
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Salvataggio..." : "Salva"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pannello PNL mensile conti Live ───────────────────────────────────────────
function MonthlyPnlPanel({ months, loading, onAddWithdrawal, onAddExtraEarning }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? months : months.slice(0, 6);

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.1rem 1.25rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem", flexWrap: "wrap", gap: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <DollarSign size={15} style={{ color: "var(--accent)" }} />
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>PNL mensile — conti Live</h3>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={onAddWithdrawal} style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: "0.35rem 0.7rem",
            color: "var(--text-secondary)", cursor: "pointer", fontSize: 12,
          }}>
            <Wallet size={12} /> Registra prelievo
          </button>
          <button onClick={onAddExtraEarning} style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "var(--accent-dim)", border: "1px solid var(--accent)",
            borderRadius: "var(--radius-sm)", padding: "0.35rem 0.7rem",
            color: "var(--accent)", cursor: "pointer", fontSize: 12,
          }}>
            <Plus size={12} /> Guadagno extra
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : months.length === 0 ? (
        <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-muted)", fontSize: 12 }}>
          Nessuno storico mensile ancora disponibile per i conti Live
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.05em" }}>
                <th style={{ padding: "0.4rem 0.5rem", fontWeight: 500 }}>MESE</th>
                <th style={{ padding: "0.4rem 0.5rem", fontWeight: 500, textAlign: "right" }}>PNL TRADING</th>
                <th style={{ padding: "0.4rem 0.5rem", fontWeight: 500, textAlign: "right" }}>EXTRA (PROP/ALTRO)</th>
                <th style={{ padding: "0.4rem 0.5rem", fontWeight: 500, textAlign: "right" }}>TOTALE</th>
                <th style={{ padding: "0.4rem 0.5rem", fontWeight: 500, textAlign: "right" }}>PRELIEVI</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(m => (
                <tr key={`${m.year}-${m.month}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.5rem", color: "var(--text-primary)", fontWeight: 500 }}>{fmtMonth(m.year, m.month)}</td>
                  <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data)", color: pnlColor(m.trading_pnl) }}>{fmtProfit(m.trading_pnl)}</td>
                  <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data)", color: m.extra_earnings ? pnlColor(m.extra_earnings) : "var(--text-muted)" }}>
                    {m.extra_earnings ? fmtProfit(m.extra_earnings) : "—"}
                  </td>
                  <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data)", fontWeight: 700, color: pnlColor(m.total_pnl) }}>{fmtProfit(m.total_pnl)}</td>
                  <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data)", color: m.withdrawals ? "var(--warning)" : "var(--text-muted)" }}>
                    {m.withdrawals ? `-${fmtCurrency(m.withdrawals)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {months.length > 6 && (
            <button onClick={() => setExpanded(e => !e)} style={{
              marginTop: "0.6rem", background: "none", border: "none",
              color: "var(--text-muted)", cursor: "pointer", fontSize: 11,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? "Mostra meno" : `Mostra tutti (${months.length} mesi)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Modale dettaglio conto (equity curve + dati aggregati) ───────────────────
function AccountDetailModal({ account, serverNow, onClose }) {
  const [snapshots, setSnapshots]         = useState([]);
  const [latestSnapshot, setLatestSnapshot] = useState(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [monthlyPnl, setMonthlyPnl]       = useState([]);
  const [monthlyLoading, setMonthlyLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getAccountSnapshots(account.id)
      .then((data) => {
        if (cancelled) return;
        // L'API può restituire { snapshots, latest_snapshot } o direttamente l'array
        if (Array.isArray(data)) {
          setSnapshots(data);
          setLatestSnapshot(null);
        } else {
          setSnapshots(data?.snapshots || []);
          setLatestSnapshot(data?.latest_snapshot || null);
        }
      })
      .catch((e) => { if (!cancelled) setError(e.message || "Errore caricamento storico"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [account.id]);

  useEffect(() => {
    let cancelled = false;
    setMonthlyLoading(true);
    api.getAccountMonthlyPnl(account.id)
      .then((data) => { if (!cancelled) setMonthlyPnl(data || []); })
      .catch(() => { if (!cancelled) setMonthlyPnl([]); })
      .finally(() => { if (!cancelled) setMonthlyLoading(false); });
    return () => { cancelled = true; };
  }, [account.id]);

  const curve = useMemo(() => {
    if (!snapshots.length) return [];
    const sorted = [...snapshots].sort((a, b) =>
      new Date(a.snapshot_date || a.snapshot_time) - new Date(b.snapshot_date || b.snapshot_time)
    );
    let peak = -Infinity;
    return sorted.map(s => {
      const equity = Number(s.equity ?? s.balance ?? 0);
      peak = Math.max(peak, equity);
      return {
        date: s.snapshot_date
          ? new Date(s.snapshot_date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
          : new Date(s.snapshot_time).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }),
        equity,
        balance: Number(s.balance ?? 0),
        drawdown: peak > 0 ? -(peak - equity) : 0,
        daily_pnl: Number(s.daily_pnl ?? 0),
      };
    });
  }, [snapshots]);

  const stats = useMemo(() => {
    if (!curve.length) return null;
    const first     = curve[0];
    const last      = curve[curve.length - 1];
    const peakEquity = Math.max(...curve.map(c => c.equity));
    const minDD      = Math.min(...curve.map(c => c.drawdown));
    const netChange  = last.equity - first.equity;
    const winDays    = curve.filter(c => c.daily_pnl > 0).length;
    const lossDays   = curve.filter(c => c.daily_pnl < 0).length;
    const totalDays  = winDays + lossDays;
    const winRate    = totalDays > 0 ? (winDays / totalDays) * 100 : null;
    const bestDay    = Math.max(...curve.map(c => c.daily_pnl));
    const worstDay   = Math.min(...curve.map(c => c.daily_pnl));
    return { peakEquity, minDD, netChange, winDays, lossDays, winRate, bestDay, worstDay, days: curve.length };
  }, [curve]);

  const offline     = isOffline(account, serverNow);
  const lastSeenStr = fmtLastSeen(account, serverNow);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: "1rem",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", padding: "1.5rem",
          width: "100%", maxWidth: 720, maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TrendingUp size={16} style={{ color: "var(--accent)" }} />
              <h2 style={{ fontSize: 17, fontWeight: 600 }}>{account.name || account.id}</h2>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-data)", marginTop: 4 }}>
              {account.id} · {account.platform} · {account.broker || "—"}
              {offline && <span style={{ marginLeft: 8, color: "var(--danger)" }}>· offline{lastSeenStr ? ` (${lastSeenStr})` : ""}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {/* Dati correnti */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.6rem", marginBottom: "1.25rem" }}>
          {[
            { label: "BALANCE",   value: fmtCurrency(account.balance) },
            { label: "EQUITY",    value: fmtCurrency(account.equity) },
            { label: "PNL OGGI",  value: fmtProfit(account.daily_pnl),   color: pnlColor(account.daily_pnl) },
            { label: "PNL 30GG",  value: fmtProfit(account.monthly_pnl), color: pnlColor(account.monthly_pnl) },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", padding: "0.65rem 0.75rem" }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "var(--font-data)", color: color || "var(--text-primary)" }}>{value}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: 13 }}>
            Impossibile caricare lo storico ({error})
          </div>
        ) : curve.length === 0 ? (
          <div style={{
            textAlign: "center", padding: "2.5rem",
            color: "var(--text-muted)", fontSize: 13,
            border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
          }}>
            Nessuno storico ancora disponibile per questo conto
          </div>
        ) : (
          <>
            {/* Statistiche aggregate */}
            {stats && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem", marginBottom: "1.25rem" }}>
                {[
                  { label: "VARIAZIONE PERIODO", value: fmtProfit(stats.netChange),                     color: pnlColor(stats.netChange) },
                  { label: "MAX DRAWDOWN",        value: fmtCurrency(stats.minDD),                       color: "var(--danger)" },
                  { label: "PICCO EQUITY",        value: fmtCurrency(stats.peakEquity) },
                  { label: "WIN RATE GIORNI",     value: stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "—", color: stats.winRate >= 50 ? "var(--accent)" : "var(--warning)" },
                  { label: "MIGLIOR GIORNO",      value: fmtProfit(stats.bestDay),  color: pnlColor(stats.bestDay) },
                  { label: "PEGGIOR GIORNO",      value: fmtProfit(stats.worstDay), color: pnlColor(stats.worstDay) },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.6rem 0.75rem" }}>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 3, letterSpacing: "0.04em" }}>{label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-data)", color: color || "var(--text-primary)" }}>{value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Equity curve */}
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
              EQUITY CURVE ({stats?.days || 0} giorni)
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={curve} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="liveEqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3dd68c" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3dd68c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} width={60} domain={["auto", "auto"]} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="equity" name="Equity" stroke="#3dd68c" strokeWidth={2} fill="url(#liveEqGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>

            <div style={{ marginTop: "1rem" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.05em" }}>DRAWDOWN ($)</div>
              <ResponsiveContainer width="100%" height={90}>
                <AreaChart data={curve} margin={{ top: 0, right: 5, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="liveDdGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#e05252" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#e05252" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis hide />
                  <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} width={60} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="drawdown" name="DD $" stroke="#e05252" strokeWidth={1.5} fill="url(#liveDdGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {/* Profitti mensili $ e % */}
        <div style={{ marginTop: "1.5rem" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            PROFITTI MENSILI
          </div>
          {monthlyLoading ? (
            <Spinner />
          ) : monthlyPnl.length === 0 ? (
            <div style={{ textAlign: "center", padding: "1.25rem", color: "var(--text-muted)", fontSize: 12, border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)" }}>
              Nessuno storico mensile ancora disponibile
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.05em" }}>
                    <th style={{ padding: "0.4rem 0.5rem", fontWeight: 500 }}>MESE</th>
                    <th style={{ padding: "0.4rem 0.5rem", fontWeight: 500, textAlign: "right" }}>PNL ($)</th>
                    <th style={{ padding: "0.4rem 0.5rem", fontWeight: 500, textAlign: "right" }}>PNL (%)</th>
                    <th style={{ padding: "0.4rem 0.5rem", fontWeight: 500, textAlign: "right" }}>PRELIEVI</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyPnl.map(m => (
                    <tr key={`${m.year}-${m.month}`} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.5rem", color: "var(--text-primary)", fontWeight: 500 }}>{fmtMonth(m.year, m.month)}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data)", color: pnlColor(m.pnl) }}>{fmtProfit(m.pnl)}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data)", color: pnlColor(m.pnl_pct) }}>
                        {m.pnl_pct !== null && m.pnl_pct !== undefined ? `${m.pnl_pct >= 0 ? "+" : ""}${m.pnl_pct.toFixed(2)}%` : "—"}
                      </td>
                      <td style={{ padding: "0.5rem", textAlign: "right", fontFamily: "var(--font-data)", color: m.withdrawals ? "var(--warning)" : "var(--text-muted)" }}>
                        {m.withdrawals ? `-${fmtCurrency(m.withdrawals)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modale configurazione ────────────────────────────────────────────────────
function ConfigModal({ account, onClose, onSave }) {
  const [form, setForm] = useState({
    name:                account.name || account.id,
    broker:              account.broker || "",
    account_type:        account.account_type || "Demo",
    initial_balance:     account.initial_balance || "",
    max_daily_dd_pct:    account.max_daily_dd_pct || "",
    max_total_dd_pct:    account.max_total_dd_pct || "",
    profit_target_pct:   account.profit_target_pct || "",
    max_margin_used_pct: account.max_margin_used_pct || "",
    bonus_credit:        account.bonus_credit || "",
  });

  const isProp = form.account_type === "Prop";

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  const inputStyle = {
    width: "100%", background: "var(--bg-elevated)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)", padding: "0.5rem 0.75rem",
    fontSize: 13, outline: "none",
  };

  const labelStyle = {
    fontSize: 11, color: "var(--text-muted)",
    display: "block", marginBottom: 4, letterSpacing: "0.04em",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 200, padding: "1rem",
    }}>
      <div style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)", padding: "1.5rem",
        width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Configura conto</h2>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-data)", marginTop: 2 }}>
              ID: {account.id} · {account.platform}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div>
            <label style={labelStyle}>NOME LEGGIBILE</label>
            <input name="name" value={form.name} onChange={handleChange} placeholder="es. FTMO 10K Challenge" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>BROKER</label>
            <input name="broker" value={form.broker} onChange={handleChange} placeholder="es. FTMO, The5ers, Axi..." style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>TIPO CONTO</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {["Live", "Prop", "Demo", "Altro"].map(type => (
                <button key={type} onClick={() => setForm(f => ({ ...f, account_type: type }))} style={{
                  flex: 1, padding: "0.4rem", fontSize: 13,
                  borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
                  background: form.account_type === type ? "var(--accent-dim)" : "var(--bg-elevated)",
                  color: form.account_type === type ? "var(--accent)" : "var(--text-secondary)",
                  cursor: "pointer",
                }}>
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Bonus/Credito — sempre visibile */}
          <div>
            <label style={labelStyle}>BONUS / CREDITO ($)</label>
            <input
              name="bonus_credit"
              value={form.bonus_credit}
              onChange={handleChange}
              placeholder="es. 500 (lascia 0 se non presente)"
              type="number"
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Se il broker aggiunge un bonus che compare nell'equity, inseriscilo qui per escluderlo dal PnL aperto
            </div>
          </div>

          {isProp && (
            <>
              <div style={{ height: 1, background: "var(--border)", margin: "0.25rem 0" }} />
              <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.05em" }}>PARAMETRI PROP FIRM</div>
              <div>
                <label style={labelStyle}>BALANCE INIZIALE</label>
                <input name="initial_balance" value={form.initial_balance} onChange={handleChange} placeholder="es. 10000" type="number" style={inputStyle} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={labelStyle}>MAX DD GIORNALIERO (%)</label>
                  <input name="max_daily_dd_pct" value={form.max_daily_dd_pct} onChange={handleChange} placeholder="es. 5" type="number" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>MAX DD TOTALE (%)</label>
                  <input name="max_total_dd_pct" value={form.max_total_dd_pct} onChange={handleChange} placeholder="es. 10" type="number" style={inputStyle} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={labelStyle}>TARGET PROFITTO (%)</label>
                  <input name="profit_target_pct" value={form.profit_target_pct} onChange={handleChange} placeholder="es. 8" type="number" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>MAX MARGINE USATO (%)</label>
                  <input name="max_margin_used_pct" value={form.max_margin_used_pct} onChange={handleChange} placeholder="es. 60" type="number" style={inputStyle} />
                </div>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button onClick={onClose} style={{
              flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)", background: "var(--bg-elevated)",
              color: "var(--text-secondary)", cursor: "pointer", fontSize: 13,
            }}>Annulla</button>
            <button onClick={() => { onSave(account.id, form); onClose(); }} style={{
              flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)",
              border: "none", background: "var(--accent)",
              color: "#000", cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}>Salva</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card singolo conto ───────────────────────────────────────────────────────
function AccountCard({ account, serverNow, onConfigure, onCloseAll, onClosePosition, onTogglePause, onDelete, onToggleHide, onOpenDetail }) {
  const [paused, setPaused] = useState(account.pause_trading ?? false);
  const [confirming, setConfirming]       = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPositions, setShowPositions] = useState(true);
  const [confirmingTicket, setConfirmingTicket] = useState(null);

  const isProp       = account.account_type === "Prop";
  const offline      = isOffline(account, serverNow);
  const lastSeenStr  = fmtLastSeen(account, serverNow);
  const ddPct        = ddPercent(account);
  const dailyPct     = dailyDdPercent(account);
  const tgtPct       = targetPercent(account);

  // Sottrae il bonus/credito dal calcolo equity PnL
  const bonus     = account.bonus_credit || 0;
  const equityPnL = (account.equity || 0) - (account.balance || 0) - bonus;

  const hasPositions = account.open_positions?.length > 0;
  const totalOpenPnL = account.open_positions?.reduce((s, p) => s + (p.profit || 0), 0) || 0;
  const isConfigured = account.account_type !== "Demo" || account.name !== account.id;

  const typeColor = account.account_type === "Prop"  ? "var(--warning)"
                  : account.account_type === "Live"  ? "var(--accent)"
                  : "var(--text-muted)";

  const cardBg     = offline      ? "linear-gradient(135deg, rgba(224,82,82,0.08) 0%, rgba(224,82,82,0.03) 100%)"
                   : isProp       ? "linear-gradient(135deg, var(--bg-surface) 0%, rgba(224,169,82,0.04) 100%)"
                   : "var(--bg-surface)";
  const cardBorder = offline      ? "var(--danger)"
                   : isProp       ? "var(--warning)"
                   : !isConfigured ? "var(--warning)"
                   : "var(--border)";

  return (
    <div
      onClick={() => onOpenDetail?.(account)}
      title="Clicca per vedere equity curve e dati aggregati"
      style={{
        background: cardBg, border: `1px solid ${cardBorder}`,
        borderRadius: "var(--radius-lg)", padding: "1.25rem",
        display: "flex", flexDirection: "column", gap: "1rem",
        boxShadow: isProp ? "0 0 20px rgba(224,169,82,0.05)" : "none",
        cursor: "pointer",
      }}
    >

      {/* Banner offline */}
      {offline && (
        <div style={{
          background: "rgba(224,82,82,0.12)", border: "1px solid var(--danger)",
          borderRadius: "var(--radius-sm)", padding: "0.4rem 0.75rem",
          fontSize: 11, color: "var(--danger)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 14 }}>📡</span>
          EA offline{lastSeenStr ? ` — ultimo segnale ${lastSeenStr}` : ""}
        </div>
      )}

      {/* Banner non configurato */}
      {!isConfigured && (
        <div style={{
          background: "var(--warning-dim)", border: "1px solid var(--warning)",
          borderRadius: "var(--radius-sm)", padding: "0.4rem 0.75rem",
          fontSize: 11, color: "var(--warning)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <Settings size={12} />
          Conto rilevato automaticamente — clicca Configura per impostarlo
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: 4 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
              color: typeColor, background: `${typeColor}22`,
              padding: "2px 7px", borderRadius: 4,
            }}>
              {account.account_type.toUpperCase()}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-data)" }}>
              {account.platform}
            </span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2 }}>
            {account.name || account.id}
          </div>
          {account.name && account.name !== account.id && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-data)", marginTop: 2 }}>{account.id}</div>
          )}
          {account.broker && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{account.broker}</div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: offline ? "var(--danger)" : paused ? "var(--warning)" : "var(--accent)",
              boxShadow: offline ? "0 0 6px var(--danger)" : paused ? "0 0 6px var(--warning)" : "0 0 6px var(--accent)",
            }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {offline ? "Offline" : paused ? "In pausa" : "Live"}
            </span>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onConfigure(account); }} style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: "0.3rem 0.6rem",
            color: "var(--text-secondary)", cursor: "pointer", fontSize: 11,
          }}>
            <Settings size={11} /> Configura
          </button>
        </div>
      </div>

      {/* Balance / Equity */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", padding: "0.75rem" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>BALANCE</div>
          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-data)" }}>
            {fmtCurrency(account.balance)}
          </div>
        </div>
        <div style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", padding: "0.75rem" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>
            EQUITY{bonus > 0 && <span style={{ marginLeft: 4, color: "var(--warning)", fontSize: 9 }}>(-bonus)</span>}
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-data)", color: pnlColor(equityPnL) }}>
            {fmtCurrency(account.equity)}
          </div>
          <div style={{ fontSize: 10, color: pnlColor(equityPnL), fontFamily: "var(--font-data)" }}>
            {fmtProfit(equityPnL)}
            {bonus > 0 && <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>(excl. bonus ${bonus})</span>}
          </div>
        </div>
      </div>

      {/* PnL */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
        {[
          { label: "OGGI",      value: account.daily_pnl   },
          { label: "7 GIORNI",  value: account.weekly_pnl  },
          { label: "30 GIORNI", value: account.monthly_pnl },
        ].map(({ label, value }) => (
          <div key={label} style={{
            textAlign: "center", background: "var(--bg-elevated)",
            borderRadius: "var(--radius-sm)", padding: "0.6rem 0.4rem",
          }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-data)", color: pnlColor(value) }}>
              {fmtProfit(value)}
            </div>
          </div>
        ))}
      </div>

      {/* Margin level */}
      {account.margin_level > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Margin Level</span>
          <span style={{
            fontFamily: "var(--font-data)", fontSize: 12, fontWeight: 500,
            color: account.margin_level > 200 ? "var(--accent)" : account.margin_level > 100 ? "var(--warning)" : "var(--danger)",
          }}>
            {Number(account.margin_level).toFixed(1)}%
          </span>
        </div>
      )}

      {/* Barre prop */}
      {isProp && (ddPct !== null || dailyPct !== null || tgtPct !== null) && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
          {ddPct !== null && (() => {
            const currentDD = Math.max(0, account.initial_balance - account.balance);
            const maxDD     = account.initial_balance * (account.max_total_dd_pct / 100);
            return (
              <ProgressBar
                pct={ddPct}
                color={ddPct > 70 ? "var(--danger)" : "var(--warning)"}
                label="DD Totale usato"
                sublabel={`$${currentDD.toFixed(0)} / $${maxDD.toFixed(0)} (limite ${account.max_total_dd_pct}%)`}
              />
            );
          })()}
          {dailyPct !== null && (() => {
            const usedDD     = Math.abs(Math.min(0, account.daily_pnl || 0));
            const maxDailyDD = account.initial_balance * (account.max_daily_dd_pct / 100);
            return (
              <ProgressBar
                pct={dailyPct}
                color={dailyPct > 70 ? "var(--danger)" : "var(--warning)"}
                label="DD Giornaliero usato"
                sublabel={`$${usedDD.toFixed(0)} / $${maxDailyDD.toFixed(0)} (limite ${account.max_daily_dd_pct}%)`}
              />
            );
          })()}
          {tgtPct !== null && (() => {
            const profit = Math.max(0, (account.balance || 0) - account.initial_balance);
            const target = account.initial_balance * (account.profit_target_pct / 100);
            return (
              <ProgressBar
                pct={tgtPct}
                color="var(--accent)"
                label="Target profitto"
                sublabel={`$${profit.toFixed(0)} / $${target.toFixed(0)} (target ${account.profit_target_pct}%)`}
              />
            );
          })()}
        </div>
      )}

      {/* Posizioni aperte */}
      {hasPositions ? (
        <div style={{
          borderRadius: "var(--radius-md)",
          border: `1px solid ${totalOpenPnL >= 0 ? "rgba(61,214,140,0.35)" : "rgba(224,82,82,0.35)"}`,
          background: totalOpenPnL >= 0 ? "rgba(61,214,140,0.06)" : "rgba(224,82,82,0.06)",
          overflow: "hidden",
        }}>
          <div
            onClick={(e) => { e.stopPropagation(); setShowPositions(s => !s); }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.65rem 0.75rem", cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: totalOpenPnL >= 0 ? "var(--accent)" : "var(--danger)",
                boxShadow: `0 0 6px ${totalOpenPnL >= 0 ? "var(--accent)" : "var(--danger)"}`,
                animation: "pulse 2s infinite",
              }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.04em" }}>
                {account.open_positions.length} POSIZIONI APERTE
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-data)", color: pnlColor(totalOpenPnL) }}>
                {fmtProfit(totalOpenPnL)}
              </span>
              {showPositions
                ? <ChevronUp   size={14} style={{ color: "var(--text-muted)" }} />
                : <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
              }
            </div>
          </div>

          {showPositions && (
            <div style={{ borderTop: `1px solid ${totalOpenPnL >= 0 ? "rgba(61,214,140,0.2)" : "rgba(224,82,82,0.2)"}` }}>
              {account.open_positions.map((pos, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.5rem 0.75rem",
                  borderBottom: i < account.open_positions.length - 1
                    ? `1px solid ${totalOpenPnL >= 0 ? "rgba(61,214,140,0.1)" : "rgba(224,82,82,0.1)"}`
                    : "none",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, fontFamily: "var(--font-data)",
                      color: pos.direction === "BUY" ? "var(--accent)" : "var(--danger)",
                      background: pos.direction === "BUY" ? "var(--accent-dim)" : "var(--danger-dim)",
                      padding: "2px 6px", borderRadius: 3,
                    }}>
                      {pos.direction}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{pos.symbol}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{pos.lots} lot</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontFamily: "var(--font-data)", fontSize: 13, fontWeight: 600, color: pnlColor(pos.profit) }}>
                      {fmtProfit(pos.profit)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirmingTicket !== pos.ticket) {
                          setConfirmingTicket(pos.ticket);
                          return;
                        }
                        setConfirmingTicket(null);
                        onClosePosition?.(account.id, pos.ticket);
                      }}
                      onMouseLeave={() => setConfirmingTicket(prev => (prev === pos.ticket ? null : prev))}
                      title={confirmingTicket === pos.ticket ? "Conferma chiusura" : "Chiudi questa posizione"}
                      style={{
                        padding: "3px 6px", fontSize: 10, fontWeight: 600,
                        borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center",
                        border: `1px solid ${confirmingTicket === pos.ticket ? "var(--danger)" : "var(--border)"}`,
                        background: confirmingTicket === pos.ticket ? "var(--danger-dim)" : "transparent",
                        color: confirmingTicket === pos.ticket ? "var(--danger)" : "var(--text-muted)",
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "0.55rem 0.75rem", borderRadius: "var(--radius-sm)",
          background: "var(--bg-elevated)", border: "1px solid var(--border)",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)" }} />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Nessuna posizione aperta</span>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

      {/* Pulsanti azione */}
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          onClick={() => {
  const newPaused = !paused;
  setPaused(newPaused);
  onTogglePause(account.id, newPaused);
}}

          style={{
            flex: 1, padding: "0.5rem", fontSize: 12,
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${paused ? "var(--warning)" : "var(--border)"}`,
            background: paused ? "var(--warning-dim)" : "var(--bg-elevated)",
            color: paused ? "var(--warning)" : "var(--text-secondary)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          }}
        >
          <Activity size={13} />
          {paused ? "Riprendi EA" : "Pausa EA"}
        </button>

        <button
          onClick={() => { if (!confirming) { setConfirming(true); return; } setConfirming(false); onCloseAll(account.id); }}
          onMouseLeave={() => setConfirming(false)}
          style={{
            flex: 1, padding: "0.5rem", fontSize: 12,
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${confirming ? "var(--danger)" : "var(--border)"}`,
            background: confirming ? "var(--danger-dim)" : "var(--bg-elevated)",
            color: confirming ? "var(--danger)" : "var(--text-secondary)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            transition: "all 0.15s",
          }}
        >
          <X size={13} />
          {confirming ? "Conferma chiusura" : "Chiudi trade"}
        </button>

        <button
          onClick={() => onToggleHide(account.id)}
          title="Nascondi conto"
          style={{
            padding: "0.5rem 0.6rem", fontSize: 12,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            color: "var(--text-muted)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <EyeOff size={13} />
        </button>

        <button
          onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } setConfirmDelete(false); onDelete(account.id); }}
          onMouseLeave={() => setConfirmDelete(false)}
          title={confirmDelete ? "Conferma eliminazione" : "Elimina conto"}
          style={{
            padding: "0.5rem 0.6rem", fontSize: 12,
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${confirmDelete ? "var(--danger)" : "var(--border)"}`,
            background: confirmDelete ? "var(--danger-dim)" : "var(--bg-elevated)",
            color: confirmDelete ? "var(--danger)" : "var(--text-muted)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────
export function LiveAccounts() {
  const [accounts, setAccounts]                     = useState([]);
  const [loading, setLoading]                       = useState(true);
  const [configuringAccount, setConfiguringAccount] = useState(null);
  const [detailAccount, setDetailAccount]           = useState(null);
  const [lastUpdate, setLastUpdate]                 = useState(new Date());
  const [showHidden, setShowHidden]                 = useState(false);
  const [serverNow, setServerNow]                   = useState(null);
  const [monthlySummary, setMonthlySummary]         = useState([]);
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(true);
  const [showWithdrawalModal, setShowWithdrawalModal]     = useState(false);
  const [showExtraEarningModal, setShowExtraEarningModal] = useState(false);

  const [hiddenIds, setHiddenIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("hidden_accounts") || "[]"); }
    catch { return []; }
  });

  function saveHiddenIds(ids) {
    setHiddenIds(ids);
    localStorage.setItem("hidden_accounts", JSON.stringify(ids));
  }

  function toggleHide(accountId) {
    const newIds = hiddenIds.includes(accountId)
      ? hiddenIds.filter(id => id !== accountId)
      : [...hiddenIds, accountId];
    saveHiddenIds(newIds);
  }

  function loadAccounts() {
    api.getAccounts().then(({ accounts, server_time }) => {
      setAccounts(accounts);
      setServerNow(server_time);
      setLoading(false);
      setLastUpdate(new Date());
    });
  }

  function loadMonthlySummary() {
    setMonthlySummaryLoading(true);
    api.getLiveMonthlySummary()
      .then(setMonthlySummary)
      .catch(() => setMonthlySummary([]))
      .finally(() => setMonthlySummaryLoading(false));
  }

  useEffect(() => {
    loadAccounts();
    loadMonthlySummary();
    const interval = setInterval(loadAccounts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleSaveConfig(accountId, config) {
    setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, ...config } : a));
    try {
      await api.updateAccount(accountId, {
        name:                config.name,
        broker:              config.broker,
        account_type:        config.account_type,
        initial_balance:     config.initial_balance     ? parseFloat(config.initial_balance)     : undefined,
        max_daily_dd_pct:    config.max_daily_dd_pct    ? parseFloat(config.max_daily_dd_pct)    : undefined,
        max_total_dd_pct:    config.max_total_dd_pct    ? parseFloat(config.max_total_dd_pct)    : undefined,
        profit_target_pct:   config.profit_target_pct   ? parseFloat(config.profit_target_pct)   : undefined,
        max_margin_used_pct: config.max_margin_used_pct ? parseFloat(config.max_margin_used_pct) : undefined,
        bonus_credit:        config.bonus_credit        ? parseFloat(config.bonus_credit)        : 0,
      });
    } catch(e) {
      console.error("Errore salvataggio account:", e);
    }
  }

  const visibleAccounts = sortAccounts(
    accounts.filter(a => showHidden ? hiddenIds.includes(a.id) : !hiddenIds.includes(a.id))
  );
  const hiddenCount    = hiddenIds.filter(id => accounts.some(a => a.id === id)).length;
  const activeAccounts = accounts.filter(a => !hiddenIds.includes(a.id));
  const offlineCount   = activeAccounts.filter(a => isOffline(a, serverNow)).length;
  const totalBalance   = activeAccounts.reduce((s, a) => s + (a.balance   || 0), 0);
  const totalEquity    = activeAccounts.reduce((s, a) => s + (a.equity    || 0), 0);
  const totalBonus     = activeAccounts.reduce((s, a) => s + (a.bonus_credit || 0), 0);
  const totalDailyPnL  = activeAccounts.reduce((s, a) => s + (a.daily_pnl || 0), 0);
  const openPositions  = activeAccounts.reduce((s, a) => s + (a.open_positions?.length || 0), 0);
  const totalOpenPnL   = activeAccounts.reduce((s, a) =>
    s + (a.open_positions?.reduce((ss, p) => ss + (p.profit || 0), 0) || 0), 0);

  // PnL aggregato dei soli conti Live (esclusi Prop/Demo/Altro e nascosti)
  const liveOnlyAccounts   = activeAccounts.filter(a => a.account_type === "Live");
  const liveDailyPnL       = liveOnlyAccounts.reduce((s, a) => s + (a.daily_pnl   || 0), 0);
  const liveWeeklyPnL      = liveOnlyAccounts.reduce((s, a) => s + (a.weekly_pnl  || 0), 0);
  const liveMonthlyPnL     = liveOnlyAccounts.reduce((s, a) => s + (a.monthly_pnl || 0), 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Conti Live</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            {activeAccounts.length} conti attivi · aggiornato alle {lastUpdate.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
            {offlineCount > 0 && <span style={{ marginLeft: 8, color: "var(--danger)", fontWeight: 600 }}>· {offlineCount} offline ⚠</span>}
            {hiddenCount > 0 && <span style={{ marginLeft: 8 }}>· {hiddenCount} nascosti</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden(h => !h)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: showHidden ? "var(--accent-dim)" : "var(--bg-elevated)",
                border: `1px solid ${showHidden ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)", padding: "0.4rem 0.9rem",
                color: showHidden ? "var(--accent)" : "var(--text-secondary)",
                cursor: "pointer", fontSize: 13,
              }}
            >
              {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
              {showHidden ? "Mostra attivi" : `Nascosti (${hiddenCount})`}
            </button>
          )}
          <button onClick={loadAccounts} style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: "0.4rem 0.9rem",
            color: "var(--text-secondary)", cursor: "pointer", fontSize: 13,
          }}>
            <RefreshCw size={13} /> Aggiorna
          </button>
        </div>
      </div>

      {/* Cards riepilogo */}
      {!showHidden && (
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          {[
            { label: "BALANCE TOTALE",   value: fmtCurrency(totalBalance),              color: "var(--text-primary)"               },
            { label: "EQUITY TOTALE",    value: fmtCurrency(totalEquity - totalBonus),  color: pnlColor(totalEquity - totalBalance - totalBonus) },
            { label: "PNL APERTO",       value: fmtProfit(totalOpenPnL),                color: pnlColor(totalOpenPnL)              },
            { label: "PNL OGGI",         value: fmtProfit(totalDailyPnL),               color: pnlColor(totalDailyPnL)             },
            { label: "POSIZIONI APERTE", value: openPositions,                          color: openPositions > 0 ? "var(--warning)" : "var(--text-muted)" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)", padding: "0.9rem 1.1rem",
              flex: 1, minWidth: 130,
            }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, fontFamily: "var(--font-data)", color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Griglia conti */}
      {loading ? <Spinner /> : visibleAccounts.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "3rem",
          color: "var(--text-muted)", fontSize: 14,
          border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
        }}>
          <div style={{ fontSize: 32, marginBottom: "1rem" }}>{showHidden ? "👁" : "📡"}</div>
          <div style={{ marginBottom: 8 }}>{showHidden ? "Nessun conto nascosto" : "Nessun conto rilevato"}</div>
          {!showHidden && (
            <div style={{ fontSize: 12 }}>
              Carica l'EA Live Monitor su un conto MT5 — apparirà automaticamente qui
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Prop */}
          {visibleAccounts.some(a => a.account_type === "Prop") && (
            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--warning)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 3, height: 14, background: "var(--warning)", borderRadius: 2 }} />
                PROP FIRM
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
                {visibleAccounts.filter(a => a.account_type === "Prop").map(account => (
                  <AccountCard key={account.id} account={account} serverNow={serverNow}
                    onConfigure={setConfiguringAccount}
                    onCloseAll={id => api.closeAll(id)}
                    onClosePosition={(id, ticket) => api.closeTicket(id, ticket)}
                    onTogglePause={(id, newPaused) => api.setPause(id, newPaused)}
                    onToggleHide={toggleHide}
                    onOpenDetail={setDetailAccount}
                    onDelete={async (id) => { await api.deleteAccount(id); setAccounts(prev => prev.filter(a => a.id !== id)); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Live */}
          {visibleAccounts.some(a => a.account_type === "Live") && (
            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--accent)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 3, height: 14, background: "var(--accent)", borderRadius: 2 }} />
                LIVE
              </div>

              {/* PNL mensile conti Live (include prelievi e guadagni extra) */}
              {!showHidden && liveOnlyAccounts.length > 0 && (
                <MonthlyPnlPanel
                  months={monthlySummary}
                  loading={monthlySummaryLoading}
                  onAddWithdrawal={() => setShowWithdrawalModal(true)}
                  onAddExtraEarning={() => setShowExtraEarningModal(true)}
                />
              )}

              {/* Riepilogo PnL solo conti Live */}
              {!showHidden && liveOnlyAccounts.length > 0 && (
                <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                  {[
                    { label: "PNL LIVE OGGI",      value: liveDailyPnL   },
                    { label: "PNL LIVE 7 GIORNI",  value: liveWeeklyPnL  },
                    { label: "PNL LIVE 30 GIORNI", value: liveMonthlyPnL },
                  ].map(({ label, value }) => (
                    <div key={label} style={{
                      background: "var(--bg-surface)", border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)", padding: "0.75rem 1rem",
                      flex: 1, minWidth: 150,
                    }}>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-data)", color: pnlColor(value) }}>
                        {fmtProfit(value)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
                {visibleAccounts.filter(a => a.account_type === "Live").map(account => (
                  <AccountCard key={account.id} account={account} serverNow={serverNow}
                    onConfigure={setConfiguringAccount}
                    onCloseAll={id => api.closeAll(id)}
                    onClosePosition={(id, ticket) => api.closeTicket(id, ticket)}
                    onTogglePause={(id, newPaused) => api.setPause(id, newPaused)}
                    onToggleHide={toggleHide}
                    onOpenDetail={setDetailAccount}
                    onDelete={async (id) => { await api.deleteAccount(id); setAccounts(prev => prev.filter(a => a.id !== id)); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Demo/Altro */}
          {visibleAccounts.some(a => a.account_type !== "Prop" && a.account_type !== "Live") && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 3, height: 14, background: "var(--text-muted)", borderRadius: 2 }} />
                DEMO / ALTRO
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
                {visibleAccounts.filter(a => a.account_type !== "Prop" && a.account_type !== "Live").map(account => (
                  <AccountCard key={account.id} account={account} serverNow={serverNow}
                    onConfigure={setConfiguringAccount}
                    onCloseAll={id => api.closeAll(id)}
                    onClosePosition={(id, ticket) => api.closeTicket(id, ticket)}
                    onTogglePause={(id, newPaused) => api.setPause(id, newPaused)}
                    onToggleHide={toggleHide}
                    onOpenDetail={setDetailAccount}
                    onDelete={async (id) => { await api.deleteAccount(id); setAccounts(prev => prev.filter(a => a.id !== id)); }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modale configurazione */}
      {configuringAccount && (
        <ConfigModal
          account={configuringAccount}
          onClose={() => setConfiguringAccount(null)}
          onSave={handleSaveConfig}
        />
      )}

      {/* Modale dettaglio conto (equity curve + dati aggregati) */}
      {detailAccount && (
        <AccountDetailModal
          account={detailAccount}
          serverNow={serverNow}
          onClose={() => setDetailAccount(null)}
        />
      )}

      {/* Modale registra prelievo */}
      {showWithdrawalModal && (
        <WithdrawalModal
          accounts={accounts.filter(a => a.account_type === "Live")}
          onClose={() => setShowWithdrawalModal(false)}
          onSaved={loadMonthlySummary}
        />
      )}

      {/* Modale aggiungi guadagno extra */}
      {showExtraEarningModal && (
        <ExtraEarningModal
          onClose={() => setShowExtraEarningModal(false)}
          onSaved={loadMonthlySummary}
        />
      )}
    </div>
  );
}