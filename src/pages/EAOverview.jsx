import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, EyeOff, Filter } from "lucide-react";
import { api } from "../api/client";
import { Spinner } from "../components/ui/Spinner";
import { Badge } from "../components/ui/Badge";
import { useEAConfigs } from "../hooks/useEAConfigs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthsActive(firstDate) {
  if (!firstDate) return 0;
  const start = new Date(firstDate);
  const now = new Date();
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
}

function calcRetDd(profit, maxDd) {
  if (!maxDd || maxDd === 0) return null;
  return profit / Math.abs(maxDd);
}

function fmtProfit(val) {
  if (val === null || val === undefined) return "—";
  const n = Number(val);
  return (n >= 0 ? "+" : "") + n.toFixed(2);
}

function fmt(val, dec = 2) {
  if (val === null || val === undefined) return "—";
  return Number(val).toFixed(dec);
}

function isExpiringSoon(dateStr) {
  if (!dateStr) return false;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return false;
  const [dd, mm, yyyy] = parts.map(Number);
  if (!dd || !mm || !yyyy) return false;
  const target = new Date(yyyy, mm - 1, dd);
  const diffMs = target - new Date();
  return diffMs < 30 * 24 * 3600 * 1000;
}

const ASSET_GROUPS = {
  "XAUUSD": ["XAUUSD", "GOLD", "XAUUSD.S", "XAUUSDm", "XAUUSDc"],
  "NAS100": ["NAS100", "NASDAQ", "US100", "NDX","USTEC"],
  "DAX":    ["GDAXI", "DAX", "GER40", "GER30"],
  "EURUSD": ["EURUSD", "EURUSDm"],
};

function normalizeAsset(symbol) {
  if (!symbol) return "ALTRO";
  const s = symbol.toUpperCase();
  for (const [group, variants] of Object.entries(ASSET_GROUPS)) {
    if (variants.some(v => s.includes(v.toUpperCase().replace(/\./g, "").replace(/M$/, "")))) return group;
  }
  return symbol.toUpperCase();
}

const pfType = v => v >= 2 ? "positive" : v >= 1.5 ? "warning" : v >= 1 ? "neutral" : "negative";
const wrType = v => v >= 55 ? "positive" : v >= 45 ? "warning" : "negative";
const rdType = v => v === null ? "neutral" : v >= 3 ? "positive" : v >= 1 ? "warning" : "negative";
const clType = v => v >= 8 ? "negative" : v >= 5 ? "warning" : "neutral";

// ─── Colonne ──────────────────────────────────────────────────────────────────
const COLUMN_GROUPS = [
  { label: "STRATEGIA", columns: [
    { key: "ea_name",               label: "Nome",          numeric: false },
    { key: "symbol",                label: "Asset",         numeric: false },
  ]},
  { label: "ATTIVITÀ", columns: [
    { key: "total_trades",          label: "Trade",         numeric: true  },
    { key: "_months",               label: "Mesi",          numeric: true  },
  ]},
  { label: "PERFORMANCE", columns: [
    { key: "win_rate_pct",          label: "Win%",          numeric: true  },
    { key: "profit_factor",         label: "PF",            numeric: true  },
    { key: "_ret_dd",               label: "Ret/DD",        numeric: true  },
    { key: "_retdd",                label: "Ret/DD",        numeric: true  },
  ]},
  { label: "PROFITTO (norm.)", columns: [
    { key: "total_net_profit_norm", label: "Net $",         numeric: true  },
    { key: "max_dd",                label: "Max DD",        numeric: true  },
  ]},
  { label: "QUALITÀ TRADE", columns: [
    { key: "avg_win",               label: "Avg Win",       numeric: true  },
    { key: "avg_loss",              label: "Avg Loss",      numeric: true  },
    { key: "avg_rr",                label: "Avg RR",        numeric: true  },
    { key: "expectancy",            label: "Expect.",       numeric: true  },
    { key: "max_consec_loss",       label: "Max CL",        numeric: true  },
  ]},
  { label: "GESTIONE", columns: [
    { key: "_next_opt",             label: "Pross. Ottim.", numeric: false },
    { key: "_notes",                label: "Note",          numeric: false },
  ]},
  { label: "HEALTH", columns: [
  { key: "_health", label: "Health Score", numeric: false },
]},
  { label: "BACKTEST", columns: [
  { key: "_backtest", label: "vs Backtest", numeric: false },
]},
  { label: "AZIONI", columns: [
  { key: "_actions", label: "", numeric: false },
]},
];

const ALL_COLUMNS = COLUMN_GROUPS.flatMap(g => g.columns);
const GESTIONE_KEYS = ["_next_opt", "_notes", "_actions", "_health", "_backtest"];

function SortIcon({ column, sortKey, sortDir }) {
  if (sortKey !== column) return <ArrowUpDown size={11} style={{ opacity: 0.25 }} />;
  return sortDir === "asc"
    ? <ArrowUp size={11} style={{ color: "var(--accent)" }} />
    : <ArrowDown size={11} style={{ color: "var(--accent)" }} />;
}

function SummaryCard({ label, value, sub, valueColor }) {
  return (
    <div style={{
      background: "var(--bg-surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)", padding: "1rem 1.25rem", flex: 1, minWidth: 140,
    }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "var(--font-data)", color: valueColor || "var(--text-primary)", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────
export function EAOverview() {
  const [eas, setEas]                 = useState([]);
  const [loading, setLoading]         = useState(true);
  const [sortKey, setSortKey]         = useState("_retdd");
  const [sortDir, setSortDir]         = useState("desc");
  const [showHidden, setShowHidden]   = useState(false);
  const [assetFilter, setAssetFilter] = useState("TUTTI");
  const [editingCell, setEditingCell] = useState(null);
  const navigate = useNavigate();
  const { getConfig, updateConfig } = useEAConfigs();

  useEffect(() => {
    api.getEAs(showHidden).then(data => { setEas(data); setLoading(false); });
  }, [showHidden]);

  // Ricarica la lista se torniamo da un'altra pagina (es. dopo aver collegato un backtest in dettaglio)
  useEffect(() => {
    const refetch = () => api.getEAs(showHidden).then(setEas);
    window.addEventListener("ea-config-updated", refetch);
    window.addEventListener("focus", refetch);
    return () => {
      window.removeEventListener("ea-config-updated", refetch);
      window.removeEventListener("focus", refetch);
    };
  }, [showHidden]);

  const enriched = useMemo(() => eas.map(ea => {
    const months = monthsActive(ea.first_trade_date);
    return {
      ...ea,
      _months: months,
      _ret_dd: calcRetDd(ea.total_net_profit_norm ?? ea.total_net_profit, ea.max_dd),
      _retdd: calcRetDd(ea.total_net_profit_norm ?? ea.total_net_profit, ea.max_dd),
      _asset:  normalizeAsset(ea.symbol),
    };
  }), [eas]);

  const assets = useMemo(() => {
    const unique = [...new Set(enriched.map(ea => ea._asset))].sort();
    return ["TUTTI", ...unique];
  }, [enriched]);

  const filtered = useMemo(() => enriched.filter(ea =>
    assetFilter === "TUTTI" || ea._asset === assetFilter
  ), [enriched, assetFilter]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  }), [filtered, sortKey, sortDir]);

  function handleSort(key) {
    if (GESTIONE_KEYS.includes(key)) return;
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const activeEAs = filtered.filter(ea => !ea.is_hidden);
  const inProfit  = activeEAs.filter(ea => (ea.total_net_profit_norm ?? ea.total_net_profit) > 0).length;
  const avgPF     = activeEAs.length ? activeEAs.reduce((s, ea) => s + (ea.profit_factor || 0), 0) / activeEAs.length : 0;
  const avgRetDd = activeEAs.filter(ea => ea._retdd !== null).reduce((s, ea) => s + ea._retdd, 0) / (activeEAs.filter(ea => ea._retdd !== null).length || 1);
  const totalNorm = activeEAs.reduce((s, ea) => s + (ea.total_net_profit_norm ?? ea.total_net_profit ?? 0), 0);
  const bestEA    = [...activeEAs].sort((a, b) => (b._retdd ?? -999) - (a._retdd ?? -999))[0];

  // ─── Render cella ─────────────────────────────────────────────────────────
  function renderCell(ea, col) {
    switch (col.key) {
      case "ea_name":
        return (
          <span style={{ fontWeight: 500 }}>
            {ea.ea_name}
            {ea.is_hidden && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}>ARCH.</span>}
          </span>
        );
      case "symbol":
        return (
          <span style={{
            fontFamily: "var(--font-data)", fontSize: 11,
            color: "var(--text-secondary)", background: "var(--bg-elevated)",
            padding: "2px 6px", borderRadius: 4,
          }}>
            {ea.symbol || "—"}
          </span>
        );
      case "total_trades":
        return (
          <span style={{ fontFamily: "var(--font-data)" }}>
            {ea.total_trades}
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}> ({ea.win_trades}W/{ea.loss_trades}L)</span>
          </span>
        );
      case "_months":
        return <span style={{ fontFamily: "var(--font-data)", color: "var(--text-secondary)" }}>{ea._months < 1 ? "<1" : ea._months}</span>;
      case "win_rate_pct":
        return <Badge value={`${Number(ea.win_rate_pct).toFixed(1)}%`} type={wrType(ea.win_rate_pct)} />;
      case "profit_factor":
        return <Badge value={ea.profit_factor ? Number(ea.profit_factor).toFixed(2) : "—"} type={pfType(ea.profit_factor)} />;
      case "_ret_dd":
        return <Badge value={ea._ret_dd ? ea._ret_dd.toFixed(2) : "—"} type={rdType(ea._ret_dd)} />;
      case "_retdd":
        return <Badge value={ea._retdd ? ea._retdd.toFixed(2) : "—"} type={rdType(ea._retdd)} />;
      case "total_net_profit_norm": {
        const p = ea.total_net_profit_norm ?? ea.total_net_profit;
        return <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, color: p >= 0 ? "var(--accent)" : "var(--danger)" }}>{fmtProfit(p)}</span>;
      }
      case "max_dd":
        return <span style={{ fontFamily: "var(--font-data)", color: "var(--danger)" }}>{ea.max_dd ? `-${Number(ea.max_dd).toFixed(2)}` : "—"}</span>;
      case "avg_win":
        return <span style={{ fontFamily: "var(--font-data)", color: "var(--accent)" }}>+{fmt(ea.avg_win)}</span>;
      case "avg_loss":
        return <span style={{ fontFamily: "var(--font-data)", color: "var(--danger)" }}>{fmt(ea.avg_loss)}</span>;
      case "avg_rr":
        return <span style={{ fontFamily: "var(--font-data)", color: "var(--text-secondary)" }}>{fmt(ea.avg_rr)}</span>;
      case "expectancy":
        return <span style={{ fontFamily: "var(--font-data)", color: ea.expectancy >= 0 ? "var(--accent)" : "var(--danger)" }}>{fmtProfit(ea.expectancy)}</span>;
      case "max_consec_loss":
        return <Badge value={ea.max_consec_loss ?? "—"} type={clType(ea.max_consec_loss)} />;
        

      // ─── Colonne gestione ────────────────────────────────────────────────
      case "_next_opt": {
        const config    = getConfig(ea.ea_name);
        const val       = config.next_optimization || "";
        const isEditing = editingCell?.ea === ea.ea_name && editingCell?.col === "_next_opt";
        const expiring  = isExpiringSoon(val);

        if (isEditing) {
          return (
            <input
              autoFocus
              defaultValue={val}
              placeholder="gg/mm/aaaa"
              onBlur={e => {
                updateConfig(ea.ea_name, { next_optimization: e.target.value.trim() });
                setEditingCell(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") e.target.blur();
                if (e.key === "Escape") setEditingCell(null);
              }}
              style={{
                background: "var(--bg-elevated)", border: "1px solid var(--accent)",
                borderRadius: 4, color: "var(--text-primary)",
                padding: "2px 6px", fontSize: 11, width: 90,
                fontFamily: "var(--font-data)", outline: "none",
              }}
            />
          );
        }

        return (
          <div
            onClick={() => setEditingCell({ ea: ea.ea_name, col: "_next_opt" })}
            title={expiring && val ? "⚠ Ottimizzazione imminente o scaduta" : "Clicca per modificare"}
            style={{
              fontFamily: "var(--font-data)", fontSize: 11, cursor: "text",
              color: expiring ? "#fff" : val ? "var(--text-secondary)" : "var(--text-muted)",
              background: expiring ? "var(--danger-dim)" : "transparent",
              padding: "4px 6px", borderRadius: 4, minWidth: 85,
              border: `1px solid ${expiring ? "rgba(224,82,82,0.4)" : "transparent"}`,
              transition: "border 0.15s",
              display: "flex", alignItems: "center", gap: 4,
            }}
            onMouseEnter={e => { if (!expiring) e.currentTarget.style.borderColor = "var(--border)"; }}
            onMouseLeave={e => { if (!expiring) e.currentTarget.style.borderColor = "transparent"; }}
          >
            {expiring && <span style={{ color: "var(--danger)", fontSize: 10 }}>⚠</span>}
            {val || <span style={{ color: "var(--text-muted)", fontSize: 10 }}>—</span>}
          </div>
        );
      }
      case "_health": {
  const score  = ea.health_score;
  const status = ea.health_status;
  const details = ea.health_details || {};

  // Nessun dato sufficiente
  if (score === null || score === undefined) {
    const label =
      status === "insufficient_recent"
        ? `⚪ < 3 trade recenti (${details.recent_trades || 0})`
        : status === "insufficient_data"
        ? `⚪ Dati insufficienti (min. ${details.min_required || 15})`
        : "⚪ —";
    return (
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
        {label}
      </span>
    );
  }

  const emoji = status === "stable"   ? "🟢"
              : status === "warning"  ? "🟡"
              : status === "degraded" ? "🔴"
              : "⚪";

  const color = status === "stable"   ? "var(--accent)"
              : status === "warning"  ? "var(--warning)"
              : status === "degraded" ? "var(--danger)"
              : "var(--text-muted)";

  const label = status === "stable"   ? "Stabile"
              : status === "warning"  ? "Attenzione"
              : status === "degraded" ? "Degradazione"
              : "—";

  const confidence = details.confidence; // "alta" | "media" | "bassa"
  const confDot   = confidence === "alta"  ? "●●●"
                   : confidence === "media" ? "●●○"
                   : confidence === "bassa" ? "●○○" : "";
  const confColor = confidence === "alta"  ? "var(--accent)"
                   : confidence === "media" ? "var(--warning)"
                   : "var(--text-muted)";

  const tooltip = details.recent_pf != null
    ? `PF: ${details.historic_pf} → ${details.recent_pf} | WR: ${details.historic_wr}% → ${details.recent_wr}% | ${details.recent_trades} trade recenti | confidenza: ${confidence}`
    : "";

  return (
    <div
      title={tooltip}
      style={{ display: "flex", alignItems: "center", gap: 6, cursor: tooltip ? "help" : "default" }}
    >
      <span style={{ fontSize: 13 }}>{emoji}</span>
      <span style={{
        fontFamily: "var(--font-data)", fontSize: 12, fontWeight: 600, color,
      }}>
        {score}
      </span>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      {confDot && (
        <span
          title={`Confidenza: ${confidence} (${details.recent_trades} trade recenti)`}
          style={{ fontSize: 9, color: confColor, letterSpacing: 1 }}
        >
          {confDot}
        </span>
      )}
    </div>
  );
}

      case "_backtest": {
  const ref  = ea.backtest_ref;
  const coh  = ea.backtest_coherence;

  if (!ref) {
    return (
      <button
        onClick={() => navigate(`/analisi/${encodeURIComponent(ea.ea_name)}`)}
        style={{
          fontSize: 11, color: "var(--text-muted)", background: "none",
          border: "1px dashed var(--border)", borderRadius: 4, padding: "3px 8px", cursor: "pointer",
        }}
        title="Apri la scheda di dettaglio per collegare un backtest di riferimento"
      >
        + Collega backtest
      </button>
    );
  }

  const status = coh?.status;
  const emoji = status === "migliore"    ? "🟢"
              : status === "coerente"    ? "🟢"
              : status === "peggiore"    ? "🔴"
              : status === "insufficiente" ? "⚪"
              : "⚪";
  const label = status === "migliore"      ? "Migliore"
              : status === "coerente"      ? "Coerente"
              : status === "peggiore"      ? "Peggiore"
              : status === "insufficiente" ? "Pochi trade"
              : "n/d";
  const color = status === "migliore"    ? "var(--accent)"
              : status === "coerente"    ? "var(--accent)"
              : status === "peggiore"    ? "var(--danger)"
              : "var(--text-muted)";

  return (
    <div
      onClick={() => navigate(`/analisi/${encodeURIComponent(ea.ea_name)}`)}
      title={coh?.ratio != null ? `Rapporto medio live/backtest: ${coh.ratio} su ${coh.n_metrics} metriche · clic per cambiare riferimento` : "Clic per cambiare riferimento"}
      style={{ display: "flex", flexDirection: "column", gap: 2, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 12 }}>{emoji}</span>
        <span style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</span>
      </div>
      <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-data)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {ref}
      </span>
    </div>
  );
}

      case "_notes": {
        const config    = getConfig(ea.ea_name);
        const val       = config.notes || "";
        const isEditing = editingCell?.ea === ea.ea_name && editingCell?.col === "_notes";

        if (isEditing) {
          return (
            <input
              autoFocus
              defaultValue={val}
              placeholder="Aggiungi nota..."
              onBlur={e => {
                updateConfig(ea.ea_name, { notes: e.target.value.trim() });
                setEditingCell(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") e.target.blur();
                if (e.key === "Escape") setEditingCell(null);
              }}
              style={{
                background: "var(--bg-elevated)", border: "1px solid var(--accent)",
                borderRadius: 4, color: "var(--text-primary)",
                padding: "2px 6px", fontSize: 11, width: 180, outline: "none",
              }}
            />
          );
        }

        return (
          <div
            onClick={() => setEditingCell({ ea: ea.ea_name, col: "_notes" })}
            title={val || "Clicca per modificare"}
            style={{
              fontSize: 11, cursor: "text",
              color: val ? "var(--text-secondary)" : "var(--text-muted)",
              maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              padding: "4px 6px", borderRadius: 4,
              border: "1px solid transparent", transition: "border 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "transparent"}
          >
            {val || <span style={{ fontSize: 10 }}>—</span>}
          </div>
        );
      }
      case "_actions": {
  const config   = getConfig(ea.ea_name);
  const isHidden = config.is_hidden || ea.is_hidden || false;
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        updateConfig(ea.ea_name, { is_hidden: !isHidden });
        // Aggiorna anche sul backend
        api.saveEAConfig(ea.ea_name, { is_hidden: !isHidden });
      }}
      title={isHidden ? "Mostra EA" : "Archivia EA"}
      style={{
        background: "none",
        border: `1px solid ${isHidden ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius-sm)",
        color: isHidden ? "var(--accent)" : "var(--text-muted)",
        cursor: "pointer",
        padding: "3px 8px",
        fontSize: 11,
        whiteSpace: "nowrap",
      }}
    >
      {isHidden ? "👁 Mostra" : "Archivia"}
    </button>
      );
    }

      default: return "—";
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>EA Overview</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            {activeEAs.length} strategie attive · clicca su una riga per analizzarla
          </p>
        </div>
        <button
          onClick={() => setShowHidden(h => !h)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: showHidden ? "var(--accent-dim)" : "var(--bg-elevated)",
            color: showHidden ? "var(--accent)" : "var(--text-secondary)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            padding: "0.4rem 0.9rem", cursor: "pointer", fontSize: 13,
          }}
        >
          {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
          {showHidden ? "Nascondi archiviate" : "Mostra archiviate"}
        </button>
      </div>

      {/* Cards riepilogo */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <SummaryCard label="STRATEGIE ATTIVE"        value={activeEAs.length}      sub={`${inProfit} in profitto · ${activeEAs.length - inProfit} in perdita`} />
        <SummaryCard label="NET PROFIT TOTALE (norm.)" value={fmtProfit(totalNorm)} sub="somma normalizzata 0.01 lotti" valueColor={totalNorm >= 0 ? "var(--accent)" : "var(--danger)"} />
        <SummaryCard label="PF MEDIO"                value={avgPF.toFixed(2)}      sub="su strategie attive"           valueColor={avgPF >= 1.5 ? "var(--accent)" : avgPF >= 1 ? "var(--warning)" : "var(--danger)"} />
        <SummaryCard label="RET/DD MEDIO"            value={avgRetDd.toFixed(2)}   sub="rendimento tot. / max DD"      valueColor={avgRetDd >= 2 ? "var(--accent)" : avgRetDd >= 1 ? "var(--warning)" : "var(--danger)"} />
        <SummaryCard label="MIGLIORE EA"             value={bestEA?.ea_name ?? "—"} sub={bestEA ? `Ret/DD: ${bestEA._retdd?.toFixed(2)}` : ""} valueColor="var(--accent)" />
      </div>

      {/* Filtro asset */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <Filter size={13} style={{ color: "var(--text-muted)" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Asset:</span>
        {assets.map(asset => (
          <button key={asset} onClick={() => setAssetFilter(asset)} style={{
            padding: "0.25rem 0.75rem", fontSize: 12,
            borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
            background: assetFilter === asset ? "var(--accent-dim)" : "var(--bg-elevated)",
            color: assetFilter === asset ? "var(--accent)" : "var(--text-secondary)",
            cursor: "pointer", fontFamily: "var(--font-data)",
          }}>
            {asset}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <div style={{ overflowX: "auto", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              {/* Gruppi colonne */}
              <tr style={{ background: "var(--bg-elevated)" }}>
                {COLUMN_GROUPS.map(group => (
                  <th key={group.label} colSpan={group.columns.length} style={{
                    padding: "0.35rem 0.75rem", textAlign: "center",
                    color: "var(--text-muted)", fontSize: 10, letterSpacing: "0.07em", fontWeight: 600,
                    borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)",
                  }}>
                    {group.label}
                  </th>
                ))}
                <th style={{ borderBottom: "1px solid var(--border)" }} />
              </tr>
              {/* Header colonne */}
              <tr style={{ background: "var(--bg-surface)" }}>
                {ALL_COLUMNS.map(col => (
                  <th key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      padding: "0.55rem 0.75rem",
                      textAlign: col.numeric ? "right" : "left",
                      color: sortKey === col.key ? "var(--accent)" : "var(--text-muted)",
                      fontWeight: 500,
                      cursor: GESTIONE_KEYS.includes(col.key) ? "default" : "pointer",
                      whiteSpace: "nowrap", userSelect: "none",
                      fontSize: 11, letterSpacing: "0.03em",
                      borderBottom: "2px solid var(--border)",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                      {col.label}
                      {!GESTIONE_KEYS.includes(col.key) && (
                        <SortIcon column={col.key} sortKey={sortKey} sortDir={sortDir} />
                      )}
                    </span>
                  </th>
                ))}
                <th style={{ borderBottom: "2px solid var(--border)", padding: "0.55rem 0.75rem", color: "var(--text-muted)", fontSize: 11 }}>●</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(ea => (
                <tr
                  key={ea.ea_name}
                  onClick={() => navigate(`/analisi/${encodeURIComponent(ea.ea_name)}`)}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    opacity: ea.is_hidden ? 0.5 : 1,
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  {ALL_COLUMNS.map(col => (
                    <td
                      key={col.key}
                      style={{
                        padding: "0.65rem 0.75rem",
                        textAlign: col.numeric ? "right" : "left",
                        whiteSpace: "nowrap",
                      }}
                      // Le colonne di gestione bloccano la navigazione a livello di td
                      onClick={GESTIONE_KEYS.includes(col.key) ? e => e.stopPropagation() : undefined}
                    >
                      {renderCell(ea, col)}
                    </td>
                  ))}
                  <td style={{ padding: "0.65rem 0.75rem", textAlign: "center" }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: "50%", margin: "0 auto",
                      background: ea.is_hidden ? "var(--text-muted)" : "var(--accent)",
                      boxShadow: ea.is_hidden ? "none" : "0 0 6px var(--accent)",
                    }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}