import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronUp,
         Play, TrendingUp, AlertTriangle, Target } from "lucide-react";
import { api } from "../api/client";
import { Card }    from "../components/ui/Card";
import { Badge }   from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";

// ══════════════════════════════════════════════════════════════════════════════
//  SEZIONE REGOLE (invariata) — solo componenti interni rifattorizzati
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_FIRMS = [
  {
    id: "the5ers", name: "The5ers", website: "https://the5ers.com",
    challenges: [
      {
        id: "the5ers_2phase", name: "2 Fasi (High Stakes)", type: "2-fase",
        params: { profit_target_p1: 8, profit_target_p2: 5, daily_dd: 5, max_dd: 10,
                  min_trading_days: 0, time_limit_days: 0, leverage: "1:30",
                  profit_split: "80% → 100%", scaling: "Fino a $4M", payout_frequency: "Su richiesta" },
        rules: { ea_allowed: true, weekend_hold: true, news_holding: true, min_sl_required: false,
                 hft_allowed: false, copy_trading: false, martingale: false, hedging: false,
                 news_trading_challenge: "Permesso (no nuovi ordini 2 min prima/dopo su High Stakes)",
                 news_trading_funded: "Permesso (no nuovi ordini 2 min prima/dopo su High Stakes)",
                 max_risk_per_trade: "Nessun limite", consistency_rule: "Nessuna",
                 min_trade_duration: "Nessun limite", inactivity_rule: "Nessuna",
                 other_rules: "Vietato bracketing con pending orders intorno a news. Vietato scalping durante rollover." },
      },
      {
        id: "the5ers_bootcamp", name: "Bootcamp", type: "1-fase",
        params: { profit_target_p1: 10, profit_target_p2: null, daily_dd: 4, max_dd: 8,
                  min_trading_days: 0, time_limit_days: 365, leverage: "1:30",
                  profit_split: "50% → 100%", scaling: "Fino a $4M", payout_frequency: "Su richiesta" },
        rules: { ea_allowed: true, weekend_hold: true, news_holding: true, min_sl_required: true,
                 hft_allowed: false, copy_trading: false, martingale: false, hedging: false,
                 news_trading_challenge: "Permesso", news_trading_funded: "Permesso",
                 max_risk_per_trade: "2% del balance", consistency_rule: "Nessuna",
                 min_trade_duration: "Nessun limite", inactivity_rule: "Nessuna",
                 other_rules: "Stop loss obbligatorio su ogni trade." },
      },
    ],
  },
  {
    id: "ftmo", name: "FTMO", website: "https://ftmo.com",
    challenges: [
      {
        id: "ftmo_2step", name: "2 Step Challenge", type: "2-fase",
        params: { profit_target_p1: 10, profit_target_p2: 5, daily_dd: 5, max_dd: 10,
                  min_trading_days: 10, time_limit_days: 60, leverage: "1:30 – 1:100",
                  profit_split: "80% → 90%", scaling: "+25% ogni 4 mesi fino $2M",
                  payout_frequency: "Bisettimanale" },
        rules: { ea_allowed: true, weekend_hold: true, news_holding: true, min_sl_required: false,
                 hft_allowed: false, copy_trading: false, martingale: false, hedging: false,
                 news_trading_challenge: "Permesso", news_trading_funded: "Permesso",
                 max_risk_per_trade: "Nessun limite", consistency_rule: "Nessuna",
                 min_trade_duration: "Nessun limite", inactivity_rule: "Nessuna",
                 other_rules: "Minimo 10 giorni di trading. Massimo 60 giorni per completare." },
      },
    ],
  },
  {
    id: "fundingpips", name: "FundingPips", website: "https://fundingpips.com",
    challenges: [
      {
        id: "fp_2step", name: "2 Step Standard", type: "2-fase",
        params: { profit_target_p1: 8, profit_target_p2: 5, daily_dd: 5, max_dd: 10,
                  min_trading_days: 3, time_limit_days: 0, leverage: "1:100",
                  profit_split: "95%", scaling: "Fino a $300K", payout_frequency: "Bisettimanale" },
        rules: { ea_allowed: true, weekend_hold: true, news_holding: true, min_sl_required: false,
                 hft_allowed: false, copy_trading: false, martingale: false, hedging: false,
                 news_trading_challenge: "VIETATO — finestra 5 min prima/dopo red folder",
                 news_trading_funded: "VIETATO — finestra 5 min prima/dopo red folder",
                 max_risk_per_trade: "Nessun limite", consistency_rule: "Nessuna",
                 min_trade_duration: "Nessun limite", inactivity_rule: "Nessuna",
                 other_rules: "DD statico su 2-step. Vietato HFT, arbitrage." },
      },
    ],
  },
];

function loadFirms() {
  try {
    const s = localStorage.getItem("prop_firms_v2");
    return s ? JSON.parse(s) : DEFAULT_FIRMS;
  } catch { return DEFAULT_FIRMS; }
}
function saveFirms(f) {
  try { localStorage.setItem("prop_firms_v2", JSON.stringify(f)); } catch {}
}

function fmt(v, dec = 2) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toFixed(dec);
}

// ── Componente riga editabile ─────────────────────────────────────────────────
function EditableRuleRow({ label, value, isBool = false, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);

  function handleSave() {
    onSave(isBool ? (draft === "true" || draft === true) : draft);
    setEditing(false);
  }

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.4rem 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 140 }}>{label}</span>
      {editing ? (
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flex: 1, justifyContent: "flex-end" }}>
          {isBool ? (
            <select value={String(draft)} onChange={e => setDraft(e.target.value)}
              style={{ padding: "0.2rem 0.4rem", fontSize: 12, background: "var(--bg-elevated)",
                       border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                       color: "var(--text-primary)" }}>
              <option value="true">Sì</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input value={draft} onChange={e => setDraft(e.target.value)}
              style={{ flex: 1, maxWidth: 280, padding: "0.2rem 0.4rem", fontSize: 12,
                       background: "var(--bg-elevated)", border: "1px solid var(--accent)",
                       borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }} />
          )}
          <button onClick={handleSave} style={{ background: "none", border: "none", cursor: "pointer",
                                                color: "var(--accent)", padding: 2 }}>
            <Check size={14} />
          </button>
          <button onClick={() => { setDraft(value); setEditing(false); }}
            style={{ background: "none", border: "none", cursor: "pointer",
                     color: "var(--text-muted)", padding: 2 }}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {isBool ? (
            <Badge value={value ? "✓ Sì" : "✗ No"} type={value ? "positive" : "negative"} />
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-primary)", maxWidth: 280,
                           textAlign: "right" }}>{value || "—"}</span>
          )}
          <button onClick={() => { setDraft(value); setEditing(true); }}
            style={{ background: "none", border: "none", cursor: "pointer",
                     color: "var(--text-muted)", padding: 2, opacity: 0.5 }}>
            <Edit2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── ChallengeCard ─────────────────────────────────────────────────────────────
function ChallengeCard({ challenge, onDelete, onUpdate }) {
  const [open, setOpen] = useState(false);
  const { params, rules } = challenge;

  function updateParam(key, val) {
    onUpdate({ ...challenge, params: { ...params, [key]: val } });
  }
  function updateRule(key, val) {
    onUpdate({ ...challenge, rules: { ...rules, [key]: val } });
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                  marginBottom: "0.75rem", overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                 padding: "0.85rem 1rem", cursor: "pointer",
                 background: open ? "var(--bg-elevated)" : "transparent" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{challenge.name}</span>
          <Badge value={challenge.type} type="neutral" />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Target: {params.profit_target_p1}%
            {params.profit_target_p2 ? ` + ${params.profit_target_p2}%` : ""}
            {" "}· DD: {params.daily_dd}% / {params.max_dd}%
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button onClick={e => { e.stopPropagation(); onDelete(challenge.id); }}
            style={{ background: "none", border: "none", cursor: "pointer",
                     color: "var(--text-muted)", padding: 4, opacity: 0.5 }}>
            <Trash2 size={12} />
          </button>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {open && (
        <div style={{ padding: "1rem", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                            color: "var(--text-muted)", marginBottom: "0.75rem" }}>PARAMETRI</div>
              <EditableRuleRow label="Target Fase 1 (%)"   value={params.profit_target_p1} onSave={v => updateParam("profit_target_p1", parseFloat(v))} />
              <EditableRuleRow label="Target Fase 2 (%)"   value={params.profit_target_p2 ?? "—"} onSave={v => updateParam("profit_target_p2", parseFloat(v) || null)} />
              <EditableRuleRow label="Daily DD (%)"        value={params.daily_dd}         onSave={v => updateParam("daily_dd", parseFloat(v))} />
              <EditableRuleRow label="Max DD (%)"          value={params.max_dd}           onSave={v => updateParam("max_dd", parseFloat(v))} />
              <EditableRuleRow label="Min Giorni Trading"  value={params.min_trading_days} onSave={v => updateParam("min_trading_days", parseInt(v))} />
              <EditableRuleRow label="Limite Giorni"       value={params.time_limit_days}  onSave={v => updateParam("time_limit_days", parseInt(v))} />
              <EditableRuleRow label="Leva"                value={params.leverage}         onSave={v => updateParam("leverage", v)} />
              <EditableRuleRow label="Profit Split"        value={params.profit_split}     onSave={v => updateParam("profit_split", v)} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                            color: "var(--text-muted)", marginBottom: "0.75rem" }}>REGOLE</div>
              <EditableRuleRow label="EA Permessi"      value={rules.ea_allowed}      isBool onSave={v => updateRule("ea_allowed", v)} />
              <EditableRuleRow label="Hold Weekend"     value={rules.weekend_hold}    isBool onSave={v => updateRule("weekend_hold", v)} />
              <EditableRuleRow label="Hold News"        value={rules.news_holding}    isBool onSave={v => updateRule("news_holding", v)} />
              <EditableRuleRow label="SL Obbligatorio"  value={rules.min_sl_required} isBool onSave={v => updateRule("min_sl_required", v)} />
              <EditableRuleRow label="HFT"              value={rules.hft_allowed}     isBool onSave={v => updateRule("hft_allowed", v)} />
              <EditableRuleRow label="Martingale"       value={rules.martingale}      isBool onSave={v => updateRule("martingale", v)} />
              <EditableRuleRow label="News Trading Ch." value={rules.news_trading_challenge} onSave={v => updateRule("news_trading_challenge", v)} />
              <EditableRuleRow label="Max Rischio Trade" value={rules.max_risk_per_trade}    onSave={v => updateRule("max_risk_per_trade", v)} />
              <EditableRuleRow label="Note / Altre Regole" value={rules.other_rules}         onSave={v => updateRule("other_rules", v)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  CHALLENGE SIMULATOR
// ══════════════════════════════════════════════════════════════════════════════

function MiniBarChart({ data, xKey, yKey, color = "var(--accent)", height = 100 }) {
  if (!data || !data.length) return null;
  const max = Math.max(...data.map(d => d[yKey]));
  const w   = 100 / data.length;

  return (
    <div style={{ position: "relative", height, display: "flex", alignItems: "flex-end",
                  gap: 1, padding: "0 2px" }}>
      {data.map((d, i) => {
        const pct = max > 0 ? (d[yKey] / max) * 100 : 0;
        return (
          <div key={i} title={`${d[xKey]}%: ${(d[yKey] * 100).toFixed(1)}%`}
            style={{ flex: 1, height: `${pct}%`, background: color,
                     borderRadius: "2px 2px 0 0", minHeight: 1, transition: "height 0.3s" }} />
        );
      })}
    </div>
  );
}

function ChallengeSimulator({ firms }) {
  const [btData,   setBtData]   = useState(null);
  const [loading,  setLoading]  = useState(true);

  // Parametri simulazione
  const [selType,  setSelType]  = useState("ea");     // "ea" | "portfolio"
  const [selId,    setSelId]    = useState("");
  const [selColl,  setSelColl]  = useState("");       // solo per portfolio

  const [capital,   setCapital]   = useState(100000);
  const [target1,   setTarget1]   = useState(10);
  const [target2,   setTarget2]   = useState(5);
  const [is1phase,  setIs1phase]  = useState(false);
  const [dailyDD,   setDailyDD]   = useState(5);
  const [maxDD,     setMaxDD]     = useState(10);
  const [timeLimit, setTimeLimit] = useState(60);
  const [minDays,   setMinDays]   = useState(10);

  const [riskMin,        setRiskMin]        = useState(0.5);
  const [riskMax,        setRiskMax]        = useState(3.0);
  const [riskStep,       setRiskStep]       = useState(0.25);
  const [nSim,           setNSim]           = useState(3000);
  const [maxRiskPerTrade, setMaxRiskPerTrade] = useState(2.0);

  const [running,  setRunning]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [results,  setResults]  = useState(null);
  const [simError, setSimError] = useState(null);
  const workerRef = useRef(null);

  useEffect(() => {
    api.getBacktestData()
      .then(d => { setBtData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Precompila dai parametri prop firm selezionata
  function loadFromChallenge(challenge) {
    setTarget1(challenge.params.profit_target_p1 ?? 10);
    setTarget2(challenge.params.profit_target_p2 ?? 5);
    setIs1phase(!challenge.params.profit_target_p2);
    setDailyDD(challenge.params.daily_dd ?? 5);
    setMaxDD(challenge.params.max_dd ?? 10);
    setTimeLimit(challenge.params.time_limit_days || 90);
    setMinDays(challenge.params.min_trading_days || 0);
  }

  function buildDailyPnlDollar() {
    // Costruisce daily_pnl in $ assoluti e ea_components dal btData
    // direttamente nel browser — nessuna chiamata al server
    const eaPool = btData?.ea_pool || {};

    if (selType === "ea") {
      const ea = eaPool[selId];
      if (!ea?.daily_pnl_pct) return null;
      const initial = ea.initial_capital || 100000;
      const dailyDollar = ea.daily_pnl_pct.map(p => p / 100.0 * initial);
      const components  = [{
        ea_name:          selId,
        initial_capital:  initial,
        base_lots:        ea.base_lots || 0.01,
        lot_sizing_type:  ea.lot_sizing_type || "fixed_lots",
        defaultprice:     ea.defaultprice || 0,
        mm_risked_money:  ea.mm_risked_money || 0,
        ref_price:        ea.ref_price || 0,
        ref_lots:         ea.ref_lots || ea.base_lots || 0.01,
        daily_pnl_dollar: dailyDollar,
      }];
      return { dailyDollar, components };
    }

    // Portfolio
    const collection = btData?.portfolio_collections?.[selColl] || [];
    const portfolio  = collection[parseInt(selId)];
    if (!portfolio) return null;

    const allSeries  = [];
    const components = [];

    for (const eaName of portfolio.ea_list) {
      const ea = eaPool[eaName];
      if (!ea?.daily_pnl_pct) continue;
      const initial     = ea.initial_capital || 100000;
      const dailyDollar = ea.daily_pnl_pct.map(p => p / 100.0 * initial);
      components.push({
        ea_name:          eaName,
        initial_capital:  initial,
        base_lots:        ea.base_lots || 0.01,
        lot_sizing_type:  ea.lot_sizing_type || "fixed_lots",
        defaultprice:     ea.defaultprice || 0,
        mm_risked_money:  ea.mm_risked_money || 0,
        ref_price:        ea.ref_price || 0,
        ref_lots:         ea.ref_lots || ea.base_lots || 0.01,
        daily_pnl_dollar: dailyDollar,
      });
      allSeries.push(dailyDollar);
    }

    if (!allSeries.length) return null;

    const minLen    = Math.min(...allSeries.map(s => s.length));
    const combined  = new Array(minLen).fill(0);
    for (const s of allSeries)
      for (let i = 0; i < minLen; i++)
        combined[i] += s[s.length - minLen + i];

    // Tronca anche i daily_pnl_dollar dei components
    for (const c of components)
      c.daily_pnl_dollar = c.daily_pnl_dollar.slice(-minLen);

    return { dailyDollar: combined, components };
  }

  function runSimulation() {
    const built = buildDailyPnlDollar();
    if (!built) {
      setSimError("Dati non disponibili. Rigenera il JSON con analyzer.py.");
      return;
    }

    // Termina worker precedente se ancora in esecuzione
    if (workerRef.current) workerRef.current.terminate();

    setRunning(true);
    setProgress(0);
    setSimError(null);
    setResults(null);

    const worker = new Worker(
      new URL("../../public/monteCarloWorker.js", import.meta.url),
      { type: "classic" }
    );
    workerRef.current = worker;

    worker.onmessage = (e) => {
      if (e.data.type === "progress") {
        setProgress(e.data.pct);
      } else if (e.data.type === "result") {
        setResults(e.data.data);
        setRunning(false);
        setProgress(100);
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = (err) => {
      setSimError(err.message || "Errore nel Worker");
      setRunning(false);
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({
      daily_pnl_dollar: built.dailyDollar,
      ea_components:    built.components,
      params: {
        capital,
        profit_target_p1:     target1,
        profit_target_p2:     is1phase ? null : target2,
        daily_dd_pct:         dailyDD,
        max_dd_pct:           maxDD,
        time_limit_days:      timeLimit,
        min_trading_days:     minDays,
        risk_min_pct:         riskMin,
        risk_max_pct:         riskMax,
        risk_step_pct:        riskStep,
        n_simulations:        nSim,
        max_risk_per_trade_pct: maxRiskPerTrade,
      },
    });
  }

  const eaNames   = Object.keys(btData?.ea_pool || {});
  const collNames = Object.keys(btData?.portfolio_collections || {});

  const allFirmChallenges = firms.flatMap(f =>
    f.challenges.map(c => ({ ...c, firmName: f.name }))
  );

  const optimal = results?.optimal_risk_pct;

  return (
    <div>
      {loading && <Spinner />}
      {!loading && !btData?.ea_pool && (
        <div style={{ padding: "2rem", border: "1px dashed var(--border)",
                      borderRadius: "var(--radius-lg)", textAlign: "center",
                      color: "var(--text-muted)", fontSize: 13 }}>
          Nessun dato backtest disponibile. Esegui <code>analyzer.py</code> prima.
        </div>
      )}

      {!loading && btData?.ea_pool && (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1.5rem" }}>

          {/* ── Pannello input ─────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

            {/* Selezione EA / Portafoglio */}
            <Card>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                            color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                STRATEGIA DA TESTARE
              </div>

              {/* Toggle tipo */}
              <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem" }}>
                {["ea", "portfolio"].map(t => (
                  <button key={t} onClick={() => { setSelType(t); setSelId(""); }}
                    style={{ flex: 1, padding: "0.3rem", fontSize: 12,
                             borderRadius: "var(--radius-sm)",
                             border: `1px solid ${selType === t ? "var(--accent)" : "var(--border)"}`,
                             background: selType === t ? "var(--accent-dim)" : "var(--bg-elevated)",
                             color: selType === t ? "var(--accent)" : "var(--text-secondary)",
                             cursor: "pointer" }}>
                    {t === "ea" ? "Singolo EA" : "Portafoglio"}
                  </button>
                ))}
              </div>

              {selType === "ea" ? (
                <select value={selId} onChange={e => setSelId(e.target.value)}
                  style={{ width: "100%", padding: "0.4rem 0.5rem", fontSize: 13,
                           background: "var(--bg-elevated)", border: "1px solid var(--border)",
                           borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}>
                  <option value="">— seleziona EA —</option>
                  {eaNames.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <select value={selColl} onChange={e => { setSelColl(e.target.value); setSelId(""); }}
                    style={{ width: "100%", padding: "0.4rem 0.5rem", fontSize: 13,
                             background: "var(--bg-elevated)", border: "1px solid var(--border)",
                             borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}>
                    <option value="">— collezione —</option>
                    {collNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  {selColl && (
                    <select value={selId} onChange={e => setSelId(e.target.value)}
                      style={{ width: "100%", padding: "0.4rem 0.5rem", fontSize: 13,
                               background: "var(--bg-elevated)", border: "1px solid var(--border)",
                               borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}>
                      <option value="">— portafoglio —</option>
                      {(btData.portfolio_collections[selColl] || []).slice(0, 50).map((p, i) => (
                        <option key={i} value={i}>
                          #{i+1} {p.name.replace("Portfolio ", "P")} — Score {fmt(p.composite_score, 3)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Info EA selezionato */}
              {selType === "ea" && selId && btData.ea_pool[selId] && (
                <div style={{ marginTop: "0.75rem", padding: "0.6rem 0.75rem",
                              background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)",
                              fontSize: 11, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.2rem" }}>
                  {[
                    ["Calmar", fmt(btData.ea_pool[selId].calmar)],
                    ["MaxDD",  fmt(btData.ea_pool[selId].max_dd_pct) + "%"],
                    ["Win%",   fmt(btData.ea_pool[selId].win_rate, 1) + "%"],
                    ["R:R",    fmt(btData.ea_pool[selId].avg_rr)],
                    ["Trade",  btData.ea_pool[selId].n_trades],
                    ["MaxDayLoss", fmt(btData.ea_pool[selId].max_daily_loss_pct) + "%"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span style={{ color: "var(--text-muted)" }}>{k}: </span>
                      <strong style={{ color: "var(--text-primary)" }}>{v}</strong>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Parametri prop firm */}
            <Card>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                            color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                PARAMETRI PROP FIRM
              </div>

              {/* Carica da prop firm salvata */}
              <select onChange={e => {
                const ch = allFirmChallenges.find(c => c.id === e.target.value);
                if (ch) loadFromChallenge(ch);
              }} defaultValue=""
                style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: 12,
                         background: "var(--bg-elevated)", border: "1px solid var(--border)",
                         borderRadius: "var(--radius-sm)", color: "var(--text-secondary)",
                         marginBottom: "0.75rem" }}>
                <option value="">↙ Importa da prop firm salvata</option>
                {allFirmChallenges.map(c => (
                  <option key={c.id} value={c.id}>{c.firmName} — {c.name}</option>
                ))}
              </select>

              {[
                { label: "Capitale ($)", val: capital,    set: setCapital,   type: "number" },
                { label: "Target F1 (%)", val: target1,  set: setTarget1,   type: "number" },
              ].map(({ label, val, set }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between",
                                          alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                  <input type="number" value={val} onChange={e => set(parseFloat(e.target.value))}
                    style={{ width: 90, padding: "0.2rem 0.4rem", fontSize: 12, textAlign: "right",
                             background: "var(--bg-elevated)", border: "1px solid var(--border)",
                             borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }} />
                </div>
              ))}

              <div style={{ display: "flex", justifyContent: "space-between",
                            alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>1 Fase</span>
                <input type="checkbox" checked={is1phase} onChange={e => setIs1phase(e.target.checked)} />
              </div>

              {!is1phase && (
                <div style={{ display: "flex", justifyContent: "space-between",
                              alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Target F2 (%)</span>
                  <input type="number" value={target2} onChange={e => setTarget2(parseFloat(e.target.value))}
                    style={{ width: 90, padding: "0.2rem 0.4rem", fontSize: 12, textAlign: "right",
                             background: "var(--bg-elevated)", border: "1px solid var(--border)",
                             borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }} />
                </div>
              )}

              {[
                { label: "Daily DD (%)",    val: dailyDD,   set: setDailyDD },
                { label: "Max DD (%)",      val: maxDD,     set: setMaxDD },
                { label: "Limite giorni",   val: timeLimit, set: setTimeLimit },
                { label: "Min giorni trad.", val: minDays,  set: setMinDays },
              ].map(({ label, val, set }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between",
                                          alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                  <input type="number" value={val} onChange={e => set(parseFloat(e.target.value))}
                    style={{ width: 90, padding: "0.2rem 0.4rem", fontSize: 12, textAlign: "right",
                             background: "var(--bg-elevated)", border: "1px solid var(--border)",
                             borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }} />
                </div>
              ))}
            </Card>

            {/* Range rischio */}
            <Card>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                            color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                OTTIMIZZAZIONE RISCHIO
              </div>
              {[
                { label: "Rischio min (%)", val: riskMin,  set: setRiskMin },
                { label: "Rischio max (%)", val: riskMax,  set: setRiskMax },
                { label: "Step (%)",        val: riskStep, set: setRiskStep },
                { label: "Simulazioni",         val: nSim,           set: setNSim },
                { label: "Max rischio/trade (%)", val: maxRiskPerTrade, set: setMaxRiskPerTrade },
              ].map(({ label, val, set }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between",
                                          alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                  <input type="number" value={val} onChange={e => set(parseFloat(e.target.value))}
                    step={label.includes("Step") ? 0.1 : 1}
                    style={{ width: 90, padding: "0.2rem 0.4rem", fontSize: 12, textAlign: "right",
                             background: "var(--bg-elevated)", border: "1px solid var(--border)",
                             borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }} />
                </div>
              ))}

              <button
                onClick={runSimulation}
                disabled={running || !selId}
                style={{ width: "100%", marginTop: "0.75rem", padding: "0.6rem",
                         fontSize: 13, fontWeight: 600,
                         background: running || !selId ? "var(--bg-elevated)" : "var(--accent-dim)",
                         border: `1px solid ${running || !selId ? "var(--border)" : "var(--accent)"}`,
                         color: running || !selId ? "var(--text-muted)" : "var(--accent)",
                         borderRadius: "var(--radius-md)", cursor: running || !selId ? "default" : "pointer",
                         display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {running ? (
                  <><div style={{ width: 14, height: 14, border: "2px solid var(--border)",
                                  borderTop: "2px solid var(--accent)", borderRadius: "50%",
                                  animation: "spin 0.8s linear infinite" }} />
                    Simulazione… {progress}%</>
                ) : (
                  <><Play size={14} /> Avvia Monte Carlo (locale)</>
                )}
              </button>
              {running && (
                <div style={{ marginTop: "0.4rem", height: 4, background: "var(--bg-elevated)",
                              borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`,
                                background: "var(--accent)", transition: "width 0.3s",
                                borderRadius: 2 }} />
                </div>
              )}
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

              {simError && (
                <div style={{ marginTop: "0.5rem", padding: "0.5rem", fontSize: 12,
                              color: "var(--danger)", background: "var(--danger-dim)",
                              borderRadius: "var(--radius-sm)" }}>
                  {simError}
                </div>
              )}
            </Card>
          </div>

          {/* ── Pannello risultati ───────────────────────────────── */}
          <div>
            {!results && !running && (
              <div style={{ height: "100%", minHeight: 300, display: "flex", alignItems: "center",
                            justifyContent: "center", border: "1px dashed var(--border)",
                            borderRadius: "var(--radius-lg)", color: "var(--text-muted)", fontSize: 13 }}>
                Configura i parametri e avvia la simulazione
              </div>
            )}

            {results && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

                {/* KPI ottimale */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
                  {(() => {
                    const opt = results.results.find(r => r.risk_pct === optimal) || {};
                    return [
                      { label: "Rischio Ottimale", value: `${optimal}%`, type: "positive" },
                      { label: "P(Successo)",       value: `${(opt.p_success * 100).toFixed(1)}%`,
                        type: opt.p_success >= 0.7 ? "positive" : opt.p_success >= 0.5 ? "warning" : "negative" },
                      { label: "Giorni Medi",       value: `${opt.avg_days_success?.toFixed(0) || "—"}gg`,
                        type: "neutral" },
                      { label: "P(Viola Daily DD)", value: `${(opt.p_daily_breach * 100).toFixed(1)}%`,
                        type: opt.p_daily_breach < 0.1 ? "positive" : opt.p_daily_breach < 0.25 ? "warning" : "negative" },
                    ];
                  })().map(({ label, value, type }) => (
                    <Card key={label}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
                      <Badge value={value} type={type} />
                    </Card>
                  ))}
                </div>

                {/* Tabella scenari */}
                <Card>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                                color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    ANALISI PER LIVELLO DI RISCHIO
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {["RISCHIO%", "P(SUCC)", "P(DAILY)", "P(TOT DD)", "P(TIMEOUT)",
                            "GG MEDI", "GG P95", "MAX DD%", ""].map(h => (
                            <th key={h} style={{ padding: "0.4rem 0.5rem", textAlign: "right",
                                               fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
                                               whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.results.map(r => {
                          const isOpt = r.risk_pct === optimal;
                          return (
                            <tr key={r.risk_pct}
                              style={{ background: isOpt ? "var(--accent-dim)" : "transparent",
                                       borderLeft: isOpt ? "2px solid var(--accent)" : "2px solid transparent",
                                       borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)", fontWeight: isOpt ? 700 : 400,
                                           color: isOpt ? "var(--accent)" : "var(--text-primary)" }}>
                                {r.risk_pct}%
                                {r.trade_capped && (
                                  <span title={`Rischio effettivo: ${r.effective_risk_pct}% (ridotto dal cap ${maxRiskPerTrade}% per trade)`}
                                    style={{ marginLeft: 4, color: "var(--warning)", fontSize: 10, cursor: "help" }}>
                                    ⚠cap
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)",
                                           color: r.p_success >= 0.7 ? "var(--accent)" :
                                                  r.p_success >= 0.5 ? "var(--warning)" : "var(--danger)" }}>
                                {(r.p_success * 100).toFixed(1)}%
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)",
                                           color: r.p_daily_breach < 0.1 ? "var(--accent)" :
                                                  r.p_daily_breach < 0.25 ? "var(--warning)" : "var(--danger)" }}>
                                {(r.p_daily_breach * 100).toFixed(1)}%
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)", color: "var(--text-secondary)" }}>
                                {(r.p_total_breach * 100).toFixed(1)}%
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)", color: "var(--text-secondary)" }}>
                                {(r.p_timeout * 100).toFixed(1)}%
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)", color: "var(--text-secondary)" }}>
                                {r.avg_days_success > 0 ? r.avg_days_success : "—"}
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)", color: "var(--text-muted)" }}>
                                {r.p95_days_success > 0 ? r.p95_days_success : "—"}
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)", color: "var(--text-secondary)" }}>
                                {r.avg_max_dd_pct.toFixed(1)}%
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "center",
                                           fontSize: 11 }}>
                                {isOpt ? "★ ottimale" : ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* Grafici affiancati */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <Card>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                                  color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                      P(SUCCESSO) PER RISCHIO
                    </div>
                    <MiniBarChart data={results.results} xKey="risk_pct" yKey="p_success"
                                  color="var(--accent)" height={80} />
                    <div style={{ display: "flex", justifyContent: "space-between",
                                  fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                      <span>{riskMin}%</span><span>{riskMax}%</span>
                    </div>
                  </Card>
                  <Card>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                                  color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                      P(VIOLA DAILY DD) PER RISCHIO
                    </div>
                    <MiniBarChart data={results.results} xKey="risk_pct" yKey="p_daily_breach"
                                  color="var(--danger)" height={80} />
                    <div style={{ display: "flex", justifyContent: "space-between",
                                  fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                      <span>{riskMin}%</span><span>{riskMax}%</span>
                    </div>
                  </Card>
                </div>

                {/* Lotti consigliati per il rischio ottimale */}
                {results.lot_recommendations && results.lot_recommendations.length > 0 && (
                  <Card>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                                  color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                      PARAMETRI DA IMPOSTARE @ RISCHIO OTTIMALE ({results.optimal_risk_pct}%)
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                          {["EA", "PARAMETRO", "VALORE", "LOSS MEDIA/GG", "LOSS MAX/GG"].map(h => (
                            <th key={h} style={{ padding: "0.35rem 0.5rem", textAlign: h === "EA" ? "left" : "right",
                                               fontSize: 10, fontWeight: 600, color: "var(--text-muted)" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.lot_recommendations.map(rec => (
                          <tr key={rec.ea_name} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "0.35rem 0.5rem", color: "var(--text-primary)", fontWeight: 500 }}>
                              {rec.ea_name}
                            </td>
                            <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                         color: "var(--text-muted)", fontSize: 11 }}>
                              {rec.param_name}
                            </td>
                            <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                         fontFamily: "var(--font-data)", fontWeight: 700,
                                         color: rec.trade_capped ? "var(--warning)" : "var(--accent)" }}>
                              {rec.sizing_type === "sqx_fixed_money"
                                ? `$${Number(rec.param_value).toFixed(0)}`
                                : Number(rec.param_value).toFixed(4)}
                              {rec.trade_capped && (
                                <span title={`Lotti ridotti: il trade peggiore supererebbe il ${maxRiskPerTrade}% per trade. Valore capped al limite.`}
                                  style={{ marginLeft: 4, fontSize: 10, color: "var(--warning)", cursor: "help" }}>
                                  ⚠
                                </span>
                              )}
                              {!rec.trade_capped && rec.note && (
                                <span title={rec.note}
                                  style={{ marginLeft: 4, fontSize: 10,
                                           color: "var(--text-muted)", cursor: "help" }}>ⓘ</span>
                              )}
                            </td>
                            <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                         fontFamily: "var(--font-data)", color: "var(--warning)" }}>
                              {rec.expected_avg_daily_loss_dollar != null
                                ? `-$${rec.expected_avg_daily_loss_dollar.toFixed(0)}`
                                : "—"}
                            </td>
                            <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                         fontFamily: "var(--font-data)", color: "var(--danger)" }}>
                              {rec.expected_max_daily_loss_dollar != null
                                ? `-$${rec.expected_max_daily_loss_dollar.toFixed(0)}`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: "0.5rem" }}>
                      Fattore di scala: {results.lot_recommendations[0]?.scale_factor?.toFixed(4)} ·
                      Stesso fattore per tutti gli EA (tutti calibrati allo stesso MaxDD in $)
                    </div>
                  </Card>
                )}

                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {results.n_simulations.toLocaleString()} simulazioni ·
                  {results.n_trading_days} giorni con trade su {results.n_calendar_days} totali
                  ({results.avg_trades_freq}% frequenza) ·
                  Rischio ottimale = max P(successo) / √(giorni medi)
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPALE
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "regole",    label: "Regole Prop Firm" },
  { id: "simulator", label: "Challenge Simulator" },
];

export function PropFirmRules() {
  const [activeTab,          setActiveTab]          = useState("regole");
  const [firms,              setFirms]              = useState(loadFirms);
  const [selectedFirm,       setSelectedFirm]       = useState(null);
  const [showAddFirm,        setShowAddFirm]        = useState(false);
  const [showAddChallenge,   setShowAddChallenge]   = useState(false);

  useEffect(() => { saveFirms(firms); }, [firms]);
  useEffect(() => {
    if (!selectedFirm && firms.length > 0) setSelectedFirm(firms[0].id);
  }, []);

  function addFirm(firm) { setFirms(p => [...p, firm]); setSelectedFirm(firm.id); }
  function deleteFirm(id) {
    const rem = firms.filter(f => f.id !== id);
    setFirms(rem); setSelectedFirm(rem[0]?.id || null);
  }
  function addChallenge(ch) {
    setFirms(p => p.map(f => f.id === selectedFirm ? { ...f, challenges: [...f.challenges, ch] } : f));
  }
  function deleteChallenge(firmId, chId) {
    setFirms(p => p.map(f => f.id === firmId
      ? { ...f, challenges: f.challenges.filter(c => c.id !== chId) } : f));
  }
  function updateChallenge(firmId, updated) {
    setFirms(p => p.map(f => f.id === firmId
      ? { ...f, challenges: f.challenges.map(c => c.id === updated.id ? updated : c) } : f));
  }
  function resetToDefault() {
    if (confirm("Ripristinare i dati predefiniti?")) {
      setFirms(DEFAULT_FIRMS); setSelectedFirm(DEFAULT_FIRMS[0].id);
    }
  }

  const activeFirm = firms.find(f => f.id === selectedFirm);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Prop Firm</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Regole, limiti e simulazione challenge · {firms.length} prop firms
          </p>
        </div>
        {activeTab === "regole" && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={resetToDefault}
              style={{ padding: "0.4rem 0.9rem", fontSize: 12, borderRadius: "var(--radius-sm)",
                       border: "1px solid var(--border)", background: "var(--bg-elevated)",
                       color: "var(--text-muted)", cursor: "pointer" }}>
              Reset default
            </button>
            <button onClick={() => setShowAddFirm(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.4rem 0.9rem",
                       fontSize: 13, borderRadius: "var(--radius-sm)",
                       border: "1px solid var(--accent)", background: "var(--accent-dim)",
                       color: "var(--accent)", cursor: "pointer" }}>
              <Plus size={14} /> Aggiungi Prop Firm
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.5rem",
                    borderBottom: "1px solid var(--border)", paddingBottom: "0" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding: "0.5rem 1.25rem", fontSize: 13, border: "none",
                     borderBottom: activeTab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                     background: "transparent", fontWeight: activeTab === t.id ? 600 : 400,
                     color: activeTab === t.id ? "var(--accent)" : "var(--text-secondary)",
                     cursor: "pointer", marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Regole ───────────────────────────────────────── */}
      {activeTab === "regole" && (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {firms.map(firm => (
              <div key={firm.id} onClick={() => setSelectedFirm(firm.id)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                         padding: "0.75rem 0.9rem", borderRadius: "var(--radius-md)", cursor: "pointer",
                         background: selectedFirm === firm.id ? "var(--accent-dim)" : "var(--bg-surface)",
                         border: `1px solid ${selectedFirm === firm.id ? "var(--accent)" : "var(--border)"}` }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: selectedFirm === firm.id ? 600 : 400,
                                color: selectedFirm === firm.id ? "var(--accent)" : "var(--text-primary)" }}>
                    {firm.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {firm.challenges.length} challenge{firm.challenges.length !== 1 ? "s" : ""}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteFirm(firm.id); }}
                  style={{ background: "none", border: "none", color: "var(--text-muted)",
                           cursor: "pointer", padding: 4, opacity: 0.5 }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <div>
            {!activeFirm ? (
              <div style={{ textAlign: "center", padding: "3rem", border: "1px dashed var(--border)",
                            borderRadius: "var(--radius-lg)", color: "var(--text-muted)" }}>
                Seleziona una prop firm o aggiungine una nuova
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between",
                              alignItems: "center", marginBottom: "1.25rem" }}>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>{activeFirm.name}</h2>
                    {activeFirm.website && (
                      <a href={activeFirm.website} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
                        {activeFirm.website} ↗
                      </a>
                    )}
                  </div>
                  <button onClick={() => setShowAddChallenge(true)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.4rem 0.9rem",
                             fontSize: 13, borderRadius: "var(--radius-sm)",
                             border: "1px solid var(--border)", background: "var(--bg-elevated)",
                             color: "var(--text-secondary)", cursor: "pointer" }}>
                    <Plus size={14} /> Aggiungi Challenge
                  </button>
                </div>
                {activeFirm.challenges.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2rem", border: "1px dashed var(--border)",
                                borderRadius: "var(--radius-lg)", color: "var(--text-muted)", fontSize: 13 }}>
                    Nessuna challenge — clicca "Aggiungi Challenge"
                  </div>
                ) : (
                  activeFirm.challenges.map(ch => (
                    <ChallengeCard key={ch.id} challenge={ch}
                      onDelete={id => deleteChallenge(activeFirm.id, id)}
                      onUpdate={updated => updateChallenge(activeFirm.id, updated)} />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab Challenge Simulator ──────────────────────────── */}
      {activeTab === "simulator" && (
        <ChallengeSimulator firms={firms} />
      )}
    </div>
  );
}
