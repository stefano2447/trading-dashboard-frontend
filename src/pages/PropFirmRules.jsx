import { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronUp } from "lucide-react";

// ─── Dati precompilati ────────────────────────────────────────────────────────

const DEFAULT_FIRMS = [
  {
    id: "the5ers",
    name: "The5ers",
    website: "https://the5ers.com",
    challenges: [
      {
        id: "the5ers_2phase",
        name: "2 Fasi (High Stakes)",
        type: "2-fase",
        params: {
          profit_target_p1:    8,
          profit_target_p2:    5,
          daily_dd:            5,
          max_dd:              10,
          min_trading_days:    0,
          time_limit_days:     0,
          leverage:            "1:30",
          profit_split:        "80% → 100%",
          scaling:             "Fino a $4M",
          payout_frequency:    "Su richiesta",
        },
        rules: {
          ea_allowed:          true,
          weekend_hold:        true,
          news_trading_challenge: "Permesso (no nuovi ordini 2 min prima/dopo su High Stakes)",
          news_trading_funded:    "Permesso (no nuovi ordini 2 min prima/dopo su High Stakes)",
          news_holding:           true,
          min_sl_required:        false,
          max_risk_per_trade:     "Nessun limite (2% su Bootcamp)",
          consistency_rule:       "Nessuna",
          hft_allowed:            false,
          copy_trading:           false,
          martingale:             false,
          hedging:                false,
          min_trade_duration:     "Nessun limite",
          inactivity_rule:        "Nessuna",
          other_rules:            "Vietato bracketing con pending orders intorno a news. Vietato scalping durante rollover. Vietato reverse/hedge arbitrage.",
        },
      },
      {
        id: "the5ers_bootcamp",
        name: "Bootcamp",
        type: "1-fase",
        params: {
          profit_target_p1:    10,
          profit_target_p2:    null,
          daily_dd:            4,
          max_dd:              8,
          min_trading_days:    0,
          time_limit_days:     365,
          leverage:            "1:30",
          profit_split:        "50% → 100%",
          scaling:             "Fino a $4M",
          payout_frequency:    "Su richiesta",
        },
        rules: {
          ea_allowed:             true,
          weekend_hold:           true,
          news_trading_challenge: "Permesso",
          news_trading_funded:    "Permesso",
          news_holding:           true,
          min_sl_required:        true,
          max_risk_per_trade:     "2% del balance",
          consistency_rule:       "Nessuna",
          hft_allowed:            false,
          copy_trading:           false,
          martingale:             false,
          hedging:                false,
          min_trade_duration:     "Nessun limite",
          inactivity_rule:        "Nessuna",
          other_rules:            "Stop loss obbligatorio su ogni trade. Max 2% rischio per posizione.",
        },
      },
    ],
  },
  {
    id: "ftmo",
    name: "FTMO",
    website: "https://ftmo.com",
    challenges: [
      {
        id: "ftmo_2step",
        name: "2 Step Challenge",
        type: "2-fase",
        params: {
          profit_target_p1:    10,
          profit_target_p2:    5,
          daily_dd:            5,
          max_dd:              10,
          min_trading_days:    10,
          time_limit_days:     60,
          leverage:            "1:30 – 1:100",
          profit_split:        "80% → 90%",
          scaling:             "+25% ogni 4 mesi fino $2M",
          payout_frequency:    "Bisettimanale",
        },
        rules: {
          ea_allowed:             true,
          weekend_hold:           true,
          news_trading_challenge: "Permesso",
          news_trading_funded:    "Permesso",
          news_holding:           true,
          min_sl_required:        false,
          max_risk_per_trade:     "Nessun limite",
          consistency_rule:       "Nessuna",
          hft_allowed:            false,
          copy_trading:           false,
          martingale:             false,
          hedging:                false,
          min_trade_duration:     "Nessun limite",
          inactivity_rule:        "Nessuna",
          other_rules:            "Minimo 10 giorni di trading. Massimo 60 giorni per completare la challenge.",
        },
      },
    ],
  },
  {
    id: "fundingpips",
    name: "FundingPips",
    website: "https://fundingpips.com",
    challenges: [
      {
        id: "fp_2step",
        name: "2 Step Standard",
        type: "2-fase",
        params: {
          profit_target_p1:    8,
          profit_target_p2:    5,
          daily_dd:            5,
          max_dd:              10,
          min_trading_days:    3,
          time_limit_days:     0,
          leverage:            "1:100",
          profit_split:        "95%",
          scaling:             "Fino a $300K",
          payout_frequency:    "Bisettimanale",
        },
        rules: {
          ea_allowed:             true,
          weekend_hold:           true,
          news_trading_challenge: "VIETATO — finestra 5 min prima/dopo evento red folder",
          news_trading_funded:    "VIETATO — finestra 5 min prima/dopo evento red folder",
          news_holding:           true,
          min_sl_required:        false,
          max_risk_per_trade:     "Nessun limite",
          consistency_rule:       "15% su account Zero",
          hft_allowed:            false,
          copy_trading:           false,
          martingale:             false,
          hedging:                false,
          min_trade_duration:     "Nessun limite",
          inactivity_rule:        "Nessuna",
          other_rules:            "Solo EA come trade/risk management tool. Vietato HFT, arbitrage, tick scalping, toxic order flow. DD statico (non trailing) su 2-step.",
        },
      },
      {
        id: "fp_1step",
        name: "1 Step",
        type: "1-fase",
        params: {
          profit_target_p1:    10,
          profit_target_p2:    null,
          daily_dd:            3,
          max_dd:              6,
          min_trading_days:    3,
          time_limit_days:     0,
          leverage:            "1:100",
          profit_split:        "95%",
          scaling:             "Fino a $300K",
          payout_frequency:    "Bisettimanale",
        },
        rules: {
          ea_allowed:             true,
          weekend_hold:           true,
          news_trading_challenge: "VIETATO — finestra 5 min prima/dopo evento red folder",
          news_trading_funded:    "VIETATO — finestra 5 min prima/dopo evento red folder",
          news_holding:           true,
          min_sl_required:        false,
          max_risk_per_trade:     "Nessun limite",
          consistency_rule:       "Nessuna",
          hft_allowed:            false,
          copy_trading:           false,
          martingale:             false,
          hedging:                false,
          min_trade_duration:     "Nessun limite",
          inactivity_rule:        "Nessuna",
          other_rules:            "DD massimo 6% con target 10% — ratio 1.67:1. Più difficile del 2-step.",
        },
      },
      {
        id: "fp_zero",
        name: "Zero (Instant Funding)",
        type: "instant",
        params: {
          profit_target_p1:    null,
          profit_target_p2:    null,
          daily_dd:            3,
          max_dd:              5,
          min_trading_days:    0,
          time_limit_days:     0,
          leverage:            "1:100",
          profit_split:        "95%",
          scaling:             "Fino a $300K",
          payout_frequency:    "Bisettimanale",
        },
        rules: {
          ea_allowed:             true,
          weekend_hold:           false,
          news_trading_challenge: "N/A (nessuna challenge)",
          news_trading_funded:    "VIETATO — finestra 5 min prima/dopo",
          news_holding:           false,
          min_sl_required:        false,
          max_risk_per_trade:     "Nessun limite",
          consistency_rule:       "15% — profitto giornaliero max 15% del totale",
          hft_allowed:            false,
          copy_trading:           false,
          martingale:             false,
          hedging:                false,
          min_trade_duration:     "Nessun limite",
          inactivity_rule:        "Nessuna",
          other_rules:            "DD trailing (si alza con i profitti). Vietato weekend hold. Nessuna fase di valutazione.",
        },
      },
    ],
  },
  {
    id: "tradingpit",
    name: "The Trading Pit",
    website: "https://thetradingpit.com",
    challenges: [
      {
        id: "ttp_cfd_prime_2fase",
        name: "CFD Prime 2 Fasi",
        type: "2-fase",
        params: {
          profit_target_p1:    6,
          profit_target_p2:    1.2,
          daily_dd:            5,
          max_dd:              10,
          min_trading_days:    3,
          time_limit_days:     0,
          leverage:            "1:50",
          profit_split:        "50% → 80%",
          scaling:             "Fino a $5M",
          payout_frequency:    "Bisettimanale",
        },
        rules: {
          ea_allowed:             true,
          weekend_hold:           true,
          news_trading_challenge: "VIETATO — 2 min prima/dopo annuncio",
          news_trading_funded:    "VIETATO — 2 min prima/dopo annuncio",
          news_holding:           true,
          min_sl_required:        false,
          max_risk_per_trade:     "Nessun limite",
          consistency_rule:       "40% — nessun giorno > 40% del target",
          hft_allowed:            false,
          copy_trading:           false,
          martingale:             false,
          hedging:                false,
          min_trade_duration:     "1 minuto",
          inactivity_rule:        "21 giorni — account chiuso se inattivo",
          other_rules:            "DD giornaliero balance-based, reset alle 16:15 CT. Profitto minimo 0.5% per 3 giorni per payout. Vietato scalping < 1 min.",
        },
      },
      {
        id: "ttp_cfd_prime_1fase",
        name: "CFD Prime 1 Fase",
        type: "1-fase",
        params: {
          profit_target_p1:    6,
          profit_target_p2:    null,
          daily_dd:            5,
          max_dd:              10,
          min_trading_days:    3,
          time_limit_days:     0,
          leverage:            "1:50",
          profit_split:        "50% → 80%",
          scaling:             "Fino a $5M",
          payout_frequency:    "Bisettimanale",
        },
        rules: {
          ea_allowed:             true,
          weekend_hold:           true,
          news_trading_challenge: "VIETATO — 2 min prima/dopo annuncio",
          news_trading_funded:    "VIETATO — 2 min prima/dopo annuncio",
          news_holding:           true,
          min_sl_required:        false,
          max_risk_per_trade:     "Nessun limite",
          consistency_rule:       "40% — nessun giorno > 40% del target",
          hft_allowed:            false,
          copy_trading:           false,
          martingale:             false,
          hedging:                false,
          min_trade_duration:     "1 minuto",
          inactivity_rule:        "21 giorni",
          other_rules:            "Stesse regole della 2 fasi ma fase singola. Profitto minimo 0.5% per 3 giorni per payout.",
        },
      },
    ],
  },
];

// ─── Persistenza localStorage ─────────────────────────────────────────────────

function loadFirms() {
  try {
    const saved = localStorage.getItem("prop_firm_rules");
    return saved ? JSON.parse(saved) : DEFAULT_FIRMS;
  } catch { return DEFAULT_FIRMS; }
}

function saveFirms(firms) {
  try { localStorage.setItem("prop_firm_rules", JSON.stringify(firms)); } catch {}
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────

function BoolBadge({ value }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
      background: value ? "var(--accent-dim)" : "var(--danger-dim)",
      color: value ? "var(--accent)" : "var(--danger)",
    }}>
      {value ? "✓ Sì" : "✗ No"}
    </span>
  );
}

function RuleRow({ label, value, isBool = false }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "0.5rem 0", borderBottom: "1px solid var(--border)", gap: "1rem",
    }}>
      <span style={{ fontSize: 13, color: "var(--text-muted)", flexShrink: 0, minWidth: 180 }}>{label}</span>
      {isBool
        ? <BoolBadge value={value} />
        : <span style={{ fontSize: 13, color: "var(--text-primary)", textAlign: "right", fontWeight: 500 }}>{value}</span>
      }
    </div>
  );
}

function typeLabel(type) {
  return type === "2-fase" ? "2 Fasi" : type === "1-fase" ? "1 Fase" : type === "instant" ? "Instant Funding" : type;
}

function typeColor(type) {
  return type === "2-fase" ? "var(--accent)" : type === "1-fase" ? "var(--warning)" : "var(--text-secondary)";
}

// ─── Modale nuova prop firm ───────────────────────────────────────────────────
function AddFirmModal({ onClose, onAdd }) {
  const [name, setName]       = useState("");
  const [website, setWebsite] = useState("");

  const inputStyle = {
    width: "100%", background: "var(--bg-elevated)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)", padding: "0.5rem 0.75rem",
    fontSize: 13, outline: "none",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.5rem", width: 380 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Aggiungi Prop Firm</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>NOME</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="es. MyFundedFX" style={inputStyle} autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>WEBSITE (opzionale)</label>
            <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." style={inputStyle} />
          </div>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button onClick={onClose} style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>Annulla</button>
            <button
              disabled={!name.trim()}
              onClick={() => { onAdd({ id: Date.now().toString(), name: name.trim(), website: website.trim(), challenges: [] }); onClose(); }}
              style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "none", background: name.trim() ? "var(--accent)" : "var(--bg-elevated)", color: name.trim() ? "#000" : "var(--text-muted)", cursor: name.trim() ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}
            >
              Aggiungi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modale nuova challenge ───────────────────────────────────────────────────
function AddChallengeModal({ onClose, onAdd }) {
  const [form, setForm] = useState({
    name: "", type: "2-fase",
    profit_target_p1: "", profit_target_p2: "",
    daily_dd: "", max_dd: "",
    min_trading_days: "", time_limit_days: "",
    leverage: "", profit_split: "", scaling: "", payout_frequency: "",
    ea_allowed: true, weekend_hold: true,
    news_trading_challenge: "", news_trading_funded: "", news_holding: true,
    min_sl_required: false, max_risk_per_trade: "",
    consistency_rule: "", hft_allowed: false, copy_trading: false,
    martingale: false, hedging: false,
    min_trade_duration: "", inactivity_rule: "", other_rules: "",
  });

  function upd(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const inputStyle = { width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", padding: "0.45rem 0.65rem", fontSize: 12, outline: "none" };
  const labelStyle = { fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 3 };

  function handleAdd() {
    const challenge = {
      id: Date.now().toString(),
      name: form.name,
      type: form.type,
      params: {
        profit_target_p1:    form.profit_target_p1 ? Number(form.profit_target_p1) : null,
        profit_target_p2:    form.profit_target_p2 ? Number(form.profit_target_p2) : null,
        daily_dd:            form.daily_dd ? Number(form.daily_dd) : null,
        max_dd:              form.max_dd ? Number(form.max_dd) : null,
        min_trading_days:    form.min_trading_days ? Number(form.min_trading_days) : 0,
        time_limit_days:     form.time_limit_days ? Number(form.time_limit_days) : 0,
        leverage:            form.leverage,
        profit_split:        form.profit_split,
        scaling:             form.scaling,
        payout_frequency:    form.payout_frequency,
      },
      rules: {
        ea_allowed:             form.ea_allowed,
        weekend_hold:           form.weekend_hold,
        news_trading_challenge: form.news_trading_challenge,
        news_trading_funded:    form.news_trading_funded,
        news_holding:           form.news_holding,
        min_sl_required:        form.min_sl_required,
        max_risk_per_trade:     form.max_risk_per_trade,
        consistency_rule:       form.consistency_rule,
        hft_allowed:            form.hft_allowed,
        copy_trading:           form.copy_trading,
        martingale:             form.martingale,
        hedging:                form.hedging,
        min_trade_duration:     form.min_trade_duration,
        inactivity_rule:        form.inactivity_rule,
        other_rules:            form.other_rules,
      },
    };
    onAdd(challenge);
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: "1rem" }}>
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "1.5rem", width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Aggiungi Challenge</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {/* Nome e tipo */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle}>NOME CHALLENGE</label>
              <input value={form.name} onChange={e => upd("name", e.target.value)} placeholder="es. 2 Step Classic" style={inputStyle} autoFocus />
            </div>
            <div>
              <label style={labelStyle}>TIPO</label>
              <select value={form.type} onChange={e => upd("type", e.target.value)} style={inputStyle}>
                <option value="2-fase">2 Fasi</option>
                <option value="1-fase">1 Fase</option>
                <option value="instant">Instant Funding</option>
              </select>
            </div>
          </div>

          <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.05em", marginTop: 4 }}>PARAMETRI BASE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.75rem" }}>
            <div><label style={labelStyle}>TARGET P1 (%)</label><input type="number" value={form.profit_target_p1} onChange={e => upd("profit_target_p1", e.target.value)} placeholder="es. 8" style={inputStyle} /></div>
            <div><label style={labelStyle}>TARGET P2 (%)</label><input type="number" value={form.profit_target_p2} onChange={e => upd("profit_target_p2", e.target.value)} placeholder="es. 5" style={inputStyle} /></div>
            <div><label style={labelStyle}>DD GIORN. (%)</label><input type="number" value={form.daily_dd} onChange={e => upd("daily_dd", e.target.value)} placeholder="es. 5" style={inputStyle} /></div>
            <div><label style={labelStyle}>MAX DD (%)</label><input type="number" value={form.max_dd} onChange={e => upd("max_dd", e.target.value)} placeholder="es. 10" style={inputStyle} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.75rem" }}>
            <div><label style={labelStyle}>MIN GIORNI</label><input type="number" value={form.min_trading_days} onChange={e => upd("min_trading_days", e.target.value)} placeholder="es. 5" style={inputStyle} /></div>
            <div><label style={labelStyle}>LIMITE GIORNI</label><input type="number" value={form.time_limit_days} onChange={e => upd("time_limit_days", e.target.value)} placeholder="0=nessuno" style={inputStyle} /></div>
            <div><label style={labelStyle}>LEVA</label><input value={form.leverage} onChange={e => upd("leverage", e.target.value)} placeholder="es. 1:100" style={inputStyle} /></div>
            <div><label style={labelStyle}>SPLIT</label><input value={form.profit_split} onChange={e => upd("profit_split", e.target.value)} placeholder="es. 80%" style={inputStyle} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div><label style={labelStyle}>SCALING</label><input value={form.scaling} onChange={e => upd("scaling", e.target.value)} placeholder="es. Fino a $2M" style={inputStyle} /></div>
            <div><label style={labelStyle}>FREQUENZA PAYOUT</label><input value={form.payout_frequency} onChange={e => upd("payout_frequency", e.target.value)} placeholder="es. Bisettimanale" style={inputStyle} /></div>
          </div>

          <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.05em", marginTop: 4 }}>REGOLE</div>

          {/* Toggle rules */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
            {[
              { key: "ea_allowed",       label: "EA Permessi"      },
              { key: "weekend_hold",     label: "Weekend Hold"     },
              { key: "news_holding",     label: "News Holding"     },
              { key: "min_sl_required",  label: "SL Obbligatorio"  },
              { key: "hft_allowed",      label: "HFT Permesso"     },
              { key: "copy_trading",     label: "Copy Trading"     },
              { key: "martingale",       label: "Martingale"       },
              { key: "hedging",          label: "Hedging"          },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => upd(key, !form[key])} style={{
                padding: "0.4rem 0.5rem", fontSize: 12, borderRadius: "var(--radius-sm)",
                border: `1px solid ${form[key] ? "var(--accent)" : "var(--border)"}`,
                background: form[key] ? "var(--accent-dim)" : "var(--bg-elevated)",
                color: form[key] ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer", textAlign: "left",
              }}>
                {form[key] ? "✓" : "✗"} {label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div><label style={labelStyle}>NEWS TRADING IN CHALLENGE</label><input value={form.news_trading_challenge} onChange={e => upd("news_trading_challenge", e.target.value)} placeholder="es. Vietato 5 min prima/dopo" style={inputStyle} /></div>
            <div><label style={labelStyle}>NEWS TRADING IN FUNDED</label><input value={form.news_trading_funded} onChange={e => upd("news_trading_funded", e.target.value)} placeholder="es. Permesso" style={inputStyle} /></div>
            <div><label style={labelStyle}>MAX RISCHIO/TRADE</label><input value={form.max_risk_per_trade} onChange={e => upd("max_risk_per_trade", e.target.value)} placeholder="es. 2% del balance" style={inputStyle} /></div>
            <div><label style={labelStyle}>REGOLA CONSISTENZA</label><input value={form.consistency_rule} onChange={e => upd("consistency_rule", e.target.value)} placeholder="es. Max 40% in un giorno" style={inputStyle} /></div>
            <div><label style={labelStyle}>MIN DURATA TRADE</label><input value={form.min_trade_duration} onChange={e => upd("min_trade_duration", e.target.value)} placeholder="es. 1 minuto" style={inputStyle} /></div>
            <div><label style={labelStyle}>REGOLA INATTIVITÀ</label><input value={form.inactivity_rule} onChange={e => upd("inactivity_rule", e.target.value)} placeholder="es. 21 giorni max" style={inputStyle} /></div>
          </div>
          <div>
            <label style={labelStyle}>ALTRE REGOLE / NOTE</label>
            <textarea value={form.other_rules} onChange={e => upd("other_rules", e.target.value)} placeholder="Aggiungi regole aggiuntive..." rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button onClick={onClose} style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}>Annulla</button>
            <button onClick={handleAdd} disabled={!form.name.trim()} style={{ flex: 1, padding: "0.6rem", borderRadius: "var(--radius-sm)", border: "none", background: form.name.trim() ? "var(--accent)" : "var(--bg-elevated)", color: form.name.trim() ? "#000" : "var(--text-muted)", cursor: form.name.trim() ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>Aggiungi</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Card challenge ───────────────────────────────────────────────────────────
function ChallengeCard({ challenge, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const { params, rules }       = challenge;
  const color                   = typeColor(challenge.type);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", marginBottom: "0.75rem" }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "0.85rem 1.1rem", cursor: "pointer",
          background: "var(--bg-elevated)",
          transition: "background 0.1s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
        onMouseLeave={e => e.currentTarget.style.background = "var(--bg-elevated)"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}22`, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.05em" }}>
            {typeLabel(challenge.type).toUpperCase()}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{challenge.name}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Metriche rapide */}
          <div style={{ display: "flex", gap: "1.25rem", fontSize: 12 }}>
            {params.profit_target_p1 && (
              <span style={{ color: "var(--accent)" }}>
                Target: <span style={{ fontFamily: "var(--font-data)", fontWeight: 600 }}>{params.profit_target_p1}%{params.profit_target_p2 ? ` / ${params.profit_target_p2}%` : ""}</span>
              </span>
            )}
            {params.daily_dd && (
              <span style={{ color: "var(--warning)" }}>
                DD/g: <span style={{ fontFamily: "var(--font-data)", fontWeight: 600 }}>{params.daily_dd}%</span>
              </span>
            )}
            {params.max_dd && (
              <span style={{ color: "var(--danger)" }}>
                Max DD: <span style={{ fontFamily: "var(--font-data)", fontWeight: 600 }}>{params.max_dd}%</span>
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={e => { e.stopPropagation(); onDelete(challenge.id); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4 }}>
              <Trash2 size={13} />
            </button>
            {expanded ? <ChevronUp size={16} style={{ color: "var(--text-muted)" }} /> : <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />}
          </div>
        </div>
      </div>

      {/* Contenuto espanso */}
      {expanded && (
        <div style={{ padding: "1.1rem", background: "var(--bg-surface)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>

            {/* Parametri */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>PARAMETRI</div>
              {params.profit_target_p1 && <RuleRow label="Target Profitto Fase 1" value={`${params.profit_target_p1}%`} />}
              {params.profit_target_p2 && <RuleRow label="Target Profitto Fase 2" value={`${params.profit_target_p2}%`} />}
              {params.daily_dd         && <RuleRow label="Max DD Giornaliero"     value={`${params.daily_dd}%`} />}
              {params.max_dd           && <RuleRow label="Max DD Totale"          value={`${params.max_dd}%`} />}
              <RuleRow label="Min Giorni Trading"  value={params.min_trading_days > 0 ? `${params.min_trading_days} giorni` : "Nessun minimo"} />
              <RuleRow label="Limite di Tempo"     value={params.time_limit_days  > 0 ? `${params.time_limit_days} giorni` : "Nessun limite"} />
              {params.leverage         && <RuleRow label="Leva Massima"           value={params.leverage} />}
              {params.profit_split     && <RuleRow label="Profit Split"           value={params.profit_split} />}
              {params.scaling          && <RuleRow label="Scaling"                value={params.scaling} />}
              {params.payout_frequency && <RuleRow label="Frequenza Payout"       value={params.payout_frequency} />}
            </div>

            {/* Regole */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>REGOLE</div>
              <RuleRow label="EA Permessi"              value={rules.ea_allowed}       isBool />
              <RuleRow label="Weekend Hold"             value={rules.weekend_hold}     isBool />
              <RuleRow label="News Holding"             value={rules.news_holding}     isBool />
              <RuleRow label="SL Obbligatorio"          value={rules.min_sl_required}  isBool />
              <RuleRow label="HFT"                      value={rules.hft_allowed}      isBool />
              <RuleRow label="Copy Trading"             value={rules.copy_trading}     isBool />
              <RuleRow label="Martingale"               value={rules.martingale}       isBool />
              <RuleRow label="Hedging"                  value={rules.hedging}          isBool />
            </div>
          </div>

          {/* Regole news e altre */}
          <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: "0.75rem" }}>DETTAGLIO REGOLE</div>
            {rules.news_trading_challenge && <RuleRow label="News Trading in Challenge" value={rules.news_trading_challenge} />}
            {rules.news_trading_funded    && <RuleRow label="News Trading in Funded"    value={rules.news_trading_funded} />}
            {rules.max_risk_per_trade     && <RuleRow label="Max Rischio per Trade"     value={rules.max_risk_per_trade} />}
            {rules.consistency_rule       && <RuleRow label="Regola Consistenza"        value={rules.consistency_rule} />}
            {rules.min_trade_duration     && <RuleRow label="Min Durata Trade"          value={rules.min_trade_duration} />}
            {rules.inactivity_rule        && <RuleRow label="Regola Inattività"         value={rules.inactivity_rule} />}
            {rules.other_rules            && (
              <div style={{ padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Note / Altre regole</div>
                <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>{rules.other_rules}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────
export function PropFirmRules() {
  const [firms, setFirms]             = useState(loadFirms);
  const [selectedFirm, setSelectedFirm] = useState(null);
  const [showAddFirm, setShowAddFirm] = useState(false);
  const [showAddChallenge, setShowAddChallenge] = useState(false);

  useEffect(() => {
    saveFirms(firms);
  }, [firms]);

  // Seleziona prima firm di default
  useEffect(() => {
    if (!selectedFirm && firms.length > 0) {
      setSelectedFirm(firms[0].id);
    }
  }, []);

  function addFirm(firm) {
    setFirms(prev => [...prev, firm]);
    setSelectedFirm(firm.id);
  }

  function deleteFirm(firmId) {
    setFirms(prev => prev.filter(f => f.id !== firmId));
    setSelectedFirm(firms.find(f => f.id !== firmId)?.id || null);
  }

  function addChallenge(challenge) {
    setFirms(prev => prev.map(f =>
      f.id === selectedFirm ? { ...f, challenges: [...f.challenges, challenge] } : f
    ));
  }

  function deleteChallenge(firmId, challengeId) {
    setFirms(prev => prev.map(f =>
      f.id === firmId ? { ...f, challenges: f.challenges.filter(c => c.id !== challengeId) } : f
    ));
  }

  function resetToDefault() {
    if (confirm("Ripristinare i dati predefiniti? Le tue modifiche andranno perse.")) {
      setFirms(DEFAULT_FIRMS);
      setSelectedFirm(DEFAULT_FIRMS[0].id);
    }
  }

  const activeFirm = firms.find(f => f.id === selectedFirm);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Prop Firm Rules</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Regole e limiti delle prop firm · {firms.length} prop firms · dati salvati localmente
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={resetToDefault} style={{ padding: "0.4rem 0.9rem", fontSize: 12, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-muted)", cursor: "pointer" }}>
            Reset default
          </button>
          <button onClick={() => setShowAddFirm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.4rem 0.9rem", fontSize: 13, borderRadius: "var(--radius-sm)", border: "1px solid var(--accent)", background: "var(--accent-dim)", color: "var(--accent)", cursor: "pointer" }}>
            <Plus size={14} /> Aggiungi Prop Firm
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "1rem" }}>

        {/* Sidebar prop firms */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {firms.map(firm => (
            <div
              key={firm.id}
              onClick={() => setSelectedFirm(firm.id)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.7rem 0.9rem", borderRadius: "var(--radius-md)", cursor: "pointer",
                background: selectedFirm === firm.id ? "var(--accent-dim)" : "var(--bg-surface)",
                border: `1px solid ${selectedFirm === firm.id ? "var(--accent)" : "var(--border)"}`,
                transition: "all 0.1s",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: selectedFirm === firm.id ? 600 : 400, color: selectedFirm === firm.id ? "var(--accent)" : "var(--text-primary)" }}>
                  {firm.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {firm.challenges.length} challenge{firm.challenges.length !== 1 ? "s" : ""}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); deleteFirm(firm.id); }}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, opacity: 0.5 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* Pannello dettaglio */}
        <div>
          {!activeFirm ? (
            <div style={{ textAlign: "center", padding: "3rem", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", color: "var(--text-muted)" }}>
              Seleziona una prop firm o aggiungine una nuova
            </div>
          ) : (
            <div>
              {/* Header firm */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>{activeFirm.name}</h2>
                  {activeFirm.website && (
                    <a href={activeFirm.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
                      {activeFirm.website} ↗
                    </a>
                  )}
                </div>
                <button
                  onClick={() => setShowAddChallenge(true)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.4rem 0.9rem", fontSize: 13, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: "pointer" }}
                >
                  <Plus size={14} /> Aggiungi Challenge
                </button>
              </div>

              {/* Challenges */}
              {activeFirm.challenges.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", color: "var(--text-muted)", fontSize: 13 }}>
                  Nessuna challenge aggiunta — clicca "Aggiungi Challenge"
                </div>
              ) : (
                activeFirm.challenges.map(challenge => (
                  <ChallengeCard
                    key={challenge.id}
                    challenge={challenge}
                    onDelete={id => deleteChallenge(activeFirm.id, id)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {showAddFirm      && <AddFirmModal      onClose={() => setShowAddFirm(false)}      onAdd={addFirm} />}
      {showAddChallenge && <AddChallengeModal  onClose={() => setShowAddChallenge(false)} onAdd={addChallenge} />}
    </div>
  );
}