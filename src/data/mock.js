export const mockEAs = [
  {
    ea_name: "GoldStrike", symbol: "XAUUSD",
    total_trades: 124, win_trades: 78, loss_trades: 46,
    win_rate_pct: 62.9, total_net_profit: 1842.50, total_net_profit_norm: 184.25,
    profit_factor: 2.14, max_dd: 420.30, avg_lots: 0.10,
    avg_win: 38.20, avg_loss: -22.10, avg_rr: 1.73,
    max_consec_loss: 4, expectancy: 14.86,
    first_trade_date: "2025-09-01", last_trade_date: "2026-05-20",
    is_hidden: false,
  },
  {
    ea_name: "BreakoutPro", symbol: "XAUUSD",
    total_trades: 89, win_trades: 52, loss_trades: 37,
    win_rate_pct: 58.4, total_net_profit: 1120.30, total_net_profit_norm: 112.03,
    profit_factor: 1.87, max_dd: 380.10, avg_lots: 0.10,
    avg_win: 32.40, avg_loss: -19.80, avg_rr: 1.64,
    max_consec_loss: 6, expectancy: 12.59,
    first_trade_date: "2025-10-15", last_trade_date: "2026-05-22",
    is_hidden: false,
  },
  {
    ea_name: "ScalpMaster", symbol: "NAS100",
    total_trades: 312, win_trades: 198, loss_trades: 114,
    win_rate_pct: 63.5, total_net_profit: 2340.80, total_net_profit_norm: 234.08,
    profit_factor: 2.31, max_dd: 510.40, avg_lots: 0.10,
    avg_win: 18.60, avg_loss: -12.30, avg_rr: 1.51,
    max_consec_loss: 5, expectancy: 7.50,
    first_trade_date: "2025-08-01", last_trade_date: "2026-05-25",
    is_hidden: false,
  },
  {
    ea_name: "TrendFollower", symbol: "XAUUSD",
    total_trades: 45, win_trades: 27, loss_trades: 18,
    win_rate_pct: 60.0, total_net_profit: 640.20, total_net_profit_norm: 64.02,
    profit_factor: 1.72, max_dd: 290.50, avg_lots: 0.10,
    avg_win: 42.10, avg_loss: -24.60, avg_rr: 1.71,
    max_consec_loss: 3, expectancy: 14.23,
    first_trade_date: "2026-01-10", last_trade_date: "2026-05-18",
    is_hidden: false,
  },
  {
    ea_name: "NewsGuard", symbol: "EURUSD",
    total_trades: 67, win_trades: 38, loss_trades: 29,
    win_rate_pct: 56.7, total_net_profit: 420.10, total_net_profit_norm: 42.01,
    profit_factor: 1.54, max_dd: 310.20, avg_lots: 0.10,
    avg_win: 28.30, avg_loss: -18.90, avg_rr: 1.50,
    max_consec_loss: 7, expectancy: 6.27,
    first_trade_date: "2025-11-20", last_trade_date: "2026-05-21",
    is_hidden: false,
  },
  {
    ea_name: "DAX Breakout", symbol: "GDAXI",
    total_trades: 98, win_trades: 55, loss_trades: 43,
    win_rate_pct: 56.1, total_net_profit: 780.40, total_net_profit_norm: 78.04,
    profit_factor: 1.68, max_dd: 440.20, avg_lots: 0.10,
    avg_win: 24.60, avg_loss: -16.80, avg_rr: 1.46,
    max_consec_loss: 5, expectancy: 7.97,
    first_trade_date: "2025-09-15", last_trade_date: "2026-05-23",
    is_hidden: false,
  },
  {
    ea_name: "OldStrategy_v1", symbol: "XAUUSD",
    total_trades: 200, win_trades: 90, loss_trades: 110,
    win_rate_pct: 45.0, total_net_profit: -320.00, total_net_profit_norm: -32.00,
    profit_factor: 0.82, max_dd: 890.40, avg_lots: 0.10,
    avg_win: 24.10, avg_loss: -21.30, avg_rr: 1.13,
    max_consec_loss: 12, expectancy: -1.60,
    first_trade_date: "2025-06-01", last_trade_date: "2025-12-31",
    is_hidden: true,
  },
];

export const mockTrades = Array.from({ length: 60 }, (_, i) => {
  const isWin = Math.random() > 0.38;
  const profit = isWin ? +(Math.random() * 80 + 10).toFixed(2) : -(Math.random() * 50 + 5).toFixed(2);
  const date = new Date(2025, 8, 1);
  date.setDate(date.getDate() + i * 3);
  return {
    ticket: 1000000 + i,
    ea_name: "GoldStrike", symbol: "XAUUSD",
    direction: Math.random() > 0.5 ? "BUY" : "SELL",
    lots: 0.10,
    open_time: date.toISOString(),
    close_time: new Date(date.getTime() + 3600000 * (Math.random() * 8 + 1)).toISOString(),
    profit, commission: -0.70, swap: 0,
    net_profit: +(profit - 0.70).toFixed(2),
  };
});

export const mockAccounts = [
  { id: "AXI_DEMO_01",   name: "Axi Demo XAUUSD",   broker: "Axi",        platform: "MT5", account_type: "Demo", balance: 10000, equity: 10234.50, open_pnl: 234.50,   daily_pnl: 120.30,  weekly_pnl: 340.80,  monthly_pnl: 890.20,  margin_level: 420.5 },
  { id: "FTMO_PROP_01",  name: "FTMO 10K Challenge", broker: "FTMO",       platform: "MT5", account_type: "Prop", balance: 10000, equity:  9870.20, open_pnl: -129.80,  daily_pnl: -80.50,  weekly_pnl: 120.40,  monthly_pnl: 320.10,  margin_level: 380.2, max_daily_dd_pct: 5, max_total_dd_pct: 10, profit_target_pct: 8,  initial_balance: 10000 },
  { id: "FIVER_PROP_01", name: "The5ers Hyper 10K",  broker: "The5ers",    platform: "MT5", account_type: "Prop", balance: 10500, equity: 10680.00, open_pnl: 180.00,   daily_pnl: 95.20,   weekly_pnl: 280.60,  monthly_pnl: 620.40,  margin_level: 510.8, max_daily_dd_pct: 4, max_total_dd_pct: 8,  profit_target_pct: 10, initial_balance: 10000 },
  { id: "MT4_DEMO_01",   name: "MT4 Demo Multi-EA",  broker: "Tradeslide", platform: "MT4", account_type: "Demo", balance: 50000, equity: 51240.30, open_pnl: 1240.30,  daily_pnl: 310.40,  weekly_pnl: 820.90,  monthly_pnl: 2140.60, margin_level: 890.1 },
];