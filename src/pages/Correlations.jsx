import { useState, useMemo, useEffect } from "react";
import { Search, X } from "lucide-react";
import { api } from "../api/client";
import { Spinner } from "../components/ui/Spinner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function aggregateByDay(trades) {
  const result = {};
  for (const t of trades) {
    const ea  = t.ea_name;
    const day = t.close_time?.slice(0, 10);
    if (!ea || !day) continue;
    if (!result[ea]) result[ea] = {};
    if (!result[ea][day]) result[ea][day] = 0;
    result[ea][day] += t.net_profit ?? (t.profit + (t.commission || 0) + (t.swap || 0));
  }
  return result;
}

function calcMaxDD(dayMap) {
  let equity = 0, peak = 0, maxDD = 0;
  for (const p of Object.values(dayMap)) {
    equity += p;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD || 1;
}

function normalizeByDD(dayMap, ddTarget, maxDD) {
  const factor = ddTarget / maxDD;
  const result = {};
  for (const [day, pnl] of Object.entries(dayMap)) {
    result[day] = pnl * factor;
  }
  return result;
}

function pearson(a, b) {
  const n = a.length;
  if (n < 2) return 0;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - meanA, xb = b[i] - meanB;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}

function lossCorrelation(daysA, daysB, threshold) {
  const allDays = [...new Set([...Object.keys(daysA), ...Object.keys(daysB)])];
  const aVals = [], bVals = [];
  for (const day of allDays) {
    const a = daysA[day] ?? 0, b = daysB[day] ?? 0;
    if (a < -threshold || b < -threshold) { aVals.push(a); bVals.push(b); }
  }
  return { corr: pearson(aVals, bVals), days: aVals.length };
}

function lossOverlapScore(daysA, daysB, threshold) {
  const allDays = [...new Set([...Object.keys(daysA), ...Object.keys(daysB)])];
  let both = 0, atLeast = 0;
  for (const day of allDays) {
    const a = daysA[day] ?? 0, b = daysB[day] ?? 0;
    const aL = a < -threshold, bL = b < -threshold;
    if (aL || bL) atLeast++;
    if (aL && bL) both++;
  }
  return { score: atLeast === 0 ? 0 : both / atLeast, days: atLeast };
}

function calcPair(daysA, daysB, mode, threshold) {
  if (mode === "overlap") {
    const { score, days } = lossOverlapScore(daysA, daysB, threshold);
    return { val: score, days };
  }
  const { corr, days } = lossCorrelation(daysA, daysB, threshold);
  return { val: corr, days };
}

function cellBg(val, mode) {
  if (val === null) return "var(--bg-elevated)";
  const intensity = Math.min(Math.abs(val), 1);
  if (mode === "overlap") {
    if (val > 0.5) return `rgba(224,82,82,${0.15 + val * 0.65})`;
    if (val < 0.2) return `rgba(61,214,140,${0.2 + (0.2 - val) * 1.5})`;
    return `rgba(180,180,180,0.1)`;
  }
  if (val > 0.1)  return `rgba(224,82,82,${0.15 + intensity * 0.65})`;
  if (val < -0.1) return `rgba(61,214,140,${0.15 + intensity * 0.65})`;
  return `rgba(180,180,180,0.1)`;
}

function cellFg(val, mode) {
  if (val === null) return "var(--text-muted)";
  if (mode === "overlap") return val > 0.5 ? "var(--danger)" : val < 0.2 ? "var(--accent)" : "var(--text-secondary)";
  return val > 0.3 ? "var(--danger)" : val < -0.3 ? "var(--accent)" : "var(--text-secondary)";
}

// ─── Componente principale ────────────────────────────────────────────────────
export function Correlations() {
  const [mode, setMode]                   = useState("correlation");
  const [ddTarget, setDdTarget]           = useState(500);
  const [lossThreshold, setLossThreshold] = useState(5);
  const [search, setSearch]               = useState("");
  const [selectedEAs, setSelectedEAs]     = useState(null);
  const [hoveredCell, setHoveredCell]     = useState(null);
  const [tradesByEA, setTradesByEA]       = useState({});
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    api.getAllTrades().then(data => {
      setTradesByEA(data);
      setLoading(false);
    });
  }, []);

  const allEANames = useMemo(() => Object.keys(tradesByEA), [tradesByEA]);

  const daysByEA = useMemo(() => {
    const result = {};
    for (const [eaName, trades] of Object.entries(tradesByEA)) {
      result[eaName] = aggregateByDay(trades)[eaName] || {};
    }
    return result;
  }, [tradesByEA]);

  const maxDDs = useMemo(() => {
    const r = {};
    for (const name of allEANames) r[name] = calcMaxDD(daysByEA[name] || {});
    return r;
  }, [daysByEA, allEANames]);

  const normalizedDays = useMemo(() => {
    const r = {};
    for (const name of allEANames) {
      r[name] = normalizeByDD(daysByEA[name] || {}, ddTarget, maxDDs[name]);
    }
    return r;
  }, [daysByEA, maxDDs, ddTarget, allEANames]);

  const fullRanking = useMemo(() => {
    const result = [];
    for (let i = 0; i < allEANames.length; i++) {
      for (let j = i + 1; j < allEANames.length; j++) {
        const { val, days } = calcPair(
          normalizedDays[allEANames[i]] || {},
          normalizedDays[allEANames[j]] || {},
          mode, lossThreshold
        );
        result.push({ a: allEANames[i], b: allEANames[j], val, days });
      }
    }
    return result.sort((a, b) => a.val - b.val);
  }, [normalizedDays, mode, lossThreshold, allEANames]);

  const matrixEAs = useMemo(() => {
    if (selectedEAs) return selectedEAs;
    return allEANames.slice(0, Math.min(20, allEANames.length));
  }, [selectedEAs, allEANames]);

  const matrix = useMemo(() => {
    const m = {};
    for (const a of matrixEAs) {
      m[a] = {};
      for (const b of matrixEAs) {
        if (a === b) { m[a][b] = { val: 1, days: 0 }; continue; }
        m[a][b] = calcPair(normalizedDays[a] || {}, normalizedDays[b] || {}, mode, lossThreshold);
      }
    }
    return m;
  }, [matrixEAs, normalizedDays, mode, lossThreshold]);

  const searchResults = useMemo(() => {
    if (!search) return [];
    return allEANames
      .filter(name => name.toLowerCase().includes(search.toLowerCase()) && !matrixEAs.includes(name))
      .slice(0, 6);
  }, [search, allEANames, matrixEAs]);

  function addToMatrix(name) {
    setSelectedEAs(prev => {
      const base = prev || matrixEAs;
      if (base.includes(name) || base.length >= 25) return base;
      return [...base, name];
    });
    setSearch("");
  }

  function removeFromMatrix(name) {
    setSelectedEAs(prev => {
      const base = prev || matrixEAs;
      return base.filter(n => n !== name);
    });
  }

  function resetMatrix() {
    setSelectedEAs(null);
    setSearch("");
  }

  const bestPairs  = fullRanking.slice(0, 8);
  const worstPairs = [...fullRanking].reverse().slice(0, 8);

  if (loading) return <Spinner />;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Correlazioni</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Analisi correlazione nelle perdite · {allEANames.length} EA attivi · {fullRanking.length} coppie analizzate
        </p>
      </div>

      {/* Controlli */}
      <div style={{
        display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end",
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", padding: "1rem", marginBottom: "1.5rem",
      }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.04em" }}>MODALITÀ</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { key: "correlation", label: "Correlazione Loss-Side" },
              { key: "overlap",     label: "Loss Overlap Score"     },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setMode(key)} style={{
                padding: "0.4rem 0.9rem", fontSize: 12, borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: mode === key ? "var(--accent-dim)" : "var(--bg-elevated)",
                color: mode === key ? "var(--accent)" : "var(--text-secondary)",
                cursor: "pointer",
              }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.04em" }}>
            DD TARGET — <span style={{ color: "var(--accent)", fontFamily: "var(--font-data)" }}>${ddTarget}</span>
          </div>
          <input type="range" min={100} max={2000} step={50} value={ddTarget}
            onChange={e => setDdTarget(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
            <span>$100</span><span>$2000</span>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.04em" }}>
            SOGLIA LOSS — <span style={{ color: "var(--accent)", fontFamily: "var(--font-data)" }}>${lossThreshold}</span>
          </div>
          <input type="range" min={0} max={50} step={1} value={lossThreshold}
            onChange={e => setLossThreshold(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
            <span>$0 (tutti)</span><span>$50</span>
          </div>
        </div>
      </div>

      {/* Ranking */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--accent)", marginBottom: "1rem" }}>
            ✦ COPPIE MIGLIORI — SI COMPENSANO
          </div>
          {bestPairs.map((p, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "0.45rem 0",
              borderBottom: i < bestPairs.length - 1 ? "1px solid var(--border)" : "none",
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>
                  {p.a} <span style={{ color: "var(--text-muted)" }}>×</span> {p.b}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{p.days} giorni analizzati</div>
              </div>
              <div style={{ fontFamily: "var(--font-data)", fontSize: 13, fontWeight: 700, color: "var(--accent)", background: "var(--accent-dim)", padding: "2px 8px", borderRadius: 4 }}>
                {p.val.toFixed(2)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--danger)", marginBottom: "1rem" }}>
            ✦ COPPIE PEGGIORI — PERDONO INSIEME
          </div>
          {worstPairs.map((p, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "0.45rem 0",
              borderBottom: i < worstPairs.length - 1 ? "1px solid var(--border)" : "none",
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>
                  {p.a} <span style={{ color: "var(--text-muted)" }}>×</span> {p.b}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{p.days} giorni analizzati</div>
              </div>
              <div style={{ fontFamily: "var(--font-data)", fontSize: 13, fontWeight: 700, color: "var(--danger)", background: "var(--danger-dim)", padding: "2px 8px", borderRadius: 4 }}>
                {p.val.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Matrice */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 3 }}>MATRICE DETTAGLIO</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{matrixEAs.length} EA selezionati · max 25</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {matrixEAs.map(name => (
              <div key={name} style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "var(--bg-elevated)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)", padding: "2px 6px",
                fontSize: 11, color: "var(--text-secondary)",
              }}>
                <span title={name}>
                  {name.length > 12 ? name.slice(0, 12) + "…" : name}
                </span>
                <X size={10} style={{ cursor: "pointer", color: "var(--text-muted)" }}
                  onClick={() => removeFromMatrix(name)} />
              </div>
            ))}

            {matrixEAs.length < 25 && (
              <div style={{ position: "relative" }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", padding: "0.3rem 0.6rem",
                }}>
                  <Search size={11} style={{ color: "var(--text-muted)" }} />
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Aggiungi EA..."
                    style={{ background: "none", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 12, width: 100 }}
                  />
                </div>
                {searchResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)", zIndex: 50, overflow: "hidden", minWidth: 180,
                  }}>
                    {searchResults.map(name => (
                      <div key={name} onClick={() => addToMatrix(name)}
                        style={{ padding: "0.4rem 0.75rem", fontSize: 12, cursor: "pointer", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        {name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedEAs && (
              <button onClick={resetMatrix} style={{
                padding: "0.3rem 0.6rem", fontSize: 11, borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)", background: "var(--bg-elevated)",
                color: "var(--text-muted)", cursor: "pointer",
              }}>
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Legenda */}
        <div style={{ display: "flex", gap: "1.25rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          {mode === "correlation" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: "rgba(61,214,140,0.7)" }} />Si compensano
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: "rgba(180,180,180,0.15)" }} />Nessuna correlazione
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: "rgba(224,82,82,0.7)" }} />Perdono insieme
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: "rgba(61,214,140,0.7)" }} />Overlap basso (ottimo)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: "rgba(224,82,82,0.7)" }} />Overlap alto (da evitare)
              </div>
            </>
          )}
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Hover per dettaglio · Hover sulle etichette per nome completo</div>
        </div>

        {/* Tabella matrice */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ width: 110 }} />
                {matrixEAs.map(name => (
                  <th key={name} style={{ padding: "0 3px 8px", textAlign: "center" }}>
                    <div
                      title={name}
                      style={{
                        transform: "rotate(-45deg)", transformOrigin: "bottom left",
                        width: 55, marginLeft: 18, marginBottom: -8,
                        fontSize: 10, color: "var(--text-muted)", fontWeight: 400,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        cursor: "help",
                      }}
                    >
                      {name.length > 10 ? name.slice(0, 10) + "…" : name}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixEAs.map(rowName => (
                <tr key={rowName}>
                  <td
                    title={rowName}
                    style={{
                      fontSize: 11, color: "var(--text-muted)", paddingRight: 8,
                      textAlign: "right", whiteSpace: "nowrap",
                      maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis",
                      cursor: "help",
                    }}
                  >
                    {rowName}
                  </td>
                  {matrixEAs.map(colName => {
                    const isDiag = rowName === colName;
                    const cell   = matrix[rowName]?.[colName];
                    const val    = cell?.val ?? null;
                    const isHov  = hoveredCell?.r === rowName && hoveredCell?.c === colName;

                    return (
                      <td key={colName} style={{ padding: 2, position: "relative" }}>
                        <div
                          onMouseEnter={() => !isDiag && setHoveredCell({ r: rowName, c: colName })}
                          onMouseLeave={() => setHoveredCell(null)}
                          style={{
                            width: 46, height: 38,
                            background: isDiag ? "var(--bg-elevated)" : cellBg(val, mode),
                            borderRadius: 4,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, fontFamily: "var(--font-data)", fontWeight: 600,
                            color: isDiag ? "var(--text-muted)" : cellFg(val, mode),
                            cursor: isDiag ? "default" : "pointer",
                            border: isHov ? "1px solid var(--border-light)" : "1px solid transparent",
                            transition: "all 0.1s",
                          }}
                        >
                          {isDiag ? "—" : val !== null ? val.toFixed(2) : "?"}
                        </div>
                        {isHov && !isDiag && (
                          <div style={{
                            position: "absolute", zIndex: 100,
                            bottom: "calc(100% + 6px)", left: "50%",
                            transform: "translateX(-50%)",
                            background: "var(--bg-elevated)", border: "1px solid var(--border)",
                            borderRadius: 6, padding: "0.5rem 0.75rem", fontSize: 11,
                            whiteSpace: "nowrap", pointerEvents: "none",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                          }}>
                            <div style={{ fontWeight: 600, marginBottom: 3, color: "var(--text-primary)" }}>
                              {rowName} × {colName}
                            </div>
                            <div style={{ color: "var(--text-muted)" }}>
                              {mode === "overlap"
                                ? `Overlap: ${(val * 100).toFixed(0)}% · ${cell?.days || 0} giorni`
                                : `Correlazione: ${val?.toFixed(3)} · ${cell?.days || 0} giorni`
                              }
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}