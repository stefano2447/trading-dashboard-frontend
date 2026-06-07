import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import { Card }    from "../components/ui/Card";
import { Badge }   from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { ChevronDown, ChevronUp, AlertTriangle, Info } from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v, dec = 2) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toFixed(dec);
}

function dosColor(v) {
  if (v == null) return "var(--text-muted)";
  if (v < 0.20) return "var(--accent)";
  if (v < 0.40) return "var(--warning)";
  return "var(--danger)";
}

function dosLabel(v) {
  if (v == null) return "—";
  if (v < 0.20) return "Basso";
  if (v < 0.40) return "Medio";
  return "Alto";
}

function calmarType(v) {
  if (v >= 3) return "positive";
  if (v >= 1.5) return "warning";
  return "negative";
}

function recencyColor(v) {
  if (v == null) return "var(--text-muted)";
  if (v >= 1.2) return "var(--accent)";      // sopra storico del 20%+
  if (v >= 0.7) return "var(--text-primary)"; // in linea
  if (v >= 0.3) return "var(--warning)";      // deterioramento parziale
  return "var(--danger)";                     // deterioramento severo
}

function recencyLabel(v) {
  if (v == null) return "—";
  if (v >= 1.2) return "↑";   // meglio dello storico
  if (v >= 0.7) return "→";   // in linea
  if (v >= 0.3) return "↓";   // deteriorato
  return "↓↓";                // fortemente deteriorato
}

// ─── Tabella portafogli ───────────────────────────────────────────────────────

function PortfolioTable({ portfolios, eaPool, onSelect, selected }) {
  const [sortKey, setSortKey]   = useState("composite_score");
  const [sortDir, setSortDir]   = useState("desc");
  const [filterMinCalmar,  setFilterMinCalmar]  = useState("");
  const [filterMaxDos,     setFilterMaxDos]     = useState("");
  const [filterNea,        setFilterNea]        = useState("");
  const [filterMinRecency, setFilterMinRecency] = useState("");
  const [filterMinUpi,     setFilterMinUpi]     = useState("");
  const [filterMinRf,      setFilterMinRf]      = useState("");

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const filtered = portfolios
    .filter(p => !filterMinCalmar  || p.calmar >= parseFloat(filterMinCalmar))
    .filter(p => !filterMaxDos     || p.avg_dos <= parseFloat(filterMaxDos))
    .filter(p => !filterNea        || p.ea_list.length === parseInt(filterNea))
    .filter(p => !filterMinRecency || (p.portfolio_recency ?? 0) >= parseFloat(filterMinRecency))
    .filter(p => !filterMinUpi     || (p.portfolio_upi ?? 0)      >= parseFloat(filterMinUpi))
    .filter(p => !filterMinRf      || (p.portfolio_recovery_factor ?? 0) >= parseFloat(filterMinRf));

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
    return sortDir === "asc" ? va - vb : vb - va;
  });

  function SortIcon({ col }) {
    if (sortKey !== col) return <span style={{ opacity: 0.3, fontSize: 10 }}>↕</span>;
    return <span style={{ fontSize: 10 }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const th = (label, key) => (
    <th
      onClick={() => toggleSort(key)}
      style={{ padding: "0.5rem 0.75rem", textAlign: "right", cursor: "pointer",
               fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
               letterSpacing: "0.05em", whiteSpace: "nowrap",
               background: sortKey === key ? "var(--bg-elevated)" : "transparent" }}
    >
      {label} <SortIcon col={key} />
    </th>
  );

  return (
    <div>
      {/* Filtri */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {[
          { label: "Calmar min", val: filterMinCalmar, set: setFilterMinCalmar, ph: "es. 2.5" },
          { label: "DOS max",    val: filterMaxDos,    set: setFilterMaxDos,    ph: "es. 0.3" },
          { label: "N° EA",        val: filterNea,        set: setFilterNea,        ph: "es. 3"   },
          { label: "Recency min",  val: filterMinRecency, set: setFilterMinRecency, ph: "es. 0.8" },
          { label: "UPI min",       val: filterMinUpi,     set: setFilterMinUpi,     ph: "es. 1.5" },
          { label: "RF min",        val: filterMinRf,      set: setFilterMinRf,      ph: "es. 3"   },
        ].map(({ label, val, set, ph }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</span>
            <input
              value={val}
              onChange={e => set(e.target.value)}
              placeholder={ph}
              style={{ width: 70, padding: "0.25rem 0.5rem", fontSize: 12,
                       background: "var(--bg-elevated)", border: "1px solid var(--border)",
                       borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}
            />
          </div>
        ))}
        <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
          {sorted.length} / {portfolios.length} portafogli
        </span>
      </div>

      {/* Tabella */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontSize: 11,
                           fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em" }}>
                PORTAFOGLIO
              </th>
              {th("CALMAR",  "calmar")}
              {th("SHARPE",  "sharpe")}
              {th("MAX DD%", "max_dd_pct")}
              {th("AVG DOS",  "avg_dos")}
              {th("MAX DOS",  "max_dos")}
              {th("RECENCY",  "portfolio_recency")}
              {th("UPI",      "portfolio_upi")}
              {th("RF",       "portfolio_recovery_factor")}
              {th("UI%",      "portfolio_ulcer_index")}
              {th("CAGR%",    "portfolio_cagr_pct")}
              {th("SCORE",    "composite_score")}
              <th style={{ padding: "0.5rem 0.75rem", fontSize: 11, color: "var(--text-muted)" }}>
                EA
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              const isSelected = selected?.rank === p.rank;
              const hasWarning = eaPool && p.ea_list.some(name => {
                const ea = eaPool[name];
                return ea && ea.avg_rr < 1;
              });

              return (
                <tr
                  key={p.rank}
                  onClick={() => onSelect(isSelected ? null : p)}
                  style={{
                    background: isSelected ? "var(--accent-dim)" : i % 2 === 0 ? "transparent" : "var(--bg-elevated)",
                    borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                >
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <span style={{ fontFamily: "var(--font-data)", fontSize: 11,
                                     color: "var(--text-muted)", minWidth: 24 }}>
                        #{i + 1}
                      </span>
                      <span style={{ fontSize: 12, color: isSelected ? "var(--accent)" : "var(--text-primary)" }}>
                        {p.name.replace("Portfolio ", "P")}
                      </span>
                      {hasWarning && (
                        <span title="⚠ Contiene EA con R:R medio < 1: un singolo stop loss può essere una perdita giornaliera significativa. Verifica compatibilità con il daily DD limit della prop firm.">
                          <AlertTriangle size={12} color="var(--warning)" style={{ cursor: "help" }} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)" }}>
                    <Badge value={fmt(p.calmar)} type={calmarType(p.calmar)} />
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)",
                               color: "var(--text-secondary)" }}>
                    {fmt(p.sharpe)}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)",
                               color: p.max_dd_pct > 15 ? "var(--danger)" : "var(--text-primary)" }}>
                    {fmt(p.max_dd_pct)}%
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)",
                               color: dosColor(p.avg_dos) }}>
                    {fmt(p.avg_dos, 3)}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)",
                               color: dosColor(p.max_dos) }}>
                    {fmt(p.max_dos, 3)}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right",
                               fontFamily: "var(--font-data)" }}>
                    <span
                      title={p.portfolio_recency != null
                        ? "Calmar recente / Calmar storico = " + fmt(p.portfolio_recency, 2) + "x — " + (
                            p.portfolio_recency >= 1.2 ? "sopra la media storica" :
                            p.portfolio_recency >= 0.7 ? "in linea con lo storico" :
                            p.portfolio_recency >= 0.3 ? "deterioramento parziale" : "deterioramento severo")
                        : "Rigenera il JSON"}
                      style={{ cursor: "help", color: recencyColor(p.portfolio_recency) }}>
                      {p.portfolio_recency != null
                        ? fmt(p.portfolio_recency, 2) + "x " + recencyLabel(p.portfolio_recency)
                        : "—"}
                    </span>
                  </td>

                  {/* UPI */}
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right",
                               fontFamily: "var(--font-data)",
                               color: (p.portfolio_upi ?? 0) >= 3 ? "var(--accent)" :
                                      (p.portfolio_upi ?? 0) >= 1 ? "var(--text-secondary)" : "var(--warning)" }}>
                    <span title="Ulcer Performance Index = CAGR / Ulcer Index. Misura qualità del DD (durata + profondità). ≥3 ottimo, ≥1 accettabile"
                          style={{ cursor: "help" }}>
                      {p.portfolio_upi != null ? fmt(p.portfolio_upi, 2) : "—"}
                    </span>
                  </td>

                  {/* Recovery Factor */}
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right",
                               fontFamily: "var(--font-data)",
                               color: (p.portfolio_recovery_factor ?? 0) >= 5 ? "var(--accent)" :
                                      (p.portfolio_recovery_factor ?? 0) >= 2 ? "var(--text-secondary)" : "var(--warning)" }}>
                    <span title="Recovery Factor = Profitto totale / MaxDD. ≥5 ottimo, ≥2 accettabile"
                          style={{ cursor: "help" }}>
                      {p.portfolio_recovery_factor != null ? fmt(p.portfolio_recovery_factor, 2) : "—"}
                    </span>
                  </td>

                  {/* Ulcer Index % */}
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right",
                               fontFamily: "var(--font-data)",
                               color: (p.portfolio_ulcer_index ?? 99) <= 5  ? "var(--accent)" :
                                      (p.portfolio_ulcer_index ?? 99) <= 15 ? "var(--text-secondary)" : "var(--warning)" }}>
                    <span title="Ulcer Index % — radice della media dei drawdown quadratici. Più basso = equity curve più liscia"
                          style={{ cursor: "help" }}>
                      {p.portfolio_ulcer_index != null ? fmt(p.portfolio_ulcer_index, 1) + "%" : "—"}
                    </span>
                  </td>

                  {/* CAGR portafoglio combinato */}
                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right",
                               fontFamily: "var(--font-data)",
                               color: (p.portfolio_cagr_pct ?? 0) >= 20 ? "var(--accent)" :
                                      (p.portfolio_cagr_pct ?? 0) >= 10 ? "var(--text-secondary)" : "var(--warning)" }}>
                    <span title="CAGR del portafoglio combinato (equity curve aggregata degli EA)"
                          style={{ cursor: "help" }}>
                      {p.portfolio_cagr_pct != null ? fmt(p.portfolio_cagr_pct, 1) + "%" : "—"}
                    </span>
                  </td>

                  <td style={{ padding: "0.5rem 0.75rem", textAlign: "right",
                               fontFamily: "var(--font-data)", fontWeight: 600, color: "var(--accent)" }}>
                    {fmt(p.composite_score, 3)}
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {p.ea_list.map(ea => (
                        <span key={ea} style={{ fontSize: 10, padding: "1px 5px",
                               background: "var(--bg-elevated)", border: "1px solid var(--border)",
                               borderRadius: 3, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                          {ea}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: 13 }}>
            Nessun portafoglio corrisponde ai filtri
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pannello dettaglio portafoglio ───────────────────────────────────────────

function PortfolioDetail({ portfolio, eaPool, overlapMatrix }) {
  if (!portfolio) return null;

  const eaNames   = portfolio.ea_list;
  const n_ea      = eaNames.length;

  return (
    <Card style={{ marginTop: "1.25rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    marginBottom: "1.25rem", paddingBottom: "1rem", borderBottom: "1px solid var(--border)" }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{portfolio.name}</h3>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {n_ea} EA · {portfolio.n_matched}/{portfolio.n_total} con report
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Score: <strong style={{ color: "var(--accent)" }}>{fmt(portfolio.composite_score, 3)}</strong>
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Badge value={`Calmar ${fmt(portfolio.calmar)}`}  type={calmarType(portfolio.calmar)} />
          <Badge value={"DOS " + fmt(portfolio.avg_dos, 3)} type={portfolio.avg_dos < 0.2 ? "positive" : portfolio.avg_dos < 0.4 ? "warning" : "negative"} />
          <Badge value={"MaxDD " + fmt(portfolio.max_dd_pct) + "%"} type={portfolio.max_dd_pct > 15 ? "negative" : "warning"} />
          {portfolio.portfolio_recency != null && (
            <span title={"Calmar recente / storico = " + fmt(portfolio.portfolio_recency, 2) + "x (ultimi 90gg)"}
                  style={{ cursor: "help" }}>
              <Badge value={"Recency " + fmt(portfolio.portfolio_recency, 2) + "x"}
                     type={portfolio.portfolio_recency >= 1.2 ? "positive" : portfolio.portfolio_recency >= 0.7 ? "neutral" : "negative"} />
            </span>
          )}
          {portfolio.portfolio_upi != null && (
            <span title={"UPI = " + fmt(portfolio.portfolio_upi, 2) + " — Ulcer Performance Index (CAGR / Ulcer Index)"}
                  style={{ cursor: "help" }}>
              <Badge value={"UPI " + fmt(portfolio.portfolio_upi, 2)}
                     type={portfolio.portfolio_upi >= 3 ? "positive" : portfolio.portfolio_upi >= 1 ? "neutral" : "negative"} />
            </span>
          )}
          {portfolio.portfolio_recovery_factor != null && (
            <span title={"Recovery Factor = " + fmt(portfolio.portfolio_recovery_factor, 2) + " (profitto totale / MaxDD)"}
                  style={{ cursor: "help" }}>
              <Badge value={"RF " + fmt(portfolio.portfolio_recovery_factor, 2)}
                     type={portfolio.portfolio_recovery_factor >= 5 ? "positive" : portfolio.portfolio_recovery_factor >= 2 ? "neutral" : "negative"} />
            </span>
          )}
          {portfolio.portfolio_cagr_pct != null && (
            <span title={"CAGR portafoglio combinato = " + fmt(portfolio.portfolio_cagr_pct, 1) + "%"}
                  style={{ cursor: "help" }}>
              <Badge value={"CAGR " + fmt(portfolio.portfolio_cagr_pct, 1) + "%"}
                     type={portfolio.portfolio_cagr_pct >= 20 ? "positive" : "neutral"} />
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>

        {/* EA del portafoglio + lotti */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                        color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            COMPOSIZIONE E LOTTI CONSIGLIATI
          </div>

          {/* Selector scenario lotti */}
          <LotScenarioTable portfolio={portfolio} eaPool={eaPool} />
        </div>

        {/* Matrice DOS coppie */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                        color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            DRAWDOWN OVERLAP MATRIX
          </div>
          <OverlapSubMatrix eaNames={eaNames} overlapMatrix={overlapMatrix} />
        </div>
      </div>

      {/* Warning EA con R:R < 1 */}
      {eaPool && eaNames.some(name => eaPool[name]?.avg_rr < 1) && (
        <div style={{ marginTop: "1rem", padding: "0.75rem 1rem",
                      background: "var(--warning-dim)", border: "1px solid var(--warning)",
                      borderRadius: "var(--radius-sm)", display: "flex", gap: "0.5rem" }}>
          <AlertTriangle size={14} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: "var(--warning)" }}>
            <strong>Attenzione R:R &lt; 1:</strong>{" "}
            {eaNames.filter(name => eaPool[name]?.avg_rr < 1).join(", ")}.
            {" "}Un singolo trade a SL può rappresentare una loss importante nella giornata.
            Verifica che la max daily loss attesa sia compatibile con i limiti della prop firm.
          </div>
        </div>
      )}
    </Card>
  );
}

function LotScenarioTable({ portfolio, eaPool }) {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const scenarios = portfolio.lot_recommendations || [];
  if (!scenarios.length) return <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Dati non disponibili</div>;

  const sc = scenarios[scenarioIdx];

  return (
    <div>
      {/* Selector */}
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {scenarios.map((s, i) => (
          <button
            key={i}
            onClick={() => setScenarioIdx(i)}
            style={{ padding: "0.2rem 0.5rem", fontSize: 11, borderRadius: "var(--radius-sm)",
                     border: `1px solid ${i === scenarioIdx ? "var(--accent)" : "var(--border)"}`,
                     background: i === scenarioIdx ? "var(--accent-dim)" : "var(--bg-elevated)",
                     color: i === scenarioIdx ? "var(--accent)" : "var(--text-secondary)",
                     cursor: "pointer" }}
          >
            ${(s.capital / 1000).toFixed(0)}k / {s.dd_target_pct}% DD
          </button>
        ))}
      </div>

      {/* Tabella */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ textAlign: "left",  padding: "0.3rem 0.4rem", color: "var(--text-muted)", fontWeight: 600, fontSize: 10 }}>EA</th>
            <th style={{ textAlign: "right", padding: "0.3rem 0.4rem", color: "var(--text-muted)", fontWeight: 600, fontSize: 10 }}>LOTTI</th>
            <th style={{ textAlign: "right", padding: "0.3rem 0.4rem", color: "var(--text-muted)", fontWeight: 600, fontSize: 10 }}>WIN%</th>
            <th style={{ textAlign: "right", padding: "0.3rem 0.4rem", color: "var(--text-muted)", fontWeight: 600, fontSize: 10 }}>R:R</th>
          </tr>
        </thead>
        <tbody>
          {portfolio.ea_list.map(name => {
            const ea   = eaPool?.[name];
            const lots = sc.breakdown?.[name];
            const rrBad = ea && ea.avg_rr < 1;
            return (
              <tr key={name} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "0.35rem 0.4rem", color: "var(--text-primary)" }}>
                  {name}
                  {ea?.defaultprice > 0 && (
                    <span style={{ fontSize: 9, marginLeft: 4, color: "var(--text-muted)" }}>
                      @{ea.defaultprice}
                    </span>
                  )}
                </td>
                <td style={{ padding: "0.35rem 0.4rem", textAlign: "right",
                             fontFamily: "var(--font-data)", color: "var(--accent)", fontWeight: 600 }}>
                  {(() => {
                    if (lots == null) return "—";
                    // breakdown può essere un numero (vecchio formato) o un oggetto (nuovo formato)
                    if (typeof lots === "number") return lots.toFixed(4);
                    if (lots.lots != null) return lots.lots.toFixed(4);
                    // sqx_fixed_money: mostra il parametro mmRiskedMoney
                    return (
                      <span title={lots.note || lots.param_name} style={{ cursor: "help", fontSize: 11 }}>
                        {lots.param_value != null ? `$${Number(lots.param_value).toFixed(0)}` : "—"}
                        <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 3 }}>MM</span>
                      </span>
                    );
                  })()}
                </td>
                <td style={{ padding: "0.35rem 0.4rem", textAlign: "right", fontFamily: "var(--font-data)",
                             color: ea?.win_rate >= 55 ? "var(--accent)" : "var(--text-secondary)" }}>
                  {ea ? `${fmt(ea.win_rate, 1)}%` : "—"}
                </td>
                <td style={{ padding: "0.35rem 0.4rem", textAlign: "right", fontFamily: "var(--font-data)",
                             color: rrBad ? "var(--warning)" : "var(--text-secondary)" }}>
                  {ea ? fmt(ea.avg_rr, 2) : "—"}
                  {rrBad && " ⚠"}
                </td>
              </tr>
            );
          })}
          {/* Totale lotti */}
          <tr style={{ borderTop: "2px solid var(--border)" }}>
            <td style={{ padding: "0.35rem 0.4rem", fontWeight: 600, color: "var(--text-primary)" }}>
              Totale
            </td>
            <td style={{ padding: "0.35rem 0.4rem", textAlign: "right",
                         fontFamily: "var(--font-data)", fontWeight: 700, color: "var(--accent)" }}>
              {sc.total_lots > 0 ? fmt(sc.total_lots, 4) : "—"}
            </td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>

      {sc.breakdown && portfolio.ea_list.some(n => eaPool?.[n]?.defaultprice > 0) && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: "0.4rem" }}>
          ⓘ I lotti con @prezzo sono calcolati al defaultprice dell'EA — scalati automaticamente al prezzo attuale di mercato.
        </div>
      )}
      {sc.breakdown && portfolio.ea_list.some(n => {
        const b = sc.breakdown[n];
        return b && (b.sizing_type === "sqx_fixed_money" || (typeof b === "object" && b.lots == null));
      }) && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: "0.25rem" }}>
          ⓘ MM = valore consigliato per mmRiskedMoney (EA SQX con rischio fisso in denaro).
        </div>
      )}
    </div>
  );
}

function OverlapSubMatrix({ eaNames, overlapMatrix }) {
  if (!overlapMatrix || eaNames.length < 2) {
    return <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Dati non disponibili</div>;
  }

  const names = eaNames.filter(n => overlapMatrix[n]);

  if (names.length < 2) return (
    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
      Report non disponibili per tutti gli EA di questo portafoglio.
    </div>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ width: 80 }} />
            {names.map(n => (
              <th key={n} style={{ padding: "0.3rem 0.4rem", fontSize: 10, color: "var(--text-muted)",
                                   fontWeight: 600, textAlign: "center",
                                   maxWidth: 70, overflow: "hidden", whiteSpace: "nowrap" }}>
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map(rowName => (
            <tr key={rowName}>
              <td style={{ padding: "0.3rem 0.4rem", fontSize: 10, color: "var(--text-muted)",
                           fontWeight: 600, whiteSpace: "nowrap" }}>
                {rowName}
              </td>
              {names.map(colName => {
                const val = rowName === colName ? 1 : overlapMatrix[rowName]?.[colName];
                const bg  = rowName === colName ? "var(--bg-elevated)"
                          : val < 0.2  ? "rgba(0,200,100,0.12)"
                          : val < 0.4  ? "rgba(255,170,0,0.12)"
                          : "rgba(255,80,80,0.12)";
                const col = rowName === colName ? "var(--text-muted)"
                          : val < 0.2  ? "var(--accent)"
                          : val < 0.4  ? "var(--warning)"
                          : "var(--danger)";
                return (
                  <td key={colName}
                    style={{ padding: "0.3rem 0.4rem", textAlign: "center",
                             fontFamily: "var(--font-data)", fontSize: 11,
                             background: bg, color: col, fontWeight: rowName === colName ? 400 : 500 }}>
                    {rowName === colName ? "—" : val != null ? val.toFixed(3) : "n/a"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: "0.5rem" }}>
        Verde &lt;0.20 · Giallo 0.20-0.40 · Rosso &gt;0.40
      </div>
    </div>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────────

export function Portfolios() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [activeTab,   setActiveTab]   = useState(null);
  const [selected,    setSelected]    = useState(null);
  const detailRef = useRef(null);

  function handleSelect(portfolio) {
    setSelected(portfolio);
    // Scrolla al pannello dettaglio dopo il render
    if (portfolio) {
      setTimeout(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }

  useEffect(() => {
    setLoading(true);
    api.getBacktestData()
      .then(d => {
        setData(d);
        const collections = d?.portfolio_collections || {};
        const first = Object.keys(collections)[0];
        if (first) setActiveTab(first);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  if (error || !data || data.status === "no_data") return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Portafogli</h1>
      <div style={{ marginTop: "2rem", padding: "2rem", border: "1px dashed var(--border)",
                    borderRadius: "var(--radius-lg)", textAlign: "center", color: "var(--text-muted)" }}>
        <Info size={32} style={{ marginBottom: "1rem", opacity: 0.4 }} />
        <div style={{ fontSize: 14, marginBottom: "0.5rem" }}>
          {error || "Nessun dato disponibile"}
        </div>
        <div style={{ fontSize: 12 }}>
          Esegui <code>analyzer.py</code> e copia <code>portfolio_results.json</code> sul server.
        </div>
      </div>
    </div>
  );

  const collections   = data.portfolio_collections || {};
  const eaPool        = data.ea_pool || {};
  const overlapMatrix = data.overlap_matrix || {};
  const collectionNames = Object.keys(collections);

  const activePortfolios = activeTab ? (collections[activeTab] || []) : [];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Portafogli</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {collectionNames.length} collezioni · {Object.keys(eaPool).length} EA nel pool ·
          aggiornato {data.generated_at ? new Date(data.generated_at).toLocaleDateString("it-IT") : "—"}
        </p>
      </div>

      {/* Tab collezioni */}
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.25rem",
                    borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem",
                    flexWrap: "wrap" }}>
        {collectionNames.map(name => (
          <button
            key={name}
            onClick={() => { setActiveTab(name); setSelected(null); }}
            style={{ padding: "0.4rem 1rem", fontSize: 13, borderRadius: "var(--radius-sm)",
                     border: `1px solid ${activeTab === name ? "var(--accent)" : "var(--border)"}`,
                     background: activeTab === name ? "var(--accent-dim)" : "transparent",
                     color: activeTab === name ? "var(--accent)" : "var(--text-secondary)",
                     cursor: "pointer", fontWeight: activeTab === name ? 600 : 400 }}
          >
            {name}
            <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>
              ({(collections[name] || []).length})
            </span>
          </button>
        ))}
      </div>

      {/* Tabella */}
      {activeTab && (
        <Card>
          <PortfolioTable
            portfolios={activePortfolios}
            eaPool={eaPool}
            onSelect={handleSelect}
            selected={selected}
          />
        </Card>
      )}

      {/* Pannello dettaglio */}
      {selected && (
        <div ref={detailRef} style={{ scrollMarginTop: "1.5rem" }}>
          <PortfolioDetail
            portfolio={selected}
            eaPool={eaPool}
            overlapMatrix={overlapMatrix}
          />
        </div>
      )}
    </div>
  );
}
