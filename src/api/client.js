const BASE_URL = import.meta.env.VITE_API_URL || "https://trading-dashboard-1qnr.onrender.com";
const API_KEY  = import.meta.env.VITE_API_KEY  || "";

const USE_MOCK = false; // ← COLLEGATO AL BACKEND REALE

import { mockEAs, mockTrades, mockAccounts } from "../data/mock.js";

async function request(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
      ...options.headers
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  getEAs: async (includeHidden = false) => {
    if (USE_MOCK) return mockEAs.filter(ea => includeHidden || !ea.is_hidden);
    const data = await request(`/api/eas?include_hidden=${includeHidden}`);
    return data.eas;
  },

  getEATrades: async (eaName) => {
    if (USE_MOCK) {
      const existing = mockTrades.filter(t => t.ea_name === eaName);
      if (existing.length > 0) return existing;
      return Array.from({ length: 40 }, (_, i) => {
        const isWin = Math.random() > 0.40;
        const profit = isWin ? +(Math.random() * 70 + 10).toFixed(2) : -(Math.random() * 45 + 5).toFixed(2);
        const date = new Date(2025, 9, 1);
        date.setDate(date.getDate() + i * 4);
        return {
          ticket: 2000000 + i, ea_name: eaName, symbol: "XAUUSD",
          direction: Math.random() > 0.5 ? "BUY" : "SELL", lots: 0.10,
          open_time: date.toISOString(),
          close_time: new Date(date.getTime() + 3600000 * (Math.random() * 6 + 1)).toISOString(),
          profit, commission: -0.70, swap: 0,
          net_profit: +(profit - 0.70).toFixed(2),
        };
      });
    }
    const data = await request(`/api/eas/${encodeURIComponent(eaName)}`);
    return data.trades.map(t => ({
      ...t,
      net_profit: t.profit + (t.commission || 0) + (t.swap || 0),
    }));
  },

  getAccounts: async () => {
    if (USE_MOCK) return { accounts: mockAccounts, server_time: null };
    const data = await request("/api/accounts");
    return { accounts: data.accounts, server_time: data.server_time ? new Date(data.server_time) : null };
  },

  getAccountSnapshots: async (accountId) => {
    if (USE_MOCK) return [];
    const data = await request(`/api/accounts/${accountId}/snapshots`);
    return data.snapshots || [];
  },

setPause: async (accountId, paused) => {
    if (USE_MOCK) return { status: "ok" };
    return request(`/api/accounts/${accountId}/pause`, {
      method: "POST",
      body: JSON.stringify({ pause_trading: paused }),
    });
  },

  closeAll: async (accountId) => {
    if (USE_MOCK) return { status: "ok" };
    return request(`/api/accounts/${accountId}/close_all`, { method: "POST" });
  },

  updateAccount: async (accountId, data) => {
    if (USE_MOCK) return { status: "ok" };
    return request(`/api/accounts/${accountId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  getAllTrades: async () => {
    if (USE_MOCK) {
      const result = {};
      for (const ea of mockEAs.filter(e => !e.is_hidden)) {
        const existing = mockTrades.filter(t => t.ea_name === ea.ea_name);
        result[ea.ea_name] = existing.length > 0 ? existing : Array.from({ length: 45 }, (_, i) => {
          const isWin = Math.random() > 0.40;
          const profit = isWin ? +(Math.random() * 70 + 5).toFixed(2) : -(Math.random() * 45 + 5).toFixed(2);
          const date = new Date(2025, 8, 1);
          date.setDate(date.getDate() + i * 4 + Math.floor(Math.random() * 2));
          return {
            ea_name: ea.ea_name, symbol: ea.symbol || "XAUUSD",
            direction: Math.random() > 0.5 ? "BUY" : "SELL",
            lots: ea.avg_lots || 0.10,
            open_time: date.toISOString(),
            close_time: new Date(date.getTime() + 3600000 * (Math.random() * 6 + 1)).toISOString(),
            profit, commission: -0.70, swap: 0,
            net_profit: +(profit - 0.70).toFixed(2),
          };
        });
      }
      return result;
    }
    const data = await request("/api/trades/all");
    return data.trades_by_ea;
  },

  // ─── EA Configs ─────────────────────────────────────────────────────────
  getEAConfigs: async () => {
    if (USE_MOCK) {
      try {
        const saved = localStorage.getItem("ea_configs");
        return saved ? JSON.parse(saved) : {};
      } catch { return {}; }
    }
    const data = await request("/api/ea-configs");
    return data.configs;
  },

  deleteAccount: async (accountId) => {
  if (USE_MOCK) return { status: "ok" };
  return request(`/api/accounts/${accountId}`, { method: "DELETE" });
  },
  
  getNews: async (week = "current") => {
  if (USE_MOCK) return [];
  const data = await request(`/api/news?week=${week}`);
  return data.events || [];
  },

  saveEAConfig: async (eaName, fields) => {
    if (USE_MOCK) {
      try {
        const saved   = localStorage.getItem("ea_configs");
        const configs = saved ? JSON.parse(saved) : {};
        configs[eaName] = { ...configs[eaName], ...fields };
        localStorage.setItem("ea_configs", JSON.stringify(configs));
      } catch {}
      return { status: "ok" };
    }
    return request("/api/ea-configs", {
      method: "POST",
      body: JSON.stringify({ ea_name: eaName, ...fields }),
    });
  },


  getBacktestData: async () => {
    if (USE_MOCK) return { status: "no_data", ea_pool: {}, portfolio_collections: {} };
    const data = await request("/api/backtest/data");
    return data;
  },

  getOptimizerData: async () => {
    if (USE_MOCK) return { status: "no_data", collections: {} };
    const data = await request("/api/backtest/optimizer");
    return data;
  },

  simulateChallenge: async (params) => {
    if (USE_MOCK) return { results: [], optimal_risk_pct: null, trade_count: 0, n_simulations: 0 };
    return request("/api/backtest/simulate", {
      method: "POST",
      body: JSON.stringify(params),
    });
  },
};