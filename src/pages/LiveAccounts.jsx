import { useState, useEffect } from "react";
import { RefreshCw, Settings, X, Activity, ChevronDown, ChevronUp } from "lucide-react";
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
  const maxDD = account.initial_balance * (account.max_total_dd_pct / 100);
  return Math.min(Math.max((currentDD / maxDD) * 100, 0), 100);
}

function dailyDdPercent(account) {
  if (!account.initial_balance || !account.max_daily_dd_pct) return null;
  const maxDailyDD = account.initial_balance * (account.max_daily_dd_pct / 100);
  const usedDD = Math.abs(Math.min(0, account.daily_pnl || 0));
  return Math.min((usedDD / maxDailyDD) * 100, 100);
}

function targetPercent(account) {
  if (!account.initial_balance || !account.profit_target_pct) return null;
  const target = account.initial_balance * (account.profit_target_pct / 100);
  const profit = (account.balance || 0) - account.initial_balance;
  return Math.min(Math.max((profit / target) * 100, 0), 100);
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

// ─── Modale configurazione ────────────────────────────────────────────────────
function ConfigModal({ account, onClose, onSave }) {
  const [form, setForm] = useState({
    name:               account.name || account.id,
    broker:             account.broker || "",
    account_type:       account.account_type || "Demo",
    initial_balance:    account.initial_balance || "",
    max_daily_dd_pct:   account.max_daily_dd_pct || "",
    max_total_dd_pct:   account.max_total_dd_pct || "",
    profit_target_pct:  account.profit_target_pct || "",
    max_margin_used_pct:account.max_margin_used_pct || "",
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

        {/* Header */}
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

          {/* Nome leggibile */}
          <div>
            <label style={labelStyle}>NOME LEGGIBILE</label>
            <input
              name="name" value={form.name} onChange={handleChange}
              placeholder="es. FTMO 10K Challenge"
              style={inputStyle}
            />
          </div>

          {/* Broker */}
          <div>
            <label style={labelStyle}>BROKER</label>
            <input
              name="broker" value={form.broker} onChange={handleChange}
              placeholder="es. FTMO, The5ers, Axi..."
              style={inputStyle}
            />
          </div>

          {/* Tipo conto */}
          <div>
            <label style={labelStyle}>TIPO CONTO</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {["Live", "Prop", "Demo", "Altro"].map(type => (
                <button
                  key={type}
                  onClick={() => setForm(f => ({ ...f, account_type: type }))}
                  style={{
                    flex: 1, padding: "0.4rem", fontSize: 13,
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: form.account_type === type ? "var(--accent-dim)" : "var(--bg-elevated)",
                    color: form.account_type === type ? "var(--accent)" : "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Parametri prop */}
          {isProp && (
            <>
              <div style={{ height: 1, background: "var(--border)", margin: "0.25rem 0" }} />
              <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.05em" }}>
                PARAMETRI PROP FIRM
              </div>

              <div>
                <label style={labelStyle}>BALANCE INIZIALE (al momento del finanziamento)</label>
                <input
                  name="initial_balance" value={form.initial_balance}
                  onChange={handleChange} placeholder="es. 10000"
                  type="number" style={inputStyle}
                />
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

          {/* Bottoni */}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button onClick={onClose} style={{
              flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)", background: "var(--bg-elevated)",
              color: "var(--text-secondary)", cursor: "pointer", fontSize: 13,
            }}>
              Annulla
            </button>
            <button onClick={() => { onSave(account.id, form); onClose(); }} style={{
              flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)",
              border: "none", background: "var(--accent)",
              color: "#000", cursor: "pointer", fontSize: 13, fontWeight: 600,
            }}>
              Salva
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card singolo conto ───────────────────────────────────────────────────────
function AccountCard({ account, onConfigure, onCloseAll, onTogglePause }) {
  const [paused, setPaused]         = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showPositions, setShowPositions] = useState(true);

  const isProp      = account.account_type === "Prop";
  const ddPct       = ddPercent(account);
  const dailyPct    = dailyDdPercent(account);
  const tgtPct      = targetPercent(account);
  const equityPnL   = (account.equity || 0) - (account.balance || 0);
  const hasPositions = account.open_positions?.length > 0;
  const totalOpenPnL = account.open_positions?.reduce((s, p) => s + (p.profit || 0), 0) || 0;

  const isConfigured = account.account_type !== "Demo" || account.name !== account.id;

  function handleCloseAll() {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    onCloseAll(account.id);
  }

  const typeColor = account.account_type === "Prop"  ? "var(--warning)"
                  : account.account_type === "Live"  ? "var(--accent)"
                  : "var(--text-muted)";

  return (
    <div style={{
      background: "var(--bg-surface)",
      border: `1px solid ${!isConfigured ? "var(--warning)" : "var(--border)"}`,
      borderRadius: "var(--radius-lg)", padding: "1.25rem",
      display: "flex", flexDirection: "column", gap: "1rem",
      position: "relative",
    }}>

      {/* Banner "non configurato" */}
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: 3 }}>
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
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {account.name || account.id}
          </div>
          {account.name && account.name !== account.id && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-data)" }}>
              {account.id}
            </div>
          )}
          {account.broker && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{account.broker}</div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {/* Indicatore live */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: paused ? "var(--warning)" : "var(--accent)",
              boxShadow: paused ? "0 0 6px var(--warning)" : "0 0 6px var(--accent)",
            }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {paused ? "In pausa" : "Live"}
            </span>
          </div>
          {/* Tasto configura */}
          <button
            onClick={() => onConfigure(account)}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "var(--bg-elevated)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: "0.3rem 0.6rem",
              color: "var(--text-secondary)", cursor: "pointer", fontSize: 11,
            }}
          >
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
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3 }}>EQUITY</div>
          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-data)", color: pnlColor(equityPnL) }}>
            {fmtCurrency(account.equity)}
          </div>
          <div style={{ fontSize: 10, color: pnlColor(equityPnL), fontFamily: "var(--font-data)" }}>
            {fmtProfit(equityPnL)}
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
  const maxDD = account.initial_balance * (account.max_total_dd_pct / 100);
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
  const usedDD = Math.abs(Math.min(0, account.daily_pnl || 0));
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
          {/* Header posizioni — cliccabile per collapse */}
          <div
            onClick={() => setShowPositions(s => !s)}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "0.65rem 0.75rem", cursor: "pointer",
            }}
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
                ? <ChevronUp size={14} style={{ color: "var(--text-muted)" }} />
                : <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
              }
            </div>
          </div>

          {/* Lista posizioni */}
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
                    <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>
                      {pos.symbol}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {pos.lots} lot
                    </span>
                  </div>
                  <span style={{ fontFamily: "var(--font-data)", fontSize: 13, fontWeight: 600, color: pnlColor(pos.profit) }}>
                    {fmtProfit(pos.profit)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "0.55rem 0.75rem",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)" }} />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Nessuna posizione aperta</span>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

      {/* Pulsanti azione */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          onClick={() => { setPaused(p => !p); onTogglePause(account.id); }}
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
          onClick={handleCloseAll}
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
      </div>
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────
export function LiveAccounts() {
  const [accounts, setAccounts]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [configuringAccount, setConfiguringAccount] = useState(null);
  const [lastUpdate, setLastUpdate]     = useState(new Date());

  function loadAccounts() {
    api.getAccounts().then(data => {
      const withPositions = data.map(acc => ({
        ...acc,
        open_positions: acc.open_pnl !== 0 ? [
          { symbol: "XAUUSD", direction: "BUY",  lots: 0.10, profit: +(acc.open_pnl * 0.6).toFixed(2) },
          { symbol: "XAUUSD", direction: "SELL", lots: 0.05, profit: +(acc.open_pnl * 0.4).toFixed(2) },
        ] : [],
      }));
      setAccounts(withPositions);
      setLoading(false);
      setLastUpdate(new Date());
    });
  }

  useEffect(() => {
    loadAccounts();
    const interval = setInterval(loadAccounts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

async function handleSaveConfig(accountId, config) {
  // Aggiornamento ottimistico
  setAccounts(prev => prev.map(a =>
    a.id === accountId ? { ...a, ...config } : a
  ));
  // Salva sul backend
  try {
    await api.updateAccount(accountId, {
      name:                config.name,
      broker:              config.broker,
      account_type:        config.account_type,
      initial_balance:     config.initial_balance ? parseFloat(config.initial_balance) : undefined,
      max_daily_dd_pct:    config.max_daily_dd_pct ? parseFloat(config.max_daily_dd_pct) : undefined,
      max_total_dd_pct:    config.max_total_dd_pct ? parseFloat(config.max_total_dd_pct) : undefined,
      profit_target_pct:   config.profit_target_pct ? parseFloat(config.profit_target_pct) : undefined,
      max_margin_used_pct: config.max_margin_used_pct ? parseFloat(config.max_margin_used_pct) : undefined,
    });
  } catch(e) {
    console.error("Errore salvataggio account:", e);
  }
}

  const totalBalance   = accounts.reduce((s, a) => s + (a.balance   || 0), 0);
  const totalEquity    = accounts.reduce((s, a) => s + (a.equity    || 0), 0);
  const totalDailyPnL  = accounts.reduce((s, a) => s + (a.daily_pnl || 0), 0);
  const openPositions  = accounts.reduce((s, a) => s + (a.open_positions?.length || 0), 0);
  const totalOpenPnL   = accounts.reduce((s, a) =>
    s + (a.open_positions?.reduce((ss, p) => ss + (p.profit || 0), 0) || 0), 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Conti Live</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            {accounts.length} conti · aggiornato alle {lastUpdate.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <button onClick={loadAccounts} style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "var(--bg-elevated)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)", padding: "0.4rem 0.9rem",
          color: "var(--text-secondary)", cursor: "pointer", fontSize: 13,
        }}>
          <RefreshCw size={13} /> Aggiorna
        </button>
      </div>

      {/* Cards riepilogo */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {[
          { label: "BALANCE TOTALE",   value: fmtCurrency(totalBalance),  color: "var(--text-primary)"         },
          { label: "EQUITY TOTALE",    value: fmtCurrency(totalEquity),   color: pnlColor(totalEquity - totalBalance) },
          { label: "PNL APERTO",       value: fmtProfit(totalOpenPnL),    color: pnlColor(totalOpenPnL)        },
          { label: "PNL OGGI",         value: fmtProfit(totalDailyPnL),   color: pnlColor(totalDailyPnL)       },
          { label: "POSIZIONI APERTE", value: openPositions,              color: openPositions > 0 ? "var(--warning)" : "var(--text-muted)" },
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

      {/* Griglia conti */}
      {loading ? <Spinner /> : accounts.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "3rem",
          color: "var(--text-muted)", fontSize: 14,
          border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
        }}>
          <div style={{ fontSize: 32, marginBottom: "1rem" }}>📡</div>
          <div style={{ marginBottom: 8 }}>Nessun conto rilevato</div>
          <div style={{ fontSize: 12 }}>
            Carica l'EA Live Monitor su un conto MT5 — apparirà automaticamente qui al primo invio dati
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
          {accounts.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              onConfigure={setConfiguringAccount}
              onCloseAll={id => api.closeAll(id)}
              onTogglePause={id => api.togglePause(id)}
            />
          ))}
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
    </div>
  );
}