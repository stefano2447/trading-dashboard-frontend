import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Edit2, Check, X } from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, ReferenceLine,
  Cell, CartesianGrid
} from "recharts";
import { api } from "../api/client";
import { Spinner } from "../components/ui/Spinner";
import { useEAConfigs } from "../hooks/useEAConfigs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthsActive(firstDate) {
  if (!firstDate) return 0;
  const start = new Date(firstDate);
  const now   = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("it-IT");
}

function fmtProfit(val) {
  if (val === null || val === undefined) return "—";
  const n = Number(val);
  if (isNaN(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function fmt(val, dec = 2) {
  if (val === null || val === undefined) return "—";
  const n = Number(val);
  if (isNaN(n)) return "—";
  return n.toFixed(dec);
}

function isExpiringSoon(dateStr) {
  if (!dateStr) return false;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return false;
  const [dd, mm, yyyy] = parts.map(Number);
  if (!dd || !mm || !yyyy) return false;
  const target = new Date(yyyy, mm - 1, dd);
  return target - new Date() < 30 * 24 * 3600 * 1000;
}

function netProfit(t) {
  return t.net_profit ?? (t.profit + (t.commission || 0) + (t.swap || 0));
}

function normProfit(t) {
  const raw  = netProfit(t);
  const lots = t.lots && t.lots > 0 ? t.lots : 0.01;
  return raw * (0.01 / lots);
}

// ─── Calcoli ──────────────────────────────────────────────────────────────────

function calcEquityCurve(trades, mode) {
  let equity = 0, peak = 0;
  return trades.map(t => {
    const val = mode === "norm" ? normProfit(t) : netProfit(t);
    equity += val;
    if (equity > peak) peak = equity;
    const dd = Math.min(0, equity - peak);
    return {
      date:     new Date(t.close_time).toLocaleDateString("it-IT"),
      equity:   +equity.toFixed(2),
      drawdown: +dd.toFixed(2),
    };
  });
}

function calcMaxDD(trades) {
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of trades) {
    equity += normProfit(t);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function calcMaxConsecLoss(trades) {
  let max = 0, cur = 0;
  for (const t of trades) {
    if (netProfit(t) < 0) { cur++; if (cur > max) max = cur; } else cur = 0;
  }
  return max;
}

const DAYS   = ["Lun", "Mar", "Mer", "Gio", "Ven"];
const HOURS  = Array.from({ length: 24 }, (_, i) => i);
const MONTHS = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

function calcHeatmap(trades) {
  const map = {};
  for (const t of trades) {
    const dt   = new Date(t.open_time);
    const day  = dt.getDay();
    const hour = dt.getHours();
    if (day === 0 || day === 6) continue;
    const key = `${day}_${hour}`;
    if (!map[key]) map[key] = { profit: 0, count: 0 };
    map[key].profit += netProfit(t);
    map[key].count++;
  }
  return map;
}

function calcDayBar(trades) {
  const map = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const t of trades) {
    const day = new Date(t.open_time).getDay();
    if (day >= 1 && day <= 5) map[day] += netProfit(t);
  }
  return DAYS.map((label, i) => ({ label, profit: +map[i + 1].toFixed(2) }));
}

function calcHourBar(trades) {
  const map = {};
  for (let h = 0; h < 24; h++) map[h] = 0;
  for (const t of trades) {
    const h = new Date(t.open_time).getHours();
    map[h] += netProfit(t);
  }
  return HOURS.map(h => ({ label: `${h}h`, profit: +map[h].toFixed(2) }));
}

function calcMonthBar(trades) {
  const map = {};
  for (let m = 0; m < 12; m++) map[m] = 0;
  for (const t of trades) {
    const month = new Date(t.close_time).getMonth();
    map[month] += netProfit(t);
  }
  return MONTHS.map((label, i) => ({ label, profit: +map[i].toFixed(2) }));
}

// ─── Componenti UI ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem 0.75rem", fontSize: 12 }}>
      <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.value >= 0 ? "var(--accent)" : "var(--danger)", fontFamily: "var(--font-data)" }}>
          {p.name}: {p.value >= 0 ? "+" : ""}{Number(p.value).toFixed(2)}
        </div>
      ))}
    </div>
  );
}

function MetricRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{label}</span>
      <span style={{ fontFamily: "var(--font-data)", fontSize: 13, fontWeight: 500, color: color || "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function CompareRow({ label, live, backtest, higherIsBetter = true }) {
  const l = live, b = backtest;
  const hasBoth = l != null && b != null && !isNaN(l) && !isNaN(b);
  const delta = hasBoth ? l - b : null;
  const good  = hasBoth ? (higherIsBetter ? delta >= 0 : delta <= 0) : null;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 90px 90px 70px", alignItems: "center",
      padding: "0.5rem 0", borderBottom: "1px solid var(--border)", fontSize: 12,
    }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-data)", textAlign: "right" }}>{b != null ? fmt(b) : "—"}</span>
      <span style={{ fontFamily: "var(--font-data)", textAlign: "right", fontWeight: 600 }}>{l != null ? fmt(l) : "—"}</span>
      <span style={{
        textAlign: "right", fontSize: 11,
        color: hasBoth ? (good ? "var(--accent)" : "var(--danger)") : "var(--text-muted)",
      }}>
        {hasBoth ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}` : "—"}
      </span>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem", marginTop: "1.5rem" }}>
      {children}
    </div>
  );
}

function EditableField({ label, value, placeholder, onSave, monospace = false, warning = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  function save() { onSave(draft.trim()); setEditing(false); }

  if (editing) {
    return (
      <div style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={placeholder}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            style={{ flex: 1, background: "var(--bg-elevated)", border: "1px solid var(--accent)", borderRadius: 4, color: "var(--text-primary)", padding: "4px 8px", fontSize: 12, outline: "none", fontFamily: monospace ? "var(--font-data)" : "inherit" }}
          />
          <button onClick={save} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}><Check size={14} /></button>
          <button onClick={() => setEditing(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={14} /></button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {warning && value && <span style={{ fontSize: 10, color: "var(--danger)" }}>⚠ imminente</span>}
          <span style={{ fontFamily: monospace ? "var(--font-data)" : "inherit", fontSize: 13, fontWeight: 500, color: warning && value ? "var(--danger)" : value ? "var(--text-primary)" : "var(--text-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {value || <span style={{ fontStyle: "italic", fontSize: 11 }}>non impostato</span>}
          </span>
          <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
            <Edit2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────
export function EADetail() {
  const { name }    = useParams();
  const navigate    = useNavigate();
  const [trades, setTrades]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [equityMode, setEquityMode] = useState("norm");
  const { getConfig, updateConfig } = useEAConfigs();
  const [btCandidates, setBtCandidates] = useState([]);
  const [btRef, setBtRef]               = useState("");
  const [btData, setBtData]             = useState(null);
  const [btNames, setBtNames]           = useState([]);

  const eaName = name ? decodeURIComponent(name) : null;

  useEffect(() => {
    if (!eaName) { setLoading(false); return; }
    api.getEATrades(eaName).then(data => {
      const sorted = [...data].sort((a, b) => new Date(a.close_time) - new Date(b.close_time));
      setTrades(sorted);
      setLoading(false);
    });
  }, [eaName]);

  // Backtest: nomi disponibili + suggerimenti automatici per l'EA corrente
  useEffect(() => {
    if (!eaName) return;
    api.listBacktestNames().then(d => setBtNames(d.names || []));
    api.suggestBacktestMatch(eaName).then(d => setBtCandidates(d.candidates || []));
  }, [eaName]);

  // Precompila con il riferimento salvato, o col miglior suggerimento se non impostato
  useEffect(() => {
    if (!eaName) return;
    const saved = getConfig(eaName)?.backtest_ref;
    if (saved) setBtRef(saved);
    else if (btCandidates.length && btCandidates[0].score > 0.4) setBtRef(btCandidates[0].backtest_ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eaName, btCandidates]);

  // Carica le metriche di backtest quando cambia il riferimento
  useEffect(() => {
    if (!btRef) { setBtData(null); return; }
    api.getBacktestReference(btRef).then(setBtData).catch(() => setBtData(null));
  }, [btRef]);

  function saveBacktestRef(ref) {
    setBtRef(ref);
    updateConfig(eaName, { backtest_ref: ref });
    api.saveEAConfig(eaName, { backtest_ref: ref });
  }

  const metrics = useMemo(() => {
    if (!trades.length) return null;

    const profitsNorm = trades.map(normProfit);
    const profitsRaw  = trades.map(netProfit);

    const wins   = profitsNorm.filter(p => p > 0);
    const losses = profitsNorm.filter(p => p < 0);
    const total  = profitsNorm.reduce((s, p) => s + p, 0);
    const totalRaw = profitsRaw.reduce((s, p) => s + p, 0);

    const grossW = wins.reduce((s, p) => s + p, 0);
    const grossL = Math.abs(losses.reduce((s, p) => s + p, 0));
    const pf     = grossL > 0 ? grossW / grossL : null;
    const avgWin  = wins.length   ? grossW / wins.length   : 0;
    const avgLoss = losses.length ? grossL / losses.length : 0;
    const winRate = profitsNorm.length ? (wins.length / profitsNorm.length) * 100 : 0;
    const avgRR   = avgLoss > 0 ? avgWin / avgLoss : null;
    const expectancy = profitsNorm.length
      ? (wins.length / profitsNorm.length) * avgWin - (losses.length / profitsNorm.length) * avgLoss
      : 0;

    const maxDD  = calcMaxDD(trades);
    const avgLots = trades.reduce((s, t) => s + (t.lots || 0.01), 0) / trades.length;
    const months  = monthsActive(trades[0]?.open_time);
    const calmar  = months > 0 && maxDD > 0 ? (total * (12 / months)) / maxDD : null;
    const retDD   = maxDD > 0 ? total / maxDD : null;
    const maxCL   = calcMaxConsecLoss(trades);

    return {
      total, totalRaw, pf, winRate,
      wins: wins.length, losses: losses.length,
      avgWin, avgLoss, avgRR, expectancy,
      maxDD, calmar, retDD, maxCL,
      months, avgLots,
      firstTrade: trades[0]?.open_time,
      lastTrade:  trades[trades.length - 1]?.close_time,
    };
  }, [trades]);

  const equityCurve = useMemo(() => {
    if (!trades.length) return [];
    return calcEquityCurve(trades, equityMode);
  }, [trades, equityMode]);

  const heatmap  = useMemo(() => calcHeatmap(trades),  [trades]);
  const dayBar   = useMemo(() => calcDayBar(trades),   [trades]);
  const hourBar  = useMemo(() => calcHourBar(trades),  [trades]);
  const monthBar = useMemo(() => calcMonthBar(trades), [trades]);

  const heatValues = Object.values(heatmap).map(v => v.profit);
  const heatMax    = Math.max(...heatValues.map(Math.abs), 1);

  function heatColor(profit) {
    const intensity = Math.min(Math.abs(profit) / heatMax, 1);
    if (profit > 0) return `rgba(61,214,140,${0.15 + intensity * 0.7})`;
    if (profit < 0) return `rgba(224,82,82,${0.15 + intensity * 0.7})`;
    return "var(--bg-elevated)";
  }

  const config   = eaName ? getConfig(eaName) : {};
  const nextOpt  = config.next_optimization || "";
  const notes    = config.notes || "";
  const expiring = isExpiringSoon(nextOpt);

  if (!eaName) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: "1rem" }}>Analisi EA</h1>
        <p style={{ color: "var(--text-muted)" }}>
          Seleziona una strategia dalla{" "}
          <span style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => navigate("/")}>EA Overview</span>.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.35rem 0.75rem", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <ArrowLeft size={14} /> Overview
        </button>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>{eaName}</h1>
          {metrics && (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              {trades.length} trade · attivo da {metrics.months} mesi · {trades[0]?.symbol || ""}
            </p>
          )}
        </div>
      </div>

      {loading ? <Spinner /> : !metrics ? (
        <p style={{ color: "var(--text-muted)" }}>Nessun trade trovato per questa strategia.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* Cards metriche top */}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {[
              { label: "NET PROFIT (norm.)", value: fmtProfit(metrics.total),                         color: metrics.total    >= 0   ? "var(--accent)"  : "var(--danger)"  },
              { label: "PROFIT FACTOR",      value: fmt(metrics.pf),                                  color: (metrics.pf||0)  >= 1.5 ? "var(--accent)"  : "var(--warning)" },
              { label: "CALMAR RATIO",       value: fmt(metrics.calmar),                              color: (metrics.calmar||0) >= 2 ? "var(--accent)"  : "var(--warning)" },
              { label: "RET/DD",             value: fmt(metrics.retDD),                               color: (metrics.retDD||0)  >= 2 ? "var(--accent)"  : "var(--warning)" },
              { label: "WIN RATE",           value: `${fmt(metrics.winRate, 1)}%`,                    color: metrics.winRate  >= 55  ? "var(--accent)"  : "var(--warning)" },
              { label: "MAX DD (norm.)",     value: metrics.maxDD > 0 ? `-${fmt(metrics.maxDD)}` : "—", color: "var(--danger)" },
            ].map(m => (
              <div key={m.label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "0.9rem 1.1rem", flex: 1, minWidth: 130 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: 5 }}>{m.label}</div>
                <div style={{ fontSize: 20, fontWeight: 600, fontFamily: "var(--font-data)", color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Equity curve */}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)" }}>EQUITY CURVE</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["norm", "real"].map(mode => (
                  <button key={mode} onClick={() => setEquityMode(mode)} style={{ padding: "0.2rem 0.6rem", fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: equityMode === mode ? "var(--accent-dim)" : "var(--bg-elevated)", color: equityMode === mode ? "var(--accent)" : "var(--text-muted)", cursor: "pointer" }}>
                    {mode === "norm" ? "Normalizzata" : "Reale"}
                  </button>
                ))}
              </div>
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={equityCurve} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3dd68c" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3dd68c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} width={55} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="equity" name="Equity" stroke="#3dd68c" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>

            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.05em" }}>DRAWDOWN ($)</div>
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={equityCurve} margin={{ top: 0, right: 5, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#e05252" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#e05252" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis hide />
                  <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} width={55} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="drawdown" name="DD $" stroke="#e05252" strokeWidth={1.5} fill="url(#ddGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Live vs Backtest */}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)" }}>LIVE vs BACKTEST</div>
              <select
                value={btRef}
                onChange={e => saveBacktestRef(e.target.value)}
                style={{
                  background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 4,
                  color: "var(--text-primary)", padding: "4px 8px", fontSize: 12, fontFamily: "var(--font-data)",
                }}
              >
                <option value="">— Nessun riferimento —</option>
                {btCandidates.length > 0 && (
                  <optgroup label="Suggeriti">
                    {btCandidates.map(c => (
                      <option key={c.backtest_ref} value={c.backtest_ref}>
                        {c.backtest_ref} ({Math.round(c.score * 100)}%)
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Tutti">
                  {btNames.map(n => <option key={n} value={n}>{n}</option>)}
                </optgroup>
              </select>
            </div>

            {!btRef ? (
              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
                Seleziona un riferimento di backtest per confrontare le performance.
              </p>
            ) : !btData ? (
              <Spinner />
            ) : (
              <>
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 90px 90px 70px",
                  padding: "0.4rem 0", borderBottom: "2px solid var(--border)",
                  fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.05em",
                }}>
                  <span>METRICA</span>
                  <span style={{ textAlign: "right" }}>BACKTEST</span>
                  <span style={{ textAlign: "right" }}>LIVE</span>
                  <span style={{ textAlign: "right" }}>DELTA</span>
                </div>
                <CompareRow label="Calmar Ratio" live={metrics.calmar}  backtest={btData.calmar} />
                <CompareRow label="Win Rate %"   live={metrics.winRate} backtest={btData.win_rate} />
                <CompareRow label="Avg RR"       live={metrics.avgRR}   backtest={btData.avg_rr} />
                <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: "0.75rem" }}>
                  Backtest: {btData.period || "—"} · {btData.n_trades ?? "—"} trade &nbsp;|&nbsp;
                  Live: {trades.length} trade dal {fmtDate(metrics.firstTrade)}.
                  Max DD non incluso nel confronto diretto: nel backtest è in % sul capitale iniziale
                  ({fmt(btData.max_dd_pct)}%), nel live è normalizzato a 0.01 lotti — scale diverse, non comparabili 1:1.
                </p>
              </>
            )}
          </div>

          {/* Metriche + Heatmap */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem" }}>

            {/* Pannello sinistro */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
                <SectionTitle>METRICHE COMPLETE</SectionTitle>
                <MetricRow label="Totale trade"       value={trades.length} />
                <MetricRow label="Win / Loss"         value={`${metrics.wins} / ${metrics.losses}`} />
                <MetricRow label="Win Rate"           value={`${fmt(metrics.winRate, 1)}%`}    color={metrics.winRate >= 55 ? "var(--accent)" : "var(--warning)"} />
                <MetricRow label="Profit Factor"      value={fmt(metrics.pf)}                  color={(metrics.pf||0) >= 1.5 ? "var(--accent)" : "var(--warning)"} />
                <MetricRow label="Net Profit (reale)" value={fmtProfit(metrics.totalRaw)}       color={metrics.totalRaw >= 0 ? "var(--accent)" : "var(--danger)"} />
                <MetricRow label="Net Profit (norm.)" value={fmtProfit(metrics.total)}          color={metrics.total >= 0 ? "var(--accent)" : "var(--danger)"} />
                <MetricRow label="Max DD (norm.)"     value={metrics.maxDD > 0 ? `-${fmt(metrics.maxDD)}` : "—"} color="var(--danger)" />
                <MetricRow label="Ret/DD"             value={fmt(metrics.retDD)}               color={(metrics.retDD||0) >= 2 ? "var(--accent)" : "var(--warning)"} />
                <MetricRow label="Calmar Ratio"       value={fmt(metrics.calmar)}              color={(metrics.calmar||0) >= 2 ? "var(--accent)" : "var(--warning)"} />
                <MetricRow label="Avg Win"            value={`+${fmt(metrics.avgWin)}`}        color="var(--accent)" />
                <MetricRow label="Avg Loss"           value={`-${fmt(metrics.avgLoss)}`}       color="var(--danger)" />
                <MetricRow label="Avg RR"             value={fmt(metrics.avgRR)} />
                <MetricRow label="Expectancy"         value={fmtProfit(metrics.expectancy)}    color={metrics.expectancy >= 0 ? "var(--accent)" : "var(--danger)"} />
                <MetricRow label="Max consec. loss"   value={metrics.maxCL}                    color={metrics.maxCL >= 8 ? "var(--danger)" : "var(--text-primary)"} />
                <MetricRow label="Primo trade"        value={fmtDate(metrics.firstTrade)} />
                <MetricRow label="Ultimo trade"       value={fmtDate(metrics.lastTrade)} />
                <MetricRow label="Mesi attivo"        value={metrics.months} />
                <MetricRow label="Lotti medi"         value={fmt(metrics.avgLots)} />
              </div>

              <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
                <SectionTitle>GESTIONE</SectionTitle>
                <EditableField label="Prossima ottimizzazione" value={nextOpt} placeholder="gg/mm/aaaa" monospace warning={expiring} onSave={val => updateConfig(eaName, { next_optimization: val })} />
                <EditableField label="Note" value={notes} placeholder="Aggiungi note sulla strategia..." onSave={val => updateConfig(eaName, { notes: val })} />
              </div>
            </div>

            {/* Pannello destro */}
            <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>

              <SectionTitle>HEATMAP GIORNO × ORA</SectionTitle>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 32, color: "var(--text-muted)", fontWeight: 400 }} />
                      {HOURS.map(h => (
                        <th key={h} style={{ width: 22, textAlign: "center", color: "var(--text-muted)", fontWeight: 400, padding: "0 1px" }}>
                          {h % 3 === 0 ? h : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((day, di) => (
                      <tr key={day}>
                        <td style={{ color: "var(--text-muted)", fontSize: 10, paddingRight: 6, whiteSpace: "nowrap" }}>{day}</td>
                        {HOURS.map(h => {
                          const key  = `${di + 1}_${h}`;
                          const cell = heatmap[key];
                          return (
                            <td key={h}
                              title={cell ? `${day} ${h}h: ${cell.profit >= 0 ? "+" : ""}${cell.profit.toFixed(2)} (${cell.count} trade)` : "Nessun trade"}
                              style={{ width: 20, height: 18, background: cell ? heatColor(cell.profit) : "var(--bg-elevated)", border: "1px solid var(--bg-base)", borderRadius: 2, cursor: cell ? "help" : "default" }}
                            />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(61,214,140,0.7)", borderRadius: 2, marginRight: 4 }} />Profitto
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, background: "rgba(224,82,82,0.7)", borderRadius: 2, marginRight: 4 }} />Perdita
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Hover per dettaglio</span>
                </div>
              </div>

              <SectionTitle>PERFORMANCE PER GIORNO</SectionTitle>
              <ResponsiveContainer width="100%" height={110}>
                <BarChart data={dayBar} margin={{ top: 0, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Bar dataKey="profit" name="Profit" radius={[3, 3, 0, 0]}>
                    {dayBar.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? "#3dd68c" : "#e05252"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <SectionTitle>PERFORMANCE PER ORA</SectionTitle>
              <ResponsiveContainer width="100%" height={110}>
                <BarChart data={hourBar} margin={{ top: 0, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} interval={2} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Bar dataKey="profit" name="Profit" radius={[2, 2, 0, 0]}>
                    {hourBar.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? "#3dd68c" : "#e05252"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              <SectionTitle>PERFORMANCE PER MESE</SectionTitle>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={monthBar} margin={{ top: 0, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Bar dataKey="profit" name="Profit" radius={[2, 2, 0, 0]}>
                    {monthBar.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? "#3dd68c" : "#e05252"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Lista trade */}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
            <SectionTitle>LISTA TRADE ({trades.length})</SectionTitle>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["#", "Apertura", "Chiusura", "Dir.", "Lotti", "Open", "Close", "Profit", "Comm.", "Net"].map(h => (
                      <th key={h} style={{ padding: "0.5rem 0.75rem", textAlign: ["#", "Dir."].includes(h) ? "left" : "right", color: "var(--text-muted)", fontSize: 11, fontWeight: 500 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => {
                    const net = netProfit(t);
                    return (
                      <tr key={t.ticket || i} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.1s" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <td style={{ padding: "0.5rem 0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-data)", fontSize: 11 }}>{i + 1}</td>
                        <td style={{ padding: "0.5rem 0.75rem", fontFamily: "var(--font-data)", fontSize: 11, color: "var(--text-secondary)" }}>{fmtDate(t.open_time)}</td>
                        <td style={{ padding: "0.5rem 0.75rem", fontFamily: "var(--font-data)", fontSize: 11, color: "var(--text-secondary)" }}>{fmtDate(t.close_time)}</td>
                        <td style={{ padding: "0.5rem 0.75rem" }}>
                          <span style={{ fontFamily: "var(--font-data)", fontSize: 11, color: t.direction === "BUY" ? "var(--accent)" : "var(--danger)" }}>{t.direction}</span>
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)", fontSize: 11 }}>{t.lots}</td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)", fontSize: 11, color: "var(--text-secondary)" }}>{t.open_price}</td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)", fontSize: 11, color: "var(--text-secondary)" }}>{t.close_price}</td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)", fontSize: 11, color: (t.profit||0) >= 0 ? "var(--accent)" : "var(--danger)" }}>{fmtProfit(t.profit)}</td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)", fontSize: 11, color: "var(--text-muted)" }}>{t.commission != null ? fmt(t.commission) : "—"}</td>
                        <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)", fontSize: 11, fontWeight: 600, color: net >= 0 ? "var(--accent)" : "var(--danger)" }}>{fmtProfit(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}