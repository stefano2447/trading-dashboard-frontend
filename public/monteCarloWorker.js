/**
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
  // Costruisce la serie dei P&L giornalieri in % del capitale backtest
  // per ogni EA, poi li combina con cap per-EA.
  // Con compound=true, ogni giorno il P&L scala con il balance corrente.

  const minLen = Math.min(...eaComponents.map(c => c.daily_pnl_dollar.length));

  // Combina i P&L in % (non in $) per supportare il compound
  // Ogni EA contribuisce con i suoi daily_pnl_pct / initial_capital * initial_capital
  // → di fatto daily_pnl_pct è già in % del capitale backtest

  // 1. Calcola scale_factor base (come per challenge)
  const rawCombined = new Array(minLen).fill(0);
  for (const c of eaComponents) {
    const arr = c.daily_pnl_dollar;
    for (let i = 0; i < minLen; i++) rawCombined[i] += arr[arr.length - minLen + i];
  }
  const losses = rawCombined.filter(x => x < 0);
  if (!losses.length) return null;

  const avgLoss          = Math.abs(losses.reduce((a,b)=>a+b,0)/losses.length);
  const riskTargetDollar = params.ra_capital * riskPct / 100.0;
  const scaleFactorBase  = avgLoss > 0 ? riskTargetDollar / avgLoss : 1.0;

  // 2. Per ogni EA, applica cap per-EA e calcola serie in % del capitale iniziale
  // Con compound, questa % viene applicata al balance corrente ogni giorno
  const maxRiskDollar = params.ra_capital * (params.max_risk_per_trade_pct || 2.0) / 100.0;
  const eaSeries = [];  // array di serie in % (non in $)

  for (const comp of eaComponents) {
    const sizing = comp.lot_sizing_type || "fixed_lots";
    let riskPerTradeScaled;
    if (sizing === "sqx_fixed_money") {
      const mmBase = comp.mm_risked_money || comp.initial_capital * 0.01;
      riskPerTradeScaled = mmBase * scaleFactorBase;
    } else {
      const p90Pct = comp.p90_single_trade_loss_pct || comp.max_single_trade_loss_pct || 0;
      riskPerTradeScaled = (p90Pct / 100.0) * comp.initial_capital * scaleFactorBase;
    }
    let sfEA = scaleFactorBase;
    if (riskPerTradeScaled > maxRiskDollar && riskPerTradeScaled > 0) {
      sfEA = scaleFactorBase * (maxRiskDollar / riskPerTradeScaled);
    }

    // Serie in % del capitale backtest, scalata
    const arr = comp.daily_pnl_dollar;
    const pctSeries = new Array(minLen);
    for (let i = 0; i < minLen; i++) {
      pctSeries[i] = arr[arr.length - minLen + i] / comp.initial_capital * sfEA;
    }
    eaSeries.push(pctSeries);
  }

  // 3. Serie combinata in % (somma delle % di ogni EA)
  const combinedPct = new Array(minLen).fill(0);
  for (const s of eaSeries) {
    for (let i = 0; i < minLen; i++) combinedPct[i] += s[i];
  }

  // Orizzonti temporali in giorni
  const horizons = [
    { label: "1m",  days: 30 },
    { label: "3m",  days: 91 },
    { label: "6m",  days: 182 },
    { label: "12m", days: 365 },
  ];
  if (params.ra_custom_days && params.ra_custom_days > 0) {
    horizons.push({ label: "custom", days: params.ra_custom_days });
  }

  const maxHorizonDays = Math.max(...horizons.map(h => h.days));
  const ruinThreshold  = params.ra_ruin_pct / 100.0;     // es. 0.60
  const dd30Threshold  = 0.30;
  const compound       = params.ra_compound !== false;    // default true
  const nSims          = params.n_simulations;

  const rand = mulberry32(12345);

  // Risultati per orizzonte: array di balance finali
  const horizonResults = {};
  for (const h of horizons) horizonResults[h.label] = [];

  let nRuined = 0;
  let nDD30   = 0;
  const maxDDList = [];

  for (let s = 0; s < nSims; s++) {
    let balance    = params.ra_capital;
    let peakBalance = balance;
    let ruined     = false;
    let hitDD30    = false;
    const snapshots = {};  // giorno → balance

    for (let day = 1; day <= maxHorizonDays; day++) {
      if (ruined) break;

      // Campiona un giorno dalla storia
      const idx    = Math.floor(rand() * combinedPct.length);
      const pctDay = combinedPct[idx];

      if (pctDay !== 0) {
        let pnlDay;
        if (compound) {
          // Con compound: P&L scala col balance corrente
          pnlDay = pctDay * balance;
        } else {
          // Senza compound: P&L fisso in $ (scala col capitale iniziale)
          pnlDay = pctDay * params.ra_capital;
        }

        balance += pnlDay;
        if (balance < 0) balance = 0;
        if (balance > peakBalance) peakBalance = balance;

        const currentDD = (peakBalance - balance) / peakBalance;
        if (currentDD > dd30Threshold) hitDD30 = true;
        if (currentDD >= ruinThreshold) {
          ruined = true;
          balance = params.ra_capital * (1 - ruinThreshold);
        }
      }

      // Snapshot agli orizzonti
      for (const h of horizons) {
        if (day === h.days) snapshots[h.label] = balance;
      }
    }

    // Se la simulazione finisce prima dell'orizzonte (es. ruin prima di 12m)
    for (const h of horizons) {
      if (snapshots[h.label] === undefined) {
        snapshots[h.label] = balance;
      }
      horizonResults[h.label].push(snapshots[h.label]);
    }

    if (ruined) nRuined++;
    if (hitDD30) nDD30++;
    if (peakBalance > 0) {
      maxDDList.push((peakBalance - balance) / peakBalance * 100);
    }
  }

  // Calcola statistiche per ogni orizzonte
  const horizonStats = {};
  for (const h of horizons) {
    const balances = horizonResults[h.label].sort((a,b) => a-b);
    const n        = balances.length;
    const mean     = balances.reduce((a,b)=>a+b,0) / n;
    const p5       = balances[Math.floor(n * 0.05)];
    const p50      = balances[Math.floor(n * 0.50)];
    const p95      = balances[Math.floor(n * 0.95)];

    // Rendimento % rispetto al capitale iniziale
    const toReturn = b => ((b - params.ra_capital) / params.ra_capital * 100);

    horizonStats[h.label] = {
      days:       h.days,
      mean_bal:   Math.round(mean),
      p5_bal:     Math.round(p5),
      p50_bal:    Math.round(p50),
      p95_bal:    Math.round(p95),
      mean_ret:   Math.round(toReturn(mean)  * 10) / 10,
      p5_ret:     Math.round(toReturn(p5)    * 10) / 10,
      p50_ret:    Math.round(toReturn(p50)   * 10) / 10,
      p95_ret:    Math.round(toReturn(p95)   * 10) / 10,
    };
  }

  const sortedDD = maxDDList.sort((a,b)=>a-b);
  const n        = sortedDD.length;

  return {
    risk_pct:       riskPct,
    p_ruin:         Math.round(nRuined / nSims * 10000) / 10000,
    p_dd30:         Math.round(nDD30   / nSims * 10000) / 10000,
    avg_max_dd:     Math.round(sortedDD.reduce((a,b)=>a+b,0)/n * 10) / 10,
    p95_max_dd:     Math.round(sortedDD[Math.floor(n*0.95)] * 10) / 10,
    horizons:       horizonStats,
    compound:       compound,
  };
}

// ─── Entry point del Worker ───────────────────────────────────────────────────
self.onmessage = function(e) {
  const { daily_pnl_dollar, ea_components, params } = e.data;

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

    // Ottimale per conto reale: max Sharpe simulato a 6 mesi
    // = rendimento_medio / std_rendimenti tra simulazioni
    // Approssimazione: massimizza P95_ret / (-P5_ret + 1) → bilancia upside e downside
    let bestIdx = 0, bestScore = -1e9;
    const horizon6m = "6m";
    for (let i = 0; i < results.length; i++) {
      const h = results[i].horizons[horizon6m] || results[i].horizons["custom"];
      if (!h) continue;
      const p_ruin = results[i].p_ruin;
      // Score: rendimento medio pesato per bassa probabilità di rovina
      const score = h.mean_ret * (1 - p_ruin * 3);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }

    const nActive   = daily_pnl_dollar.filter(x => x !== 0).length;
    const nCalendar = daily_pnl_dollar.length;

    self.postMessage({
      type: "result",
      data: {
        sim_type:          "real_account",
        results,
        optimal_risk_pct:  results[bestIdx]?.risk_pct ?? null,
        n_trading_days:    nActive,
        n_calendar_days:   nCalendar,
        avg_trades_freq:   Math.round(nActive / nCalendar * 1000) / 10,
        n_simulations:     params.n_simulations,
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