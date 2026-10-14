//+------------------------------------------------------------------+
//| Expert Advisor: Range Breakout EA - v1.4.1                       |
//| v1.4.1: fix lotti x(prezzo/defaultprice) al riavvio dell'EA:     |
//|  g_pricemolt calcolato in OnInit e prima di ogni operazione,     |
//|  nessun ordine finche' lo scaling non e' pronto                  |
//| Derivato da v1.3 - logica di trading invariata                   |
//|                                                                  |
//| Novita' v1.4:                                                    |
//|  - Rimossi: journal CSV, protezione prop firm, filtro corpo      |
//|    candela, Spreadadjust (gestiti esternamente / non usati)      |
//|  - Input lotti + Magic Number spostati in cima                   |
//|  - Blocco da variabile globale TRADING_PAUSED (TradingGuard)     |
//|  - Prestazioni: livelli H/L calcolati in blocco e in cache,      |
//|    handle ATR/ADX persistenti, log verbosi disattivabili,        |
//|    controlli nuova barra solo al cambio minuto nel tester        |
//|  - OnTester: criteri custom selezionabili e filtri indipendenti  |
//|    dalla durata del periodo (utili per IS/OOS)                   |
//+------------------------------------------------------------------+
#property strict
#property version "1.41"

#include <Trade\Trade.mqh>
CTrade trade;

enum LotCalculationMethod
{
    FixedLot=0,       // Lotti fissi
    PercentRisk=1,    // Percentuale del balance
    FixedMoneyRisk=2, // Rischio fisso in denaro
    FixedLotsMoney=3  // Lotti fissi per X denaro
};

enum AccountValueSource
{
    UseBalance=0,     // Balance
    UseEquity=1       // Equity
};

enum OptCriterion
{
    CRIT_LEGACY=0,          // Formula originale v1.3 (EP/RF/log trade)
    CRIT_RF_ANNUAL=1,       // Recovery Factor annualizzato
    CRIT_MARTIN=2,          // Martin ratio (rend. annuo / Ulcer Index)
    CRIT_SHARPE_MONTHLY=3,  // Sharpe su rendimenti mensili (annualizzato)
    CRIT_SQN100=4,          // SQN normalizzato a 100 trade
    CRIT_PROFIT_FACTOR=5,   // Profit Factor
    CRIT_STABILITY=6        // R2 equity x RF annualizzato
};

// Liste per massimi e minimi locali
#include <Arrays/ArrayObj.mqh>
CArrayObj highLevels;
CArrayObj lowLevels;

// Classe compatibile con CArrayObj
class Level : public CObject
{
public:
    int index;
    double value;
    Level(int i, double v) : index(i), value(v) {}
};

// === Lotti e Magic Number (in cima per inserimento rapido) ===
input group "💰 Lotti e Magic Number"
input ulong MagicNumber = 123456;                         // Magic Number per identificare ordini
input LotCalculationMethod lotMethod = FixedLot;         // Metodo di calcolo dei lotti
input double fixedLotSize = 0.10;                        // Lotti fissi
input double riskPercent = 1.0;                          // Percentuale rischio balance
input double fixedRiskAmount = 100.0;                    // Rischio fisso in denaro
input double fixedlotsxmoney = 500;                      // Rischio 0.01 lotti ogni X denaro
input AccountValueSource lotSizeAccountSource = UseEquity; // Valore conto per calcolo lotti (Balance/Equity)
input bool adjustlotsizevariables = false;               // modifica lottaggio in funzione dei valori variabili

// === Entry management ===
input group "🎯 Trade entry management"
input ENUM_TIMEFRAMES userTimeframe = PERIOD_M15;         // Timeframe operativo dell'EA
input ENUM_TIMEFRAMES customTimeframe = PERIOD_M15;       // Timeframe per aggiornamento segnali
input string orderComment = "EURUSD_H1_A";               // Identificativo strategia
input int candlelookback = 100;                          // Candele massime da considerare
input int candleleftBars = 5;                            // Numero di candele inferiori a sinistra
input int candlerightBars = 5;                           // Numero di candele inferiori a destra
input double MinDistancefromact = 13.0;                  // Distanza minima in pips tra prezzo e H/L
input int MaxOpenOrders = 1;                             // Numero massimo di ordini aperti
input int MaxPendingOrders = 1;                          // Numero massimo di ordini pendenti
input double buffer_buy = 2;                             // Buffer in pips per buy
input double buffer_sell = 3;                            // Buffer in pips per sell
input double OrderExpirationHours = 2.0;                 // Scadenza ordini pendenti in ore 
input double minDistancebetword = 100;                   // distanza minima tra ordini pendenti in pips

// === Variable values setting ===
input group "Variable values setting"
input double defaultprice = 0;                           // Prezzo base per calcolare valori (usato solo se UseATRScaling = false)
input bool UseATRScaling = false;                        // Usa scaling basato su ATR invece che sul prezzo base
input double ATRDefault = 0;                             // ATR di riferimento (in pips) per lo scaling
input int ATR_ScalingPeriod = 30;                        // Periodo ATR per lo scaling
input ENUM_TIMEFRAMES ATR_ScalingTimeframe = PERIOD_D1;   // Timeframe ATR per lo scaling
input bool enablespreadfilter = false;                   // attiva filtro spread
input double MaxSpreadPoints = 10;                       // spread massimo 

// === Calcolo Stop Loss e Take Profit ===
input group "🎯 SL/TP Settings"
input ENUM_TIMEFRAMES customTimeframeSLTP = PERIOD_M15;  // Timeframe per aggiornamento SL e TP
input bool Checkevrytick = false;                        // Check ad ogni tick
input double SL_factor = 50.0;                          // Stop Loss in punti
input double TP_factor = 100.0;                         // Take Profit in punti

// === Trailing Stop ===
input group "📈 Trailing Stop"
input bool EnableTrailingStop = false;
input double TrailingStartPips = 10.0;                  // distanza in pips per attivare trailing
input double TrailingStopPoints = 20.0;                 // distanza standard in pips dello SL
input double TrailingStepPoints = 5.0;                  // passo minimo in pips tra modifiche SL
input double TrailingMaxDistancePips = 50.0;            // distanza massima consentita tra prezzo e SL
input int TrailingMinAgeSeconds = 300;                   // ⏱️ Secondi minimi prima di attivare il trailing

// === Trailing TP ===
input group "📈 Trailing Take profit"
input bool EnableTrailingTP = true;
input double TrailingTPStartPips = 20.0;                // Profitto minimo per attivare il trailing TP
input double TrailingTPDistancePips = 15.0;             // Distanza del TP dal prezzo attuale

// === Breakeven ===
input group "Breakeven"
input bool EnableBreakeven = true;
input double BreakevenActivationPips = 20.0;            // profitto minimo in pips per attivare breakeven
input double BreakevenExtraPips = 2.0;                  // extra in pips da aggiungere al prezzo di apertura

// === FILTRO VOLATILITA' ATR ===
input group "🌊 Filtro Volatilità ATR"
input bool UseATRFilter = false;                         // Abilita filtro ATR
input double MinATRMultiplier = 15.0;                   // Volatilità minima richiesta (in pips diretti)
input int ATRPeriod = 14;                               // Periodo ATR

// === FILTRO ADX ===
input group "📐 Filtro ADX (Trend Strength)"
input bool UseADXFilter = false;                         // Abilita filtro ADX
input ENUM_TIMEFRAMES ADXTimeframe = PERIOD_D1;          // Timeframe calcolo ADX
input int ADXPeriod_Filter = 14;                         // Periodo ADX
input double ADXMinLevel = 22.0;                         // Livello ADX minimo richiesto

// === CHIUSURA AUTOMATICA DOPO TEMPO ===
input group "⏰ Chiusura Automatica per Tempo"
input bool EnableAutoCloseAfterTime = false;           // Abilita chiusura automatica dopo tempo
input int AutoCloseHours = 2;                          // Ore dopo le quali chiudere automaticamente
input int AutoCloseMinutes = 30;                       // Minuti aggiuntivi

// === FILTRO PERFORMANCE DINAMICO ===
input group "📈 Gestione Performance Dinamica"
input bool UsePerformanceFilter = false;                 // Abilita filtro performance
input int TradesLookback = 10;                          // Numero trade recenti da analizzare
input double RiskReductionFactor = 0.5;                 // Moltiplicatore rischio dopo performance negative (0.5 = dimezza)
input double RiskIncreaseFactor = 1.5;                  // Moltiplicatore rischio dopo performance positive (1.5 = aumenta 50%)
input int LookbackWindow = 5;                           // Finestra di trade recenti da valutare
input int LossThreshold = 3;                            // Numero di loss nella finestra per ridurre rischio
input int WinThreshold = 4;                             // Numero di win nella finestra per aumentare rischio
input bool secondLossThreshold = false;                  // Dimezza il rischio dopo 2*LossThreshold
input double MaxRiskMultiplier = 2.0;                   // Moltiplicatore massimo del rischio
input double MinRiskMultiplier = 0.2;                   // Moltiplicatore minimo del rischio
input double BlockedLevelBufferPips = 0;    // Buffer in pips per livelli bloccati
input int BlockedLevelHours = 0;             // Ore di blocco per stesso livello

// === Permessi di Trading ===
input group "✅ Permessi di Trading"
input bool Allowbuy = true;
input bool Allowsell = true;
input bool AllowTradingMonday = true;
input bool AllowTradingTuesday = true;
input bool AllowTradingWednesday = true;
input bool AllowTradingThursday = true;
input bool AllowTradingFriday = true;
input bool AllowTradingSaturday = true;
input bool AllowTradingSunday = true;
input int startHour = 0;                                 // ora inizio stop trading
input int startMinute = 0;                               // minuto inizio stop trading
input int endHour = 0;                                   // ora fine stop trading
input int endMinute = 0;                                 // minuto fine stop trading
input bool closetradeshour = false;                      // chiudere tutti i trade all'inizio del periodo di stop
input int ExcludedHour1 = -1;  // Primo orario da escludere (-1 = non usare)
input int ExcludedHour2 = -1;  // Secondo orario da escludere (-1 = non usare)
input int ExcludedHour3 = -1;  // Terzo orario da escludere (-1 = non usare)
input int ExcludedHour4 = -1;  // Quarto orario da escludere (-1 = non usare)
input int ExcludedHour5 = -1;  // Quinto orario da escludere (-1 = non usare)

// === Varie ===
input group "🔧 Varie"
input bool VerboseLog = false;                           // Log dettagliato (rallenta backtest e riempie i log)

// === Ottimizzazione: filtri originali (invariati) ===
input group "📊 Ottimizzazione - filtri originali"
input int minnumberoftrades = 0;        // Numero minimo di trade
input double minexpectedPayoff = 0;     // Valore minimo payoff atteso
input double minrecoveryFactor = 0;     // Valore minimo recovery factor

// === Ottimizzazione: criterio e filtri indipendenti dal periodo ===
input group "📊 Ottimizzazione - criterio custom e filtri (0 = off)"
input OptCriterion OptCriterionMode = CRIT_LEGACY;       // Criterio custom (OnTester)
input double Opt_MinTradesPerMonth = 0;                  // Trade minimi al mese
input double Opt_MinProfitFactor = 0;                    // Profit Factor minimo
input double Opt_MinRFAnnual = 0;                        // Recovery Factor annualizzato minimo
input double Opt_MinRSquared = 0;                        // R2 minimo della equity (0-1)
input double Opt_MinAvgTradePoints = 0;                  // Guadagno medio per trade minimo (punti)
input double Opt_MaxBestTradePct = 0;                    // Max % del profitto netto dal trade migliore
input double Opt_MinProfitableMonthsPct = 0;             // % minima di mesi in profitto
input double Opt_MaxEquityDDPct = 0;                     // Max drawdown equity % (dipende dal deposito)

//+------------------------------------------------------------------+
//| Strutture dati                                                  |
//+------------------------------------------------------------------+

// Struttura per tracciare risultati trade
struct TradeResult
{
    ulong ticket;
    datetime closeTime;
    double profit;
    bool isWin;
    
    TradeResult()
    {
        ticket = 0;
        closeTime = 0;
        profit = 0.0;
        isWin = false;
    }
};

// Struttura per tracciare livelli di prezzo utilizzati
struct UsedPriceLevel
{
    double price;           // Prezzo del livello
    datetime useTime;       // Quando è stato utilizzato
    bool isBuyLevel;        // true per BUY, false per SELL
    
    UsedPriceLevel()
    {
        price = 0.0;
        useTime = 0;
        isBuyLevel = false;
    }
    
    UsedPriceLevel(double p, datetime t, bool isBuy)
    {
        price = p;
        useTime = t;
        isBuyLevel = isBuy;
    }
};

struct SimplePositionTimer
{
    ulong ticket;           // Ticket della posizione
    datetime openTime;      // Tempo di apertura
    
    SimplePositionTimer()
    {
        ticket = 0;
        openTime = 0;
    }
    
    SimplePositionTimer(ulong t, datetime ot)
    {
        ticket = t;
        openTime = ot;
    }
};

// Statistiche per OnTester
struct OptStats
{
    double years;
    double months;
    int    trades;
    double netProfit;
    double equityDD;
    double equityDDPct;
    double profitFactor;
    double rfAnnual;
    double annualReturnPct;
    double ulcerIndex;
    double martin;
    double sharpeMonthly;
    double sqn100;
    double rSquared;
    double avgTradePoints;
    double bestTradePct;
    double tradesPerMonth;
    double profitableMonthsPct;
};

//+------------------------------------------------------------------+
//| Variabili globali                                               |
//+------------------------------------------------------------------+
// Nomi variabili globali di terminale (NewsGuard / TradingGuard)
const string GV_NEWS_ACTIVE   = "NewsGuard_Active";
const string GV_TRADING_PAUSE = "TRADING_PAUSED";

// Cache dei dati di mercato
double g_askPrice;
double g_bidPrice;
double g_currentPrice;

// Gestione temporale
datetime g_lastCheckedDay = 0;
datetime g_lastCheckedBarTimeOrder = 0;
datetime g_lastCheckedBarTimeSLTP = 0;
datetime g_lastVolumeUpdateTime = 0;
long     g_lastTickMinute = -1;
bool     g_isTester = false;
bool     g_forceOrderUpdate = false;
datetime g_testStartTime = 0;

// Cache orari consentiti (ricalcolati solo al cambio minuto)
bool g_dayAllowedCache = true;
bool g_hourAllowedCache = true;

// Cache livelli locali
bool     g_levelsValid = false;
datetime g_levelsBar0Time = 0;
int      g_levelsBarsCount = 0;

// Livelli e ordini
double g_highLevelsforpending[];
double g_lowLevelsforpending[];
double g_pricemolt = 1.0;
bool   g_scalingReady = false;   // v1.4.1: true quando g_pricemolt e' stato calcolato
int g_scalingATRHandle = INVALID_HANDLE;
int g_atrFilterHandle = INVALID_HANDLE;
int g_adxFilterHandle = INVALID_HANDLE;

// Performance tracking
TradeResult g_recentTrades[];
double g_currentRiskMultiplier = 1.0;

// Array per tracciare livelli di prezzo utilizzati
UsedPriceLevel g_usedPriceLevels[];

SimplePositionTimer g_positionTimers[];

//+------------------------------------------------------------------+
//| OnTester: criteri custom e filtri                                |
//+------------------------------------------------------------------+
bool AnyNewOptFilterActive()
{
    return (Opt_MinTradesPerMonth > 0 || Opt_MinProfitFactor > 0 || Opt_MinRFAnnual > 0 ||
            Opt_MinRSquared > 0 || Opt_MinAvgTradePoints > 0 || Opt_MaxBestTradePct > 0 ||
            Opt_MinProfitableMonthsPct > 0 || Opt_MaxEquityDDPct > 0);
}

// Coefficiente R2 della curva equity per trade (con segno della pendenza)
double CalcRSquared(const double &equity[], int n)
{
    if (n < 3) return 0.0;
    double sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (int i = 0; i < n; i++)
    {
        double x = (double)i;
        double y = equity[i];
        sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    double cov  = n * sxy - sx * sy;
    double varx = n * sxx - sx * sx;
    double vary = n * syy - sy * sy;
    if (varx <= 0 || vary <= 0) return 0.0;
    double r = cov / MathSqrt(varx * vary);
    double r2 = r * r;
    return (cov < 0) ? -r2 : r2;
}

bool ComputeOptStats(OptStats &st)
{
    ZeroMemory(st);
    
    datetime endTime = TimeCurrent();
    double seconds = (double)(endTime - g_testStartTime);
    if (seconds < 86400) seconds = 86400;
    st.years  = seconds / (365.25 * 86400.0);
    st.months = st.years * 12.0;
    
    double deposit   = TesterStatistics(STAT_INITIAL_DEPOSIT);
    st.netProfit     = TesterStatistics(STAT_PROFIT);
    st.equityDD      = TesterStatistics(STAT_EQUITY_DD);
    st.equityDDPct   = TesterStatistics(STAT_EQUITYDD_PERCENT);
    st.profitFactor  = TesterStatistics(STAT_PROFIT_FACTOR);
    if (deposit <= 0) deposit = 1.0;
    
    // --- Ricostruzione trade dalla history (netto commissioni/swap, punti) ---
    if (!HistorySelect(0, endTime)) return false;
    int totalDeals = HistoryDealsTotal();
    
    ulong  openPos[];
    double openPrice[];
    double openComm[];
    int    openDir[];
    int    openCount = 0;
    
    double tradeNet[];
    double tradePts[];
    datetime tradeTime[];
    int n = 0;
    ArrayResize(tradeNet, 0, 1000);
    ArrayResize(tradePts, 0, 1000);
    ArrayResize(tradeTime, 0, 1000);
    
    for (int i = 0; i < totalDeals; i++)
    {
        ulong d = HistoryDealGetTicket(i);
        if (d == 0) continue;
        long dtype = HistoryDealGetInteger(d, DEAL_TYPE);
        if (dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL) continue;
        long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
        ulong pos  = (ulong)HistoryDealGetInteger(d, DEAL_POSITION_ID);
        double price = HistoryDealGetDouble(d, DEAL_PRICE);
        double comm  = HistoryDealGetDouble(d, DEAL_COMMISSION);
        
        if (entry == DEAL_ENTRY_IN)
        {
            ArrayResize(openPos,   openCount + 1);
            ArrayResize(openPrice, openCount + 1);
            ArrayResize(openComm,  openCount + 1);
            ArrayResize(openDir,   openCount + 1);
            openPos[openCount]   = pos;
            openPrice[openCount] = price;
            openComm[openCount]  = comm;
            openDir[openCount]   = (dtype == DEAL_TYPE_BUY) ? 1 : -1;
            openCount++;
        }
        else if (entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT)
        {
            double net = HistoryDealGetDouble(d, DEAL_PROFIT) + comm + HistoryDealGetDouble(d, DEAL_SWAP);
            double pts = 0.0;
            for (int k = 0; k < openCount; k++)
            {
                if (openPos[k] != pos) continue;
                net += openComm[k];
                pts = (price - openPrice[k]) * openDir[k] / _Point;
                // rimuovi (swap con l'ultimo)
                openPos[k]   = openPos[openCount - 1];
                openPrice[k] = openPrice[openCount - 1];
                openComm[k]  = openComm[openCount - 1];
                openDir[k]   = openDir[openCount - 1];
                openCount--;
                break;
            }
            ArrayResize(tradeNet,  n + 1, 1000);
            ArrayResize(tradePts,  n + 1, 1000);
            ArrayResize(tradeTime, n + 1, 1000);
            tradeNet[n]  = net;
            tradePts[n]  = pts;
            tradeTime[n] = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
            n++;
        }
    }
    st.trades = n;
    st.tradesPerMonth = (st.months > 0) ? n / st.months : 0.0;
    
    // --- RF annualizzato e rendimento annuo ---
    double annualProfit = st.netProfit / st.years;
    st.annualReturnPct = annualProfit / deposit * 100.0;
    st.rfAnnual = (st.equityDD > 0) ? annualProfit / st.equityDD : (st.netProfit > 0 ? 1000.0 : 0.0);
    
    if (n == 0) return true;
    
    // --- Equity per trade, Ulcer Index, R2, medie ---
    double equity[];
    ArrayResize(equity, n + 1);
    equity[0] = 0.0;
    double peak = deposit, sumSqDD = 0.0;
    double sum = 0.0, sumSq = 0.0, sumPts = 0.0, best = -DBL_MAX;
    for (int i = 0; i < n; i++)
    {
        equity[i + 1] = equity[i] + tradeNet[i];
        double eqAbs = deposit + equity[i + 1];
        if (eqAbs > peak) peak = eqAbs;
        double ddPct = (peak > 0) ? (peak - eqAbs) / peak * 100.0 : 0.0;
        sumSqDD += ddPct * ddPct;
        
        sum    += tradeNet[i];
        sumSq  += tradeNet[i] * tradeNet[i];
        sumPts += tradePts[i];
        if (tradeNet[i] > best) best = tradeNet[i];
    }
    st.ulcerIndex = MathSqrt(sumSqDD / n);
    st.martin = st.annualReturnPct / MathMax(st.ulcerIndex, 1e-6);
    st.rSquared = CalcRSquared(equity, n + 1);
    st.avgTradePoints = sumPts / n;
    st.bestTradePct = (st.netProfit > 0) ? best / st.netProfit * 100.0 : 100.0;
    
    double mean = sum / n;
    double variance = (n > 1) ? (sumSq - n * mean * mean) / (n - 1) : 0.0;
    double sd   = (variance > 0) ? MathSqrt(variance) : 0.0;
    st.sqn100 = (sd > 0) ? mean / sd * MathSqrt(MathMin((double)n, 100.0)) : 0.0;
    
    // --- Rendimenti mensili: Sharpe e % mesi positivi ---
    MqlDateTime s0, s1;
    TimeToStruct(g_testStartTime, s0);
    TimeToStruct(endTime, s1);
    int nMonths = (s1.year - s0.year) * 12 + (s1.mon - s0.mon) + 1;
    if (nMonths < 1) nMonths = 1;
    double monthly[];
    ArrayResize(monthly, nMonths);
    ArrayInitialize(monthly, 0.0);
    for (int i = 0; i < n; i++)
    {
        MqlDateTime t;
        TimeToStruct(tradeTime[i], t);
        int m = (t.year - s0.year) * 12 + (t.mon - s0.mon);
        if (m < 0) m = 0;
        if (m >= nMonths) m = nMonths - 1;
        monthly[m] += tradeNet[i] / deposit;
    }
    double mSum = 0.0, mSumSq = 0.0;
    int positive = 0;
    for (int m = 0; m < nMonths; m++)
    {
        mSum += monthly[m];
        mSumSq += monthly[m] * monthly[m];
        if (monthly[m] > 0) positive++;
    }
    double mMean = mSum / nMonths;
    double mVar  = (nMonths > 1) ? (mSumSq - nMonths * mMean * mMean) / (nMonths - 1) : 0.0;
    double mSd   = (mVar > 0) ? MathSqrt(mVar) : 0.0;
    st.sharpeMonthly = (mSd > 0) ? mMean / mSd * MathSqrt(12.0) : 0.0;
    st.profitableMonthsPct = 100.0 * positive / nMonths;
    
    return true;
}

double OnTester()
{
    double expectedPayoff = (double)TesterStatistics(STAT_EXPECTED_PAYOFF);
    double recoveryFactor = (double)TesterStatistics(STAT_RECOVERY_FACTOR);
    double numberOfTrades = (double)TesterStatistics(STAT_TRADES);
    bool optimizing = (bool)MQLInfoInteger(MQL_OPTIMIZATION);
    
    // Vincolo di coerenza parametri: vale sempre
    if (BreakevenExtraPips > BreakevenActivationPips)
    {
        if (!optimizing) Print("📊 OnTester = 0 | scartato: BreakevenExtraPips > BreakevenActivationPips");
        return 0;
    }
    
    // ── Modalita' LEGACY: identica alla v1.3 ──
    // I filtri originali (n. trade, payoff, RF) dipendono dalla durata del periodo,
    // quindi si applicano SOLO con il criterio legacy.
    string reason = "";
    if (OptCriterionMode == CRIT_LEGACY)
    {
        if (numberOfTrades < minnumberoftrades)      reason = StringFormat("trade %.0f < %d", numberOfTrades, minnumberoftrades);
        else if (expectedPayoff < minexpectedPayoff) reason = StringFormat("payoff %.2f < %.2f", expectedPayoff, minexpectedPayoff);
        else if (recoveryFactor < minrecoveryFactor) reason = StringFormat("RF %.2f < %.2f", recoveryFactor, minrecoveryFactor);
        
        if (reason != "")
        {
            if (!optimizing) Print("📊 OnTester = 0 | scartato (filtri originali): ", reason);
            return 0;
        }
        // Percorso veloce: stesso risultato della v1.3, nessun calcolo extra
        if (!AnyNewOptFilterActive() && optimizing)
            return expectedPayoff * 0.1 + recoveryFactor * 0.7 + MathLog(numberOfTrades) * 0.2;
    }
    
    OptStats st;
    if (!ComputeOptStats(st))
    {
        if (!optimizing) Print("📊 OnTester = 0 | errore lettura history");
        return 0;
    }
    
    // Filtri indipendenti dalla durata del periodo
    if (Opt_MinTradesPerMonth > 0      && st.tradesPerMonth      < Opt_MinTradesPerMonth)      reason = StringFormat("trade/mese %.2f < %.2f", st.tradesPerMonth, Opt_MinTradesPerMonth);
    else if (Opt_MinProfitFactor > 0   && st.profitFactor        < Opt_MinProfitFactor)        reason = StringFormat("PF %.2f < %.2f", st.profitFactor, Opt_MinProfitFactor);
    else if (Opt_MinRFAnnual > 0       && st.rfAnnual            < Opt_MinRFAnnual)            reason = StringFormat("RFann %.2f < %.2f", st.rfAnnual, Opt_MinRFAnnual);
    else if (Opt_MinRSquared > 0       && st.rSquared            < Opt_MinRSquared)            reason = StringFormat("R2 %.3f < %.3f", st.rSquared, Opt_MinRSquared);
    else if (Opt_MinAvgTradePoints > 0 && st.avgTradePoints      < Opt_MinAvgTradePoints)      reason = StringFormat("avgPts %.1f < %.1f", st.avgTradePoints, Opt_MinAvgTradePoints);
    else if (Opt_MaxBestTradePct > 0   && st.bestTradePct        > Opt_MaxBestTradePct)        reason = StringFormat("best%% %.1f > %.1f", st.bestTradePct, Opt_MaxBestTradePct);
    else if (Opt_MinProfitableMonthsPct > 0 && st.profitableMonthsPct < Opt_MinProfitableMonthsPct) reason = StringFormat("mesi+%% %.1f < %.1f", st.profitableMonthsPct, Opt_MinProfitableMonthsPct);
    else if (Opt_MaxEquityDDPct > 0    && st.equityDDPct         > Opt_MaxEquityDDPct)         reason = StringFormat("DDeq%% %.2f > %.2f", st.equityDDPct, Opt_MaxEquityDDPct);
    
    double score = 0.0;
    if (reason == "")
    {
        switch (OptCriterionMode)
        {
            case CRIT_RF_ANNUAL:      score = st.rfAnnual; break;
            case CRIT_MARTIN:         score = st.martin; break;
            case CRIT_SHARPE_MONTHLY: score = st.sharpeMonthly; break;
            case CRIT_SQN100:         score = st.sqn100; break;
            case CRIT_PROFIT_FACTOR:  score = st.profitFactor; break;
            case CRIT_STABILITY:      score = (st.rSquared > 0) ? st.rSquared * st.rfAnnual : 0.0; break;
            default:                  score = expectedPayoff * 0.1 + recoveryFactor * 0.7 + MathLog(numberOfTrades) * 0.2; break;
        }
    }
    
    // Riepilogo nel log per singoli backtest (in ottimizzazione Print non viene scritto)
    if (!optimizing)
    {
        PrintFormat("📊 OnTester = %.4f | dal %s al %s | anni=%.2f trade=%d trade/mese=%.2f PF=%.2f RFann=%.2f Martin=%.2f SharpeM=%.2f SQN100=%.2f R2=%.3f avgPts=%.1f best%%=%.1f mesi+%%=%.1f DDeq%%=%.2f",
                    score, TimeToString(g_testStartTime, TIME_DATE), TimeToString(TimeCurrent(), TIME_DATE),
                    st.years, st.trades, st.tradesPerMonth, st.profitFactor, st.rfAnnual, st.martin,
                    st.sharpeMonthly, st.sqn100, st.rSquared, st.avgTradePoints, st.bestTradePct,
                    st.profitableMonthsPct, st.equityDDPct);
        if (reason != "")
            Print("📊 OnTester = 0 | scartato (filtri Opt_): ", reason);
    }
    
    return score;
}

//+------------------------------------------------------------------+
//| Funzioni di utilità per il mercato                              |
//+------------------------------------------------------------------+
void UpdateMarketData()
{
    g_askPrice = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    g_bidPrice = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    g_currentPrice = (g_askPrice + g_bidPrice) * 0.5;
}

double GetSpreadInPips()
{
    return (g_askPrice - g_bidPrice) / _Point;
}

bool IsSpreadAcceptable()
{
    return !enablespreadfilter || GetSpreadInPips() <= MaxSpreadPoints;
}

//+------------------------------------------------------------------+
//| Verifica se l'orario corrente è in quelli esclusi             |
//+------------------------------------------------------------------+
bool IsCurrentHourExcluded()
{
    MqlDateTime dt;
    TimeToStruct(TimeCurrent(), dt);
    int currentHour = dt.hour;
    
    if (ExcludedHour1 >= 0 && ExcludedHour1 <= 23 && currentHour == ExcludedHour1) return true;
    if (ExcludedHour2 >= 0 && ExcludedHour2 <= 23 && currentHour == ExcludedHour2) return true;
    if (ExcludedHour3 >= 0 && ExcludedHour3 <= 23 && currentHour == ExcludedHour3) return true;
    if (ExcludedHour4 >= 0 && ExcludedHour4 <= 23 && currentHour == ExcludedHour4) return true;
    if (ExcludedHour5 >= 0 && ExcludedHour5 <= 23 && currentHour == ExcludedHour5) return true;
    
    return false;
}

//+------------------------------------------------------------------+
//| Legge l'ATR corrente (in prezzo, stessa unita' di ATRDefault)    |
//| per lo scaling di g_pricemolt                                    |
//+------------------------------------------------------------------+
double GetScalingATRValue()
{
    if (g_scalingATRHandle == INVALID_HANDLE)
    {
        g_scalingATRHandle = iATR(_Symbol, ATR_ScalingTimeframe, ATR_ScalingPeriod);
        if (g_scalingATRHandle == INVALID_HANDLE)
        {
            Print("❌ Errore creazione handle ATR (scaling)");
            return 0.0;
        }
    }

    double atrBuffer[1];
    if (CopyBuffer(g_scalingATRHandle, 0, 0, 1, atrBuffer) != 1)
    {
        Print("❌ Errore lettura buffer ATR (scaling)");
        return 0.0;
    }

    return atrBuffer[0];
}

//+------------------------------------------------------------------+
//| Filtro volatilità ATR (handle persistente)                       |
//+------------------------------------------------------------------+
bool IsVolatilityAcceptable()
{
    if (!UseATRFilter) return true;
    
    if (g_atrFilterHandle == INVALID_HANDLE)
    {
        g_atrFilterHandle = iATR(_Symbol, userTimeframe, ATRPeriod);
        if (g_atrFilterHandle == INVALID_HANDLE)
        {
            Print("❌ Errore creazione handle ATR");
            return true; // Se errore, procedi comunque
        }
    }
    
    double atrBuffer[1];
    if (CopyBuffer(g_atrFilterHandle, 0, 0, 1, atrBuffer) != 1)
    {
        Print("❌ Errore lettura buffer ATR");
        return true; // Se errore, procedi comunque
    }
    
    double atrInPips = atrBuffer[0] / _Point;
    bool isAcceptable = atrInPips >= MinATRMultiplier*g_pricemolt;
    
    if (VerboseLog)
    {
        if (!isAcceptable)
            Print("🌙 Volatilità troppo bassa - ATR: ", DoubleToString(atrInPips, 1), " pips (Min richiesto: ", MinATRMultiplier, " pips)");
        else
            Print("✅ Volatilità accettabile - ATR: ", DoubleToString(atrInPips, 1), " pips");
    }
    
    return isAcceptable;
}

//+------------------------------------------------------------------+
//| Filtro ADX (handle persistente)                                  |
//+------------------------------------------------------------------+
bool IsADXAcceptable()
{
    if (!UseADXFilter) return true;
    
    if (g_adxFilterHandle == INVALID_HANDLE)
    {
        g_adxFilterHandle = iADX(_Symbol, ADXTimeframe, ADXPeriod_Filter);
        if (g_adxFilterHandle == INVALID_HANDLE)
        {
            Print("❌ Errore creazione handle ADX");
            return true;
        }
    }
    
    double adxBuffer[1];
    if (CopyBuffer(g_adxFilterHandle, 0, 0, 1, adxBuffer) != 1)
    {
        Print("❌ Errore lettura buffer ADX");
        return true;
    }
    
    double adxValue = adxBuffer[0];
    bool acceptable = adxValue >= ADXMinLevel;
    
    if (VerboseLog)
    {
        if (!acceptable)
            Print("📉 ADX troppo basso - ADX: ", DoubleToString(adxValue, 1),
                  " (Min richiesto: ", ADXMinLevel, ") → trade saltato");
        else
            Print("✅ ADX accettabile - ADX: ", DoubleToString(adxValue, 1));
    }
    
    return acceptable;
}

//+------------------------------------------------------------------+
//| Gestione Performance Dinamica                                   |
//+------------------------------------------------------------------+
void AddTradeResult(ulong ticket, double profit, datetime closeTime)
{
    if (!UsePerformanceFilter) return;
    
    int size = ArraySize(g_recentTrades);
    
    if (size >= TradesLookback)
    {
        for (int i = 0; i < size - 1; i++)
            g_recentTrades[i] = g_recentTrades[i + 1];
        size = TradesLookback - 1;
    }
    
    ArrayResize(g_recentTrades, size + 1);
    g_recentTrades[size].ticket = ticket;
    g_recentTrades[size].profit = profit;
    g_recentTrades[size].closeTime = closeTime;
    g_recentTrades[size].isWin = (profit > 0);
    
    if (VerboseLog)
        Print("📊 Trade aggiunto al tracking: Ticket=", ticket, " Profit=", profit, " Win=", (profit > 0 ? "SÌ" : "NO"));
    
    UpdateRiskMultiplier();
}

void UpdateRiskMultiplier()
{
    if (!UsePerformanceFilter) 
    {
        g_currentRiskMultiplier = 1.0;
        return;
    }
    
    int totalTrades = ArraySize(g_recentTrades);
    if (totalTrades == 0)
    {
        g_currentRiskMultiplier = 1.0;
        return;
    }
    
    int windowSize = MathMin(LookbackWindow, totalTrades);
    int winCount = 0;
    int lossCount = 0;
    
    for (int i = totalTrades - windowSize; i < totalTrades; i++)
    {
        if (g_recentTrades[i].isWin) winCount++;
        else                         lossCount++;
    }
    
    double oldMultiplier = g_currentRiskMultiplier;
    
    // NB: logica identica alla v1.3 (il ramo secondLossThreshold resta com'era)
    if (lossCount >= LossThreshold)
    {
        g_currentRiskMultiplier = RiskReductionFactor;
        if (VerboseLog) Print("📉 RIDUZIONE RISCHIO: ", lossCount, " loss su ", windowSize, " trade (soglia: ", LossThreshold, ") -> Moltiplicatore: ", g_currentRiskMultiplier);
    }
    else if (lossCount >= 2*LossThreshold && secondLossThreshold)
    {
        g_currentRiskMultiplier = RiskReductionFactor*0.5;
        if (VerboseLog) Print("📉 RIDUZIONE RISCHIO: ", lossCount, " loss su ", windowSize, " trade (soglia: ", 2*LossThreshold, ") -> Moltiplicatore: ", g_currentRiskMultiplier);
    }
    else if (winCount >= WinThreshold)
    {
        g_currentRiskMultiplier = RiskIncreaseFactor;
        if (VerboseLog) Print("📈 AUMENTO RISCHIO: ", winCount, " win su ", windowSize, " trade (soglia: ", WinThreshold, ") -> Moltiplicatore: ", g_currentRiskMultiplier);
    }
    else
    {
        g_currentRiskMultiplier = 1.0;
        if (VerboseLog) Print("🔄 RISCHIO NORMALE: ", winCount, " win, ", lossCount, " loss su ", windowSize, " trade -> Moltiplicatore: 1.0");
    }
    
    g_currentRiskMultiplier = MathMin(MaxRiskMultiplier, MathMax(MinRiskMultiplier, g_currentRiskMultiplier));
    
    if (MathAbs(oldMultiplier - g_currentRiskMultiplier) > 0.01)
    {
        Print("🎯 MOLTIPLICATORE RISCHIO AGGIORNATO: ", oldMultiplier, " -> ", g_currentRiskMultiplier);
        if (VerboseLog) PrintPerformanceSummary();
    }
}

void PrintPerformanceSummary()
{
    if (!UsePerformanceFilter) return;
    
    int totalTrades = ArraySize(g_recentTrades);
    if (totalTrades == 0) return;
    
    int wins = 0, losses = 0;
    double totalProfit = 0;
    
    for (int i = 0; i < totalTrades; i++)
    {
        if (g_recentTrades[i].isWin) wins++; else losses++;
        totalProfit += g_recentTrades[i].profit;
    }
    
    int windowSize = MathMin(LookbackWindow, totalTrades);
    int windowWins = 0, windowLosses = 0;
    
    for (int i = totalTrades - windowSize; i < totalTrades; i++)
    {
        if (g_recentTrades[i].isWin) windowWins++; else windowLosses++;
    }
    
    double winRate = (totalTrades > 0) ? (wins * 100.0 / totalTrades) : 0;
    double windowWinRate = (windowSize > 0) ? (windowWins * 100.0 / windowSize) : 0;
    
    Print("📊 === RIEPILOGO PERFORMANCE ===");
    Print("   TOTALE (ultimi ", totalTrades, " trade): Win: ", wins, " | Loss: ", losses, " | Win Rate: ", DoubleToString(winRate, 1), "%");
    Print("   FINESTRA CORRENTE (ultimi ", windowSize, " trade): Win: ", windowWins, " | Loss: ", windowLosses, " | Win Rate: ", DoubleToString(windowWinRate, 1), "%");
    Print("   Profitto Totale: ", DoubleToString(totalProfit, 2));
    Print("   Moltiplicatore Rischio Corrente: ", DoubleToString(g_currentRiskMultiplier, 2));
    Print("   Soglie: ", LossThreshold, " loss o ", WinThreshold, " win su ", LookbackWindow, " trade");
}

//+------------------------------------------------------------------+
//| Funzioni di gestione temporale                                  |
//+------------------------------------------------------------------+
bool IsTradingDayAllowed()
{
    MqlDateTime dt;
    TimeToStruct(TimeCurrent(), dt);
    
    switch (dt.day_of_week)
    {
        case 0: return AllowTradingSunday;
        case 1: return AllowTradingMonday;
        case 2: return AllowTradingTuesday;
        case 3: return AllowTradingWednesday;
        case 4: return AllowTradingThursday;
        case 5: return AllowTradingFriday;
        case 6: return AllowTradingSaturday;
        default: return false;
    }
}

bool IsTradingAllowedbyhour()
{
    if (IsCurrentHourExcluded())
        return false;
    
    MqlDateTime dt;
    TimeToStruct(TimeCurrent(), dt);
    
    int currentMinutes = dt.hour * 60 + dt.min;
    int startMinutes = startHour * 60 + startMinute;
    int endMinutes = endHour * 60 + endMinute;
    
    if (startMinutes == endMinutes) return true;
    
    if (startMinutes < endMinutes)
        return !(currentMinutes >= startMinutes && currentMinutes < endMinutes);
    else
        return !(currentMinutes >= startMinutes || currentMinutes < endMinutes);
}

void CloseAllTrades()
{
    for (int i = PositionsTotal() - 1; i >= 0; i--)
    {
        ulong ticket = PositionGetTicket(i);
        if (PositionSelectByTicket(ticket))
        {
            string symbol = PositionGetString(POSITION_SYMBOL);
            trade.PositionClose(symbol);
        }
    }
}

//+------------------------------------------------------------------+
//| Aggiornamento giornaliero del moltiplicatore g_pricemolt         |
//| (era dentro CheckDailyDrawdown nella v1.3 - logica identica)     |
//+------------------------------------------------------------------+
void UpdateDailyScaling()
{
    // v1.4.1: se non serve scaling, e' subito pronto
    if (!(UseATRScaling && ATRDefault > 0) && defaultprice <= 0)
    {
        g_pricemolt = 1.0;
        g_scalingReady = true;
        return;
    }
    
    datetime currentDailyOpenTime = iTime(_Symbol, PERIOD_D1, 0);
    if (currentDailyOpenTime == 0) return;                       // storico D1 non ancora disponibile: riprova al prossimo tick
    if (g_scalingReady && currentDailyOpenTime == g_lastCheckedDay) return;
    
    double newMolt = 0;
    if (UseATRScaling && ATRDefault > 0)
    {
        double atrValue = GetScalingATRValue();
        if (atrValue > 0)
            newMolt = NormalizeDouble(atrValue / ATRDefault, 2);
    }
    else
    {
        double dailyOpen = iOpen(_Symbol, PERIOD_D1, 0);
        if (dailyOpen > 0)
            newMolt = NormalizeDouble(dailyOpen / defaultprice, 2);
    }
    
    if (newMolt <= 0) return;                                    // dato non valido: NON segno il giorno, riprovo
    
    g_pricemolt = newMolt;
    g_lastCheckedDay = currentDailyOpenTime;
    if (!g_scalingReady)
        Print("Scaling pronto: g_pricemolt = ", DoubleToString(g_pricemolt, 2));
    g_scalingReady = true;
}

//+------------------------------------------------------------------+
//| Calcolo lotti                                                    |
//+------------------------------------------------------------------+
double CalculateLotSize(double stopLossPoints)
{
    double baseLotSize = fixedLotSize;
    
    if (adjustlotsizevariables) 
        baseLotSize /= g_pricemolt;
    
    if (stopLossPoints <= 0)
    {
        Print("Errore: stopLossPoints <= 0");
        return baseLotSize * g_currentRiskMultiplier;
    }
    
    double balance = (lotSizeAccountSource == UseBalance)
                        ? AccountInfoDouble(ACCOUNT_BALANCE)
                        : AccountInfoDouble(ACCOUNT_EQUITY);
    double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
    double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
    double pointValue = tickValue / tickSize;
    
    if (pointValue <= 0)
    {
        Print("Errore nel calcolo pointValue");
        return baseLotSize * g_currentRiskMultiplier;
    }
    
    double lotSize = baseLotSize;
    
    switch (lotMethod)
    {
        case PercentRisk:
        {
            double riskAmount = balance * (riskPercent / 100.0);
            lotSize = riskAmount / (stopLossPoints * pointValue);
            break;
        }
        case FixedMoneyRisk:
        {
            lotSize = fixedRiskAmount / (stopLossPoints * pointValue);
            break;
        }
        case FixedLotsMoney:
        {
            lotSize = 0.01 * (balance / fixedlotsxmoney);
            if (adjustlotsizevariables) 
                lotSize /= g_pricemolt;
            break;
        }
    }
    
    lotSize *= g_currentRiskMultiplier;
    
    double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
    double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
    double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
    
    lotSize = MathMax(minLot, MathMin(maxLot, lotSize));
    return NormalizeDouble(lotSize / lotStep, 0) * lotStep;
}

//+------------------------------------------------------------------+
//| Funzioni di conteggio ordini                                    |
//+------------------------------------------------------------------+
int CountOrders(bool isBuy, bool isOpen)
{
    int count = 0;
    
    if (isOpen)
    {
        ENUM_POSITION_TYPE posType = isBuy ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
        
        for (int i = PositionsTotal() - 1; i >= 0; i--)
        {
            ulong ticket = PositionGetTicket(i);
            if (ticket == 0 || !PositionSelectByTicket(ticket)) 
                continue;
                
            if (PositionGetInteger(POSITION_MAGIC) == MagicNumber &&
                PositionGetString(POSITION_SYMBOL) == _Symbol &&
                PositionGetInteger(POSITION_TYPE) == posType)
                count++;
        }
    }
    else
    {
        ENUM_ORDER_TYPE orderType = isBuy ? ORDER_TYPE_BUY_STOP : ORDER_TYPE_SELL_STOP;
        
        for (int i = 0; i < OrdersTotal(); i++)
        {
            ulong ticket = OrderGetTicket(i);
            if (!OrderSelect(ticket)) continue;
            
            if (OrderGetString(ORDER_SYMBOL) == _Symbol &&
                OrderGetInteger(ORDER_MAGIC) == MagicNumber &&
                OrderGetInteger(ORDER_TYPE) == orderType)
                count++;
        }
    }
    
    return count;
}

//+------------------------------------------------------------------+
//| Funzioni di gestione livelli locali                             |
//| v1.4: stessi calcoli della v1.3, ma su array copiati in blocco   |
//| (invece di migliaia di chiamate iHigh/iLow) e con cache: i       |
//| livelli usano solo barre chiuse, quindi cambiano solo quando     |
//| nasce una nuova barra di userTimeframe.                          |
//+------------------------------------------------------------------+

// Copia 'count' valori (indice 0 = barra corrente, come iHigh/iLow).
// Gli indici non disponibili restano a 0, come restituirebbe iHigh/iLow.
bool CopyHLSeries(bool isHigh, int count, double &out[])
{
    ArrayResize(out, count);
    ArrayInitialize(out, 0.0);
    
    double tmp[];
    int got = isHigh ? CopyHigh(_Symbol, userTimeframe, 0, count, tmp)
                     : CopyLow (_Symbol, userTimeframe, 0, count, tmp);
    if (got <= 0) return false;
    
    for (int k = 0; k < got && k < count; k++)
        out[k] = tmp[got - 1 - k];
    return true;
}

bool IsLocalHighLowArr(const double &arr[], int index, int leftDepth, int rightDepth, bool isHigh)
{
    double value = arr[index];
    
    for (int i = 1; i <= leftDepth; i++)
    {
        double compareValue = arr[index + i];
        if ((isHigh && compareValue >= value) || (!isHigh && compareValue <= value))
            return false;
    }
    
    for (int i = 1; i <= rightDepth; i++)
    {
        double compareValue = arr[index - i];
        if ((isHigh && compareValue >= value) || (!isHigh && compareValue <= value))
            return false;
    }
    
    return true;
}

void UpdateLocalLevels()
{
    datetime bar0 = iTime(_Symbol, userTimeframe, 0);
    int barsNow = Bars(_Symbol, userTimeframe);
    // Cache valida solo se non si usa la barra in formazione (candlerightBars >= 0)
    if (g_levelsValid && candlerightBars >= 0 &&
        bar0 == g_levelsBar0Time && barsNow == g_levelsBarsCount)
        return; // nessuna nuova barra chiusa: i livelli sarebbero identici
    
    int need = MathMax(candlelookback, 0) + MathMax(candleleftBars, 0) + 1;
    double h[], l[];
    bool okH = CopyHLSeries(true,  need, h);
    bool okL = CopyHLSeries(false, need, l);
    
    highLevels.Clear();
    lowLevels.Clear();
    
    double fallbackHigh = -DBL_MAX;
    double fallbackLow = DBL_MAX;
    
    for (int i = candlelookback; i > candlerightBars; i--)
    {
        double high = h[i];
        double low = l[i];
        
        if (high > fallbackHigh) fallbackHigh = high;
        if (low < fallbackLow) fallbackLow = low;
        
        if (IsLocalHighLowArr(h, i, candleleftBars, candlerightBars, true))
        {
            // CArrayObj (free mode) libera l'oggetto in Delete()
            for (int j = highLevels.Total() - 1; j >= 0; j--)
            {
                Level* existingHigh = (Level*)highLevels.At(j);
                if (existingHigh.value <= high)
                    highLevels.Delete(j);
            }
            highLevels.Add(new Level(i, high));
        }
        
        if (IsLocalHighLowArr(l, i, candleleftBars, candlerightBars, false))
        {
            for (int j = lowLevels.Total() - 1; j >= 0; j--)
            {
                Level* existingLow = (Level*)lowLevels.At(j);
                if (existingLow.value >= low)
                    lowLevels.Delete(j);
            }
            lowLevels.Add(new Level(i, low));
        }
    }
    
    if (highLevels.Total() == 0 && fallbackHigh != -DBL_MAX)
        highLevels.Add(new Level(0, fallbackHigh));
        
    if (lowLevels.Total() == 0 && fallbackLow != DBL_MAX)
        lowLevels.Add(new Level(0, fallbackLow));
    
    // Metti in cache solo se i dati sono stati letti correttamente
    g_levelsValid = (okH && okL);
    g_levelsBar0Time = bar0;
    g_levelsBarsCount = barsNow;
}

bool ArrayContains(const double &arr[], double value)
{
    for (int i = 0; i < ArraySize(arr); i++)
    {
        if (MathAbs(arr[i] - value) <= _Point * 10)
            return true;
    }
    return false;
}

void GetNextBreakoutLevels(bool isHigh, double &outLevels[], double bufferPoints)
{
    ArrayResize(outLevels, 0);
    
    double minimumDistance = minDistancebetword * g_pricemolt * _Point;
    double temp[];
    
    CArrayObj* levels = isHigh ? &highLevels : &lowLevels;
    
    for (int i = 0; i < levels.Total(); i++)
    {
        Level* lvl = (Level*)levels.At(i);
        double levelPrice = lvl.value;
        
        double orderPrice = isHigh 
            ? levelPrice + bufferPoints 
            : levelPrice - bufferPoints;
        
        bool violated = false;
        
        for (int j = 0; j <= candlerightBars; j++)
        {
            if (isHigh && iHigh(_Symbol, userTimeframe, j) > orderPrice)
            {
                violated = true;
                break;
            }
            else if (!isHigh && iLow(_Symbol, userTimeframe, j) < orderPrice)
            {
                violated = true;
                break;
            }
        }
        
        bool validDirection = isHigh ? (levelPrice > g_currentPrice) : (levelPrice < g_currentPrice);
        
        if (!violated && validDirection)
        {
            int sz = ArraySize(temp);
            ArrayResize(temp, sz + 1);
            temp[sz] = levelPrice;
        }
    }
    
    if (ArraySize(temp) == 0) return;
    
    ArraySort(temp);
    if (!isHigh) ArrayReverse(temp);
    
    double lastAccepted = temp[0];
    ArrayResize(outLevels, 1);
    outLevels[0] = lastAccepted;
    
    for (int i = 1; i < ArraySize(temp); i++)
    {
        if (MathAbs(temp[i] - lastAccepted) >= minimumDistance)
        {
            int sz = ArraySize(outLevels);
            ArrayResize(outLevels, sz + 1);
            outLevels[sz] = temp[i];
            lastAccepted = temp[i];
        }
    }
}

//+------------------------------------------------------------------+
//| Funzioni di gestione ordini                                     |
//+------------------------------------------------------------------+
bool OrderExistsAtPrice(double targetPrice, ENUM_ORDER_TYPE orderType)
{
    double tolerance = 2.0 * _Point;
    
    for (int i = 0; i < OrdersTotal(); i++)
    {
        if (OrderGetTicket(i) > 0)
        {
            if (OrderGetString(ORDER_SYMBOL) == _Symbol &&
                OrderGetInteger(ORDER_MAGIC) == MagicNumber &&
                OrderGetInteger(ORDER_TYPE) == orderType)
            {
                double price = OrderGetDouble(ORDER_PRICE_OPEN);
                if (MathAbs(price - targetPrice) <= tolerance)
                {
                    if (VerboseLog) Print("🔍 Ordine esistente trovato: Prezzo=", price);
                    return true;
                }
            }
        }
    }
    return false;
}

void PlacePendingOrders(double max, double min)
{
    if (!IsSpreadAcceptable())
    {
        if (VerboseLog) Print("❌ Spread non accettabile:", GetSpreadInPips(), " pips");
        return;
    }
    
    if (!IsVolatilityAcceptable())
    {
        if (VerboseLog) Print("❌ Volatilità ATR troppo bassa - Ordini sospesi");
        return;
    }
    
    if (!IsADXAcceptable())
    {
        if (VerboseLog) Print("❌ ADX insufficiente - Ordini sospesi");
        return;
    }
    
    double minDistance = MinDistancefromact * g_pricemolt * _Point;
    datetime expirationTime = TimeCurrent() + (int)(OrderExpirationHours * 3600);
    
    // Gestione ordine BUY
    if (max > 0 && Allowbuy && CountOrders(true, true) < MaxOpenOrders)
    {
        double entry_buy = max + buffer_buy * g_pricemolt * _Point;
        
        if (IsPriceLevelBlocked(entry_buy, true))
        {
            if (VerboseLog) Print("🚫 Ordine BUY NON piazzato - Livello bloccato a ", DoubleToString(entry_buy, _Digits));
            return;
        }
        
        if (entry_buy >= (g_askPrice + minDistance) && !OrderExistsAtPrice(entry_buy, ORDER_TYPE_BUY_STOP))
        {
            double sl_buy = (SL_factor <= 0) ? 0.0 : entry_buy - (SL_factor * g_pricemolt * _Point);
            double tp_buy = (TP_factor <= 0) ? 0.0 : entry_buy + (TP_factor * g_pricemolt * _Point);
            
            double stopLossPoints = SL_factor * g_pricemolt;
            double lotSize = CalculateLotSize(stopLossPoints);
            
            bool res = trade.BuyStop(lotSize, entry_buy, _Symbol, sl_buy, tp_buy, 
                                   ORDER_TIME_SPECIFIED, expirationTime, orderComment);
                                   
            Print("🟢 ENTRY BUY: ", entry_buy, " SL: ", sl_buy, " TP: ", tp_buy, " LOT: ", lotSize, " (Risk x", DoubleToString(g_currentRiskMultiplier, 2), ")");
            
            if (!res) 
                Print("Errore BuyStop: ", GetLastError());
            else
                AddUsedPriceLevel(entry_buy, true);
        }
    }
    
    // Gestione ordine SELL
    if (min > 0 && Allowsell && CountOrders(false, true) < MaxOpenOrders)
    {
        double entry_sell = min - buffer_sell * g_pricemolt * _Point;
        
        if (IsPriceLevelBlocked(entry_sell, false))
        {
            if (VerboseLog) Print("🚫 Ordine SELL NON piazzato - Livello bloccato a ", DoubleToString(entry_sell, _Digits));
            return;
        }
        
        if (entry_sell <= (g_bidPrice - minDistance) && !OrderExistsAtPrice(entry_sell, ORDER_TYPE_SELL_STOP))
        {
            double sl_sell = (SL_factor <= 0) ? 0.0 : entry_sell + (SL_factor * g_pricemolt * _Point);
            double tp_sell = (TP_factor <= 0) ? 0.0 : entry_sell - (TP_factor * g_pricemolt * _Point);
            
            double stopLossPoints = SL_factor * g_pricemolt;
            double lotSize = CalculateLotSize(stopLossPoints);
            
            bool res = trade.SellStop(lotSize, entry_sell, _Symbol, sl_sell, tp_sell,
                                    ORDER_TIME_SPECIFIED, expirationTime, orderComment);
                                    
            Print("🔴 ENTRY SELL: ", entry_sell, " SL: ", sl_sell, " TP: ", tp_sell, " LOT: ", lotSize, " (Risk x", DoubleToString(g_currentRiskMultiplier, 2), ")");
            
            if (!res)
                Print("Errore SellStop: ", GetLastError());
            else
                AddUsedPriceLevel(entry_sell, false);
        }
    }
}

void CancelPendingOrders()
{
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        ulong ticket = OrderGetTicket(i);
        if (ticket == 0) continue;
        
        if (OrderGetString(ORDER_SYMBOL) == _Symbol &&
            OrderGetInteger(ORDER_MAGIC) == MagicNumber)
        {
            ENUM_ORDER_TYPE orderType = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
            if (orderType == ORDER_TYPE_BUY_STOP || orderType == ORDER_TYPE_SELL_STOP)
            {
                bool res = trade.OrderDelete(ticket);
                if (!res)
                    Print("❌ Errore cancellazione ordine ", ticket, ": ", GetLastError());
                else
                    Print("✅ Ordine cancellato: ", ticket);
            }
        }
    }
}

void UpdatePendingOrders()
{
    // 1. Ricalcola i livelli (dalla cache se non c'e' una nuova barra chiusa)
    double bufferBuyPoints  = buffer_buy  * g_pricemolt * _Point;
    double bufferSellPoints = buffer_sell * g_pricemolt * _Point;
    UpdateLocalLevels();
    GetNextBreakoutLevels(true,  g_highLevelsforpending, bufferBuyPoints);
    GetNextBreakoutLevels(false, g_lowLevelsforpending,  bufferSellPoints);
    
    if (VerboseLog) Print("Livelli breakout aggiornati - Aggiorno ordini pendenti");
    
    // 2. Raccogli gli ordini pendenti esistenti
    double existingBuyPrices[];
    double existingSellPrices[];
    ulong  existingBuyTickets[];
    ulong  existingSellTickets[];
    
    for (int i = 0; i < OrdersTotal(); i++)
    {
        ulong ticket = OrderGetTicket(i);
        if (ticket == 0) continue;
        if (OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
        if (OrderGetInteger(ORDER_MAGIC)  != MagicNumber) continue;
        
        ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
        double price = OrderGetDouble(ORDER_PRICE_OPEN);
        
        if (ot == ORDER_TYPE_BUY_STOP)
        {
            int sz = ArraySize(existingBuyPrices);
            ArrayResize(existingBuyPrices,   sz + 1);
            ArrayResize(existingBuyTickets,  sz + 1);
            existingBuyPrices[sz]   = price - bufferBuyPoints;
            existingBuyTickets[sz]  = ticket;
        }
        else if (ot == ORDER_TYPE_SELL_STOP)
        {
            int sz = ArraySize(existingSellPrices);
            ArrayResize(existingSellPrices,  sz + 1);
            ArrayResize(existingSellTickets, sz + 1);
            existingSellPrices[sz]  = price + bufferSellPoints;
            existingSellTickets[sz] = ticket;
        }
    }
    
    // 3. Cancella ordini i cui livelli non esistono più
    for (int i = 0; i < ArraySize(existingBuyTickets); i++)
    {
        if (!ArrayContains(g_highLevelsforpending, existingBuyPrices[i]))
        {
            trade.OrderDelete(existingBuyTickets[i]);
            if (VerboseLog) Print("📝 Ordine cancellato (livello non più valido): ", existingBuyTickets[i]);
        }
    }
    for (int i = 0; i < ArraySize(existingSellTickets); i++)
    {
        if (!ArrayContains(g_lowLevelsforpending, existingSellPrices[i]))
        {
            trade.OrderDelete(existingSellTickets[i]);
            if (VerboseLog) Print("📝 Ordine cancellato (livello non più valido): ", existingSellTickets[i]);
        }
    }
    
    // 4. Piccola pausa per lasciar propagare le cancellazioni (invariata)
    Sleep(200);
    
    // 5. Piazza i livelli mancanti
    for (int i = 0; i < MaxPendingOrders && i < ArraySize(g_highLevelsforpending); i++)
    {
        if (!ArrayContains(existingBuyPrices, g_highLevelsforpending[i]))
            PlacePendingOrders(g_highLevelsforpending[i], 0.0);
    }
    for (int i = 0; i < MaxPendingOrders && i < ArraySize(g_lowLevelsforpending); i++)
    {
        if (!ArrayContains(existingSellPrices, g_lowLevelsforpending[i]))
            PlacePendingOrders(0.0, g_lowLevelsforpending[i]);
    }
}

//+------------------------------------------------------------------+
//| Funzioni di trailing e breakeven                                |
//+------------------------------------------------------------------+
void ApplyTrailingStop()
{
    if (!EnableTrailingStop) return;
    
    double stopLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
    
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (!PositionSelectByTicket(ticket) ||
            PositionGetInteger(POSITION_MAGIC) != MagicNumber ||
            PositionGetString(POSITION_SYMBOL) != _Symbol)
            continue;
        
        ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
        double posOpenPrice = PositionGetDouble(POSITION_PRICE_OPEN);
        double posSL = PositionGetDouble(POSITION_SL);
        double posTP = PositionGetDouble(POSITION_TP);
        
        double posCurrentPrice = (posType == POSITION_TYPE_BUY) ? g_bidPrice : g_askPrice;
        double posProfit = (posType == POSITION_TYPE_BUY) 
                          ? (posCurrentPrice - posOpenPrice) / _Point
                          : (posOpenPrice - posCurrentPrice) / _Point;
        
        if (TrailingMinAgeSeconds > 0)
        {
            datetime posOpenTime = (datetime)PositionGetInteger(POSITION_TIME);
            int ageSeconds = (int)(TimeCurrent() - posOpenTime);
            if (ageSeconds < TrailingMinAgeSeconds)
            {
                if (VerboseLog)
                    Print("⏱️ Trailing BLOCKed (Ticket=", ticket, 
                          "): età ", ageSeconds, "s < minimo ", TrailingMinAgeSeconds, "s");
                continue;
            }
        }
        
        if (posProfit < TrailingStartPips * g_pricemolt)
            continue;
        
        double desiredSL = 0.0;
        bool needUpdate = false;
        
        if (posType == POSITION_TYPE_BUY)
        {
            desiredSL = posCurrentPrice - TrailingStopPoints * g_pricemolt * _Point;
            double maxAllowedSL = posCurrentPrice - TrailingMaxDistancePips * g_pricemolt * _Point;
            
            if (desiredSL < maxAllowedSL) desiredSL = maxAllowedSL;
            
            needUpdate = (posSL < desiredSL - TrailingStepPoints * g_pricemolt * _Point || posSL == 0.0) &&
                        (posCurrentPrice - desiredSL) >= stopLevel;
        }
        else if (posType == POSITION_TYPE_SELL)
        {
            desiredSL = posCurrentPrice + TrailingStopPoints * g_pricemolt * _Point;
            double maxAllowedSL = posCurrentPrice + TrailingMaxDistancePips * g_pricemolt * _Point;
            
            if (desiredSL > maxAllowedSL) desiredSL = maxAllowedSL;
            
            needUpdate = (posSL > desiredSL + TrailingStepPoints * g_pricemolt * _Point || posSL == 0.0) &&
                        (desiredSL - posCurrentPrice) >= stopLevel;
        }
        
        if (needUpdate)
        {
            trade.PositionModify(ticket, desiredSL, posTP);
            if (VerboseLog)
                Print("Trailing ", (posType == POSITION_TYPE_BUY ? "BUY" : "SELL"), 
                      " - Ticket: ", ticket, " Nuovo SL: ", desiredSL);
        }
    }
}

void ApplyBreakeven()
{
    if (!EnableBreakeven) return;
    
    double stopLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
    
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (!PositionSelectByTicket(ticket) ||
            PositionGetInteger(POSITION_MAGIC) != MagicNumber ||
            PositionGetString(POSITION_SYMBOL) != _Symbol)
            continue;
        
        ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
        double posOpenPrice = PositionGetDouble(POSITION_PRICE_OPEN);
        double posSL = PositionGetDouble(POSITION_SL);
        double posTP = PositionGetDouble(POSITION_TP);
        
        double posCurrentPrice = (posType == POSITION_TYPE_BUY) ? g_bidPrice : g_askPrice;
        double posProfit = (posType == POSITION_TYPE_BUY)
                          ? (posCurrentPrice - posOpenPrice) / _Point
                          : (posOpenPrice - posCurrentPrice) / _Point;
        
        if (posProfit < BreakevenActivationPips * g_pricemolt)
            continue;
        
        double newSL;
        bool needUpdate = false;
        
        if (posType == POSITION_TYPE_BUY)
        {
            newSL = posOpenPrice + BreakevenExtraPips * g_pricemolt * _Point;
            needUpdate = posSL < newSL && (posCurrentPrice - newSL) >= stopLevel;
        }
        else if (posType == POSITION_TYPE_SELL)
        {
            newSL = posOpenPrice - BreakevenExtraPips * g_pricemolt * _Point;
            needUpdate = (posSL > newSL || posSL == 0.0) && (newSL - posCurrentPrice) >= stopLevel;
        }
        
        if (needUpdate)
        {
            trade.PositionModify(ticket, newSL, posTP);
            if (VerboseLog)
                Print("Breakeven ", (posType == POSITION_TYPE_BUY ? "BUY" : "SELL"), 
                      " - Ticket: ", ticket, " Nuovo SL: ", newSL);
        }
    }
}

void ApplyTrailingTakeProfit()
{
    if (!EnableTrailingTP || TrailingTPStartPips == 0) return;
    
    double stopLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
    
    for (int i = 0; i < PositionsTotal(); i++)
    {
        ulong ticket = PositionGetTicket(i);
        if (!PositionSelectByTicket(ticket) ||
            PositionGetInteger(POSITION_MAGIC) != MagicNumber ||
            PositionGetString(POSITION_SYMBOL) != _Symbol)
            continue;
        
        ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
        double posOpenPrice = PositionGetDouble(POSITION_PRICE_OPEN);
        double posTP = PositionGetDouble(POSITION_TP);
        double posSL = PositionGetDouble(POSITION_SL);
        
        double posCurrentPrice = (posType == POSITION_TYPE_BUY) ? g_bidPrice : g_askPrice;
        double posProfit = (posType == POSITION_TYPE_BUY)
                          ? (posOpenPrice - posCurrentPrice) / _Point
                          : (posCurrentPrice - posOpenPrice) / _Point;
        
        if (posProfit < TrailingTPStartPips * g_pricemolt)
            continue;
        
        double newTP;
        bool needUpdate = false;
        
        if (posType == POSITION_TYPE_BUY)
        {
            newTP = posCurrentPrice + TrailingTPDistancePips * g_pricemolt * _Point;
            needUpdate = (newTP - posCurrentPrice >= stopLevel) && 
                        (posTP == 0.0 || newTP < posTP);
        }
        else if (posType == POSITION_TYPE_SELL)
        {
            newTP = posCurrentPrice - TrailingTPDistancePips * g_pricemolt * _Point;
            needUpdate = (posCurrentPrice - newTP >= stopLevel) && 
                        (posTP == 0.0 || newTP > posTP);
        }
        
        if (needUpdate)
        {
            trade.PositionModify(ticket, posSL, newTP);
            if (VerboseLog)
                Print("Trailing TP ", (posType == POSITION_TYPE_BUY ? "BUY" : "SELL"), 
                      " - Ticket: ", ticket, " Nuovo TP: ", newTP);
        }
    }
}

//+------------------------------------------------------------------+
//| Eventi principali                                               |
//+------------------------------------------------------------------+
int OnInit()
{
    g_isTester = (bool)MQLInfoInteger(MQL_TESTER);
    g_testStartTime = 0; // impostato al primo tick (inizio reale del test/forward)
    g_currentRiskMultiplier = 1.0;
    g_lastTickMinute = -1;
    g_levelsValid = false;
    
    // v1.4.1: scaling calcolato subito (e ricalcolato a ogni avvio)
    g_pricemolt = 1.0;
    g_scalingReady = false;
    g_lastCheckedDay = 0;
    UpdateDailyScaling();
    
    trade.SetExpertMagicNumber(MagicNumber);
    
    // Handle indicatori creati una sola volta (v1.3 li creava/distruggeva ad ogni controllo)
    if (UseATRFilter)
        g_atrFilterHandle = iATR(_Symbol, userTimeframe, ATRPeriod);
    if (UseADXFilter)
        g_adxFilterHandle = iADX(_Symbol, ADXTimeframe, ADXPeriod_Filter);
    
    Print("== STATO FILTRI EA (v1.4.1) ==");
    Print("Magic: ", MagicNumber, " | Commento: ", orderComment);
    Print("Filtro ATR Volatilità: ", (UseATRFilter ? "ATTIVO" : "DISATTIVO"));
    if (UseATRFilter)
        Print("   ATR minimo richiesto: ", MinATRMultiplier, " pips");
    Print("Filtro ADX: ", (UseADXFilter ? "ATTIVO" : "DISATTIVO"));
        
    Print("Filtro Performance Dinamico: ", (UsePerformanceFilter ? "ATTIVO" : "DISATTIVO"));
    if (UsePerformanceFilter)
    {
        Print("   Finestra analisi: ", LookbackWindow, " trade | Soglie: ", LossThreshold, " loss → ", DoubleToString(RiskReductionFactor, 2), "x | ", 
              WinThreshold, " win → ", DoubleToString(RiskIncreaseFactor, 2), "x");
        Print("   Limiti rischio: ", DoubleToString(MinRiskMultiplier, 2), "x - ", DoubleToString(MaxRiskMultiplier, 2), "x");
    }
    
    Print("SL/TP Settings: SL=", SL_factor, " punti | TP=", TP_factor, " punti");
    Print("Scaling: ", (UseATRScaling ? "ATR-based (ATRDefault=" + DoubleToString(ATRDefault,1) + " pips)" : "Prezzo base (defaultprice=" + DoubleToString(defaultprice,2) + ")"));
    Print("Auto-Close per Tempo: ", (EnableAutoCloseAfterTime ? "ATTIVO" : "DISATTIVO"));
    if (EnableAutoCloseAfterTime)
        Print("   Tempo impostato: ", AutoCloseHours, " ore e ", AutoCloseMinutes, " minuti");
    if (!g_isTester)
        Print("Blocco da variabili globali: ", GV_NEWS_ACTIVE, " (news) e ", GV_TRADING_PAUSE, " (pausa TradingGuard)");
    
    Print("EA inizializzato correttamente");
    return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
    if (g_scalingATRHandle != INVALID_HANDLE) { IndicatorRelease(g_scalingATRHandle); g_scalingATRHandle = INVALID_HANDLE; }
    if (g_atrFilterHandle  != INVALID_HANDLE) { IndicatorRelease(g_atrFilterHandle);  g_atrFilterHandle  = INVALID_HANDLE; }
    if (g_adxFilterHandle  != INVALID_HANDLE) { IndicatorRelease(g_adxFilterHandle);  g_adxFilterHandle  = INVALID_HANDLE; }
    
    highLevels.Clear();
    lowLevels.Clear();
    
    ArrayFree(g_highLevelsforpending);
    ArrayFree(g_lowLevelsforpending);
    ArrayFree(g_recentTrades);
    ArrayFree(g_usedPriceLevels);
    ArrayFree(g_positionTimers);
    
    Print("EA deinizializzato");
}

void OnTick()
{
    if (g_testStartTime == 0) g_testStartTime = TimeCurrent();
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // BLOCCHI ESTERNI (solo live: nel tester le variabili globali
    // del terminale non esistono, quindi non si leggono nemmeno)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    static bool s_wasNewsActive = false;
    static bool s_wasPaused = false;
    bool newsActive = false;
    bool paused = false;
    
    if (!g_isTester)
    {
        newsActive = (GlobalVariableGet(GV_NEWS_ACTIVE) == 1.0);
        paused     = (GlobalVariableGet(GV_TRADING_PAUSE) == 1.0);
    }

    // --- NewsGuard: comportamento invariato (stop totale durante la finestra) ---
    // v1.4.1: scaling aggiornato prima di qualunque calcolo di lotti/distanze
    UpdateDailyScaling();
    if (!g_scalingReady) return;
    
    if (newsActive && !s_wasNewsActive)
        Print("🚫 NewsGuard: Finestra news attiva - ordini pendenti bloccati.");

    if (!newsActive && s_wasNewsActive)
    {
        Print("✅ NewsGuard: Finestra terminata - ripiazzo ordini pendenti.");
        if (!paused)
        {
            UpdateMarketData(); // v1.4: prezzi aggiornati prima di ripiazzare
            UpdatePendingOrders();
        }
    }
    s_wasNewsActive = newsActive;

    if (newsActive) return;
    
    // --- Pausa TradingGuard: niente nuovi ordini, posizioni aperte gestite ---
    if (paused && !s_wasPaused)
        Print("⏸️ TRADING_PAUSED: nessun nuovo ordine (BE/trailing/chiusure restano attivi).");
    if (!paused && s_wasPaused)
    {
        Print("▶️ TRADING_PAUSED rimossa: ripiazzo ordini pendenti.");
        g_forceOrderUpdate = true;
    }
    s_wasPaused = paused;
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    UpdateMarketData();
    
    datetime now = TimeCurrent();
    
    // Una nuova barra (M1 o superiore) puo' nascere solo al cambio di minuto.
    // Nel tester si salta quindi ogni iTime() sui tick dello stesso minuto:
    // risultato identico, molte meno chiamate. In live si controlla ogni tick.
    long curMinute = (long)(now / 60);
    bool newMinute = (curMinute != g_lastTickMinute);
    g_lastTickMinute = curMinute;
    bool checkBars = (newMinute || !g_isTester);
    
    // Giorno/orario consentiti: dipendono solo da giorno/ora/minuto → cache per minuto
    if (newMinute)
    {
        g_dayAllowedCache  = IsTradingDayAllowed();
        g_hourAllowedCache = IsTradingAllowedbyhour();
    }
    
    // Aggiornamento volumi ordini pendenti (ogni 12 ore)
    if (!paused && now - g_lastVolumeUpdateTime >= 43200)
    {
        g_lastVolumeUpdateTime = now;
        if (VerboseLog) Print("📊 Aggiornamento volumi ordini pendenti");
        UpdatePendingOrdersVolume();
    }
    
    // Pulizia periodica dei livelli scaduti (ogni ora)
    static datetime lastCleanupTime = 0;
    if (now - lastCleanupTime > 3600)
    {
        CleanupExpiredLevels();
        lastCleanupTime = now;
        
        static datetime lastStatusTime = 0;
        if (now - lastStatusTime > 14400)
        {
            if (VerboseLog) PrintBlockedLevelsStatus();
            lastStatusTime = now;
        }
    }
    
    // v1.4.1: aggiornamento di g_pricemolt spostato all'inizio di OnTick
    
    if (!g_dayAllowedCache) return;
    
    // Controllo chiusure automatiche per tempo (ogni minuto)
    static datetime lastAutoCloseCheck = 0;
    if (now - lastAutoCloseCheck > 60)
    {
        CheckAutoClosePositions();
        lastAutoCloseCheck = now;
    }
    
    if (!g_hourAllowedCache)
    {
        CancelPendingOrders();
        if (closetradeshour) CloseAllTrades();
        return;
    }
    
    // Gestione SL/TP
    if (checkBars || Checkevrytick)
    {
        datetime currentBarTimeSLTP = iTime(_Symbol, customTimeframeSLTP, 0);
        if (currentBarTimeSLTP != g_lastCheckedBarTimeSLTP || Checkevrytick)
        {
            g_lastCheckedBarTimeSLTP = currentBarTimeSLTP;
            if (PositionsTotal() > 0)
            {
                ApplyBreakeven();
                ApplyTrailingStop();
                ApplyTrailingTakeProfit();
            }
        }
    }
    
    // Aggiornamento ordini pendenti ad ogni nuova barra di customTimeframe
    // (v1.3 ricalcolava i livelli anche su ogni barra di userTimeframe:
    //  era lavoro inutile, UpdatePendingOrders li ricalcola comunque)
    if (checkBars || g_forceOrderUpdate)
    {
        datetime currentBarTimeOrder = iTime(_Symbol, customTimeframe, 0);
        bool newOrderBar = (currentBarTimeOrder != g_lastCheckedBarTimeOrder);
        if (newOrderBar)
            g_lastCheckedBarTimeOrder = currentBarTimeOrder;
        
        if (!paused && (newOrderBar || g_forceOrderUpdate))
        {
            g_forceOrderUpdate = false;
            UpdatePendingOrders();
        }
    }
}

void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
    // === TRACKING TIMER AUTO-CLOSE ===
    if (EnableAutoCloseAfterTime && trans.type == TRADE_TRANSACTION_DEAL_ADD)
    {
        ulong deal = trans.deal;
        if (!HistoryDealSelect(deal)) return;
        
        long deal_magic = HistoryDealGetInteger(deal, DEAL_MAGIC);
        if (deal_magic != MagicNumber) return;
        
        long deal_entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
        long deal_type = HistoryDealGetInteger(deal, DEAL_TYPE);
        
        if (deal_entry == DEAL_ENTRY_IN && 
            (deal_type == DEAL_TYPE_BUY || deal_type == DEAL_TYPE_SELL))
        {
            ulong position_id = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
            datetime openTime = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
            AddPositionTimer(position_id, openTime);
        }
        else if (deal_entry == DEAL_ENTRY_OUT && 
                 (deal_type == DEAL_TYPE_SELL || deal_type == DEAL_TYPE_BUY))
        {
            ulong position_id = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
            RemovePositionTimer(position_id);
        }
    }
    
    // === FILTRO PERFORMANCE ===
    if (UsePerformanceFilter && trans.type == TRADE_TRANSACTION_DEAL_ADD)
    {
        ulong deal = trans.deal;
        
        if (!HistoryDealSelect(deal)) return;
        
        long deal_magic = HistoryDealGetInteger(deal, DEAL_MAGIC);
        if (deal_magic != MagicNumber) return;
        
        long deal_entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
        if (deal_entry != DEAL_ENTRY_OUT) return;
        
        long deal_type = HistoryDealGetInteger(deal, DEAL_TYPE);
        if (deal_type != DEAL_TYPE_SELL && deal_type != DEAL_TYPE_BUY) return;
        
        ulong position_id = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
        double profit = HistoryDealGetDouble(deal, DEAL_PROFIT);
        datetime closeTime = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
        
        AddTradeResult(position_id, profit, closeTime);
    }
}

//+------------------------------------------------------------------+
//| Livelli di prezzo bloccati                                       |
//+------------------------------------------------------------------+
void AddUsedPriceLevel(double price, bool isBuyLevel)
{
    CleanupExpiredLevels();
    
    int size = ArraySize(g_usedPriceLevels);
    ArrayResize(g_usedPriceLevels, size + 1);
    
    g_usedPriceLevels[size] = UsedPriceLevel(price, TimeCurrent(), isBuyLevel);
    
    if (VerboseLog)
        Print("📌 LIVELLO BLOCCATO: ", (isBuyLevel ? "BUY" : "SELL"), 
              " a ", DoubleToString(price, _Digits), 
              " per ", BlockedLevelHours, " ore");
}

void CleanupExpiredLevels()
{
    datetime currentTime = TimeCurrent();
    int expirationSeconds = BlockedLevelHours * 3600;
    
    for (int i = ArraySize(g_usedPriceLevels) - 1; i >= 0; i--)
    {
        if ((currentTime - g_usedPriceLevels[i].useTime) > expirationSeconds)
        {
            if (VerboseLog)
                Print("🧹 Livello scaduto rimosso: ", 
                      (g_usedPriceLevels[i].isBuyLevel ? "BUY" : "SELL"),
                      " a ", DoubleToString(g_usedPriceLevels[i].price, _Digits));
            
            for (int j = i; j < ArraySize(g_usedPriceLevels) - 1; j++)
                g_usedPriceLevels[j] = g_usedPriceLevels[j + 1];
            ArrayResize(g_usedPriceLevels, ArraySize(g_usedPriceLevels) - 1);
        }
    }
}

bool IsPriceLevelBlocked(double price, bool isBuyLevel)
{
    CleanupExpiredLevels();
    
    double bufferDistance = BlockedLevelBufferPips * g_pricemolt * _Point;
    
    for (int i = 0; i < ArraySize(g_usedPriceLevels); i++)
    {
        if (g_usedPriceLevels[i].isBuyLevel != isBuyLevel)
            continue;
            
        if (MathAbs(price - g_usedPriceLevels[i].price) <= bufferDistance)
        {
            if (VerboseLog)
            {
                datetime remainingTime = g_usedPriceLevels[i].useTime + (BlockedLevelHours * 3600) - TimeCurrent();
                int remainingHours = (int)(remainingTime / 3600);
                int remainingMinutes = (int)((remainingTime % 3600) / 60);
                
                Print("🚫 LIVELLO BLOCCATO: ", (isBuyLevel ? "BUY" : "SELL"), 
                      " a ", DoubleToString(price, _Digits),
                      " troppo vicino a livello usato a ", DoubleToString(g_usedPriceLevels[i].price, _Digits),
                      " (Rimangono ", remainingHours, "h ", remainingMinutes, "m)");
            }
            return true;
        }
    }
    
    return false;
}

void PrintBlockedLevelsStatus()
{
    CleanupExpiredLevels();
    
    int totalLevels = ArraySize(g_usedPriceLevels);
    if (totalLevels == 0)
    {
        Print("📋 Nessun livello di prezzo attualmente bloccato");
        return;
    }
    
    Print("📋 LIVELLI BLOCCATI ATTIVI (", totalLevels, "):");
    
    for (int i = 0; i < totalLevels; i++)
    {
        datetime remainingTime = g_usedPriceLevels[i].useTime + (BlockedLevelHours * 3600) - TimeCurrent();
        int remainingHours = (int)(remainingTime / 3600);
        int remainingMinutes = (int)((remainingTime % 3600) / 60);
        
        Print("   ", (g_usedPriceLevels[i].isBuyLevel ? "BUY " : "SELL"), 
              " a ", DoubleToString(g_usedPriceLevels[i].price, _Digits),
              " (", remainingHours, "h ", remainingMinutes, "m rimanenti)");
    }
}

//+------------------------------------------------------------------+
//| Chiusura automatica per tempo                                    |
//+------------------------------------------------------------------+
void AddPositionTimer(ulong ticket, datetime openTime)
{
    if (!EnableAutoCloseAfterTime) return;
    
    int size = ArraySize(g_positionTimers);
    ArrayResize(g_positionTimers, size + 1);
    g_positionTimers[size] = SimplePositionTimer(ticket, openTime);
    
    if (VerboseLog)
        Print("⏰ Timer aggiunto: Ticket=", ticket, " - Chiusura prevista dopo ", 
              AutoCloseHours, "h ", AutoCloseMinutes, "m");
}

void RemovePositionTimer(ulong ticket)
{
    for (int i = ArraySize(g_positionTimers) - 1; i >= 0; i--)
    {
        if (g_positionTimers[i].ticket == ticket)
        {
            for (int j = i; j < ArraySize(g_positionTimers) - 1; j++)
                g_positionTimers[j] = g_positionTimers[j + 1];
            ArrayResize(g_positionTimers, ArraySize(g_positionTimers) - 1);
            if (VerboseLog) Print("🗑️ Timer rimosso: Ticket=", ticket);
            return;
        }
    }
}

void CheckAutoClosePositions()
{
    if (!EnableAutoCloseAfterTime) return;
    
    int autoCloseSeconds = AutoCloseHours * 3600 + AutoCloseMinutes * 60;
    datetime currentTime = TimeCurrent();
    
    for (int i = ArraySize(g_positionTimers) - 1; i >= 0; i--)
    {
        ulong ticket = g_positionTimers[i].ticket;
        datetime openTime = g_positionTimers[i].openTime;
        
        if (!PositionSelectByTicket(ticket))
        {
            RemovePositionTimer(ticket);
            continue;
        }
        
        int elapsedSeconds = (int)(currentTime - openTime);
        if (elapsedSeconds >= autoCloseSeconds)
        {
            bool result = trade.PositionClose(ticket);
            
            if (result)
            {
                double profit = PositionGetDouble(POSITION_PROFIT);
                Print("⏰ CHIUSURA AUTOMATICA: Ticket=", ticket, 
                      " dopo ", (elapsedSeconds/3600), "h ", ((elapsedSeconds%3600)/60), "m",
                      " - Profit: $", DoubleToString(profit, 2));
                RemovePositionTimer(ticket);
            }
            else
            {
                Print("❌ Errore chiusura automatica Ticket=", ticket, ": ", GetLastError());
            }
        }
    }
}

//+------------------------------------------------------------------+
//| Aggiorna il volume degli ordini pendenti                          |
//+------------------------------------------------------------------+
void UpdatePendingOrdersVolume()
{
    if (!adjustlotsizevariables && lotMethod == FixedLot) return;
    
    for (int i = OrdersTotal() - 1; i >= 0; i--)
    {
        ulong ticket = OrderGetTicket(i);
        if (ticket == 0) continue;
        if (OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
        if (OrderGetInteger(ORDER_MAGIC)  != MagicNumber) continue;
        
        ENUM_ORDER_TYPE orderType = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
        if (orderType != ORDER_TYPE_BUY_STOP && orderType != ORDER_TYPE_SELL_STOP) continue;
        
        double currentVolume = OrderGetDouble(ORDER_VOLUME_CURRENT);
        double entryPrice    = OrderGetDouble(ORDER_PRICE_OPEN);
        double sl            = OrderGetDouble(ORDER_SL);
        double tp            = OrderGetDouble(ORDER_TP);
        datetime expiration  = (datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);
        
        double slPoints = (sl == 0.0)
            ? SL_factor * g_pricemolt
            : MathAbs(entryPrice - sl) / _Point;
        
        double newVolume = CalculateLotSize(slPoints);
        
        if (MathAbs(newVolume - currentVolume) <= currentVolume * 0.02) continue;
        
        double minDist = MinDistancefromact * g_pricemolt * _Point;
        bool priceTooClose = (orderType == ORDER_TYPE_BUY_STOP)
            ? (entryPrice <= g_askPrice + minDist)
            : (entryPrice >= g_bidPrice - minDist);
        
        if (priceTooClose)
        {
            if (VerboseLog)
                Print("⚠️ Volume non aggiornato per ordine ", ticket, 
                      " - prezzo troppo vicino (", DoubleToString(entryPrice, _Digits), ")");
            continue;
        }
        
        bool newOrderPlaced = false;
        
        if (orderType == ORDER_TYPE_BUY_STOP)
            newOrderPlaced = trade.BuyStop(newVolume, entryPrice, _Symbol, sl, tp,
                                           ORDER_TIME_SPECIFIED, expiration, orderComment);
        else
            newOrderPlaced = trade.SellStop(newVolume, entryPrice, _Symbol, sl, tp,
                                            ORDER_TIME_SPECIFIED, expiration, orderComment);
        
        if (newOrderPlaced)
        {
            Sleep(100);
            if (trade.OrderDelete(ticket))
                Print("🔄 Ordine ", ticket, " aggiornato volume: ", 
                      currentVolume, " → ", newVolume);
            else
                Print("⚠️ Nuovo ordine piazzato ma vecchio ", ticket, 
                      " non cancellato - duplicato temporaneo, verrà rimosso al prossimo ciclo");
        }
        else
        {
            Print("❌ Impossibile ricreare ordine per aggiornamento volume su ", 
                  DoubleToString(entryPrice, _Digits), 
                  " - vecchio ordine ", ticket, " mantenuto (errore: ", GetLastError(), ")");
        }
    }
}
//+------------------------------------------------------------------+
//| Fine Expert Advisor                                             |
//+------------------------------------------------------------------+