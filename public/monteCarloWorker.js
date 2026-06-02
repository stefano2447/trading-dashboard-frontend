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

// ─── Monte Carlo per un livello di rischio ────────────────────────────────────
function runForRiskLevel(dailyPnlDollar, params, riskPct, rand) {
  // Calcola avg daily loss in $
  const losses = dailyPnlDollar.filter(x => x < 0);
  if (losses.length === 0) return null;

  const avgDailyLoss    = Math.abs(losses.reduce((a,b) => a+b, 0) / losses.length);
  const riskTargetDollar = params.capital * riskPct / 100.0;
  const scaleFactor      = avgDailyLoss > 0 ? riskTargetDollar / avgDailyLoss : 1.0;

  const scaledArr = dailyPnlDollar.map(x => x * scaleFactor);

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
function computeLotRecommendations(dailyPnlDollar, eaComponents, capital, optimalRisk) {
  if (!optimalRisk || !eaComponents.length) return [];

  const losses = dailyPnlDollar.filter(x => x < 0);
  if (!losses.length) return [];

  const avgDailyLoss     = Math.abs(losses.reduce((a,b)=>a+b,0)/losses.length);
  const riskTargetDollar = capital * optimalRisk / 100.0;
  const scaleFactor      = avgDailyLoss > 0 ? riskTargetDollar / avgDailyLoss : 1.0;

  return eaComponents.map(comp => {
    const sizing = comp.lot_sizing_type || "fixed_lots";
    let paramName, paramValue, note;

    if (sizing === "price_scaling_explicit") {
      paramName  = "base_lots";
      paramValue = Math.round(comp.base_lots * scaleFactor * 10000) / 10000;
      note       = `valido @ prezzo ${comp.defaultprice}; l'EA scala automaticamente`;
    } else if (sizing === "price_scaling_implicit") {
      paramName  = "LotSize";
      paramValue = Math.round(comp.ref_lots * scaleFactor * 10000) / 10000;
      note       = `valido @ prezzo ${comp.ref_price}; l'EA scala col prezzo`;
    } else if (sizing === "sqx_fixed_money") {
      paramName  = "mmRiskedMoney";
      const mmBase = comp.mm_risked_money || comp.initial_capital * 0.01;
      paramValue = Math.round(mmBase * scaleFactor * 100) / 100;
      note       = `da ${Math.round(mmBase)}$ → ${Math.round(paramValue)}$`;
    } else {
      paramName  = "Lots";
      paramValue = Math.round(comp.base_lots * scaleFactor * 10000) / 10000;
      note       = "lotti fissi";
    }

    // Calcola loss attesa con i nuovi parametri
    const eaArr    = comp.daily_pnl_dollar || [];
    const eaLosses = eaArr.filter(x => x < 0);
    const avgEALoss = eaLosses.length
      ? Math.abs(eaLosses.reduce((a,b)=>a+b,0)/eaLosses.length) * scaleFactor
      : null;
    const maxEALoss = eaLosses.length
      ? Math.abs(Math.min(...eaLosses)) * scaleFactor
      : null;

    return {
      ea_name:      comp.ea_name,
      sizing_type:  sizing,
      param_name:   paramName,
      param_value:  paramValue,
      note,
      scale_factor: Math.round(scaleFactor * 10000) / 10000,
      expected_avg_daily_loss_dollar: avgEALoss ? Math.round(avgEALoss) : null,
      expected_max_daily_loss_dollar: maxEALoss ? Math.round(maxEALoss) : null,
    };
  });
}

// ─── Entry point del Worker ───────────────────────────────────────────────────
self.onmessage = function(e) {
  const { daily_pnl_dollar, ea_components, params } = e.data;

  // Range di rischio
  const riskLevels = [];
  let r = params.risk_min_pct;
  while (r <= params.risk_max_pct + 1e-9) {
    riskLevels.push(Math.round(r * 10000) / 10000);
    r += params.risk_step_pct;
  }

  // PRNG deterministico ma diverso per ogni run
  const rand = mulberry32(Date.now() & 0xFFFFFFFF);

  const results = [];
  for (let i = 0; i < riskLevels.length; i++) {
    const res = runForRiskLevel(daily_pnl_dollar, params, riskLevels[i], rand);
    if (res) results.push(res);

    // Progresso
    self.postMessage({ type: "progress", pct: Math.round((i+1)/riskLevels.length*100) });
  }

  // Ottimale
  let bestIdx = 0, bestScore = -1;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.p_success > 0 && r.avg_days_success > 0) {
      const score = r.p_success / Math.sqrt(r.avg_days_success + 1);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
  }

  const optimalRisk = results[bestIdx]?.risk_pct ?? null;

  const nActive    = daily_pnl_dollar.filter(x => x !== 0).length;
  const nCalendar  = daily_pnl_dollar.length;

  const lotRecs = computeLotRecommendations(
    daily_pnl_dollar, ea_components, params.capital, optimalRisk
  );

  self.postMessage({
    type: "result",
    data: {
      results,
      optimal_risk_pct:    optimalRisk,
      lot_recommendations: lotRecs,
      n_trading_days:      nActive,
      n_calendar_days:     nCalendar,
      avg_trades_freq:     Math.round(nActive / nCalendar * 1000) / 10,
      n_simulations:       params.n_simulations,
    }
  });
};
