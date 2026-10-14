//+------------------------------------------------------------------+
//|                                              TradingGuard_EA.mq5 |
//|              NewsGuard + LiveMonitor unificato - v1.3             |
//|  Funzionalità:                                                   |
//|  - Protezione news (cancella pendenti / chiude trade / rimuove TP)|
//|  - Salvataggio e ripristino automatico pendenti dopo la news     |
//|  - Gestione posizioni con SL in profit (trailing) prima della news|
//|  - Limite max ordini aperti contemporaneamente                   |
//|  - Pausa trading da dashboard (cancella pendenti)                |
//|  - Kill switch da dashboard (chiude tutte le posizioni)          |
//|  - Snapshot live e polling comandi verso dashboard               |
//|  - [NUOVO v1.3] RISK GUARD per prop firm:                        |
//|      * stop perdita giornaliera (calcolo stile GFT/FTMO/TTP)     |
//|      * stop perdita massima (statica o trailing EOD con tetto)   |
//|      * stop perdita flottante combinata (stile Goat Guard GFT)   |
//|      * blocco trading fino al reset giornaliero (o permanente)   |
//+------------------------------------------------------------------+
#property copyright   "TradingGuard EA v1.3"
#property description "NewsGuard + LiveMonitor + RiskGuard unificato"
#property version     "1.30"
#property strict

#include <Trade\Trade.mqh>
CTrade trade;

//==========================================================================
// INPUT PARAMETERS
//==========================================================================

// ─────────────────────────────────────────────────────────────────────────
// SEZIONE 1 — FILTRO NEWS
// ─────────────────────────────────────────────────────────────────────────
input group "━━━ [NEWS] Attivazione ━━━"
input bool   InpNewsEnabled       = false;
// ^ TRUE = attiva protezione news | FALSE = ignora completamente le news

input group "━━━ [NEWS] Valuta e Calendario ━━━"
input string InpNewsCountry       = "USD";
// ^ Valuta di riferimento da monitorare (es. USD, EUR, GBP).
// ^ Per più valute usa la virgola: "USD,EUR,GBP"
input int    InpRefreshMinutes    = 60;
// ^ Aggiorna il calendario ogni N minuti
input string InpFFUrl_Info        = "https://nfs.faireconomy.media";
// ^ ↑ Copia questo URL in: Strumenti > Opzioni > Consiglieri Esperti > URL consentiti

input group "━━━ [NEWS] Finestra Temporale ━━━"
input int    InpMinutesBefore     = 5;
// ^ Minuti PRIMA della news in cui scatta la protezione
input int    InpMinutesAfter      = 5;
// ^ Minuti DOPO la news in cui la protezione rimane attiva
input int    InpCancelIntervalSec = 2;
// ^ Frequenza di controllo/cancellazione periodica durante la finestra (secondi).
// ^ Rete di sicurezza secondaria: la protezione primaria è OnTradeTransaction() (istantanea),
// ^ questo polling copre solo eventuali eventi persi.

input group "━━━ [NEWS] Azione sui Pendenti ━━━"
input bool   InpNewsDeletePending = true;
// ^ TRUE = cancella gli ordini pendenti durante la finestra news

input group "━━━ [NEWS] Protezione Istantanea (OnTradeTransaction) ━━━"
input bool   InpNewsInstantCancel = true;
// ^ TRUE = appena un EA piazza un pendente durante la finestra news, viene cancellato
// ^ immediatamente (evento del server), invece di aspettare il prossimo giro di polling.
input bool   InpNewsInstantClose  = true;
// ^ TRUE = se nonostante tutto un pendente viene ATTIVATO (diventa posizione) durante la
// ^ finestra news, la posizione viene chiusa immediatamente in emergenza.

input group "━━━ [NEWS] Ripristino Pendenti dopo la Finestra ━━━"
input bool   InpNewsRestorePending    = true;
// ^ TRUE = salva i pendenti cancellati per news e li ricrea identici (stesso magic number,
// ^ prezzo, SL/TP, scadenza) non appena la finestra news termina.
// ^ FALSE = comportamento precedente: i pendenti cancellati NON vengono ripristinati da questo EA.
input double InpRestoreTolerancePips = 5.0;
// ^ Tolleranza (in PIP, non punti grezzi — indipendente dal simbolo) usata per capire se un
// ^ pendente con lo stesso magic number/simbolo/tipo è già stato ricreato da un altro EA
// ^ (es. l'EA madre che lo ha generato originariamente). Se trovato un pendente "equivalente"
// ^ entro questa distanza, NON viene ricreato un duplicato.
// ^ Es: 5 pip su XAUUSD (point=0.01) = $0.50 | su EURUSD (point=0.00001) = 0.00050.

input group "━━━ [NEWS] Azione sulle Posizioni Aperte ━━━"
enum ENUM_NEWS_POS_ACTION
{
   NEWS_POS_NOTHING,    // Nessuna azione (lascia i trade aperti intatti)
   NEWS_POS_REMOVE_TP,  // Rimuovi TP durante la finestra e ripristinalo dopo
   NEWS_POS_CLOSE       // Chiudi le posizioni aperte all'inizio della finestra
};
input ENUM_NEWS_POS_ACTION InpNewsPosAction = NEWS_POS_NOTHING;
// ^ Cosa fare con le posizioni già aperte quando scatta la finestra news

input group "━━━ [NEWS] Stop Loss in Profit (Trailing) ━━━"
enum ENUM_NEWS_PROFIT_SL_ACTION
{
   PROFIT_SL_NOTHING,    // Nessuna azione specifica
   PROFIT_SL_CLOSE,      // Chiudi le posizioni con SL già in profit (trailing) prima della news
   PROFIT_SL_BREAKEVEN   // Sposta lo SL a breakeven (prezzo apertura) prima della news
};
input ENUM_NEWS_PROFIT_SL_ACTION InpNewsProfitSLAction = PROFIT_SL_NOTHING;
// ^ Gestisce le posizioni il cui Stop Loss è già stato portato in profitto dal trailing stop.
// ^ Questa azione viene eseguita ALL'INGRESSO della finestra news, PRIMA della logica
// ^ [NEWS] Azione sulle Posizioni Aperte, e riguarda solo le posizioni con SL "in the money".
// ^ NOTHING     = non fare nulla (queste posizioni seguono la logica generale sopra)
// ^ CLOSE       = chiudi subito queste posizioni (incassa il profitto garantito dal trailing)
// ^ BREAKEVEN   = sposta lo SL esattamente al prezzo di apertura (lascia correre la posizione
// ^               ma rimuove il profitto già garantito, per evitare uno stop "a mercato" fuori
// ^               controllo durante lo spike di news)

input group "━━━ [NEWS] Notifica GlobalVariable ━━━"
input bool   InpGlobalVarNotify   = true;
// ^ Scrive GlobalVariable "NewsGuard_Active" = 1 durante la finestra
// ^ (leggibile dagli altri EA per logiche personalizzate)

// ─────────────────────────────────────────────────────────────────────────
// SEZIONE 2 — CHIUSURA VENERDÌ
// ─────────────────────────────────────────────────────────────────────────
input group "━━━ [VENERDÌ] Chiusura Fine Settimana ━━━"
input bool   InpFridayCloseEnabled  = false;
// ^ TRUE = chiude tutti i trade aperti il venerdì all'ora specificata
input int    InpFridayCloseHour     = 21;
// ^ Ora di chiusura (server time) — es. 21 = alle 21:00
input int    InpFridayCloseMinute   = 0;
// ^ Minuto di chiusura — es. 0 = alle 21:00 esatte
input bool   InpFridayDeletePending = true;
// ^ TRUE = cancella anche tutti gli ordini pendenti insieme alla chiusura

// ─────────────────────────────────────────────────────────────────────────
// SEZIONE 2B — RISK GUARD (limiti prop firm)  [NUOVO v1.3]
// Lavora sempre su TUTTO il conto (tutti i simboli e tutti i magic number),
// indipendentemente dal filtro simbolo della sezione ordini.
// ─────────────────────────────────────────────────────────────────────────
input group "━━━ [RISK GUARD] Attivazione ━━━"
input bool   InpRGEnabled          = false;
// ^ TRUE = attiva i blocchi di rischio (perdita giornaliera / massima / flottante)
input double InpRGInitialBalance   = 0.0;
// ^ Saldo INIZIALE del conto prop (es. 50000). 0 = usa il balance al primo avvio
// ^ (viene salvato e riusato ai riavvii). Meglio impostarlo a mano.
input bool   InpRGResetHalt        = false;
// ^ Metti TRUE per UN riavvio per sbloccare manualmente un blocco permanente
// ^ (es. dopo lo stop sulla perdita massima), poi rimettilo a FALSE.
input bool   InpRGPushNotify       = true;
// ^ TRUE = invia notifica push MT5 (smartphone) quando scatta un blocco

input group "━━━ [RISK GUARD] Perdita Giornaliera ━━━"
enum ENUM_RG_DAILY_BASE
{
   RG_BASE_MAX_BAL_EQ,  // Maggiore tra Balance ed Equity al reset (GFT)
   RG_BASE_BALANCE,     // Balance al reset (FTMO, TTP, The5ers...)
   RG_BASE_EQUITY       // Equity al reset
};
input ENUM_RG_DAILY_BASE InpRGDailyBase = RG_BASE_MAX_BAL_EQ;
// ^ Valore "di partenza" della giornata da cui si sottrae la perdita massima consentita
enum ENUM_RG_DAILY_PCT_OF
{
   RG_PCT_OF_DAY_REF,   // % del valore di partenza della giornata (GFT)
   RG_PCT_OF_INITIAL    // % del saldo iniziale, importo fisso (FTMO, TTP)
};
input ENUM_RG_DAILY_PCT_OF InpRGDailyPctOf = RG_PCT_OF_DAY_REF;
// ^ Su cosa si calcola la % di perdita giornaliera consentita
input double InpRGDailyLimitPct    = 5.0;
// ^ Limite giornaliero della prop in % (es. 5 per GFT 2-step Standard). 0 = disattivato
input double InpRGDailyStopAtPct   = 80.0;
// ^ Il blocco scatta quando si è consumato questo % del limite (80 = a -4% se il limite è 5%)
enum ENUM_RG_TZ
{
   RG_TZ_NEWYORK,       // New York (EST/EDT, ora legale USA)
   RG_TZ_CHICAGO,       // Chicago (CST/CDT, ora legale USA)
   RG_TZ_CET,           // Europa centrale (CET/CEST)
   RG_TZ_UTC,           // UTC
   RG_TZ_SERVER         // Ora del server del broker
};
input ENUM_RG_TZ InpRGResetTZ      = RG_TZ_NEWYORK;
// ^ Fuso orario in cui la prop ricalcola il limite giornaliero
input int    InpRGResetHour        = 17;
input int    InpRGResetMinute      = 0;
// ^ Ora del reset giornaliero nel fuso scelto (GFT: 17:00 New York | TTP: 16:15 Chicago | FTMO: 00:00 CET)

input group "━━━ [RISK GUARD] Perdita Massima ━━━"
enum ENUM_RG_MAX_TYPE
{
   RG_MAX_STATIC,       // Statica dal saldo iniziale (GFT, FTMO)
   RG_MAX_TRAIL_EOD     // Trailing sul balance di fine giornata, bloccata al saldo iniziale (TTP 100k+)
};
input ENUM_RG_MAX_TYPE InpRGMaxType = RG_MAX_STATIC;
input double InpRGMaxLimitPct      = 10.0;
// ^ Perdita massima della prop in % del saldo iniziale. 0 = disattivato
input double InpRGMaxStopAtPct     = 90.0;
// ^ Il blocco (PERMANENTE fino a sblocco manuale) scatta quando si è consumato questo % del limite

input group "━━━ [RISK GUARD] Perdita Flottante (Goat Guard) ━━━"
input double InpRGFloatLimitPct    = 0.0;
// ^ Soglia della prop sulla perdita flottante COMBINATA delle posizioni aperte, in % del saldo
// ^ iniziale (GFT funded: 2). 0 = disattivato (es. in challenge)
input double InpRGFloatStopAtPct   = 85.0;
// ^ Chiude tutto quando la perdita flottante raggiunge questo % della soglia (85 = -1.7% se soglia 2%)
input bool   InpRGFloatHaltDay     = true;
// ^ TRUE = dopo lo stop flottante blocca il trading fino al prossimo reset giornaliero

// ─────────────────────────────────────────────────────────────────────────
// SEZIONE 3 — GESTIONE ORDINI (indipendente dalle news)
// ─────────────────────────────────────────────────────────────────────────
input group "━━━ [ORDINI] Filtro Simbolo ━━━"
input bool   InpFilterSymbol      = false;
// ^ FALSE = agisce su TUTTI i simboli del conto
// ^ TRUE  = agisce solo sul simbolo specificato sotto
input string InpSymbol            = "";
// ^ Simbolo target (lascia vuoto per usare il simbolo del chart corrente)

input group "━━━ [ORDINI] Limite Posizioni Aperte ━━━"
input int    InpMaxOpenTrades     = 0;
// ^ Numero massimo di posizioni aperte contemporaneamente
// ^ 0 = disabilitato | Es: 1 = se c'è già 1 trade aperto, cancella tutti i pendenti

// ─────────────────────────────────────────────────────────────────────────
// SEZIONE 3 — DASHBOARD / BACKEND
// ─────────────────────────────────────────────────────────────────────────
input group "━━━ [DASHBOARD] Connessione ━━━"
input bool   InpEnableDashboard   = true;
// ^ TRUE = abilita comunicazione con la dashboard (snapshot + comandi)
input string AccountID            = "MY_ACCOUNT_01";
// ^ ID account (deve corrispondere a quello configurato nel backend)
input string BackendURL           = "https://trading-dashboard-1qnr.onrender.com";
// ^ URL backend (senza slash finale)
input string InpBackendUrl_Info   = "https://trading-dashboard-1qnr.onrender.com";
// ^ ↑ Copia questo URL in: Strumenti > Opzioni > Consiglieri Esperti > URL consentiti
input string APIKey               = "td_sk_2024_xauusd_dashboard_abc123";
// ^ Chiave API per autenticazione

input group "━━━ [DASHBOARD] Snapshot ━━━"
input int    SendIntervalMin      = 5;
// ^ Ogni quanti minuti inviare lo snapshot al backend

//==========================================================================
// STRUTTURE E VARIABILI GLOBALI
//==========================================================================

struct NewsEvent
{
   datetime utcTime;
   string   country;
   string   title;
};

// --- Pendenti salvati per il ripristino post-news
struct SavedPendingOrder
{
   string              symbol;
   ENUM_ORDER_TYPE     type;
   ulong               magic;
   double              volume;
   double              price;       // prezzo di attivazione (open price del pendente)
   double              stoplimit;   // usato solo per BUY/SELL_STOP_LIMIT
   double              sl;
   double              tp;
   datetime            expiration;
   ENUM_ORDER_TYPE_TIME type_time;
   string              comment;
};

// --- News
NewsEvent g_events[];
int       g_eventCount     = 0;
datetime  g_lastRefresh    = 0;
bool      g_inWindow       = false;
datetime  g_lastCancelTime = 0;

// --- Pendenti salvati (news)
SavedPendingOrder g_savedOrders[];
int               g_savedOrderCount = 0;

// --- Venerdì
bool      g_fridayCloseDone   = false; // flag: chiusura già eseguita questa settimana

// --- Dashboard
datetime  g_day_start_time    = 0;
double    g_day_start_balance = 0;
bool      g_tradingPaused     = false;
datetime  g_lastSnapshotTime  = 0;

// --- Risk Guard
#define RG_HALT_NONE      0
#define RG_HALT_DAILY     1   // fino al prossimo reset giornaliero
#define RG_HALT_FLOAT     2   // fino al prossimo reset giornaliero
#define RG_HALT_MAX       3   // permanente (sblocco manuale con InpRGResetHalt)

double    g_rgInitial       = 0;     // saldo iniziale del conto prop
double    g_rgDayRef        = 0;     // valore di partenza della giornata (al reset)
double    g_rgPeakEOD       = 0;     // massimo balance a fine giornata (per max trailing EOD)
long      g_rgPeriodId      = -1;    // identificativo della "giornata prop" corrente
int       g_rgHalt          = RG_HALT_NONE;
datetime  g_rgLastEnforce   = 0;
datetime  g_rgLastLog       = 0;
string    g_rgPrefix        = "";

//==========================================================================
// INIT / DEINIT / TICK
//==========================================================================

int OnInit()
{
   EventSetTimer(1);
   // Timer ridotto da 15s a 1s: resta come rete di sicurezza secondaria per la
   // cancellazione/chiusura periodica. La protezione primaria durante la finestra
   // news è ora OnTradeTransaction(), che reagisce all'evento del server senza
   // attendere il prossimo giro di polling.

   g_day_start_balance = AccountInfoDouble(ACCOUNT_BALANCE);
   g_day_start_time    = StringToTime(TimeToString(TimeCurrent(), TIME_DATE));

   if(InpRGEnabled)
      RGInit();

   if(InpNewsEnabled)
      FetchCalendar();
   else
      Print("[TradingGuard] Protezione news DISABILITATA.");

   if(InpEnableDashboard)
   {
      SendSnapshot();
      PollCommands();
   }

   Print("[TradingGuard] Inizializzato."
         + " | News: "     + (InpNewsEnabled ? ("ON [" + InpNewsCountry + "] -" + IntegerToString(InpMinutesBefore) + "/+" + IntegerToString(InpMinutesAfter) + "min") : "OFF")
         + " | RipristinoPendenti: " + (InpNewsRestorePending ? "ON" : "OFF")
         + " | ProfitSLAction: " + EnumToString(InpNewsProfitSLAction)
         + " | MaxTrades: " + (InpMaxOpenTrades == 0 ? "illimitati" : IntegerToString(InpMaxOpenTrades))
         + " | RiskGuard: " + (InpRGEnabled ? "ON" : "OFF")
         + " | Dashboard: " + (InpEnableDashboard ? "ON" : "OFF"));

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();

   // Se usciamo durante una finestra attiva con azione REMOVE_TP, ripristina i TP
   if(g_inWindow && InpNewsPosAction == NEWS_POS_REMOVE_TP)
   {
      Print("[TradingGuard] Deinit durante finestra news — ripristino TP...");
      RestoreAllTP();
   }

   // Avviso se ci sono pendenti salvati non ancora ripristinati (EA rimosso durante la finestra)
   if(g_savedOrderCount > 0)
      PrintFormat("[TradingGuard] ATTENZIONE: EA rimosso con %d pendenti salvati NON ripristinati.", g_savedOrderCount);

   if(InpGlobalVarNotify)
      GlobalVariableSet("NewsGuard_Active", 0.0);

   if(InpRGEnabled && g_rgHalt != RG_HALT_NONE)
      Print("[TradingGuard] ATTENZIONE: EA rimosso con Risk Guard in BLOCCO — senza l'EA il blocco non è più applicato!");

   Print("[TradingGuard] EA rimosso.");
}

void OnTick()
{
   // Il Risk Guard controlla l'equity anche a ogni tick del grafico su cui è attaccato
   // (oltre al timer di 1 secondo): attacca l'EA al grafico del simbolo più volatile (es. XAUUSD).
   if(InpRGEnabled) RGCheck();
}

//==========================================================================
// TRADE TRANSACTION — Protezione istantanea durante la finestra news
// Scatta sull'evento del server (non sul polling del timer), quindi elimina
// il gap temporale che permette a un pendente di essere piazzato E attivato
// prima che TradingGuard se ne accorga.
//==========================================================================

void OnTradeTransaction(const MqlTradeTransaction &trans,
                         const MqlTradeRequest      &request,
                         const MqlTradeResult       &result)
{
   //----------------------------------------------------------------------
   // 0) RISK GUARD: durante un blocco nessuna nuova esposizione è ammessa
   //    (vale per TUTTI i simboli, indipendentemente dal filtro)
   //----------------------------------------------------------------------
   if(InpRGEnabled && g_rgHalt != RG_HALT_NONE)
   {
      if(trans.type == TRADE_TRANSACTION_ORDER_ADD)
      {
         if(OrderSelect(trans.order))
         {
            ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
            if(ot != ORDER_TYPE_BUY && ot != ORDER_TYPE_SELL)   // solo pendenti
            {
               if(trade.OrderDelete(trans.order))
                  PrintFormat("[RiskGuard] Pendente #%d cancellato: trading bloccato (%s).",
                              trans.order, RGHaltName(g_rgHalt));
            }
         }
      }
      if(trans.type == TRADE_TRANSACTION_DEAL_ADD && HistoryDealSelect(trans.deal))
      {
         ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
         if(entry == DEAL_ENTRY_IN)
         {
            ulong posId = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
            if(PositionSelectByTicket(posId))
            {
               trade.SetDeviationInPoints(100);
               if(trade.PositionClose(posId))
                  PrintFormat("[RiskGuard] Posizione #%d (%s) chiusa subito: trading bloccato (%s).",
                              posId, HistoryDealGetString(trans.deal, DEAL_SYMBOL), RGHaltName(g_rgHalt));
            }
         }
      }
   }

   if(!InpNewsEnabled || !g_inWindow) return;

   string filterSym = GetFilterSymbol();

   //----------------------------------------------------------------------
   // 1) Nuovo ordine pendente comparso durante la finestra -> cancella subito
   //----------------------------------------------------------------------
   if(InpNewsInstantCancel && InpNewsDeletePending &&
      trans.type == TRADE_TRANSACTION_ORDER_ADD)
   {
      ulong ticket = trans.order;
      if(OrderSelect(ticket))
      {
         string sym = OrderGetString(ORDER_SYMBOL);
         if(filterSym == "" || sym == filterSym)
         {
            if(InpNewsRestorePending)
               SavePendingOrder(ticket);   // stessa dedup/salvataggio del path a polling

            if(trade.OrderDelete(ticket))
               PrintFormat("[TradingGuard] (istantaneo) Pendente #%d (%s) cancellato appena piazzato in finestra news.",
                           ticket, sym);
            else
               PrintFormat("[TradingGuard] ERR cancellazione istantanea #%d (%s): %d",
                           ticket, sym, GetLastError());
         }
      }
   }

   //----------------------------------------------------------------------
   // 2) Un pendente si è attivato (deal di apertura) durante la finestra
   //    -> chiudi subito la posizione risultante, in emergenza
   //----------------------------------------------------------------------
   if(InpNewsInstantClose && trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      ulong dealTicket = trans.deal;
      if(HistoryDealSelect(dealTicket))
      {
         string sym = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
         ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);

         if((filterSym == "" || sym == filterSym) && entry == DEAL_ENTRY_IN)
         {
            ulong posId = (ulong)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
            if(PositionSelectByTicket(posId))
            {
               trade.SetDeviationInPoints(50);
               if(trade.PositionClose(posId))
                  PrintFormat("[TradingGuard] (istantaneo) Posizione #%d (%s) chiusa in emergenza: attivata durante finestra news.",
                              posId, sym);
               else
                  PrintFormat("[TradingGuard] ERR chiusura istantanea #%d (%s): retcode=%d",
                              posId, sym, trade.ResultRetcode());
            }
         }
      }
   }
}

//==========================================================================
// TIMER — Logica principale (rete di sicurezza periodica)
//==========================================================================

void OnTimer()
{
   datetime now = TimeCurrent();

   //----------------------------------------------------------------------
   // 0. RISK GUARD (prima di tutto il resto)
   //----------------------------------------------------------------------
   if(InpRGEnabled)
      RGCheck();

   //----------------------------------------------------------------------
   // 1. Logica NEWS (solo se abilitata)
   //----------------------------------------------------------------------
   if(InpNewsEnabled)
   {
      // Aggiorna calendario se scaduto
      if(now - g_lastRefresh > (datetime)(InpRefreshMinutes * 60))
         FetchCalendar();

      datetime gmt              = TimeGMT();
      bool     shouldBeInWindow = false;

      for(int i = 0; i < g_eventCount; i++)
      {
         datetime winStart = g_events[i].utcTime - InpMinutesBefore * 60;
         datetime winEnd   = g_events[i].utcTime + InpMinutesAfter  * 60;
         if(gmt >= winStart && gmt <= winEnd)
         {
            shouldBeInWindow = true;
            break;
         }
      }

      // Transizione NORMALE → FINESTRA ATTIVA
      if(shouldBeInWindow && !g_inWindow)
      {
         g_inWindow       = true;
         g_lastCancelTime = 0;
         if(InpGlobalVarNotify) GlobalVariableSet("NewsGuard_Active", 1.0);
         Print("[TradingGuard] ▶ Finestra news attivata | ",
               GetCurrentWindowNewsInfo(), " | Simbolo: ",
               (GetFilterSymbol() == "" ? "TUTTI" : GetFilterSymbol()));

         // Azioni immediate all'entrata nella finestra

         // 1) Cancella (e salva per il ripristino) i pendenti
         if(InpNewsDeletePending)
            DeletePendingOrders(GetFilterSymbol(), InpNewsRestorePending);

         // 2) Gestisci le posizioni con SL già in profit per il trailing stop
         //    (eseguito PRIMA della logica generale sulle posizioni aperte)
         HandleProfitSLPositions(GetFilterSymbol());

         // 3) Logica generale sulle posizioni aperte rimanenti
         if(InpNewsPosAction == NEWS_POS_CLOSE)
            CloseFilteredPositions(GetFilterSymbol());
         else if(InpNewsPosAction == NEWS_POS_REMOVE_TP)
            RemoveTP(GetFilterSymbol());
      }

      // Transizione FINESTRA ATTIVA → NORMALE
      if(!shouldBeInWindow && g_inWindow)
      {
         g_inWindow = false;
         if(InpGlobalVarNotify) GlobalVariableSet("NewsGuard_Active", 0.0);
         Print("[TradingGuard] ◀ Finestra news terminata.");

         if(InpNewsPosAction == NEWS_POS_REMOVE_TP)
            RestoreAllTP();

         // Durante un blocco del Risk Guard NON si ripristinano pendenti:
         // restano salvati e verranno ripristinati alla prossima fine-finestra utile.
         if(InpNewsRestorePending && !(InpRGEnabled && g_rgHalt != RG_HALT_NONE))
            RestoreSavedPendingOrders();
      }
   }

   //----------------------------------------------------------------------
   // 2. Cancellazione continua pendenti
   //    Trigger: finestra news attiva | pausa dashboard | max trades
   //----------------------------------------------------------------------
   bool   shouldCancelPending = false;
   bool   cancelDueToNews     = false;
   string cancelReason        = "";

   if(g_inWindow && InpNewsDeletePending)
   {
      shouldCancelPending = true;
      cancelDueToNews     = true;
      cancelReason        = "finestra news";
   }
   if(g_tradingPaused)
   {
      shouldCancelPending = true;
      cancelReason        = "pausa trading (dashboard)";
   }
   if(InpMaxOpenTrades > 0 && PositionsTotal() >= InpMaxOpenTrades)
   {
      shouldCancelPending = true;
      cancelReason        = "max trades raggiunto ("
                            + IntegerToString(PositionsTotal()) + "/"
                            + IntegerToString(InpMaxOpenTrades) + ")";
   }

   if(shouldCancelPending && (now - g_lastCancelTime >= InpCancelIntervalSec))
   {
      g_lastCancelTime = now;
      // Salva per il ripristino SOLO i pendenti cancellati a causa della finestra news
      // (non quelli cancellati per pausa trading o limite max trades)
      int deleted = DeletePendingOrders(GetFilterSymbol(), cancelDueToNews && InpNewsRestorePending);
      if(deleted > 0)
         Print("[TradingGuard] Cancellati ", deleted, " pendenti — motivo: ", cancelReason);
   }

   //----------------------------------------------------------------------
   // 3. Chiusura venerdì
   //----------------------------------------------------------------------
   if(InpFridayCloseEnabled)
      CheckFridayClose(now);

   //----------------------------------------------------------------------
   // 4. Dashboard: snapshot e polling comandi
   //----------------------------------------------------------------------
   if(InpEnableDashboard)
   {
      datetime today = StringToTime(TimeToString(now, TIME_DATE));
      if(today > g_day_start_time)
      {
         g_day_start_time    = today;
         g_day_start_balance = AccountInfoDouble(ACCOUNT_BALANCE);
         Print("[TradingGuard] Nuovo giorno — balance reset: ", g_day_start_balance);
         // Reset flag venerdì a inizio nuova giornata (lunedì o qualsiasi giorno)
         MqlDateTime dt; TimeToStruct(now, dt);
         if(dt.day_of_week != 5) g_fridayCloseDone = false;
      }

      if(now - g_lastSnapshotTime >= (datetime)(SendIntervalMin * 60))
      {
         g_lastSnapshotTime = now;
         SendSnapshot();
      }

      PollCommands();
   }
}

//==========================================================================
// RISK GUARD — fusi orari e "giornata prop"
//==========================================================================

// Data (00:00) della n-esima domenica del mese (n=1..5); n=-1 = ultima domenica
datetime RGSunday(int year, int month, int n)
{
   MqlDateTime d;
   d.year = year; d.mon = month; d.day = 1; d.hour = 0; d.min = 0; d.sec = 0;
   d.day_of_week = 0; d.day_of_year = 0;
   datetime first = StructToTime(d);
   TimeToStruct(first, d);
   int firstSunday = 1 + (7 - d.day_of_week) % 7;
   if(n > 0)
      return first + (datetime)((firstSunday - 1 + 7 * (n - 1)) * 86400);

   // ultima domenica: parti dal primo giorno del mese successivo e torna indietro
   MqlDateTime nx = d;
   nx.mon = month + 1; nx.year = year;
   if(nx.mon > 12) { nx.mon = 1; nx.year++; }
   nx.day = 1;
   datetime nextFirst = StructToTime(nx);
   MqlDateTime t; TimeToStruct(nextFirst - 86400, t);   // ultimo giorno del mese
   return nextFirst - 86400 - (datetime)(t.day_of_week * 86400);
}

// Offset (secondi) del fuso scelto rispetto a GMT, per l'istante gmt
int RGTzOffset(datetime gmt)
{
   MqlDateTime g; TimeToStruct(gmt, g);

   if(InpRGResetTZ == RG_TZ_UTC) return 0;

   if(InpRGResetTZ == RG_TZ_CET)
   {
      // Ora legale UE: ultima domenica di marzo 01:00 UTC -> ultima domenica di ottobre 01:00 UTC
      datetime s = RGSunday(g.year, 3, -1)  + 3600;
      datetime e = RGSunday(g.year, 10, -1) + 3600;
      return (gmt >= s && gmt < e) ? 2 * 3600 : 3600;
   }

   // USA (New York / Chicago): seconda domenica di marzo -> prima domenica di novembre, alle 02:00 locali
   int stdOffset = (InpRGResetTZ == RG_TZ_NEWYORK) ? -5 * 3600 : -6 * 3600;
   datetime s = RGSunday(g.year, 3, 2)  + 2 * 3600 - stdOffset;            // 02:00 ora solare -> UTC
   datetime e = RGSunday(g.year, 11, 1) + 2 * 3600 - (stdOffset + 3600);   // 02:00 ora legale -> UTC
   return (gmt >= s && gmt < e) ? stdOffset + 3600 : stdOffset;
}

// Identificativo della giornata prop: cambia esattamente all'orario di reset
long RGCurrentPeriodId()
{
   datetime local;
   if(InpRGResetTZ == RG_TZ_SERVER)
      local = TimeTradeServer();
   else
   {
      datetime gmt = TimeGMT();
      local = gmt + RGTzOffset(gmt);
   }
   datetime shifted = local - (datetime)(InpRGResetHour * 3600 + InpRGResetMinute * 60);
   return (long)(shifted / 86400);
}

double RGDailyBaseValue()
{
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   if(InpRGDailyBase == RG_BASE_BALANCE) return bal;
   if(InpRGDailyBase == RG_BASE_EQUITY)  return eq;
   return MathMax(bal, eq);
}

string RGHaltName(int h)
{
   if(h == RG_HALT_DAILY) return "perdita giornaliera";
   if(h == RG_HALT_FLOAT) return "perdita flottante";
   if(h == RG_HALT_MAX)   return "perdita massima (PERMANENTE)";
   return "nessuno";
}

//==========================================================================
// RISK GUARD — persistenza (GlobalVariable del terminale, per account)
//==========================================================================

void RGSave()
{
   GlobalVariableSet(g_rgPrefix + "INIT",   g_rgInitial);
   GlobalVariableSet(g_rgPrefix + "DAYREF", g_rgDayRef);
   GlobalVariableSet(g_rgPrefix + "PEAK",   g_rgPeakEOD);
   GlobalVariableSet(g_rgPrefix + "PERIOD", (double)g_rgPeriodId);
   GlobalVariableSet(g_rgPrefix + "HALT",   (double)g_rgHalt);
   GlobalVariableSet("RISKGUARD_HALT",      (g_rgHalt != RG_HALT_NONE) ? 1.0 : 0.0);
   // ^ leggibile dagli altri EA, se vuoi farli fermare da soli
}

double RGLoad(string key, double def)
{
   string n = g_rgPrefix + key;
   return GlobalVariableCheck(n) ? GlobalVariableGet(n) : def;
}

void RGInit()
{
   g_rgPrefix = "RG_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_";

   // Saldo iniziale
   if(InpRGInitialBalance > 0)
      g_rgInitial = InpRGInitialBalance;
   else
   {
      g_rgInitial = RGLoad("INIT", 0);
      if(g_rgInitial <= 0)
      {
         g_rgInitial = AccountInfoDouble(ACCOUNT_BALANCE);
         Print("[RiskGuard] ATTENZIONE: saldo iniziale non impostato — uso il balance attuale ",
               DoubleToString(g_rgInitial, 2), ". Imposta InpRGInitialBalance per sicurezza.");
      }
   }

   long   curPeriod   = RGCurrentPeriodId();
   long   savedPeriod = (long)RGLoad("PERIOD", -1);
   double savedRef    = RGLoad("DAYREF", 0);

   g_rgPeakEOD = MathMax(RGLoad("PEAK", g_rgInitial), g_rgInitial);
   g_rgHalt    = (int)RGLoad("HALT", RG_HALT_NONE);

   if(savedPeriod == curPeriod && savedRef > 0)
   {
      g_rgDayRef = savedRef;   // riavvio nella stessa giornata: riprendi il riferimento salvato
   }
   else
   {
      g_rgDayRef = RGDailyBaseValue();
      if(savedPeriod >= 0)
      {
         // nuova giornata rispetto all'ultimo salvataggio: i blocchi giornalieri decadono
         if(g_rgHalt == RG_HALT_DAILY || g_rgHalt == RG_HALT_FLOAT) g_rgHalt = RG_HALT_NONE;
      }
      Print("[RiskGuard] ATTENZIONE: riferimento giornaliero preso ORA (", DoubleToString(g_rgDayRef, 2),
            ") e non all'orario di reset: se oggi il conto era già in perdita, il blocco scatterà dopo il previsto."
            " Per il primo giorno controlla a mano il limite indicato dalla prop.");
   }
   g_rgPeriodId = curPeriod;

   if(InpRGResetHalt && g_rgHalt != RG_HALT_NONE)
   {
      Print("[RiskGuard] Sblocco manuale (InpRGResetHalt=TRUE): blocco '", RGHaltName(g_rgHalt), "' rimosso.");
      g_rgHalt = RG_HALT_NONE;
   }

   RGSave();

   PrintFormat("[RiskGuard] ATTIVO | Iniziale %.2f | Rif. giornata %.2f | Stop giornaliero a %.2f | Stop massimo a %.2f | Stop flottante %s | Reset %02d:%02d (%s) | Blocco: %s",
               g_rgInitial, g_rgDayRef, RGDailyStopLevel(), RGMaxStopLevel(),
               (InpRGFloatLimitPct > 0 ? DoubleToString(-RGFloatStopAmount(), 2) : "OFF"),
               InpRGResetHour, InpRGResetMinute, EnumToString(InpRGResetTZ), RGHaltName(g_rgHalt));
}

//==========================================================================
// RISK GUARD — livelli di stop
//==========================================================================

double RGDailyStopLevel()
{
   if(InpRGDailyLimitPct <= 0) return 0;
   double base    = (InpRGDailyPctOf == RG_PCT_OF_DAY_REF) ? g_rgDayRef : g_rgInitial;
   double allowed = base * InpRGDailyLimitPct / 100.0;
   return g_rgDayRef - allowed * InpRGDailyStopAtPct / 100.0;
}

double RGMaxStopLevel()
{
   if(InpRGMaxLimitPct <= 0) return 0;
   double allowed = g_rgInitial * InpRGMaxLimitPct / 100.0;
   double floorLv;
   if(InpRGMaxType == RG_MAX_TRAIL_EOD)
      floorLv = MathMin(g_rgPeakEOD - allowed, g_rgInitial);   // trailing, bloccata al saldo iniziale
   else
      floorLv = g_rgInitial - allowed;                          // statica
   return floorLv + allowed * (1.0 - InpRGMaxStopAtPct / 100.0);
}

double RGFloatStopAmount()
{
   return g_rgInitial * InpRGFloatLimitPct / 100.0 * InpRGFloatStopAtPct / 100.0;
}

double RGFloatingPnL()
{
   double f = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(!PositionSelectByTicket(t)) continue;
      f += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   }
   return f;
}

//==========================================================================
// RISK GUARD — controllo principale (OnTick + OnTimer)
//==========================================================================

void RGCheck()
{
   datetime now = TimeCurrent();

   //--- 1) Cambio di giornata prop (reset giornaliero)
   long pid = RGCurrentPeriodId();
   if(pid != g_rgPeriodId)
   {
      double bal = AccountInfoDouble(ACCOUNT_BALANCE);
      if(bal > g_rgPeakEOD) g_rgPeakEOD = bal;        // per la perdita massima trailing EOD

      g_rgPeriodId = pid;
      g_rgDayRef   = RGDailyBaseValue();

      if(g_rgHalt == RG_HALT_DAILY || g_rgHalt == RG_HALT_FLOAT)
      {
         Print("[RiskGuard] Nuova giornata: blocco '", RGHaltName(g_rgHalt), "' rimosso, trading riabilitato.");
         g_rgHalt = RG_HALT_NONE;
      }
      RGSave();
      PrintFormat("[RiskGuard] Reset giornaliero | Rif. %.2f | Stop giornaliero a %.2f | Stop massimo a %.2f",
                  g_rgDayRef, RGDailyStopLevel(), RGMaxStopLevel());
   }

   //--- 2) Se in blocco: mantieni il conto flat (ogni secondo)
   if(g_rgHalt != RG_HALT_NONE)
   {
      if(now - g_rgLastEnforce >= 1)
      {
         g_rgLastEnforce = now;
         if(PositionsTotal() > 0 || OrdersTotal() > 0)
            RGFlatten("mantenimento blocco " + RGHaltName(g_rgHalt));
      }
      return;
   }

   double eq = AccountInfoDouble(ACCOUNT_EQUITY);

   //--- 3) Perdita massima (blocco permanente)
   if(InpRGMaxLimitPct > 0 && eq <= RGMaxStopLevel())
   {
      RGTrigger(RG_HALT_MAX, StringFormat("equity %.2f <= stop massimo %.2f", eq, RGMaxStopLevel()));
      return;
   }

   //--- 4) Perdita giornaliera (blocco fino al reset)
   if(InpRGDailyLimitPct > 0 && eq <= RGDailyStopLevel())
   {
      RGTrigger(RG_HALT_DAILY, StringFormat("equity %.2f <= stop giornaliero %.2f (rif. %.2f)",
                                            eq, RGDailyStopLevel(), g_rgDayRef));
      return;
   }

   //--- 5) Perdita flottante combinata (Goat Guard)
   if(InpRGFloatLimitPct > 0)
   {
      double fl = RGFloatingPnL();
      if(fl <= -RGFloatStopAmount())
      {
         string why = StringFormat("perdita flottante %.2f <= -%.2f", fl, RGFloatStopAmount());
         if(InpRGFloatHaltDay)
            RGTrigger(RG_HALT_FLOAT, why);
         else
         {
            RGFlatten(why);
            RGNotify("[RiskGuard] Stop flottante: " + why + " — posizioni chiuse.");
         }
         return;
      }
   }

   //--- 6) Log di stato ogni 30 minuti
   if(now - g_rgLastLog >= 1800)
   {
      g_rgLastLog = now;
      PrintFormat("[RiskGuard] OK | Equity %.2f | margine giornaliero %.2f | margine massimo %.2f%s",
                  eq, eq - RGDailyStopLevel(), eq - RGMaxStopLevel(),
                  (InpRGFloatLimitPct > 0 ? StringFormat(" | flottante %.2f (stop -%.2f)", RGFloatingPnL(), RGFloatStopAmount()) : ""));
   }
}

void RGTrigger(int haltType, string why)
{
   g_rgHalt = haltType;
   RGSave();
   string msg = "[RiskGuard] BLOCCO " + RGHaltName(haltType) + ": " + why +
                (haltType == RG_HALT_MAX ? " — trading fermo fino a sblocco manuale."
                                         : " — trading fermo fino al prossimo reset giornaliero.");
   Print(msg);
   RGFlatten(why);
   RGNotify(msg);
}

// Chiude TUTTE le posizioni e cancella TUTTI i pendenti (tutti i simboli), con più tentativi
void RGFlatten(string why)
{
   trade.SetDeviationInPoints(100);

   for(int attempt = 0; attempt < 3; attempt++)
   {
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong t = PositionGetTicket(i);
         if(!PositionSelectByTicket(t)) continue;
         if(!trade.PositionClose(t))
            PrintFormat("[RiskGuard] ERR chiusura #%d (%s): retcode=%d",
                        t, PositionGetString(POSITION_SYMBOL), trade.ResultRetcode());
      }
      for(int i = OrdersTotal() - 1; i >= 0; i--)
      {
         ulong t = OrderGetTicket(i);
         if(!OrderSelect(t)) continue;
         trade.OrderDelete(t);
      }
      if(PositionsTotal() == 0 && OrdersTotal() == 0) break;
      Sleep(200);
   }

   if(PositionsTotal() > 0 || OrdersTotal() > 0)
      PrintFormat("[RiskGuard] ATTENZIONE: restano %d posizioni e %d pendenti (%s) — riprovo al prossimo controllo.",
                  PositionsTotal(), OrdersTotal(), why);
   else
      Print("[RiskGuard] Conto flat (", why, ").");
}

void RGNotify(string msg)
{
   if(InpRGPushNotify && TerminalInfoInteger(TERMINAL_NOTIFICATIONS_ENABLED))
      SendNotification(StringSubstr(msg, 0, 255));
}

//==========================================================================
// CHIUSURA VENERDÌ
//==========================================================================

void CheckFridayClose(datetime now)
{
   if(g_fridayCloseDone) return;

   MqlDateTime dt;
   TimeToStruct(now, dt);

   // Solo il venerdì (day_of_week == 5)
   if(dt.day_of_week != 5) return;

   // Controlla se siamo all'ora impostata o oltre (con tolleranza di 1 minuto)
   int currentMinutes = dt.hour * 60 + dt.min;
   int targetMinutes  = InpFridayCloseHour * 60 + InpFridayCloseMinute;

   if(currentMinutes < targetMinutes) return;

   // Esegui chiusura
   g_fridayCloseDone = true;
   Print("[TradingGuard] ⏰ Chiusura venerdì ore ",
         StringFormat("%02d:%02d", InpFridayCloseHour, InpFridayCloseMinute),
         " (server time) — avvio chiusura...");

   if(InpFridayDeletePending)
   {
      // Non salviamo per il ripristino: la chiusura di venerdì è definitiva fino a lunedì
      int deleted = DeletePendingOrders(GetFilterSymbol(), false);
      Print("[TradingGuard] Venerdì: cancellati ", deleted, " ordini pendenti.");
   }

   CloseAllPositions();
}

//==========================================================================
// HELPER: Simbolo da filtrare
//==========================================================================

string GetFilterSymbol()
{
   if(!InpFilterSymbol) return "";
   if(InpSymbol != "")  return InpSymbol;
   return Symbol();
}

//==========================================================================
// HELPER: dimensione di 1 pip per il simbolo (indipendente da point/digits)
// Per simboli a 3 o 5 decimali (es. USDJPY, EURUSD) 1 pip = 10 point.
// Per gli altri (es. XAUUSD a 2 decimali) 1 pip = 1 point.
//==========================================================================

double GetPipSize(string symbol)
{
   double point  = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits == 3 || digits == 5) return point * 10.0;
   return point;
}

//==========================================================================
// CANCELLAZIONE PENDENTI — restituisce il numero cancellati
// saveForRestore = TRUE  -> salva ogni ordine prima di cancellarlo, per poterlo
//                           ricreare identico a fine finestra news (vedi RestoreSavedPendingOrders)
//==========================================================================

int DeletePendingOrders(string sym, bool saveForRestore = false)
{
   int deleted = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(!OrderSelect(ticket)) continue;
      if(sym != "" && OrderGetString(ORDER_SYMBOL) != sym) continue;

      if(saveForRestore)
         SavePendingOrder(ticket);

      if(trade.OrderDelete(ticket))
         deleted++;
      else
         Print("[TradingGuard] ERR cancellazione ordine #", ticket,
               " (", OrderGetString(ORDER_SYMBOL), "): ", GetLastError());
   }
   return deleted;
}

//==========================================================================
// SALVA UN PENDENTE (chiamare PRIMA di cancellarlo — il ticket deve essere
// già selezionato tramite OrderSelect)
// Deduplica per magic+simbolo+tipo+prezzo: se un pendente "equivalente" è già
// stato salvato in questa stessa finestra (es. l'EA madre lo ha ricreato e noi
// lo abbiamo cancellato di nuovo al giro successivo), aggiorniamo la voce
// invece di accumulare doppioni.
//==========================================================================

void SavePendingOrder(ulong ticket)
{
   SavedPendingOrder o;
   o.symbol     = OrderGetString(ORDER_SYMBOL);
   o.type       = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
   o.magic      = (ulong)OrderGetInteger(ORDER_MAGIC);
   o.volume     = OrderGetDouble(ORDER_VOLUME_CURRENT);
   o.price      = OrderGetDouble(ORDER_PRICE_OPEN);
   o.stoplimit  = OrderGetDouble(ORDER_PRICE_STOPLIMIT);
   o.sl         = OrderGetDouble(ORDER_SL);
   o.tp         = OrderGetDouble(ORDER_TP);
   o.expiration = (datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);
   o.type_time  = (ENUM_ORDER_TYPE_TIME)OrderGetInteger(ORDER_TYPE_TIME);
   o.comment    = OrderGetString(ORDER_COMMENT);

   double tolerance = GetPipSize(o.symbol) * InpRestoreTolerancePips;

   for(int i = 0; i < g_savedOrderCount; i++)
   {
      if(g_savedOrders[i].magic  == o.magic  &&
         g_savedOrders[i].symbol == o.symbol &&
         g_savedOrders[i].type   == o.type   &&
         MathAbs(g_savedOrders[i].price - o.price) <= tolerance)
      {
         g_savedOrders[i] = o; // aggiorna con i dati più recenti (SL/TP potrebbero essere cambiati)
         return;
      }
   }

   int idx = g_savedOrderCount;
   ArrayResize(g_savedOrders, idx + 1);
   g_savedOrders[idx] = o;
   g_savedOrderCount++;

   PrintFormat("[TradingGuard] Pendente salvato per ripristino: %s magic=%d @ %.5f (SL=%.5f TP=%.5f)",
               o.symbol, o.magic, o.price, o.sl, o.tp);
}

//==========================================================================
// VERIFICA SE ESISTE GIÀ UN PENDENTE EQUIVALENTE (stesso magic/simbolo/tipo,
// prezzo entro tolleranza) — usata per evitare doppioni quando anche l'EA
// madre ricrea autonomamente i propri pendenti dopo la finestra news.
//==========================================================================

bool PendingOrderExists(string symbol, ENUM_ORDER_TYPE type, ulong magic, double price)
{
   double tolerance = GetPipSize(symbol) * InpRestoreTolerancePips;

   for(int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if(!OrderSelect(ticket)) continue;
      if(OrderGetString(ORDER_SYMBOL) != symbol) continue;
      if((ulong)OrderGetInteger(ORDER_MAGIC) != magic) continue;
      if((ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE) != type) continue;

      double p = OrderGetDouble(ORDER_PRICE_OPEN);
      if(MathAbs(p - price) <= tolerance) return true;
   }
   return false;
}

//==========================================================================
// RIPRISTINA I PENDENTI SALVATI (chiamata alla fine della finestra news)
//==========================================================================

void RestoreSavedPendingOrders()
{
   if(g_savedOrderCount == 0) return;

   int restored = 0, skipped = 0, failed = 0;

   for(int i = 0; i < g_savedOrderCount; i++)
   {
      SavedPendingOrder o = g_savedOrders[i];

      // Se un pendente equivalente esiste già (es. ricreato dall'EA madre), non duplicare
      if(PendingOrderExists(o.symbol, o.type, o.magic, o.price))
      {
         PrintFormat("[TradingGuard] Pendente equivalente già presente (magic=%d %s @ %.5f) — ripristino saltato per evitare doppioni.",
                     o.magic, o.symbol, o.price);
         skipped++;
         continue;
      }

      trade.SetExpertMagicNumber(o.magic);

      bool ok = trade.OrderOpen(o.symbol, o.type, o.volume, o.stoplimit, o.price,
                                 o.sl, o.tp, o.type_time, o.expiration, o.comment);

      if(ok)
      {
         PrintFormat("[TradingGuard] Pendente ripristinato: %s magic=%d @ %.5f (SL=%.5f TP=%.5f)",
                     o.symbol, o.magic, o.price, o.sl, o.tp);
         restored++;
      }
      else
      {
         PrintFormat("[TradingGuard] ERR ripristino pendente %s magic=%d: retcode=%d last_error=%d",
                     o.symbol, o.magic, trade.ResultRetcode(), GetLastError());
         failed++;
      }
   }

   trade.SetExpertMagicNumber(0); // reset magic di default dopo il ripristino

   PrintFormat("[TradingGuard] Ripristino pendenti post-news completato: %d ripristinati, %d saltati (doppioni evitati), %d falliti.",
               restored, skipped, failed);

   g_savedOrderCount = 0;
   ArrayResize(g_savedOrders, 0);
}

//==========================================================================
// GESTIONE POSIZIONI CON SL IN PROFIT (portato lì dal trailing stop)
// Eseguita all'ingresso della finestra news, prima della logica generale
// sulle posizioni aperte (NEWS_POS_ACTION).
//==========================================================================

void HandleProfitSLPositions(string sym)
{
   if(InpNewsProfitSLAction == PROFIT_SL_NOTHING) return;

   int affected = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(sym != "" && PositionGetString(POSITION_SYMBOL) != sym) continue;

      double sl        = PositionGetDouble(POSITION_SL);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      long   type      = PositionGetInteger(POSITION_TYPE);

      if(sl == 0.0) continue; // nessuno SL impostato: niente da valutare

      bool slInProfit = (type == POSITION_TYPE_BUY  && sl > openPrice) ||
                         (type == POSITION_TYPE_SELL && sl < openPrice);

      if(!slInProfit) continue; // SL ancora in perdita o a breakeven esatto: gestito dalla logica generale

      if(InpNewsProfitSLAction == PROFIT_SL_CLOSE)
      {
         trade.SetDeviationInPoints(50);
         if(trade.PositionClose(ticket))
         {
            PrintFormat("[TradingGuard] Posizione #%d (%s) chiusa — SL trailing già in profit prima della news.",
                        ticket, PositionGetString(POSITION_SYMBOL));
            affected++;
         }
         else
            PrintFormat("[TradingGuard] ERR chiusura #%d (SL in profit): retcode=%d",
                        ticket, trade.ResultRetcode());
      }
      else if(InpNewsProfitSLAction == PROFIT_SL_BREAKEVEN)
      {
         double tp = PositionGetDouble(POSITION_TP);
         if(trade.PositionModify(ticket, openPrice, tp))
         {
            PrintFormat("[TradingGuard] SL spostato a breakeven per #%d (%s): %.5f -> %.5f (era in profit)",
                        ticket, PositionGetString(POSITION_SYMBOL), sl, openPrice);
            affected++;
         }
         else
            PrintFormat("[TradingGuard] ERR spostamento a breakeven #%d: %d",
                        ticket, GetLastError());
      }
   }

   if(affected == 0)
      Print("[TradingGuard] Nessuna posizione con SL già in profit da gestire prima della news.");
}

//==========================================================================
// CHIUDI POSIZIONI FILTRATE (per simbolo)
//==========================================================================

void CloseFilteredPositions(string sym)
{
   int closed = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(sym != "" && PositionGetString(POSITION_SYMBOL) != sym) continue;

      trade.SetDeviationInPoints(50);
      if(trade.PositionClose(ticket))
      {
         Print("[TradingGuard] Posizione #", ticket, " (", PositionGetString(POSITION_SYMBOL), ") chiusa per news.");
         closed++;
      }
      else
         Print("[TradingGuard] ERR chiusura #", ticket, ": retcode=", trade.ResultRetcode());
   }
   if(closed == 0) Print("[TradingGuard] Nessuna posizione da chiudere.");
}

//==========================================================================
// RIMUOVI TP (salva in GlobalVariable per ripristino)
//==========================================================================

void RemoveTP(string sym)
{
   int modified = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(sym != "" && PositionGetString(POSITION_SYMBOL) != sym) continue;

      double tp = PositionGetDouble(POSITION_TP);
      double sl = PositionGetDouble(POSITION_SL);

      string varName = "NG_TP_" + IntegerToString(ticket);
      GlobalVariableSet(varName, tp); // salva anche se 0 (flag "processato")

      if(tp == 0.0) continue; // nessun TP da rimuovere

      if(trade.PositionModify(ticket, sl, 0.0))
      {
         Print("[TradingGuard] TP rimosso da #", ticket, " (", PositionGetString(POSITION_SYMBOL),
               ") — TP salvato: ", tp);
         modified++;
      }
      else
      {
         Print("[TradingGuard] ERR rimozione TP #", ticket, ": ", GetLastError());
         GlobalVariableDel(varName);
      }
   }
   if(modified == 0) Print("[TradingGuard] Nessun TP da rimuovere.");
}

//==========================================================================
// RIPRISTINA TP dopo la finestra
//==========================================================================

void RestoreAllTP()
{
   string varNames[];
   int    count = 0;
   int    total = GlobalVariablesTotal();

   for(int i = 0; i < total; i++)
   {
      string name = GlobalVariableName(i);
      if(StringFind(name, "NG_TP_") == 0)
      {
         ArrayResize(varNames, count + 1);
         varNames[count++] = name;
      }
   }

   if(count == 0) { Print("[TradingGuard] Nessun TP da ripristinare."); return; }

   for(int i = 0; i < count; i++)
   {
      string varName   = varNames[i];
      ulong  ticket    = (ulong)StringToInteger(StringSubstr(varName, 6));

      if(!PositionSelectByTicket(ticket))
      {
         Print("[TradingGuard] Posizione #", ticket, " non più aperta — salto ripristino TP.");
         GlobalVariableDel(varName);
         continue;
      }

      double savedTP = GlobalVariableGet(varName);
      double sl      = PositionGetDouble(POSITION_SL);

      if(savedTP == 0.0) { GlobalVariableDel(varName); continue; }

      if(trade.PositionModify(ticket, sl, savedTP))
      {
         Print("[TradingGuard] TP ripristinato per #", ticket, " → ", savedTP);
         GlobalVariableDel(varName);
      }
      else
         Print("[TradingGuard] ERR ripristino TP #", ticket, ": ", GetLastError());
   }
}

//==========================================================================
// CHIUDI TUTTE LE POSIZIONI (kill switch dashboard)
//==========================================================================

void CloseAllPositions()
{
   int closed = 0, errors = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;

      string sym = PositionGetString(POSITION_SYMBOL);
      trade.SetDeviationInPoints(50);

      if(trade.PositionClose(ticket))
      {
         PrintFormat("[TradingGuard] Chiusa posizione #%d (%s)", ticket, sym);
         closed++;
      }
      else
      {
         PrintFormat("[TradingGuard] ERR chiusura #%d (%s): retcode=%d last_error=%d",
                     ticket, sym, trade.ResultRetcode(), GetLastError());
         errors++;
      }
   }
   PrintFormat("[TradingGuard] Kill switch completato: %d chiuse, %d errori.", closed, errors);
}

//==========================================================================
// LOG: Info sulla news nella finestra corrente
//==========================================================================

string GetCurrentWindowNewsInfo()
{
   datetime gmt = TimeGMT();
   for(int i = 0; i < g_eventCount; i++)
   {
      datetime winStart = g_events[i].utcTime - InpMinutesBefore * 60;
      datetime winEnd   = g_events[i].utcTime + InpMinutesAfter  * 60;
      if(gmt >= winStart && gmt <= winEnd)
         return g_events[i].country + " " + g_events[i].title
                + " @ " + TimeToString(g_events[i].utcTime, TIME_DATE | TIME_MINUTES) + " UTC";
   }
   return "N/A";
}

//==========================================================================
// FETCH CALENDARIO DA FOREX FACTORY
//==========================================================================

void FetchCalendar()
{
   g_lastRefresh = TimeCurrent();
   g_eventCount  = 0;
   ArrayResize(g_events, 0);

   string url     = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
   string headers = "Accept: application/json\r\n";
   char   post[], result[];
   string respHeaders;

   ResetLastError();
   int res = WebRequest("GET", url, headers, 10000, post, result, respHeaders);

   if(res == -1)
   {
      Print("[TradingGuard] ERR WebRequest (", GetLastError(), ")"
            " — aggiungi https://nfs.faireconomy.media in Strumenti > Opzioni > Consiglieri Esperti");
      return;
   }
   if(res != 200) { Print("[TradingGuard] ERR HTTP ", res, " da Forex Factory"); return; }

   string json = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   ParseFFJson(json);

   Print("[TradingGuard] Calendario aggiornato — ", g_eventCount,
         " eventi High Impact questa settimana (filtro: ", InpNewsCountry, ").");
   LogUpcomingEvents();
}

//==========================================================================
// PARSING JSON FOREX FACTORY
//==========================================================================

void ParseFFJson(string json)
{
   int pos = 0, len = StringLen(json);
   while(pos < len)
   {
      int objStart = StringFind(json, "{", pos);
      if(objStart < 0) break;
      int objEnd = FindJsonObjectEnd(json, objStart);
      if(objEnd < 0) break;

      string obj = StringSubstr(json, objStart, objEnd - objStart + 1);

      if(ExtractJsonString(obj, "impact") != "High") { pos = objEnd + 1; continue; }

      string country = ExtractJsonString(obj, "country");
      if(!IsCountryMonitored(country))               { pos = objEnd + 1; continue; }

      datetime utc = ParseFFDate(ExtractJsonString(obj, "date"));
      if(utc == 0)                                   { pos = objEnd + 1; continue; }

      int idx = g_eventCount;
      ArrayResize(g_events, idx + 1);
      g_events[idx].utcTime = utc;
      g_events[idx].country = country;
      g_events[idx].title   = ExtractJsonString(obj, "title");
      g_eventCount++;
      pos = objEnd + 1;
   }
}

int FindJsonObjectEnd(string json, int start)
{
   int depth = 0, len = StringLen(json);
   bool inString = false;
   for(int i = start; i < len; i++)
   {
      ushort c    = StringGetCharacter(json, i);
      ushort prev = (i > 0) ? StringGetCharacter(json, i - 1) : 0;
      if(c == '"' && prev != '\\') inString = !inString;
      if(!inString)
      {
         if(c == '{') depth++;
         if(c == '}') { depth--; if(depth == 0) return i; }
      }
   }
   return -1;
}

string ExtractJsonString(string obj, string key)
{
   string search = "\"" + key + "\":\"";
   int start = StringFind(obj, search);
   if(start < 0) return "";
   start += StringLen(search);
   int end = StringFind(obj, "\"", start);
   if(end < 0) return "";
   return StringSubstr(obj, start, end - start);
}

bool IsCountryMonitored(string country)
{
   string list[];
   int n = StringSplit(InpNewsCountry, ',', list);
   for(int i = 0; i < n; i++)
      if(list[i] == country) return true;
   return false;
}

datetime ParseFFDate(string s)
{
   if(StringLen(s) < 19) return 0;
   MqlDateTime dt;
   dt.year = (int)StringToInteger(StringSubstr(s, 0, 4));
   dt.mon  = (int)StringToInteger(StringSubstr(s, 5, 2));
   dt.day  = (int)StringToInteger(StringSubstr(s, 8, 2));
   dt.hour = (int)StringToInteger(StringSubstr(s, 11, 2));
   dt.min  = (int)StringToInteger(StringSubstr(s, 14, 2));
   dt.sec  = (int)StringToInteger(StringSubstr(s, 17, 2));
   dt.day_of_week = 0; dt.day_of_year = 0;
   datetime localTime = StructToTime(dt);
   if(StringLen(s) < 20) return localTime;
   string offsetPart = StringSubstr(s, 19);
   if(StringLen(offsetPart) < 3) return localTime;
   int sign = (StringGetCharacter(offsetPart, 0) == '-') ? -1 : 1;
   int offH, offM;
   if(StringFind(offsetPart, ":") > 0)
   { offH = (int)StringToInteger(StringSubstr(offsetPart, 1, 2)); offM = (int)StringToInteger(StringSubstr(offsetPart, 4, 2)); }
   else
   { offH = (int)StringToInteger(StringSubstr(offsetPart, 1, 2)); offM = (int)StringToInteger(StringSubstr(offsetPart, 3, 2)); }
   return localTime - sign * (offH * 3600 + offM * 60);
}

void LogUpcomingEvents()
{
   datetime gmt = TimeGMT();
   bool found = false;
   for(int i = 0; i < g_eventCount; i++)
   {
      if(g_events[i].utcTime >= gmt && g_events[i].utcTime <= gmt + 86400)
      {
         Print("[TradingGuard] [prossime 24h] ",
               g_events[i].country, " | ", g_events[i].title, " | ",
               TimeToString(g_events[i].utcTime, TIME_DATE | TIME_MINUTES), " UTC");
         found = true;
      }
   }
   if(!found) Print("[TradingGuard] Nessun evento High Impact nelle prossime 24 ore.");
}

//==========================================================================
// DASHBOARD — SNAPSHOT
//==========================================================================

void SendSnapshot()
{
   double balance      = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity       = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin       = AccountInfoDouble(ACCOUNT_MARGIN);
   double free_margin  = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double margin_level = (margin > 0) ? (equity / margin) * 100.0 : 0.0;
   double credit       = AccountInfoDouble(ACCOUNT_CREDIT);
   double open_pnl     = equity - balance - credit;
   double daily_pnl    = (equity - credit) - g_day_start_balance;

   string payload = "{";
   payload += "\"account_id\":\""    + AccountID                       + "\",";
   payload += "\"balance\":"         + DoubleToString(balance, 2)      + ",";
   payload += "\"equity\":"          + DoubleToString(equity, 2)       + ",";
   payload += "\"margin\":"          + DoubleToString(margin, 2)       + ",";
   payload += "\"free_margin\":"     + DoubleToString(free_margin, 2)  + ",";
   payload += "\"margin_level\":"    + DoubleToString(margin_level, 2) + ",";
   payload += "\"open_pnl\":"        + DoubleToString(open_pnl, 2)     + ",";
   payload += "\"daily_pnl\":"       + DoubleToString(daily_pnl, 2)    + ",";
   payload += "\"weekly_pnl\":"      + DoubleToString(CalcHistoricalPnL(7), 2)  + ",";
   payload += "\"monthly_pnl\":"     + DoubleToString(CalcHistoricalPnL(30), 2) + ",";
   payload += "\"snapshot_time\":\"" + FormatDatetime(TimeCurrent())   + "\",";
   payload += "\"news_window\":"     + (g_inWindow      ? "true" : "false") + ",";
   payload += "\"trading_paused\":"  + (g_tradingPaused ? "true" : "false") + ",";
   payload += "\"positions\":"       + BuildPositionsJSON();
   payload += "}";

   if(PostRequest("/api/snapshots", payload))
      Print("[TradingGuard] Snapshot inviato.");
   else
      Print("[TradingGuard] ERRORE invio snapshot.");
}

double CalcHistoricalPnL(int days)
{
   datetime from = TimeCurrent() - (days * 86400);
   if(!HistorySelect(from, TimeCurrent())) return 0;
   double total = 0;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT) continue;
      total += HistoryDealGetDouble(ticket, DEAL_PROFIT);
      total += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      total += HistoryDealGetDouble(ticket, DEAL_SWAP);
   }
   return total;
}

string BuildPositionsJSON()
{
   string result = "[";
   int added = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(added > 0) result += ",";
      result += "{";
      result += "\"ticket\":"      + IntegerToString(ticket) + ",";
      result += "\"symbol\":\""    + PositionGetString(POSITION_SYMBOL) + "\",";
      result += "\"direction\":\"" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL") + "\",";
      result += "\"lots\":"        + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) + ",";
      result += "\"open_price\":"  + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 5) + ",";
      result += "\"cur_price\":"   + DoubleToString(PositionGetDouble(POSITION_PRICE_CURRENT), 5) + ",";
      result += "\"profit\":"      + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + ",";
      result += "\"swap\":"        + DoubleToString(PositionGetDouble(POSITION_SWAP), 2) + ",";
      result += "\"open_time\":\"" + FormatDatetime((datetime)PositionGetInteger(POSITION_TIME)) + "\",";
      result += "\"comment\":\""   + EscapeJSON(PositionGetString(POSITION_COMMENT)) + "\"";
      result += "}";
      added++;
   }
   return result + "]";
}

//==========================================================================
// DASHBOARD — POLLING COMANDI
//==========================================================================

void PollCommands()
{
   char result[], empty[];
   string result_headers;
   string url     = BackendURL + "/api/accounts/" + AccountID + "/commands";
   string headers = "X-API-Key: " + APIKey + "\r\n";

   ResetLastError();
   int res = WebRequest("GET", url, headers, 10000, empty, result, result_headers);

   if(res != 200)
   {
      if(res != -1)
         PrintFormat("[TradingGuard] Polling comandi fallito. HTTP %d", res);
      return;
   }

   string response = CharArrayToString(result);

   // Kill switch
   if(ExtractBool(response, "kill_switch"))
   {
      Print("[TradingGuard] KILL SWITCH attivato — chiusura tutte le posizioni...");
      CloseAllPositions();
      PostRequest("/api/accounts/" + AccountID + "/reset_kill_switch",
                  "{\"account_id\":\"" + AccountID + "\"}");
   }

   // Pausa trading
   bool pause_trading = ExtractBool(response, "pause_trading");
   if(pause_trading && !g_tradingPaused)
   {
      g_tradingPaused  = true;
      g_lastCancelTime = 0;
      GlobalVariableSet("TRADING_PAUSED", 1.0);
      Print("[TradingGuard] PAUSA TRADING attivata — pendenti cancellati periodicamente.");
   }
   else if(!pause_trading && g_tradingPaused)
   {
      g_tradingPaused = false;
      GlobalVariableSet("TRADING_PAUSED", 0.0);
      Print("[TradingGuard] PAUSA TRADING disattivata.");
   }
}

//==========================================================================
// HTTP HELPERS
//==========================================================================

bool PostRequest(string endpoint, string json)
{
   char post_data[], result[];
   string result_headers;
   int json_len = StringToCharArray(json, post_data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(post_data, json_len);
   string headers = "Content-Type: application/json\r\nX-API-Key: " + APIKey + "\r\n";
   ResetLastError();
   int res = WebRequest("POST", BackendURL + endpoint, headers, 15000, post_data, result, result_headers);
   return (res >= 200 && res < 300);
}

bool ExtractBool(string json, string key)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if(pos < 0) return false;
   pos += StringLen(search);
   while(pos < StringLen(json) && StringGetCharacter(json, pos) == ' ') pos++;
   return (StringFind(StringSubstr(json, pos, 5), "true") >= 0);
}

string FormatDatetime(datetime dt)
{
   if(dt == 0) return "1970-01-01T00:00:00Z";
   MqlDateTime mdt;
   TimeToStruct(dt, mdt);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       mdt.year, mdt.mon, mdt.day, mdt.hour, mdt.min, mdt.sec);
}

string EscapeJSON(string s)
{
   string result = "";
   int len = StringLen(s);
   for(int i = 0; i < len; i++)
   {
      ushort c = StringGetCharacter(s, i);
      if(c == '\\')      result += "\\\\";
      else if(c == '"')  result += "\\\"";
      else if(c == '/')  result += "\\/";
      else if(c == '\n') result += "\\n";
      else if(c == '\r') result += "\\r";
      else if(c == '\t') result += "\\t";
      else if(c < 32 || c > 127) result += "";
      else               result += ShortToString(c);
   }
   return result;
}
//+------------------------------------------------------------------+
