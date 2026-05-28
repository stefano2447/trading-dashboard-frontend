import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Save, ChevronDown, BarChart2 } from "lucide-react";
import { api } from "../api/client";
import { Spinner } from "../components/ui/Spinner";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid
} from "recharts";

// ─── Persistenza portafogli ───────────────────────────────────────────────────
function loadPortfolios() {
  try {
    const saved = localStorage.getItem("portfolios");
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

function savePortfolios(portfolios) {
  try { localStorage.setItem("portfolios", JSON.stringify(portfolios)); } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthsActive(firstDate) {
  if (!firstDate) return 0;
  const start = new Date(firstDate);
  const now = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
}

function fmtProfit(val) {
  if (val === null || val === undefined) return "—";
  const n = Number(val);
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function calcPortfolioMetrics(selectedEANames, tradesByEA) {
  if (!selectedEANames.length) return null;

  const allTrades = [];
  for (const name of selectedEANames) {
    const trades = (tradesByEA[name] || []).sort((a, b) => new Date(a.close_time) - new Date(b.close_time));
    if (!trades.length) continue;
    const avgLots    = trades.reduce((s, t) => s + (t.lots || 0.01), 0) / trades.length;
    const normFactor = 0.01 / avgLots;
    for (const t of trades) {
      const raw = t.net_profit ?? (t.profit + (t.commission || 0) + (t.swap || 0));
      allTrades.push({ ...t, net_profit_norm: raw * normFactor });
    }
  }

  if (!allTrades.length) return null;
  allTrades.sort((a, b) => new Date(a.close_time) - new Date(b.close_time));

  const dayMap = {};
  for (const t of allTrades) {
    const day = t.close_time?.slice(0, 10);
    if (!day) continue;
    if (!dayMap[day]) dayMap[day] = 0;
    dayMap[day] += t.net_profit_norm;
  }

  let equity = 0, peak = 0, maxDD = 0;
  const equityCurve = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, pnl]) => {
      equity += pnl;
      if (equity > peak) peak = equity;
      const dd = Math.min(0, equity - peak);
      if (peak - equity > maxDD) maxDD = peak - equity;
      return {
        date: new Date(day).toLocaleDateString("it-IT"),
        equity: +equity.toFixed(2),
        drawdown: +dd.toFixed(2),
      };
    });

  const profits = allTrades.map(t => t.net_profit_norm);
  const wins    = profits.filter(p => p > 0);
  const losses  = profits.filter(p => p < 0);
  const total   = profits.reduce((s, p) => s + p, 0);
  const grossW  = wins.reduce((s, p) => s + p, 0);
  const grossL  = Math.abs(losses.reduce((s, p) => s + p, 0));
  const pf      = grossL > 0 ? grossW / grossL : null;
  const avgWin  = wins.length ? grossW / wins.length : 0;
  const avgLoss = losses.length ? grossL / losses.length : 0;
  const winRate = profits.length ? (wins.length / profits.length) * 100 : 0;

  const firstDate = allTrades[0]?.close_time;
  const months    = monthsActive(firstDate);
  const calmar    = months > 0 && maxDD > 0 ? (total * (12 / months)) / maxDD : null;
  const retDD     = maxDD > 0 ? total / maxDD : null;

  let maxCL = 0, curCL = 0;
  for (const p of profits) {
    if (p < 0) { curCL++; if (curCL > maxCL) maxCL = curCL; } else curCL = 0;
  }

  return {
    total, pf, winRate, maxDD, calmar, retDD,
    wins: wins.length, losses: losses.length,
    totalTrades: profits.length,
    avgWin, avgLoss,
    avgRR: avgLoss > 0 ? avgWin / avgLoss : null,
    expectancy: profits.length
      ? (wins.length / profits.length) * avgWin - (losses.length / profits.length) * avgLoss
      : 0,
    maxCL, months, firstDate, equityCurve,
  };
}

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
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.45rem 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{label}</span>
      <span style={{ fontFamily: "var(--font-data)", fontSize: 13, fontWeight: 500, color: color || "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────
export function Portfolios() {
  const [tradesByEA, setTradesByEA]             = useState({});
  const [loading, setLoading]                   = useState(true);
  const [selected, setSelected]                 = useState([]);
  const [portfolios, setPortfolios]             = useState(loadPortfolios);
  const [activePortfolio, setActivePortfolio]   = useState(null);
  const [saveModalOpen, setSaveModalOpen]       = useState(false);
  const [saveName, setSaveName]                 = useState("");
  const [compareWith, setCompareWith]           = useState("");

  useEffect(() => {
    api.getAllTrades().then(data => {
      setTradesByEA(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => { savePortfolios(portfolios); }, [portfolios]);

  const allEANames = useMemo(() => Object.keys(tradesByEA), [tradesByEA]);

  const metrics = useMemo(() =>
    calcPortfolioMetrics(selected, tradesByEA),
    [selected, tradesByEA]
  );

  const compareMetrics = useMemo(() => {
    if (!compareWith || !portfolios[compareWith]) return null;
    return calcPortfolioMetrics(portfolios[compareWith].eas, tradesByEA);
  }, [compareWith, portfolios, tradesByEA]);

  function toggleEA(name) {
    setSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
    setActivePortfolio(null);
  }

  function loadPortfolio(name) {
    if (!portfolios[name]) return;
    setSelected(portfolios[name].eas);
    setActivePortfolio(name);
    setCompareWith("");
  }

  function handleSave() {
    if (!saveName.trim() || !selected.length) return;
    setPortfolios(prev => ({
      ...prev,
      [saveName.trim()]: { eas: selected, savedAt: new Date().toISOString() },
    }));
    setActivePortfolio(saveName.trim());
    setSaveName("");
    setSaveModalOpen(false);
  }

  function deletePortfolio(name) {
    setPortfolios(prev => { const next = { ...prev }; delete next[name]; return next; });
    if (activePortfolio === name) setActivePortfolio(null);
    if (compareWith === name) setCompareWith("");
  }

  const savedNames = Object.keys(portfolios);

  if (loading) return <Spinner />;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Portafogli</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Seleziona EA per costruire un portafoglio e analizzarne le metriche combinate
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {savedNames.length > 0 && (
            <div style={{ position: "relative" }}>
              <select
                value={activePortfolio || ""}
                onChange={e => e.target.value ? loadPortfolio(e.target.value) : null}
                style={{
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", color: activePortfolio ? "var(--accent)" : "var(--text-secondary)",
                  padding: "0.4rem 2rem 0.4rem 0.75rem", fontSize: 13, cursor: "pointer",
                  outline: "none", appearance: "none",
                }}
              >
                <option value="">Carica portafoglio...</option>
                {savedNames.map(name => (
                  <option key={name} value={name}>{name} ({portfolios[name].eas.length} EA)</option>
                ))}
              </select>
              <ChevronDown size={13} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
            </div>
          )}
          <button
            onClick={() => setSaveModalOpen(true)}
            disabled={!selected.length}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: selected.length ? "var(--accent-dim)" : "var(--bg-elevated)",
              border: `1px solid ${selected.length ? "var(--accent)" : "var(--border)"}`,
              borderRadius: "var(--radius-sm)", padding: "0.4rem 0.9rem",
              color: selected.length ? "var(--accent)" : "var(--text-muted)",
              cursor: selected.length ? "pointer" : "not-allowed", fontSize: 13,
            }}
          >
            <Save size={13} />
            {activePortfolio ? `Aggiorna "${activePortfolio}"` : "Salva portafoglio"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "1rem" }}>

        {/* Pannello selezione EA */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1rem", maxHeight: 500, overflowY: "auto" }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              SELEZIONA EA ({selected.length} selezionati)
            </div>
            {allEANames.map(name => {
              const isSelected = selected.includes(name);
              return (
                <div
                  key={name}
                  onClick={() => toggleEA(name)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "0.5rem", borderRadius: "var(--radius-sm)", cursor: "pointer",
                    background: isSelected ? "var(--accent-dim)" : "transparent",
                    border: `1px solid ${isSelected ? "rgba(61,214,140,0.3)" : "transparent"}`,
                    marginBottom: 3, transition: "all 0.1s",
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                    background: isSelected ? "var(--accent)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {isSelected && <span style={{ color: "#000", fontSize: 10, fontWeight: 700 }}>✓</span>}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400, color: isSelected ? "var(--accent)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      {(tradesByEA[name] || []).length} trade
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => { setSelected(allEANames); setActivePortfolio(null); }} style={{ flex: 1, padding: "0.4rem", fontSize: 11, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer" }}>Tutti</button>
            <button onClick={() => { setSelected([]); setActivePortfolio(null); }} style={{ flex: 1, padding: "0.4rem", fontSize: 11, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer" }}>Nessuno</button>
          </div>

          {savedNames.length > 0 && (
            <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1rem" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>PORTAFOGLI SALVATI</div>
              {savedNames.map(name => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.5rem", borderRadius: "var(--radius-sm)", background: activePortfolio === name ? "var(--accent-dim)" : "transparent", marginBottom: 3 }}>
                  <div onClick={() => loadPortfolio(name)} style={{ cursor: "pointer", flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: activePortfolio === name ? "var(--accent)" : "var(--text-primary)" }}>{name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{portfolios[name].eas.length} EA · {new Date(portfolios[name].savedAt).toLocaleDateString("it-IT")}</div>
                  </div>
                  <button onClick={() => deletePortfolio(name)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pannello analisi */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {!selected.length ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", color: "var(--text-muted)", gap: "1rem" }}>
              <BarChart2 size={40} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 14 }}>Seleziona almeno un EA per analizzare il portafoglio</div>
            </div>
          ) : metrics && (
            <>
              {/* Cards metriche top */}
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                {[
                  { label: "NET PROFIT (norm.)", value: fmtProfit(metrics.total),                          color: metrics.total >= 0 ? "var(--accent)" : "var(--danger)" },
                  { label: "PROFIT FACTOR",      value: metrics.pf ? metrics.pf.toFixed(2) : "—",          color: metrics.pf >= 1.5 ? "var(--accent)" : "var(--warning)" },
                  { label: "CALMAR RATIO",       value: metrics.calmar ? metrics.calmar.toFixed(2) : "—",  color: metrics.calmar >= 2 ? "var(--accent)" : "var(--warning)" },
                  { label: "RET/DD",             value: metrics.retDD ? metrics.retDD.toFixed(2) : "—",    color: metrics.retDD >= 2 ? "var(--accent)" : "var(--warning)" },
                  { label: "WIN RATE",           value: `${metrics.winRate.toFixed(1)}%`,                  color: metrics.winRate >= 55 ? "var(--accent)" : "var(--warning)" },
                  { label: "MAX DD (norm.)",     value: `-${metrics.maxDD.toFixed(2)}`,                    color: "var(--danger)" },
                ].map(m => (
                  <div key={m.label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "0.9rem 1.1rem", flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: 5 }}>{m.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-data)", color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Equity curve */}
              <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)" }}>
                    EQUITY CURVE PORTAFOGLIO
                    {activePortfolio && <span style={{ marginLeft: 8, color: "var(--accent)" }}>— {activePortfolio}</span>}
                  </div>
                  {savedNames.length > 1 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Confronta con:</span>
                      <select
                        value={compareWith}
                        onChange={e => setCompareWith(e.target.value)}
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-secondary)", padding: "0.25rem 0.5rem", fontSize: 12, outline: "none" }}
                      >
                        <option value="">— nessuno —</option>
                        {savedNames.filter(n => n !== activePortfolio).map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#3dd68c" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3dd68c" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="cmpGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#e0a952" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#e0a952" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} width={55} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                    <Area data={metrics.equityCurve} type="monotone" dataKey="equity" name={activePortfolio || "Portafoglio"} stroke="#3dd68c" strokeWidth={2} fill="url(#portGrad)" dot={false} />
                    {compareMetrics && (
                      <Area data={compareMetrics.equityCurve} type="monotone" dataKey="equity" name={compareWith} stroke="#e0a952" strokeWidth={2} fill="url(#cmpGrad)" dot={false} strokeDasharray="5 3" />
                    )}
                  </AreaChart>
                </ResponsiveContainer>

                <div style={{ marginTop: "0.75rem" }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, letterSpacing: "0.05em" }}>DRAWDOWN ($)</div>
                  <ResponsiveContainer width="100%" height={90}>
                    <AreaChart margin={{ top: 0, right: 5, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="ddGrad2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#e05252" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#e05252" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis hide />
                      <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)" }} tickLine={false} axisLine={false} width={55} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area data={metrics.equityCurve} type="monotone" dataKey="drawdown" name="DD $" stroke="#e05252" strokeWidth={1.5} fill="url(#ddGrad2)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Metriche dettaglio */}
              <div style={{ display: "grid", gridTemplateColumns: compareMetrics ? "1fr 1fr" : "1fr", gap: "1rem" }}>
                <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--accent)", marginBottom: "0.75rem" }}>
                    {activePortfolio || "SELEZIONE CORRENTE"}
                    <span style={{ marginLeft: 8, color: "var(--text-muted)", fontWeight: 400 }}>({selected.length} EA)</span>
                  </div>
                  <MetricRow label="Totale trade"       value={metrics.totalTrades} />
                  <MetricRow label="Win / Loss"         value={`${metrics.wins} / ${metrics.losses}`} />
                  <MetricRow label="Win Rate"           value={`${metrics.winRate.toFixed(1)}%`}              color={metrics.winRate >= 55 ? "var(--accent)" : "var(--warning)"} />
                  <MetricRow label="Profit Factor"      value={metrics.pf ? metrics.pf.toFixed(2) : "—"}     color={metrics.pf >= 1.5 ? "var(--accent)" : "var(--warning)"} />
                  <MetricRow label="Net Profit (norm.)" value={fmtProfit(metrics.total)}                      color={metrics.total >= 0 ? "var(--accent)" : "var(--danger)"} />
                  <MetricRow label="Max DD (norm.)"     value={`-${metrics.maxDD.toFixed(2)}`}               color="var(--danger)" />
                  <MetricRow label="Ret/DD"             value={metrics.retDD ? metrics.retDD.toFixed(2) : "—"} color={metrics.retDD >= 2 ? "var(--accent)" : "var(--warning)"} />
                  <MetricRow label="Calmar Ratio"       value={metrics.calmar ? metrics.calmar.toFixed(2) : "—"} color={metrics.calmar >= 2 ? "var(--accent)" : "var(--warning)"} />
                  <MetricRow label="Avg Win"            value={`+${metrics.avgWin.toFixed(2)}`}               color="var(--accent)" />
                  <MetricRow label="Avg Loss"           value={`-${metrics.avgLoss.toFixed(2)}`}              color="var(--danger)" />
                  <MetricRow label="Avg RR"             value={metrics.avgRR ? metrics.avgRR.toFixed(2) : "—"} />
                  <MetricRow label="Expectancy"         value={fmtProfit(metrics.expectancy)}                 color={metrics.expectancy >= 0 ? "var(--accent)" : "var(--danger)"} />
                  <MetricRow label="Max consec. loss"   value={metrics.maxCL}                                 color={metrics.maxCL >= 8 ? "var(--danger)" : "var(--text-primary)"} />
                  <MetricRow label="Mesi attivi"        value={metrics.months} />
                </div>

                {compareMetrics && (
                  <div style={{ background: "var(--bg-surface)", border: "1px solid rgba(224,169,82,0.3)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--warning)", marginBottom: "0.75rem" }}>
                      {compareWith}
                      <span style={{ marginLeft: 8, color: "var(--text-muted)", fontWeight: 400 }}>({portfolios[compareWith]?.eas.length} EA)</span>
                    </div>
                    <MetricRow label="Totale trade"       value={compareMetrics.totalTrades} />
                    <MetricRow label="Win / Loss"         value={`${compareMetrics.wins} / ${compareMetrics.losses}`} />
                    <MetricRow label="Win Rate"           value={`${compareMetrics.winRate.toFixed(1)}%`}                color={compareMetrics.winRate >= 55 ? "var(--accent)" : "var(--warning)"} />
                    <MetricRow label="Profit Factor"      value={compareMetrics.pf ? compareMetrics.pf.toFixed(2) : "—"} color={compareMetrics.pf >= 1.5 ? "var(--accent)" : "var(--warning)"} />
                    <MetricRow label="Net Profit (norm.)" value={fmtProfit(compareMetrics.total)}                        color={compareMetrics.total >= 0 ? "var(--accent)" : "var(--danger)"} />
                    <MetricRow label="Max DD (norm.)"     value={`-${compareMetrics.maxDD.toFixed(2)}`}                  color="var(--danger)" />
                    <MetricRow label="Ret/DD"             value={compareMetrics.retDD ? compareMetrics.retDD.toFixed(2) : "—"} color={compareMetrics.retDD >= 2 ? "var(--accent)" : "var(--warning)"} />
                    <MetricRow label="Calmar Ratio"       value={compareMetrics.calmar ? compareMetrics.calmar.toFixed(2) : "—"} color={compareMetrics.calmar >= 2 ? "var(--accent)" : "var(--warning)"} />
                    <MetricRow label="Avg Win"            value={`+${compareMetrics.avgWin.toFixed(2)}`}                  color="var(--accent)" />
                    <MetricRow label="Avg Loss"           value={`-${compareMetrics.avgLoss.toFixed(2)}`}                 color="var(--danger)" />
                    <MetricRow label="Avg RR"             value={compareMetrics.avgRR ? compareMetrics.avgRR.toFixed(2) : "—"} />
                    <MetricRow label="Expectancy"         value={fmtProfit(compareMetrics.expectancy)}                    color={compareMetrics.expectancy >= 0 ? "var(--accent)" : "var(--danger)"} />
                    <MetricRow label="Max consec. loss"   value={compareMetrics.maxCL}                                    color={compareMetrics.maxCL >= 8 ? "var(--danger)" : "var(--text-primary)"} />
                    <MetricRow label="Mesi attivi"        value={compareMetrics.months} />
                  </div>
                )}
              </div>

              {/* EA selezionati */}
              <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                  EA NEL PORTAFOGLIO ({selected.length})
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {selected.map(name => (
                    <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 10px" }}>
                      <span style={{ fontSize: 12, color: "var(--text-primary)" }}>{name}</span>
                      <span onClick={() => toggleEA(name)} style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer", marginLeft: 2 }}>×</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modale salvataggio */}
      {saveModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.5rem", width: 360 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: "1rem" }}>Salva portafoglio</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "0.75rem" }}>{selected.length} EA selezionati</div>
            <input
              autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setSaveModalOpen(false); }}
              placeholder="Nome portafoglio (es. Top 5 XAUUSD)"
              style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", padding: "0.5rem 0.75rem", fontSize: 13, outline: "none", marginBottom: "1rem" }}
            />
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button onClick={() => setSaveModalOpen(false)} style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>Annulla</button>
              <button onClick={handleSave} disabled={!saveName.trim()} style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "none", background: saveName.trim() ? "var(--accent)" : "var(--bg-elevated)", color: saveName.trim() ? "#000" : "var(--text-muted)", cursor: saveName.trim() ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>Salva</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}