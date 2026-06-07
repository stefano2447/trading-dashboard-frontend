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

// ─── Worker inline (evita problemi di percorso con Vite/Vercel) ──────────────
function createMonteCarloWorker() {
  const code = `/**
 * monteCarloWorker.js
 * Web Worker — esegue il Monte Carlo sul PC dell'utente
 * Nessuna chiamata a Render, tutto in locale nel browser.
 *
 * Riceve via postMessage:
 *   { daily_pnl_dollar, ea_components, params }
 *
 * Invia via postMessage:
 *   { type: "progress", pct }     durante il calcolo
 *   { type: "result", data }      al termine
 */

// ─── PRNG veloce (Mulberry32) ─────────────────────────────────────────────────
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function randomChoice(arr, rand) {
  return arr[Math.floor(rand() * arr.length)];
}

// ─── Simulazione singola fase ─────────────────────────────────────────────────
function simulatePhase(scaledArr, rand, capital, dailyDDLimit, totalDDLimit,
                       profitTarget, timeLimit, minTradingDays, maxDDList) {
  let balance      = capital;
  let peakBalance  = capital;
  let day          = 0;
  let tradingDays  = 0;

  while (true) {
    day++;
    if (day > timeLimit) return { outcome: "timeout", days: day };

    const dayPnl = randomChoice(scaledArr, rand);

    if (dayPnl !== 0.0) {
      tradingDays++;

      // Daily DD breach
      if (dayPnl < 0 && Math.abs(dayPnl) > dailyDDLimit) {
        return { outcome: "daily_breach", days: day };
      }

      balance += dayPnl;
      if (balance > peakBalance) peakBalance = balance;

      const currentDD = peakBalance - balance;
      maxDDList.push(currentDD / capital * 100.0);

      if (currentDD > totalDDLimit) {
        return { outcome: "total_breach", days: day };
      }
    }

    if (tradingDays >= minTradingDays) {
      if (balance - capital >= profitTarget) {
        return { outcome: "success", days: day };
      }
    }
  }
}

// ─── Costruzione serie combinata con cap per-EA ───────────────────────────────
function buildCappedScaledSeries(eaComponents, capital, riskPct, maxRiskPerTradePct) {
  // Calcola lo scale_factor base dal rischio medio giornaliero del PORTAFOGLIO
  // poi applica il cap per-EA individualmente, e ricombina i P&L.
  //
  // Restituisce { scaledArr, anyCapped, perEaInfo }

  // 1. Serie combinata grezza (a lotti backtest) per calcolare avg daily loss
  const minLen = Math.min(...eaComponents.map(c => c.daily_pnl_dollar.length));
  const rawCombined = new Array(minLen).fill(0);
  for (const c of eaComponents) {
    const arr = c.daily_pnl_dollar;
    for (let i = 0; i < minLen; i++) rawCombined[i] += arr[arr.length - minLen + i];
  }

  const losses = rawCombined.filter(x => x < 0);
  if (!losses.length) return { scaledArr: rawCombined, anyCapped: false, perEaInfo: [] };

  const avgDailyLoss     = Math.abs(losses.reduce((a,b)=>a+b,0)/losses.length);
  const riskTargetDollar = capital * riskPct / 100.0;
  const scaleFactorBase  = avgDailyLoss > 0 ? riskTargetDollar / avgDailyLoss : 1.0;

  const maxRiskDollar = capital * (maxRiskPerTradePct || 2.0) / 100.0;

  // 2. Calcola scale_factor per-EA con cap individuale
  const perEaInfo = [];
  const eaScaleFactors = eaComponents.map(comp => {
    const sizing = comp.lot_sizing_type || "fixed_lots";

    // Rischio per singolo trade in $ con scale_factor base
    let riskPerTradeScaled;
    if (sizing === "sqx_fixed_money") {
      const mmBase = comp.mm_risked_money || comp.initial_capital * 0.01;
      riskPerTradeScaled = mmBase * scaleFactorBase;
    } else {
      const maxSinglePct = comp.max_single_trade_loss_pct || 0;
      const maxSingleDollarBacktest = (maxSinglePct / 100.0) * comp.initial_capital;
      riskPerTradeScaled = maxSingleDollarBacktest * scaleFactorBase;
    }

    let sfEA = scaleFactorBase;
    let capped = false;
    if (riskPerTradeScaled > maxRiskDollar && riskPerTradeScaled > 0) {
      sfEA = scaleFactorBase * (maxRiskDollar / riskPerTradeScaled);
      capped = true;
    }
    perEaInfo.push({ ea_name: comp.ea_name, scale_factor: sfEA, capped });
    return sfEA;
  });

  // 3. Ricombina i P&L con lo scale_factor per-EA (cappato dove serve)
  const scaledArr = new Array(minLen).fill(0);
  eaComponents.forEach((comp, idx) => {
    const arr = comp.daily_pnl_dollar;
    const sf  = eaScaleFactors[idx];
    for (let i = 0; i < minLen; i++) {
      scaledArr[i] += arr[arr.length - minLen + i] * sf;
    }
  });

  const anyCapped = perEaInfo.some(e => e.capped);
  return { scaledArr, anyCapped, perEaInfo, scaleFactorBase };
}

// ─── Monte Carlo per un livello di rischio ────────────────────────────────────
function runForRiskLevel(eaComponents, params, riskPct) {
  // Seed FISSO per ogni livello di rischio: garantisce che tutti i livelli
  // siano testati sulle stesse identiche sequenze simulate.
  // Così l'unica differenza tra i livelli è lo scale_factor, non il caso.
  // Quando il cap blocca lo scale_factor, i risultati diventano identici.
  const rand = mulberry32(12345);
  // Costruisce la serie combinata applicando il cap per-EA.
  // Ogni EA viene scalato col suo scale_factor (cappato dove serve)
  // PRIMA di combinare i P&L → la simulazione riflette i lotti reali.
  const built = buildCappedScaledSeries(
    eaComponents, params.capital, riskPct, params.max_risk_per_trade_pct
  );
  const scaledArr = built.scaledArr;
  if (!scaledArr.length) return null;

  const tradeCapped      = built.anyCapped;
  const effectiveRiskPct = riskPct;
  const scaleFactor      = built.scaleFactorBase || 1.0;

  const dailyDDLimit = params.capital * params.daily_dd_pct  / 100.0;
  const totalDDLimit = params.capital * params.max_dd_pct    / 100.0;
  const target1      = params.capital * params.profit_target_p1 / 100.0;
  const target2      = params.profit_target_p2
                        ? params.capital * params.profit_target_p2 / 100.0
                        : null;
  const timeLimit    = params.time_limit_days > 0 ? params.time_limit_days : 99999;
  const minDays      = params.min_trading_days || 0;

  const n = params.n_simulations;
  const outcomes = { success: 0, daily_breach: 0, total_breach: 0, timeout: 0 };
  const daysToSuccess = [];
  const maxDDReached  = [];

  for (let i = 0; i < n; i++) {
    const r1 = simulatePhase(scaledArr, rand, params.capital,
                              dailyDDLimit, totalDDLimit,
                              target1, timeLimit, minDays, maxDDReached);

    if (r1.outcome !== "success") {
      outcomes[r1.outcome]++;
      continue;
    }

    if (target2 === null) {
      outcomes.success++;
      daysToSuccess.push(r1.days);
    } else {
      const r2 = simulatePhase(scaledArr, rand, params.capital,
                                dailyDDLimit, totalDDLimit,
                                target2, timeLimit, minDays, maxDDReached);
      if (r2.outcome === "success") {
        outcomes.success++;
        daysToSuccess.push(r1.days + r2.days);
      } else {
        outcomes[r2.outcome]++;
      }
    }
  }

  const pSuccess     = outcomes.success      / n;
  const pDaily       = outcomes.daily_breach / n;
  const pTotal       = outcomes.total_breach / n;
  const pTimeout     = outcomes.timeout      / n;

  const sorted = daysToSuccess.sort((a,b) => a-b);
  const avgDays    = sorted.length ? sorted.reduce((a,b)=>a+b,0)/sorted.length : 0;
  const medianDays = sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
  const p95Days    = sorted.length ? sorted[Math.floor(sorted.length*0.95)] : 0;

  const sortedDD = maxDDReached.sort((a,b)=>a-b);
  const avgMDD = sortedDD.length ? sortedDD.reduce((a,b)=>a+b,0)/sortedDD.length : 0;
  const p95MDD = sortedDD.length ? sortedDD[Math.floor(sortedDD.length*0.95)] : 0;

  return {
    risk_pct:            riskPct,
    effective_risk_pct:  Math.round(effectiveRiskPct * 1000) / 1000,
    trade_capped:        tradeCapped,
    scale_factor:        Math.round(scaleFactor * 10000) / 10000,
    p_success:           Math.round(pSuccess * 10000) / 10000,
    p_daily_breach:      Math.round(pDaily   * 10000) / 10000,
    p_total_breach:      Math.round(pTotal   * 10000) / 10000,
    p_timeout:           Math.round(pTimeout * 10000) / 10000,
    avg_days_success:    Math.round(avgDays    * 10) / 10,
    median_days_success: Math.round(medianDays * 10) / 10,
    p95_days_success:    Math.round(p95Days    * 10) / 10,
    avg_max_dd_pct:      Math.round(avgMDD * 1000) / 1000,
    p95_max_dd_pct:      Math.round(p95MDD * 1000) / 1000,
  };
}

// ─── Calcolo lotti consigliati ────────────────────────────────────────────────
function computeLotRecommendations(dailyPnlDollar, eaComponents, capital, optimalRisk, maxRiskPerTradePct) {
  if (!optimalRisk || !eaComponents.length) return [];

  const losses = dailyPnlDollar.filter(x => x < 0);
  if (!losses.length) return [];

  // Scale factor base: porta il rischio medio giornaliero al target ottimale
  const avgDailyLoss     = Math.abs(losses.reduce((a,b)=>a+b,0)/losses.length);
  const riskTargetDollar = capital * optimalRisk / 100.0;
  const scaleFactorBase  = avgDailyLoss > 0 ? riskTargetDollar / avgDailyLoss : 1.0;

  const maxRiskDollar = capital * (maxRiskPerTradePct || 2.0) / 100.0;

  return eaComponents.map(comp => {
    const sizing = comp.lot_sizing_type || "fixed_lots";

    // ── Calcola il rischio per singolo trade in $ (con scale_factor base) ──
    // sqx_fixed_money: il rischio per trade è mmRiskedMoney × scale_factor
    //   → definizione esatta, non serve stima
    // tutti gli altri: usa p90_single_trade_loss_pct (90° percentile perdite)
    //   → stima del rischio SL teorico, esclude outlier da slippage estremo
    //   → fallback su max_single se p90 non disponibile

    let riskPerTradeScaled;

    if (sizing === "sqx_fixed_money") {
      const mmBase = comp.mm_risked_money || comp.initial_capital * 0.01;
      riskPerTradeScaled = mmBase * scaleFactorBase;
    } else {
      // Usa p90 come stima del rischio teorico per trade
      const p90Pct = comp.p90_single_trade_loss_pct
                     || comp.max_single_trade_loss_pct
                     || 0;
      const p90Dollar = (p90Pct / 100.0) * comp.initial_capital;
      riskPerTradeScaled = p90Dollar * scaleFactorBase;
    }

    // Cap per-EA: riduci solo questo EA se supera il limite
    let sfEA      = scaleFactorBase;
    let capped    = false;
    if (riskPerTradeScaled > maxRiskDollar && riskPerTradeScaled > 0) {
      sfEA   = scaleFactorBase * (maxRiskDollar / riskPerTradeScaled);
      capped = true;
    }

    // ── Calcola valore parametro con scale_factor per-EA ──────────────────
    let paramName, paramValue, note;

    if (sizing === "price_scaling_explicit") {
      paramName  = "base_lots";
      paramValue = Math.round(comp.base_lots * sfEA * 10000) / 10000;
      note       = "valido @ prezzo " + (comp.defaultprice) + "; l'EA scala automaticamente";
    } else if (sizing === "price_scaling_implicit") {
      paramName  = "LotSize";
      paramValue = Math.round(comp.ref_lots * sfEA * 10000) / 10000;
      note       = "valido @ prezzo " + (comp.ref_price) + "; l'EA scala col prezzo";
    } else if (sizing === "sqx_fixed_money") {
      paramName        = "mmRiskedMoney";
      const mmBase     = comp.mm_risked_money || comp.initial_capital * 0.01;
      paramValue       = Math.round(mmBase * sfEA * 100) / 100;
      const mmOriginal = Math.round(mmBase * scaleFactorBase);
      note = capped
        ? "ottimale sarebbe $" + (mmOriginal) + ", cappato a $" + (Math.round(paramValue)) + " per limite rischio/trade"
        : "da " + (Math.round(mmBase)) + "$ → " + (Math.round(paramValue)) + "$";
    } else {
      paramName  = "Lots";
      paramValue = Math.round(comp.base_lots * sfEA * 10000) / 10000;
      note       = "lotti fissi";
    }

    // Loss media/max giornaliera attesa con i lotti finali
    const eaArr    = comp.daily_pnl_dollar || [];
    const eaLosses = eaArr.filter(x => x < 0);
    const avgEALoss = eaLosses.length
      ? Math.abs(eaLosses.reduce((a,b)=>a+b,0)/eaLosses.length) * sfEA
      : null;
    const maxEALoss = eaLosses.length
      ? Math.abs(Math.min(...eaLosses)) * sfEA
      : null;

    // Rischio per singolo trade: usa p90 per price_scaling, mmRiskedMoney per sqx
    // Questo è il rischio teorico (SL), non il caso peggiore con slippage
    let effectiveSingleRisk;
    if (sizing === "sqx_fixed_money") {
      const mmBase = comp.mm_risked_money || comp.initial_capital * 0.01;
      effectiveSingleRisk = Math.round(mmBase * sfEA);
    } else {
      const p90Pct = comp.p90_single_trade_loss_pct || comp.max_single_trade_loss_pct || 0;
      effectiveSingleRisk = Math.round((p90Pct / 100.0) * comp.initial_capital * sfEA);
    }
    // Worst case storico (include slippage)
    const worstCaseSingleRisk = Math.round(
      (comp.max_single_trade_loss_pct || 0) / 100.0 * comp.initial_capital * sfEA
    );

    return {
      ea_name:                          comp.ea_name,
      sizing_type:                      sizing,
      param_name:                       paramName,
      param_value:                      paramValue,
      note,
      trade_capped:                     capped,
      scale_factor:                     Math.round(sfEA * 10000) / 10000,
      effective_single_trade_risk_dollar: effectiveSingleRisk,     // rischio teorico (SL)
      worst_case_single_trade_dollar:   worstCaseSingleRisk,       // peggior caso storico
      expected_avg_daily_loss_dollar:   avgEALoss ? Math.round(avgEALoss) : null,
      expected_max_daily_loss_dollar:   maxEALoss ? Math.round(maxEALoss) : null,
    };
  });
}


// ─── Simulazione conto FUNDED (per stimare payout atteso) ─────────────────────
function simulateFunded(eaComponents, params, riskPctFunded) {
  // Simula il conto funded a rischio ridotto finché non viola un limite (Modello A).
  // Applica il cap per-EA anche qui (a rischio dimezzato il cap potrebbe non
  // scattare più per alcuni EA).
  const built = buildCappedScaledSeries(
    eaComponents, params.capital, riskPctFunded, params.max_risk_per_trade_pct
  );
  const scaledArr = built.scaledArr;
  if (!scaledArr.length) return 0;

  const dailyDDLimit = params.capital * params.daily_dd_pct / 100.0;
  const totalDDLimit = params.capital * params.max_dd_pct   / 100.0;

  // Seed fisso anche qui per coerenza tra livelli di rischio
  const rand = mulberry32(67890);
  const nSims = Math.min(params.n_simulations, 2000);  // funded sim più leggera

  // Limite massimo di giorni per simulazione funded (evita loop infiniti)
  // Un conto funded "sopravvive" mediamente molti mesi; cap a 2 anni
  const maxDays = 504;  // ~2 anni di trading

  let totalProfit = 0;

  for (let s = 0; s < nSims; s++) {
    let balance     = params.capital;
    let peakBalance = params.capital;
    let day         = 0;
    let violated    = false;

    while (!violated && day < maxDays) {
      day++;
      const dayPnl = scaledArr[Math.floor(rand() * scaledArr.length)];

      if (dayPnl !== 0) {
        // Daily DD
        if (dayPnl < 0 && Math.abs(dayPnl) > dailyDDLimit) {
          violated = true;
          break;
        }
        balance += dayPnl;
        if (balance > peakBalance) peakBalance = balance;
        if (peakBalance - balance > totalDDLimit) {
          violated = true;
          break;
        }
      }
    }

    // Profitto realizzato fino alla violazione (o fine periodo)
    const profit = Math.max(0, balance - params.capital);
    totalProfit += profit;
  }

  return totalProfit / nSims;  // profitto medio lordo
}


// ─── Simulatore Conto Reale ───────────────────────────────────────────────────
function runRealAccountSimulation(eaComponents, params, riskPct) {
  // riskPct = rischio per singola operazione in % del capitale reale.
  //
  // SCALA FACTOR ($ assoluti, non %):
  //   risk_per_trade_$ = capital * riskPct / 100
  //   p90_loss_$       = p90_single_trade_loss_pct / 100 * initial_capital_backtest
  //   factor           = risk_per_trade_$ / p90_loss_$
  //
  // Questo è coerente con la logica del challenge simulator.
  // Tutti gli EA vengono scalati in modo che il loro trade tipico (p90)
  // rischi esattamente riskPct% del capitale reale.
  //
  // COMPOUND: rimosso — lotti fissi per risultati affidabili.

  const riskDollar = params.ra_capital * riskPct / 100.0;
  const minLen = Math.min(...eaComponents.map(c => c.daily_pnl_dollar.length));

  // Per ogni EA: factor = risk_per_trade_$ / p90_loss_$_backtest
  const eaFactors = [];
  const eaSeries  = [];

  for (const comp of eaComponents) {
    const sizing = comp.lot_sizing_type || "fixed_lots";
    let factor;

    if (sizing === "sqx_fixed_money") {
      // mmRiskedMoney è già in $, semplicemente lo portiamo al rischio voluto
      const mmBase = comp.mm_risked_money || comp.initial_capital * 0.01;
      factor = riskDollar / mmBase;
    } else {
      // p90 in $ assoluti del backtest
      const p90Pct = comp.p90_single_trade_loss_pct || comp.max_single_trade_loss_pct || 1.0;
      const p90Dollar = (p90Pct / 100.0) * comp.initial_capital;
      factor = p90Dollar > 0 ? riskDollar / p90Dollar : 1.0;
    }

    eaFactors.push(factor);

    // Serie P&L in $ reali (scala col capitale del backtest, poi con factor)
    // daily_pnl_dollar è già in $ del backtest → * factor → $ reali
    const arr = comp.daily_pnl_dollar;
    const scaledSeries = new Array(minLen);
    for (let i = 0; i < minLen; i++) {
      scaledSeries[i] = arr[arr.length - minLen + i] * factor;
    }
    eaSeries.push(scaledSeries);
  }

  // Combina i P&L in $ reali (somma dei contributi di ogni EA)
  const combinedDollar = new Array(minLen).fill(0);
  for (const s of eaSeries) {
    for (let i = 0; i < minLen; i++) combinedDollar[i] += s[i];
  }

  // Orizzonti temporali
  const horizons = [
    { label: "3m",  days: 91  },
    { label: "6m",  days: 182 },
    { label: "12m", days: 365 },
  ];
  if (params.ra_custom_days > 0) {
    horizons.push({ label: "custom", days: params.ra_custom_days });
  }

  const maxHorizonDays = Math.max(...horizons.map(h => h.days));
  const ruinThreshold  = params.ra_ruin_pct / 100.0;
  const dd30Threshold  = 0.30;
  const nSims          = params.n_simulations;
  const rand           = mulberry32(12345);

  const horizonBalances = {};
  for (const h of horizons) horizonBalances[h.label] = [];

  let nRuined = 0, nDD30 = 0;
  const maxDDList = [];

  const blockSize = Math.max(1, Math.round(params.ra_block_size || 1));
  const nBlocks   = combinedDollar.length - blockSize + 1;

  for (let s = 0; s < nSims; s++) {
    let balance     = params.ra_capital;
    let peakBalance = balance;
    let ruined      = false;
    let hitDD30     = false;
    const snapshots = {};
    let dayCount    = 0;

    while (dayCount < maxHorizonDays) {
      // Block bootstrap: campiona un blocco di giorni consecutivi
      const blockStart = Math.floor(rand() * (blockSize > 1 ? nBlocks : combinedDollar.length));
      const blockEnd   = Math.min(blockStart + blockSize, combinedDollar.length);

      for (let bi = blockStart; bi < blockEnd && dayCount < maxHorizonDays; bi++) {
        dayCount++;
        const day    = dayCount;
        const pnlDay = combinedDollar[bi];
      if (pnlDay !== 0) {
          balance += pnlDay;
          if (balance < 0) balance = 0;
          if (balance > peakBalance) peakBalance = balance;
          // DD dal picco (per P(DD>30%))
          const ddPeak = peakBalance > 0 ? (peakBalance - balance) / peakBalance : 0;
          if (ddPeak > dd30Threshold) hitDD30 = true;
          // Rovina = perdita del X% del CAPITALE INIZIALE (non dal picco)
          // Es. 60% di $1000 = balance < $400, indipendentemente da picchi intermedi
          const lossFromInitial = (params.ra_capital - balance) / params.ra_capital;
          if (lossFromInitial >= ruinThreshold) {
            ruined  = true;
            balance = params.ra_capital * (1 - ruinThreshold);
          }
        }
        for (const h of horizons) {
          if (day === h.days && snapshots[h.label] === undefined) {
            snapshots[h.label] = balance;
          }
        }
      }  // fine blocco
    }  // fine while
    for (const h of horizons) {
      horizonBalances[h.label].push(snapshots[h.label] ?? balance);
    }
    if (ruined) nRuined++;
    if (hitDD30) nDD30++;
    if (peakBalance > 0) maxDDList.push((peakBalance - balance) / peakBalance * 100);
  }

  // Calcola statistiche per orizzonte
  const horizonStats = {};
  for (const h of horizons) {
    const bals = horizonBalances[h.label].sort((a,b) => a-b);
    const n    = bals.length;
    const mean = bals.reduce((a,b) => a+b, 0) / n;
    const toRet = b => Math.round((b - params.ra_capital) / params.ra_capital * 1000) / 10;
    horizonStats[h.label] = {
      days:     h.days,
      mean_bal: Math.round(mean),
      p5_bal:   Math.round(bals[Math.floor(n * 0.05)]),
      p50_bal:  Math.round(bals[Math.floor(n * 0.50)]),
      p95_bal:  Math.round(bals[Math.floor(n * 0.95)]),
      mean_ret: toRet(mean),
      p5_ret:   toRet(bals[Math.floor(n * 0.05)]),
      p50_ret:  toRet(bals[Math.floor(n * 0.50)]),
      p95_ret:  toRet(bals[Math.floor(n * 0.95)]),
    };
  }

  const sortedDD = maxDDList.sort((a,b) => a-b);
  const ndd = sortedDD.length;

  // Lotti per ogni EA basati su factor ($ assoluti)
  const lotRecs = eaComponents.map((comp, idx) => {
    const sizing = comp.lot_sizing_type || "fixed_lots";
    const factor = eaFactors[idx];
    let paramName, paramValue, note;

    if (sizing === "price_scaling_explicit") {
      paramName  = "base_lots";
      paramValue = Math.round(comp.base_lots * factor * 10000) / 10000;
      note       = "valido @ prezzo " + comp.defaultprice + "; l'EA scala automaticamente";
    } else if (sizing === "price_scaling_implicit") {
      paramName  = "LotSize";
      paramValue = Math.round(comp.ref_lots * factor * 10000) / 10000;
      note       = "valido @ prezzo " + comp.ref_price + "; l'EA scala col prezzo";
    } else if (sizing === "sqx_fixed_money") {
      paramName  = "mmRiskedMoney";
      paramValue = Math.round(riskDollar * 100) / 100;
      note       = "= " + riskPct + "% di $" + params.ra_capital + " = $" + Math.round(riskDollar);
    } else {
      paramName  = "Lots";
      paramValue = Math.round(comp.base_lots * factor * 10000) / 10000;
      note       = "lotti fissi";
    }

    return {
      ea_name:     comp.ea_name,
      sizing_type: sizing,
      param_name:  paramName,
      param_value: paramValue,
      note,
      factor:      Math.round(factor * 10000) / 10000,
    };
  });

  return {
    risk_pct:            riskPct,
    p_ruin:              Math.round(nRuined / nSims * 10000) / 10000,
    p_dd30:              Math.round(nDD30   / nSims * 10000) / 10000,
    avg_max_dd:          Math.round(sortedDD.reduce((a,b)=>a+b,0)/ndd * 10) / 10,
    p95_max_dd:          Math.round(sortedDD[Math.floor(ndd * 0.95)] * 10) / 10,
    horizons:            horizonStats,
    lot_recommendations: lotRecs,
  };
}

// ─── Simulazione Compound (al rischio ottimale già scelto) ───────────────────
function runCompoundSimulation(eaComponents, params, riskPct) {
  // Uguale a runRealAccountSimulation ma con compound attivo:
  // ogni giorno il P&L scala con il balance corrente.
  // Viene chiamata solo per il rischio ottimale già identificato.

  const riskDollar = params.ra_capital * riskPct / 100.0;
  const minLen = Math.min(...eaComponents.map(c => c.daily_pnl_dollar.length));

  // Calcola factor per ogni EA (stesso metodo di runRealAccountSimulation)
  const eaSeries = [];
  for (const comp of eaComponents) {
    const sizing = comp.lot_sizing_type || "fixed_lots";
    let factor;
    if (sizing === "sqx_fixed_money") {
      const mmBase = comp.mm_risked_money || comp.initial_capital * 0.01;
      factor = riskDollar / mmBase;
    } else {
      const p90Pct    = comp.p90_single_trade_loss_pct || comp.max_single_trade_loss_pct || 1.0;
      const p90Dollar = (p90Pct / 100.0) * comp.initial_capital;
      factor = p90Dollar > 0 ? riskDollar / p90Dollar : 1.0;
    }
    // Serie in % del capitale REALE (per applicare compound correttamente).
    // Logica: pnlDay = pctSeries × balance_corrente
    // Al giorno 0 (balance = ra_capital) deve dare lo stesso risultato dei lotti fissi:
    //   pnlDay_0 = arr × factor / ra_capital × ra_capital = arr × factor ✓
    // Con compound (balance > ra_capital): pnlDay > lotti fissi ✓
    const arr = comp.daily_pnl_dollar;
    const pctSeries = new Array(minLen);
    for (let i = 0; i < minLen; i++) {
      pctSeries[i] = (arr[arr.length - minLen + i] * factor) / params.ra_capital;
    }
    eaSeries.push(pctSeries);
  }

  // Combina le serie in % (somma dei contributi)
  const combinedPct = new Array(minLen).fill(0);
  for (const s of eaSeries) for (let i = 0; i < minLen; i++) combinedPct[i] += s[i];

  const horizons = [
    { label: "3m",  days: 91  },
    { label: "6m",  days: 182 },
    { label: "12m", days: 365 },
    { label: "24m", days: 730 },
    { label: "36m", days: 1095 },
  ];
  if (params.ra_custom_days > 0) {
    horizons.push({ label: "custom", days: params.ra_custom_days });
  }

  const maxDays    = Math.max(...horizons.map(h => h.days));
  const ruinPct    = params.ra_ruin_pct / 100.0;
  const dd30       = 0.30;
  const nSims      = params.n_simulations;
  const rand       = mulberry32(99999);  // seed diverso dal run fisso

  const horizonBalances = {};
  for (const h of horizons) horizonBalances[h.label] = [];
  let nRuined = 0, nDD30 = 0;

  const cBlockSize = Math.max(1, Math.round(params.ra_block_size || 1));
  const cNBlocks   = combinedPct.length - cBlockSize + 1;

  for (let s = 0; s < nSims; s++) {
    let balance     = params.ra_capital;
    let peakBalance = balance;
    let ruined      = false;
    let hitDD30     = false;
    const snapshots = {};
    let dayCount    = 0;

    while (dayCount < maxDays) {
      const blockStart = Math.floor(rand() * (cBlockSize > 1 ? Math.max(cNBlocks,1) : combinedPct.length));
      const blockEnd   = Math.min(blockStart + cBlockSize, combinedPct.length);

      for (let bi = blockStart; bi < blockEnd && dayCount < maxDays; bi++) {
        dayCount++;
        const day    = dayCount;
        const pctDay = combinedPct[bi];
        if (pctDay !== 0 && !ruined) {
          const pnlDay = pctDay * balance;
          balance += pnlDay;
          if (balance < 0) balance = 0;
          if (balance > peakBalance) peakBalance = balance;
          const ddPeak = peakBalance > 0 ? (peakBalance - balance) / peakBalance : 0;
          if (ddPeak > dd30) hitDD30 = true;
          const lossFromInitial = (params.ra_capital - balance) / params.ra_capital;
          if (lossFromInitial >= ruinPct) {
            ruined  = true;
            balance = params.ra_capital * (1 - ruinPct);
          }
        }
        for (const h of horizons) {
          if (day === h.days && snapshots[h.label] === undefined) {
            snapshots[h.label] = balance;
          }
        }
      }
    }
    for (const h of horizons) {
      horizonBalances[h.label].push(snapshots[h.label] ?? balance);
    }
    if (ruined) nRuined++;
    if (hitDD30) nDD30++;
  }

  const horizonStats = {};
  for (const h of horizons) {
    const bals = horizonBalances[h.label].sort((a,b) => a-b);
    const n    = bals.length;
    const mean = bals.reduce((a,b) => a+b, 0) / n;
    const toRet = b => Math.round((b - params.ra_capital) / params.ra_capital * 1000) / 10;
    horizonStats[h.label] = {
      days:     h.days,
      mean_bal: Math.round(mean),
      p5_bal:   Math.round(bals[Math.floor(n * 0.05)]),
      p50_bal:  Math.round(bals[Math.floor(n * 0.50)]),
      p95_bal:  Math.round(bals[Math.floor(n * 0.95)]),
      mean_ret: toRet(mean),
      p5_ret:   toRet(bals[Math.floor(n * 0.05)]),
      p50_ret:  toRet(bals[Math.floor(n * 0.50)]),
      p95_ret:  toRet(bals[Math.floor(n * 0.95)]),
    };
  }

  return {
    sim_type:   "compound",
    risk_pct:   riskPct,
    p_ruin:     Math.round(nRuined / nSims * 10000) / 10000,
    p_dd30:     Math.round(nDD30   / nSims * 10000) / 10000,
    horizons:   horizonStats,
    n_simulations: nSims,
    capital:    params.ra_capital,
  };
}

// ─── Entry point del Worker ───────────────────────────────────────────────────
self.onmessage = function(e) {
  const { daily_pnl_dollar, ea_components, params } = e.data;

  // ── Simulazione Compound (al rischio ottimale) ───────────────────────────
  if (params.sim_type === "compound") {
    const res = runCompoundSimulation(ea_components, params, params.compound_risk_pct);
    self.postMessage({ type: "result", data: res });
    return;
  }

  // ── Simulatore Conto Reale ─────────────────────────────────────────────────
  if (params.sim_type === "real_account") {
    const riskLevels = [];
    let r = params.risk_min_pct;
    while (r <= params.risk_max_pct + 1e-9) {
      riskLevels.push(Math.round(r * 10000) / 10000);
      r += params.risk_step_pct;
    }

    const results = [];
    for (let i = 0; i < riskLevels.length; i++) {
      const res = runRealAccountSimulation(ea_components, params, riskLevels[i]);
      if (res) results.push(res);
      self.postMessage({ type: "progress", pct: Math.round((i+1)/riskLevels.length*100) });
    }

    // Ottimale per conto reale:
    // Massimizza il rendimento medio a 12m, ma SOLO tra i livelli dove:
    //   1. P5 a 12m > -ruin_threshold (worst case non brucia il conto)
    //   2. P(rovina) < 5%
    // Se nessun livello soddisfa i vincoli, prende il meno rischioso.
    let bestIdx = 0, bestScore = -1e9;
    const ruinLimit  = (params.ra_ruin_max_pct || 5)  / 100.0;
    const dd30Limit  = (params.ra_dd30_max_pct || 50) / 100.0;  // default 50% = quasi disattivato
    const ruinPctNeg = -(params.ra_ruin_pct || 60);

    let anyValid = false;
    for (let i = 0; i < results.length; i++) {
      const r    = results[i];
      const h12  = r.horizons["12m"] || r.horizons["custom"];
      if (!h12) continue;
      const p_ruin  = r.p_ruin  || 0;
      const p_dd30  = r.p_dd30  || 0;
      const p5_12m  = h12.p5_ret;

      // Tre vincoli:
      // 1. P5 a 12m non deve toccare la soglia di rovina
      // 2. P(rovina) sotto il limite configurabile
      // 3. P(DD>30%) sotto il limite configurabile (vincolo psicologico)
      const p5Valid   = p5_12m > ruinPctNeg + 5;
      const ruinValid = p_ruin < ruinLimit;
      const dd30Valid = p_dd30 < dd30Limit;

      if (p5Valid && ruinValid && dd30Valid) {
        anyValid = true;
        const score = h12.mean_ret;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
    }
    // Fallback: se nessun livello rispetta tutti i vincoli,
    // rilassa P(DD>30%) e tieni solo i vincoli di rovina
    if (!anyValid) {
      for (let i = 0; i < results.length; i++) {
        const r   = results[i];
        const h12 = r.horizons["12m"] || r.horizons["custom"];
        if (!h12) continue;
        const p5Valid   = h12.p5_ret > ruinPctNeg + 5;
        const ruinValid = (r.p_ruin || 0) < ruinLimit;
        if (p5Valid && ruinValid) {
          anyValid = true;
          if (h12.mean_ret > bestScore) { bestScore = h12.mean_ret; bestIdx = i; }
        }
      }
    }
    // Fallback finale: prende il P5 migliore
    if (!anyValid) {
      for (let i = 0; i < results.length; i++) {
        const h12 = results[i].horizons["12m"] || results[i].horizons["custom"];
        if (!h12) continue;
        const score = h12.p5_ret;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
    }

    const nActive   = daily_pnl_dollar.filter(x => x !== 0).length;
    const nCalendar = daily_pnl_dollar.length;

    self.postMessage({
      type: "result",
      data: {
        sim_type:            "real_account",
        results,
        optimal_risk_pct:    results[bestIdx]?.risk_pct ?? null,
        lot_recommendations: results[bestIdx]?.lot_recommendations ?? [],
        n_trading_days:      nActive,
        n_calendar_days:     nCalendar,
        avg_trades_freq:     Math.round(nActive / nCalendar * 1000) / 10,
        n_simulations:       params.n_simulations,
      }
    });
    return;
  }

  // ── Simulatore Challenge (codice esistente) ────────────────────────────────

  // Range di rischio
  const riskLevels = [];
  let r = params.risk_min_pct;
  while (r <= params.risk_max_pct + 1e-9) {
    riskLevels.push(Math.round(r * 10000) / 10000);
    r += params.risk_step_pct;
  }

  const results = [];
  for (let i = 0; i < riskLevels.length; i++) {
    const res = runForRiskLevel(ea_components, params, riskLevels[i]);
    if (res) results.push(res);

    // Progresso
    self.postMessage({ type: "progress", pct: Math.round((i+1)/riskLevels.length*100) });
  }

  // ── Criterio di ottimizzazione ────────────────────────────────────────────
  // Parametri economici (con default ragionevoli)
  const costChallenge   = params.cost_challenge      ?? 500;
  const profitShare     = params.profit_share        ?? 0.80;
  const taxRate         = params.tax_rate            ?? 0.25;
  const payoutWait      = params.payout_wait_factor  ?? 0.075;  // 7.5%
  const fundedRiskRatio = params.funded_risk_ratio   ?? 0.50;   // dimezza
  const criterion       = params.optimal_criterion   || "ev_day";

  // Per il criterio EV/giorno calcoliamo il payout funded per ogni livello
  // (il rischio funded = rischio challenge × funded_risk_ratio)
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const fundedRisk = r.risk_pct * fundedRiskRatio;

    // Payout lordo dalla simulazione funded
    const grossPayout = simulateFunded(ea_components, params, fundedRisk);

    // Payout netto: profit share, tasse, attesa bonifico
    const netPayout = grossPayout * profitShare * (1 - taxRate) * (1 - payoutWait);

    // Economia del ciclo completo
    const pSucc        = r.p_success > 0 ? r.p_success : 0.0001;
    const attempts     = 1 / pSucc;
    const totalCost    = costChallenge * attempts;
    const challengeDays = r.avg_days_success * attempts;
    // Giorni funded: stima dal payout (assumiamo ~252 gg/anno di vita media
    // del conto, ma usiamo una proxy: i giorni challenge come riferimento minimo)
    // Per semplicità il tempo del ciclo = challengeDays + giorni per guadagnare il payout
    // Approssimiamo i giorni funded come proporzionali al payout/rendimento giornaliero
    const fundedDays   = 126;  // ~6 mesi di vita media stimata del conto funded

    const totalDays = challengeDays + fundedDays;
    const ev        = netPayout - totalCost;
    const evPerDay  = totalDays > 0 ? ev / totalDays : -1e9;

    r.gross_payout    = Math.round(grossPayout);
    r.net_payout      = Math.round(netPayout);
    r.expected_cost   = Math.round(totalCost);
    r.ev              = Math.round(ev);
    r.ev_per_day      = Math.round(evPerDay * 100) / 100;
    r.funded_risk_pct = Math.round(fundedRisk * 1000) / 1000;
  }

  // Seleziona l'ottimale in base al criterio scelto
  let bestIdx = 0, bestScore = -1e9;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    let score;
    if (criterion === "max_prob") {
      score = r.p_success;
    } else if (criterion === "balanced") {
      score = r.avg_days_success > 0 ? r.p_success / Math.sqrt(r.avg_days_success + 1) : -1e9;
    } else {  // ev_day (default)
      score = r.ev_per_day;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  const optimalRisk = results[bestIdx]?.risk_pct ?? null;

  const nActive    = daily_pnl_dollar.filter(x => x !== 0).length;
  const nCalendar  = daily_pnl_dollar.length;

  const lotRecs = computeLotRecommendations(
    daily_pnl_dollar, ea_components, params.capital, optimalRisk,
    params.max_risk_per_trade_pct
  );

  self.postMessage({
    type: "result",
    data: {
      results,
      optimal_risk_pct:    optimalRisk,
      optimal_criterion:   criterion,
      lot_recommendations: lotRecs,
      n_trading_days:      nActive,
      n_calendar_days:     nCalendar,
      avg_trades_freq:     Math.round(nActive / nCalendar * 1000) / 10,
      n_simulations:       params.n_simulations,
    }
  });
};
`;
  const blob = new Blob([code], { type: "application/javascript" });
  const url  = URL.createObjectURL(blob);
  return new Worker(url);
}


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
  // Parametri economici per il criterio EV/giorno
  const [costChallenge,  setCostChallenge]  = useState(500);
  const [profitShare,    setProfitShare]    = useState(80);
  const [taxRate,        setTaxRate]        = useState(25);
  const [fundedRiskRatio, setFundedRiskRatio] = useState(50);
  const [optimalCriterion, setOptimalCriterion] = useState("ev_day");

  const [running,       setRunning]       = useState(false);
  const [progress,      setProgress]      = useState(0);
  const [results,       setResults]       = useState(null);
  const [simError,      setSimError]      = useState(null);
  const [compoundRes,   setCompoundRes]   = useState(null);
  const [compoundRun,   setCompoundRun]   = useState(false);
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
        ea_name:                  selId,
        initial_capital:          initial,
        base_lots:                ea.base_lots || 0.01,
        lot_sizing_type:          ea.lot_sizing_type || "fixed_lots",
        defaultprice:             ea.defaultprice || 0,
        mm_risked_money:          ea.mm_risked_money || 0,
        ref_price:                ea.ref_price || 0,
        ref_lots:                 ea.ref_lots || ea.base_lots || 0.01,
        max_single_trade_loss_pct:  ea.max_single_trade_loss_pct || 0,
        p90_single_trade_loss_pct:  ea.p90_single_trade_loss_pct || 0,
        daily_pnl_dollar:           dailyDollar,
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
        ea_name:                   eaName,
        initial_capital:           initial,
        base_lots:                 ea.base_lots || 0.01,
        lot_sizing_type:           ea.lot_sizing_type || "fixed_lots",
        defaultprice:              ea.defaultprice || 0,
        mm_risked_money:           ea.mm_risked_money || 0,
        ref_price:                 ea.ref_price || 0,
        ref_lots:                  ea.ref_lots || ea.base_lots || 0.01,
        max_single_trade_loss_pct:  ea.max_single_trade_loss_pct || 0,
        p90_single_trade_loss_pct:  ea.p90_single_trade_loss_pct || 0,
        daily_pnl_dollar:           dailyDollar,
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

  function runCompoundSim() {
    const built = buildDailyPnlDollar();
    if (!built || !results?.optimal_risk_pct) return;
    if (workerRef.current) workerRef.current.terminate();
    setCompoundRun(true); setCompoundRes(null);
    const worker = createMonteCarloWorker();
    workerRef.current = worker;
    worker.onmessage = e => {
      if (e.data.type === "result") {
        setCompoundRes(e.data.data);
        setCompoundRun(false);
        worker.terminate(); workerRef.current = null;
      }
    };
    worker.onerror = err => {
      setCompoundRun(false); worker.terminate(); workerRef.current = null;
    };
    worker.postMessage({
      daily_pnl_dollar: built.dailyDollar,
      ea_components:    built.components,
      params: {
        sim_type:          "compound",
        compound_risk_pct: results.optimal_risk_pct,
        ra_capital:        capital,
        ra_ruin_pct:       ruinPct,
        ra_block_size:     blockSize,
        ra_custom_days:    showCustom ? customDays : 0,
        n_simulations:     nSim,
        max_risk_per_trade_pct: maxRiskPerTrade,
      }
    });
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

    const worker = createMonteCarloWorker();
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
        cost_challenge:       costChallenge,
        profit_share:         profitShare / 100,
        tax_rate:             taxRate / 100,
        funded_risk_ratio:    fundedRiskRatio / 100,
        payout_wait_factor:   0.075,
        optimal_criterion:    optimalCriterion,
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
                      {(btData.portfolio_collections[selColl] || []).map((p, i) => (
                        <option key={i} value={i}>
                          #{i+1} {p.name.replace("Portfolio ", "P")} — Score {fmt(p.composite_score, 3)} · Recency {fmt(p.portfolio_recency, 2)}x · DOS {fmt(p.avg_dos, 3)}
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

              {/* Criterio di ottimizzazione */}
              <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem",
                            borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                              color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  CRITERIO OTTIMO
                </div>
                <select value={optimalCriterion} onChange={e => setOptimalCriterion(e.target.value)}
                  style={{ width: "100%", padding: "0.35rem 0.5rem", fontSize: 12, marginBottom: "0.5rem",
                           background: "var(--bg-elevated)", border: "1px solid var(--border)",
                           borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}>
                  <option value="ev_day">Valore atteso / giorno (economico)</option>
                  <option value="max_prob">Massima probabilità di successo</option>
                  <option value="balanced">Bilanciato P/√giorni</option>
                </select>

                {optimalCriterion === "ev_day" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {[
                      { label: "Costo challenge ($)", val: costChallenge,   set: setCostChallenge },
                      { label: "Profit share (%)",    val: profitShare,     set: setProfitShare },
                      { label: "Tasse (%)",           val: taxRate,         set: setTaxRate },
                      { label: "Riduz. rischio funded (%)", val: fundedRiskRatio, set: setFundedRiskRatio },
                    ].map(({ label, val, set }) => (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between",
                                                alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
                        <input type="number" value={val} onChange={e => set(parseFloat(e.target.value))}
                          style={{ width: 80, padding: "0.2rem 0.4rem", fontSize: 12, textAlign: "right",
                                   background: "var(--bg-elevated)", border: "1px solid var(--border)",
                                   borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
                          {["RISCHIO%", "P(SUCC)", "P(DAILY)", "GG MEDI",
                            "PAYOUT NET", "EV/GG", "MAX DD%", ""].map(h => (
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
                                {r.avg_days_success > 0 ? r.avg_days_success : "—"}
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)", color: "var(--text-secondary)" }}>
                                {r.net_payout != null ? `$${r.net_payout.toLocaleString()}` : "—"}
                              </td>
                              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right",
                                           fontFamily: "var(--font-data)", fontWeight: 600,
                                           color: r.ev_per_day > 0 ? "var(--accent)" : "var(--danger)" }}>
                                {r.ev_per_day != null ? `$${r.ev_per_day.toFixed(0)}` : "—"}
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
                          {["EA", "PARAMETRO", "VALORE", "RISCHIO/TRADE", "LOSS MEDIA/GG", "LOSS MAX/GG"].map(h => (
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
                                         fontFamily: "var(--font-data)",
                                         color: rec.trade_capped ? "var(--warning)" : "var(--text-secondary)" }}>
                              {rec.effective_single_trade_risk_dollar != null ? (
                                <span
                                  title={rec.worst_case_single_trade_dollar
                                    ? "Rischio SL teorico. Worst case storico (con slippage): -$" + rec.worst_case_single_trade_dollar.toFixed(0)
                                    : "Rischio teorico per trade (90° percentile perdite)"}
                                  style={{ cursor: "help", borderBottom: "1px dashed currentColor" }}>
                                  -${rec.effective_single_trade_risk_dollar.toFixed(0)}
                                </span>
                              ) : "—"}
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
                      Il cap rischio/trade viene applicato per-EA: solo gli EA che lo richiedono
                      vengono ridotti, gli altri mantengono i lotti pieni. ⚠ = EA cappato.
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

// ══════════════════════════════════════════════════════════════════════════════
//  SIMULATORE CONTO REALE
// ══════════════════════════════════════════════════════════════════════════════
function RealAccountSimulator() {
  const [btData,   setBtData]   = useState(null);
  const [loading,  setLoading]  = useState(true);

  const [selType,  setSelType]  = useState("ea");
  const [selId,    setSelId]    = useState("");
  const [selColl,  setSelColl]  = useState("");

  // Parametri simulazione
  const [capital,   setCapital]   = useState(10000);
  const [riskMin,   setRiskMin]   = useState(0.5);
  const [riskMax,   setRiskMax]   = useState(3.0);
  const [riskStep,  setRiskStep]  = useState(0.25);
  const [nSim,      setNSim]      = useState(3000);
  const [ruinPct,      setRuinPct]      = useState(60);
  const [maxRiskPerTrade, setMaxRiskPerTrade] = useState(2.0);
  const [pRuinMax,     setPRuinMax]     = useState(5);   // % max P(rovina) per ottimale
  const [pDD30Max,     setPDD30Max]     = useState(30);  // % max P(DD>30%) per ottimale
  const [blockSize,    setBlockSize]    = useState(1);   // giorni per block bootstrap (1=classico)
  const [customDays, setCustomDays] = useState(180);
  const [showCustom, setShowCustom] = useState(false);

  const [running,       setRunning]       = useState(false);
  const [progress,      setProgress]      = useState(0);
  const [results,       setResults]       = useState(null);
  const [simError,      setSimError]      = useState(null);
  const [compoundRes,   setCompoundRes]   = useState(null);
  const [compoundRun,   setCompoundRun]   = useState(false);
  const workerRef = useRef(null);

  useEffect(() => {
    api.getBacktestData()
      .then(d => setBtData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function buildDailyPnlDollar() {
    const eaPool = btData?.ea_pool || {};
    if (selType === "ea") {
      const ea = eaPool[selId];
      if (!ea?.daily_pnl_pct) return null;
      const initial = ea.initial_capital || 100000;
      const dailyDollar = ea.daily_pnl_pct.map(p => p / 100.0 * initial);
      return {
        dailyDollar,
        components: [{
          ea_name: selId, initial_capital: initial,
          base_lots: ea.base_lots || 0.01, lot_sizing_type: ea.lot_sizing_type || "fixed_lots",
          defaultprice: ea.defaultprice || 0, mm_risked_money: ea.mm_risked_money || 0,
          ref_price: ea.ref_price || 0, ref_lots: ea.ref_lots || ea.base_lots || 0.01,
          max_single_trade_loss_pct: ea.max_single_trade_loss_pct || 0,
          p90_single_trade_loss_pct: ea.p90_single_trade_loss_pct || 0,
          daily_pnl_dollar: dailyDollar,
        }]
      };
    }
    const collection = btData?.portfolio_collections?.[selColl] || [];
    const portfolio  = collection[parseInt(selId)];
    if (!portfolio) return null;
    const eaPool2    = btData?.ea_pool || {};
    const components = [];
    const allSeries  = [];
    for (const eaName of portfolio.ea_list) {
      const ea = eaPool2[eaName];
      if (!ea?.daily_pnl_pct) continue;
      const initial     = ea.initial_capital || 100000;
      const dailyDollar = ea.daily_pnl_pct.map(p => p / 100.0 * initial);
      components.push({
        ea_name: eaName, initial_capital: initial,
        base_lots: ea.base_lots || 0.01, lot_sizing_type: ea.lot_sizing_type || "fixed_lots",
        defaultprice: ea.defaultprice || 0, mm_risked_money: ea.mm_risked_money || 0,
        ref_price: ea.ref_price || 0, ref_lots: ea.ref_lots || ea.base_lots || 0.01,
        max_single_trade_loss_pct: ea.max_single_trade_loss_pct || 0,
        p90_single_trade_loss_pct: ea.p90_single_trade_loss_pct || 0,
        daily_pnl_dollar: dailyDollar,
      });
      allSeries.push(dailyDollar);
    }
    if (!allSeries.length) return null;
    const minLen   = Math.min(...allSeries.map(s => s.length));
    const combined = new Array(minLen).fill(0);
    for (const s of allSeries) for (let i=0;i<minLen;i++) combined[i]+=s[s.length-minLen+i];
    for (const c of components) c.daily_pnl_dollar = c.daily_pnl_dollar.slice(-minLen);
    return { dailyDollar: combined, components };
  }

  function runCompoundSim() {
    const built = buildDailyPnlDollar();
    if (!built || !results?.optimal_risk_pct) return;
    if (workerRef.current) workerRef.current.terminate();
    setCompoundRun(true); setCompoundRes(null);
    const worker = createMonteCarloWorker();
    workerRef.current = worker;
    worker.onmessage = e => {
      if (e.data.type === "result") {
        setCompoundRes(e.data.data);
        setCompoundRun(false);
        worker.terminate(); workerRef.current = null;
      }
    };
    worker.onerror = err => {
      setCompoundRun(false); worker.terminate(); workerRef.current = null;
    };
    worker.postMessage({
      daily_pnl_dollar: built.dailyDollar,
      ea_components:    built.components,
      params: {
        sim_type:          "compound",
        compound_risk_pct: results.optimal_risk_pct,
        ra_capital:        capital,
        ra_ruin_pct:       ruinPct,
        ra_block_size:     blockSize,
        ra_custom_days:    showCustom ? customDays : 0,
        n_simulations:     nSim,
        max_risk_per_trade_pct: maxRiskPerTrade,
      }
    });
  }

  function runSimulation() {
    const built = buildDailyPnlDollar();
    if (!built) { setSimError("Dati non disponibili. Rigenera il JSON."); return; }
    if (workerRef.current) workerRef.current.terminate();
    setRunning(true); setProgress(0); setSimError(null); setResults(null); setCompoundRes(null);
    const worker = createMonteCarloWorker();
    workerRef.current = worker;
    worker.onmessage = e => {
      if (e.data.type === "progress") setProgress(e.data.pct);
      else if (e.data.type === "result") {
        setResults(e.data.data); setRunning(false); setProgress(100);
        worker.terminate(); workerRef.current = null;
      }
    };
    worker.onerror = err => {
      setSimError(err.message || "Errore Worker");
      setRunning(false); worker.terminate(); workerRef.current = null;
    };
    worker.postMessage({
      daily_pnl_dollar: built.dailyDollar,
      ea_components:    built.components,
      params: {
        sim_type:       "real_account",
        ra_capital:     capital,
        ra_ruin_pct:       ruinPct,
        ra_ruin_max_pct:   pRuinMax,
        ra_dd30_max_pct:   pDD30Max,
        ra_block_size:     blockSize,
        ra_custom_days:    showCustom ? customDays : 0,
        risk_min_pct:   riskMin,
        risk_max_pct:   riskMax,
        risk_step_pct:  riskStep,
        n_simulations:  nSim,
        max_risk_per_trade_pct: maxRiskPerTrade,
      }
    });
  }

  const eaNames   = Object.keys(btData?.ea_pool || {});
  const collNames = Object.keys(btData?.portfolio_collections || {});
  const optimal   = results?.optimal_risk_pct;

  // Orizzonti da mostrare
  const horizonKeys = ["3m", "6m", "12m", ...(showCustom ? ["custom"] : [])];
  const horizonLabel = { "3m": "3 mesi", "6m": "6 mesi", "12m": "12 mesi", "custom": customDays + "gg" };

  return (
    <div>
      {loading && <Spinner />}
      {!loading && !btData?.ea_pool && (
        <div style={{ padding: "2rem", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
                      textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          Nessun dato backtest. Esegui <code>analyzer.py</code> prima.
        </div>
      )}
      {!loading && btData?.ea_pool && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1.5rem" }}>

          {/* ── Input ─────────────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

            {/* Selezione */}
            <Card>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                            color: "var(--text-muted)", marginBottom: "0.75rem" }}>STRATEGIA</div>
              <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem" }}>
                {["ea", "portfolio"].map(t => (
                  <button key={t} onClick={() => { setSelType(t); setSelId(""); }}
                    style={{ flex: 1, padding: "0.3rem", fontSize: 12, borderRadius: "var(--radius-sm)",
                             border: `1px solid ${selType===t?"var(--accent)":"var(--border)"}`,
                             background: selType===t?"var(--accent-dim)":"var(--bg-elevated)",
                             color: selType===t?"var(--accent)":"var(--text-secondary)", cursor: "pointer" }}>
                    {t === "ea" ? "Singolo EA" : "Portafoglio"}
                  </button>
                ))}
              </div>
              {selType === "ea" ? (
                <select value={selId} onChange={e => setSelId(e.target.value)}
                  style={{ width: "100%", padding: "0.4rem", fontSize: 13, background: "var(--bg-elevated)",
                           border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}>
                  <option value="">— seleziona EA —</option>
                  {eaNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <select value={selColl} onChange={e => { setSelColl(e.target.value); setSelId(""); }}
                    style={{ width: "100%", padding: "0.4rem", fontSize: 13, background: "var(--bg-elevated)",
                             border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}>
                    <option value="">— collezione —</option>
                    {collNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  {selColl && (
                    <select value={selId} onChange={e => setSelId(e.target.value)}
                      style={{ width: "100%", padding: "0.4rem", fontSize: 12, background: "var(--bg-elevated)",
                               border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)" }}>
                      <option value="">— portafoglio —</option>
                      {(btData.portfolio_collections[selColl]||[]).map((p,i) => (
                        <option key={i} value={i}>
                          #{i+1} {p.name.replace("Portfolio ","P")} · Rec {fmt(p.portfolio_recency,2)}x · DOS {fmt(p.avg_dos,3)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </Card>

            {/* Parametri conto */}
            <Card>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em",
                            color: "var(--text-muted)", marginBottom: "0.75rem" }}>PARAMETRI CONTO</div>
              {[
                { label: "Capitale ($)",           val: capital,         set: setCapital },
                { label: "Max rischio/trade (%)",  val: maxRiskPerTrade, set: setMaxRiskPerTrade },
                { label: "Soglia rovina (%)",      val: ruinPct,         set: setRuinPct },
              ].map(({label,val,set}) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between",
                                          alignItems:"center", marginBottom:"0.5rem" }}>
                  <span style={{ fontSize:12, color:"var(--text-muted)" }}>{label}</span>
                  <input type="number" value={val} onChange={e=>set(parseFloat(e.target.value))}
                    style={{ width:90, padding:"0.2rem 0.4rem", fontSize:12, textAlign:"right",
                             background:"var(--bg-elevated)", border:"1px solid var(--border)",
                             borderRadius:"var(--radius-sm)", color:"var(--text-primary)" }}/>
                </div>
              ))}

            </Card>

            {/* Orizzonti e rischio */}
            <Card>
              <div style={{ fontSize:11, fontWeight:600, letterSpacing:"0.07em",
                            color:"var(--text-muted)", marginBottom:"0.75rem" }}>ORIZZONTI E RISCHIO</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.5rem" }}>
                <span style={{ fontSize:12, color:"var(--text-muted)" }}>Periodo custom</span>
                <input type="checkbox" checked={showCustom} onChange={e=>setShowCustom(e.target.checked)}/>
              </div>
              {showCustom && (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.5rem" }}>
                  <span style={{ fontSize:12, color:"var(--text-muted)" }}>Giorni (30-1095)</span>
                  <input type="number" value={customDays} min={30} max={1095}
                    onChange={e=>setCustomDays(parseInt(e.target.value))}
                    style={{ width:90, padding:"0.2rem 0.4rem", fontSize:12, textAlign:"right",
                             background:"var(--bg-elevated)", border:"1px solid var(--border)",
                             borderRadius:"var(--radius-sm)", color:"var(--text-primary)" }}/>
                </div>
              )}
              {[
                { label: "Rischio min (%)",   val: riskMin,   set: setRiskMin },
                { label: "Rischio max (%)",   val: riskMax,   set: setRiskMax },
                { label: "Step (%)",          val: riskStep,  set: setRiskStep },
                { label: "Simulazioni",       val: nSim,      set: setNSim },
              ].map(({label,val,set}) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between",
                                          alignItems:"center", marginBottom:"0.5rem" }}>
                  <span style={{ fontSize:12, color:"var(--text-muted)" }}>{label}</span>
                  <input type="number" value={val} onChange={e=>set(parseFloat(e.target.value))}
                    style={{ width:90, padding:"0.2rem 0.4rem", fontSize:12, textAlign:"right",
                             background:"var(--bg-elevated)", border:"1px solid var(--border)",
                             borderRadius:"var(--radius-sm)", color:"var(--text-primary)" }}/>
                </div>
              ))}
              {/* Parametri ottimizzazione */}
              <div style={{ borderTop:"1px solid var(--border)", paddingTop:"0.75rem",
                            marginTop:"0.25rem" }}>
                <div style={{ fontSize:11, fontWeight:600, letterSpacing:"0.07em",
                              color:"var(--text-muted)", marginBottom:"0.5rem" }}>OTTIMIZZAZIONE</div>
                {[
                  { label: "P(rovina) max (%)",
                    hint:  "ottimale = max rendimento con P(rovina) sotto questa soglia",
                    val: pRuinMax, set: setPRuinMax },
                  { label: "P(DD>30%) max (%)",
                    hint:  "ottimale esclude livelli dove il drawdown >30% è troppo probabile. Abbassa a 15-20% per conti che non vuoi vedere in forte perdita",
                    val: pDD30Max, set: setPDD30Max },
                  { label: "Block bootstrap (giorni)",
                    hint:  "1=indipendente, 10-20=preserva correlazione temporale (più realistico)",
                    val: blockSize, set: setBlockSize },
                ].map(({label,hint,val,set}) => (
                  <div key={label} style={{ display:"flex", justifyContent:"space-between",
                                            alignItems:"center", marginBottom:"0.5rem" }}>
                    <span style={{ fontSize:12, color:"var(--text-muted)", cursor:"help" }}
                          title={hint}>{label} ⓘ</span>
                    <input type="number" value={val} onChange={e=>set(parseFloat(e.target.value))}
                      style={{ width:80, padding:"0.2rem 0.4rem", fontSize:12, textAlign:"right",
                               background:"var(--bg-elevated)", border:"1px solid var(--border)",
                               borderRadius:"var(--radius-sm)", color:"var(--text-primary)" }}/>
                  </div>
                ))}
              </div>

              <button onClick={runSimulation} disabled={running||!selId}
                style={{ width:"100%", marginTop:"0.75rem", padding:"0.6rem", fontSize:13, fontWeight:600,
                         background: running||!selId?"var(--bg-elevated)":"var(--accent-dim)",
                         border:`1px solid ${running||!selId?"var(--border)":"var(--accent)"}`,
                         color: running||!selId?"var(--text-muted)":"var(--accent)",
                         borderRadius:"var(--radius-md)", cursor:running||!selId?"default":"pointer",
                         display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                {running
                  ? <><div style={{ width:14,height:14,border:"2px solid var(--border)",borderTop:"2px solid var(--accent)",
                                    borderRadius:"50%",animation:"spin 0.8s linear infinite" }}/>
                      Simulazione… {progress}%</>
                  : <><Play size={14}/> Avvia simulazione (locale)</>}
              </button>
              {running && (
                <div style={{ marginTop:"0.4rem",height:4,background:"var(--bg-elevated)",borderRadius:2,overflow:"hidden" }}>
                  <div style={{ height:"100%",width:`${progress}%`,background:"var(--accent)",transition:"width 0.3s",borderRadius:2 }}/>
                </div>
              )}
              {simError && (
                <div style={{ marginTop:"0.5rem",padding:"0.5rem",fontSize:12,
                              color:"var(--danger)",background:"var(--danger-dim)",borderRadius:"var(--radius-sm)" }}>
                  {simError}
                </div>
              )}
            </Card>
          </div>

          {/* ── Output ────────────────────────────────────────────── */}
          <div>
            {!results && !running && (
              <div style={{ height:"100%",minHeight:300,display:"flex",alignItems:"center",justifyContent:"center",
                            border:"1px dashed var(--border)",borderRadius:"var(--radius-lg)",
                            color:"var(--text-muted)",fontSize:13 }}>
                Configura i parametri e avvia la simulazione
              </div>
            )}

            {results && (
              <div style={{ display:"flex",flexDirection:"column",gap:"1rem" }}>

                {/* KPI ottimale */}
                {optimal && (() => {
                  const opt = results.results.find(r => r.risk_pct === optimal) || {};
                  const h6  = opt.horizons?.["6m"] || opt.horizons?.["custom"] || {};
                  return (
                    <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.75rem" }}>
                      {[
                        { label:"Rischio Ottimale", value:`${optimal}%`,             type:"positive" },
                        { label:`Rendimento 6m medio`, value:`${h6.mean_ret ?? "—"}%`, type: h6.mean_ret>0?"positive":"negative" },
                        { label:`Rendimento 6m P95`,  value:`${h6.p95_ret ?? "—"}%`,  type:"positive" },
                        { label:"P(Rovina)",           value:`${((opt.p_ruin||0)*100).toFixed(1)}%`,
                          type: opt.p_ruin < 0.05?"positive":opt.p_ruin<0.15?"warning":"negative" },
                      ].map(({label,value,type}) => (
                        <Card key={label}>
                          <div style={{ fontSize:11,color:"var(--text-muted)",marginBottom:4 }}>{label}</div>
                          <Badge value={value} type={type}/>
                        </Card>
                      ))}
                    </div>
                  );
                })()}

                {/* Tabella unica compatta */}
                <Card>
                  <div style={{ fontSize:11,fontWeight:600,letterSpacing:"0.07em",
                                color:"var(--text-muted)",marginBottom:"0.75rem" }}>
                    PROIEZIONE RENDIMENTO — LOTTI FISSI
                    <span style={{ fontWeight:400, marginLeft:8 }}>
                      (rischio = % del capitale per singola operazione)
                    </span>
                  </div>
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                      <thead>
                        <tr style={{ borderBottom:"2px solid var(--border)" }}>
                          <th rowSpan={2} style={{ padding:"0.4rem 0.5rem",textAlign:"right",fontSize:10,
                                                   fontWeight:600,color:"var(--text-muted)",verticalAlign:"bottom" }}>RISCHIO%</th>
                          {horizonKeys.map(hk => (
                            <th key={hk} colSpan={3} style={{ padding:"0.3rem 0.5rem",textAlign:"center",fontSize:10,
                                                              fontWeight:700,color:"var(--text-secondary)",
                                                              borderLeft:"1px solid var(--border)" }}>
                              {horizonLabel[hk]}
                            </th>
                          ))}
                          <th rowSpan={2} style={{ padding:"0.4rem 0.5rem",textAlign:"right",fontSize:10,
                                                   fontWeight:600,color:"var(--text-muted)",verticalAlign:"bottom",
                                                   borderLeft:"1px solid var(--border)" }}>P(ROVINA)</th>
                          <th rowSpan={2} style={{ padding:"0.4rem 0.5rem",textAlign:"right",fontSize:10,
                                                   fontWeight:600,color:"var(--text-muted)",verticalAlign:"bottom" }}>P(DD&gt;30%)</th>
                          <th rowSpan={2} style={{ padding:"0.4rem 0.3rem",textAlign:"center",fontSize:10,
                                                   fontWeight:600,color:"var(--text-muted)",verticalAlign:"bottom" }}>★</th>
                        </tr>
                        <tr style={{ borderBottom:"1px solid var(--border)" }}>
                          {horizonKeys.map(hk => (
                            ["P5","MEDIO","P95"].map((sub,si) => (
                              <th key={hk+sub} style={{ padding:"0.3rem 0.4rem",textAlign:"right",fontSize:9,
                                                        fontWeight:500,color:"var(--text-muted)",
                                                        borderLeft: si===0?"1px solid var(--border)":"none" }}>
                                {sub}
                              </th>
                            ))
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.results.map(r => {
                          const isOpt  = r.risk_pct === optimal;
                          const p_ruin = r.p_ruin || 0;
                          return (
                            <tr key={r.risk_pct}
                              style={{ background:isOpt?"var(--accent-dim)":"transparent",
                                       borderLeft:isOpt?"2px solid var(--accent)":"2px solid transparent",
                                       borderBottom:"1px solid var(--border)" }}>
                              <td style={{ padding:"0.35rem 0.5rem",textAlign:"right",fontFamily:"var(--font-data)",
                                           fontWeight:isOpt?700:400,color:isOpt?"var(--accent)":"var(--text-primary)" }}>
                                {r.risk_pct}%
                              </td>
                              {horizonKeys.map(hk => {
                                const h = r.horizons?.[hk] || {};
                                return [
                                  <td key={hk+"p5"} style={{ padding:"0.35rem 0.4rem",textAlign:"right",
                                       fontFamily:"var(--font-data)",fontSize:11,
                                       color:(h.p5_ret>0)?"var(--text-muted)":"var(--danger)",
                                       borderLeft:"1px solid var(--border)" }}>
                                    {h.p5_ret ?? "—"}%
                                  </td>,
                                  <td key={hk+"mean"} style={{ padding:"0.35rem 0.4rem",textAlign:"right",
                                       fontFamily:"var(--font-data)",fontWeight:600,
                                       color:(h.mean_ret>0)?"var(--accent)":"var(--danger)" }}>
                                    {h.mean_ret ?? "—"}%
                                  </td>,
                                  <td key={hk+"p95"} style={{ padding:"0.35rem 0.4rem",textAlign:"right",
                                       fontFamily:"var(--font-data)",fontSize:11,color:"var(--text-muted)" }}>
                                    {h.p95_ret ?? "—"}%
                                  </td>
                                ];
                              })}
                              <td style={{ padding:"0.35rem 0.5rem",textAlign:"right",fontFamily:"var(--font-data)",
                                           color:p_ruin<0.05?"var(--accent)":p_ruin<0.15?"var(--warning)":"var(--danger)",
                                           borderLeft:"1px solid var(--border)" }}>
                                {(p_ruin*100).toFixed(1)}%
                              </td>
                              <td style={{ padding:"0.35rem 0.5rem",textAlign:"right",fontFamily:"var(--font-data)",
                                           color:(r.p_dd30||0)<0.2?"var(--text-secondary)":"var(--warning)" }}>
                                {((r.p_dd30||0)*100).toFixed(1)}%
                              </td>
                              <td style={{ padding:"0.35rem 0.3rem",textAlign:"center",fontSize:11,color:"var(--accent)" }}>
                                {isOpt?"★":""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize:10,color:"var(--text-muted)",marginTop:"0.5rem" }}>
                    P5 = worst case (95% dei casi fa meglio) · MEDIO = atteso · P95 = best case (solo 5% fa meglio)
                  </div>
                </Card>

                {/* Lotti consigliati al rischio ottimale */}
                {results.lot_recommendations && results.lot_recommendations.length > 0 && (
                  <Card>
                    <div style={{ fontSize:11,fontWeight:600,letterSpacing:"0.07em",
                                  color:"var(--text-muted)",marginBottom:"0.75rem" }}>
                      PARAMETRI DA IMPOSTARE @ RISCHIO OTTIMALE ({optimal}% per trade)
                    </div>
                    <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                      <thead>
                        <tr style={{ borderBottom:"1px solid var(--border)" }}>
                          {["EA","PARAMETRO","VALORE",""].map(h=>(
                            <th key={h} style={{ padding:"0.35rem 0.5rem",textAlign:h==="EA"?"left":"right",
                                                 fontSize:10,fontWeight:600,color:"var(--text-muted)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.lot_recommendations.map(rec => (
                          <tr key={rec.ea_name} style={{ borderBottom:"1px solid var(--border)" }}>
                            <td style={{ padding:"0.35rem 0.5rem",color:"var(--text-primary)",fontWeight:500 }}>{rec.ea_name}</td>
                            <td style={{ padding:"0.35rem 0.5rem",textAlign:"right",color:"var(--text-muted)",fontSize:11 }}>{rec.param_name}</td>
                            <td style={{ padding:"0.35rem 0.5rem",textAlign:"right",fontFamily:"var(--font-data)",
                                         fontWeight:700,color:"var(--accent)" }}>
                              {rec.sizing_type==="sqx_fixed_money" ? `$${Number(rec.param_value).toFixed(0)}` : Number(rec.param_value).toFixed(4)}
                            </td>
                            <td style={{ padding:"0.35rem 0.5rem",textAlign:"right" }}>
                              {rec.note && <span title={rec.note} style={{ fontSize:10,color:"var(--text-muted)",cursor:"help" }}>ⓘ</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize:10,color:"var(--text-muted)",marginTop:"0.5rem" }}>
                      Lotti calcolati sul capitale iniziale di ${capital.toLocaleString()}.
  
                    </div>
                  </Card>
                )}

                {/* ── Sezione Compound ─────────────────────────────────── */}
                {optimal && (
                  <Card>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                                  marginBottom: compoundRes ? "0.75rem" : 0 }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:600, color:"var(--text-primary)" }}>
                          Proiezione con Compound @ {optimal}%
                        </div>
                        <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:2 }}>
                          Lotti ribilanciati ogni giorno in proporzione al balance — orizzonti fino a 3 anni
                        </div>
                      </div>
                      <button onClick={runCompoundSim} disabled={compoundRun}
                        style={{ padding:"0.4rem 0.9rem", fontSize:12, fontWeight:600,
                                 background: compoundRun?"var(--bg-elevated)":"var(--accent-dim)",
                                 border:"1px solid var(--accent)", color:"var(--accent)",
                                 borderRadius:"var(--radius-md)", cursor:compoundRun?"default":"pointer",
                                 whiteSpace:"nowrap", marginLeft:"1rem" }}>
                        {compoundRun ? "Calcolo…" : "▶ Simula compound"}
                      </button>
                    </div>

                    {compoundRes && (() => {
                      const hks    = ["3m","6m","12m","24m","36m",...(showCustom?["custom"]:[])];
                      const labels = { "3m":"3 mesi","6m":"6 mesi","12m":"12 mesi","24m":"24 mesi","36m":"3 anni","custom":customDays+"gg" };
                      return (
                        <div style={{ overflowX:"auto" }}>
                          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                            <thead>
                              <tr style={{ borderBottom:"1px solid var(--border)" }}>
                                <th style={{ padding:"0.35rem 0.5rem", textAlign:"left", fontSize:10,
                                             fontWeight:600, color:"var(--text-muted)" }}>ORIZZONTE</th>
                                <th style={{ padding:"0.35rem 0.5rem", textAlign:"right", fontSize:10,
                                             fontWeight:600, color:"var(--danger)" }}>WORST (P5)</th>
                                <th style={{ padding:"0.35rem 0.5rem", textAlign:"right", fontSize:10,
                                             fontWeight:600, color:"var(--text-secondary)" }}>MEDIANO</th>
                                <th style={{ padding:"0.35rem 0.5rem", textAlign:"right", fontSize:10,
                                             fontWeight:600, color:"var(--accent)" }}>MEDIO</th>
                                <th style={{ padding:"0.35rem 0.5rem", textAlign:"right", fontSize:10,
                                             fontWeight:600, color:"var(--accent)" }}>BEST (P95)</th>
                                <th style={{ padding:"0.35rem 0.5rem", textAlign:"right", fontSize:10,
                                             fontWeight:600, color:"var(--text-muted)" }}>BAL. MEDIO</th>
                              </tr>
                            </thead>
                            <tbody>
                              {hks.map(hk => {
                                const h = compoundRes.horizons?.[hk];
                                if (!h) return null;
                                return (
                                  <tr key={hk} style={{ borderBottom:"1px solid var(--border)" }}>
                                    <td style={{ padding:"0.35rem 0.5rem", fontWeight:600,
                                                 color:"var(--text-primary)" }}>{labels[hk]}</td>
                                    <td style={{ padding:"0.35rem 0.5rem", textAlign:"right",
                                                 fontFamily:"var(--font-data)",
                                                 color:h.p5_ret>=0?"var(--text-secondary)":"var(--danger)" }}>
                                      {h.p5_ret}%
                                    </td>
                                    <td style={{ padding:"0.35rem 0.5rem", textAlign:"right",
                                                 fontFamily:"var(--font-data)", color:"var(--text-secondary)" }}>
                                      {h.p50_ret}%
                                    </td>
                                    <td style={{ padding:"0.35rem 0.5rem", textAlign:"right",
                                                 fontFamily:"var(--font-data)", fontWeight:600,
                                                 color:h.mean_ret>=0?"var(--accent)":"var(--danger)" }}>
                                      {h.mean_ret}%
                                    </td>
                                    <td style={{ padding:"0.35rem 0.5rem", textAlign:"right",
                                                 fontFamily:"var(--font-data)", color:"var(--accent)" }}>
                                      {h.p95_ret}%
                                    </td>
                                    <td style={{ padding:"0.35rem 0.5rem", textAlign:"right",
                                                 fontFamily:"var(--font-data)", color:"var(--text-muted)" }}>
                                      ${h.mean_bal.toLocaleString()}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <div style={{ fontSize:10, color:"var(--text-muted)", marginTop:"0.5rem",
                                        display:"flex", gap:"1.5rem" }}>
                            <span>P(rovina): {(compoundRes.p_ruin*100).toFixed(1)}%</span>
                            <span>P(DD&gt;30%): {(compoundRes.p_dd30*100).toFixed(1)}%</span>
                            <span>{compoundRes.n_simulations.toLocaleString()} simulazioni</span>
                          </div>
                        </div>
                      );
                    })()}
                  </Card>
                )}

                <div style={{ fontSize:11,color:"var(--text-muted)" }}>
                  {results.n_simulations.toLocaleString()} simulazioni ·
                  {results.n_trading_days} giorni con trade su {results.n_calendar_days} totali
                  ({results.avg_trades_freq}% frequenza) · Lotti fissi · ottimale = max rendimento medio con P5&gt;-{ruinPct-5}% e P(rovina)&lt;5%
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


const TABS = [
  { id: "regole",    label: "Regole Prop Firm" },
  { id: "simulator", label: "Challenge Simulator" },
  { id: "real",      label: "Simulatore Conto Reale" },
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

      {/* ── Tab Simulatore Conto Reale ───────────────────────── */}
      {activeTab === "real" && (
        <RealAccountSimulator />
      )}
    </div>
  );
}
