import { useState, useEffect, useMemo, useCallback } from "react";
import { Spinner } from "../components/ui/Spinner";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_IT   = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const MONTHS_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

function getWeekRange(offset = 0) {
  const now    = new Date();
  const day    = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function formatWeekLabel(monday, sunday) {
  return `${monday.getDate()} ${MONTHS_IT[monday.getMonth()]} — ${sunday.getDate()} ${MONTHS_IT[sunday.getMonth()]} ${sunday.getFullYear()}`;
}

function fmtTime(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  } catch { return dateStr; }
}

function fmtDay(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return `${DAYS_IT[d.getDay()]} ${d.getDate()} ${MONTHS_IT[d.getMonth()]}`;
  } catch { return dateStr; }
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

const CURRENCY_COLORS = {
  USD: "#3d7ef5", EUR: "#e0a952", GBP: "#9b59b6",
  JPY: "#e05252", CHF: "#3dd68c", AUD: "#e07452",
  CAD: "#52b8e0", NZD: "#52e0a4", CNY: "#e05252",
};

// Cache in memoria nel browser
const _cache = {};

async function doFetch(week) {
  const cacheKey = `news_${week}`;
  const now = Date.now();

  if (_cache[cacheKey] && now - _cache[cacheKey].ts < 30 * 60 * 1000) {
    return { events: _cache[cacheKey].data, not_available: false };
  }

  const res = await fetch(`/api/news?week=${week}`, {
    signal: AbortSignal.timeout(20000),
  });

  const data = await res.json();

  if (data.not_available) {
    return { events: [], not_available: true };
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const events = data.events || [];
  _cache[cacheKey] = { ts: now, data: events };
  return { events, not_available: false };
}

// ─── Card singolo evento ──────────────────────────────────────────────────────
function NewsCard({ event, isNext }) {
  const cur       = event.currency || "???";
  const currColor = CURRENCY_COLORS[cur] || "#888888";
  const isPast    = !isNext && new Date(event.date) < new Date();

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: "1rem",
        padding: "1rem 1.25rem",
        borderBottom: "1px solid var(--border)",
        opacity: isPast ? 0.45 : 1,
        transition: "background 0.1s",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      {/* Orario */}
      <div style={{ minWidth: 60, textAlign: "right", paddingTop: 2, flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--font-data)", fontSize: 15, fontWeight: 500, color: "var(--text-secondary)" }}>
          {fmtTime(event.date)}
        </span>
      </div>

      {/* Dot rosso high impact */}
      <div style={{ display: "flex", alignItems: "center", paddingTop: 5, flexShrink: 0 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: "#e05252", boxShadow: "0 0 8px #e05252",
        }} />
      </div>

      {/* Badge valuta — sempre visibile e ben leggibile */}
      <div style={{
        flexShrink: 0,
        minWidth: 56, textAlign: "center",
        background: `${currColor}25`,
        border: `2px solid ${currColor}`,
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 14, fontWeight: 800,
        fontFamily: "var(--font-data)",
        color: currColor,
        letterSpacing: "0.03em",
      }}>
        {cur}
      </div>

      {/* Titolo e dati */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: 5, lineHeight: 1.35,
        }}>
          {event.title}
        </div>
        {(event.forecast || event.previous || event.actual) && (
          <div style={{ display: "flex", gap: "1.5rem", fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
            {event.forecast && (
              <span>
                Previsto:{" "}
                <span style={{ fontFamily: "var(--font-data)", color: "var(--text-secondary)", fontWeight: 600 }}>
                  {event.forecast}
                </span>
              </span>
            )}
            {event.previous && (
              <span>
                Precedente:{" "}
                <span style={{ fontFamily: "var(--font-data)", color: "var(--text-secondary)", fontWeight: 600 }}>
                  {event.previous}
                </span>
              </span>
            )}
            {event.actual && (
              <span>
                Attuale:{" "}
                <span style={{ fontFamily: "var(--font-data)", color: "var(--accent)", fontWeight: 700 }}>
                  {event.actual}
                </span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────
export function News() {
  const [weekOffset, setWeekOffset]         = useState(0);
  const [news, setNews]                     = useState([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(null);
  const [currencyFilter, setCurrencyFilter] = useState("TUTTI");
  const [lastUpdate, setLastUpdate]         = useState(null);

  const { monday, sunday } = getWeekRange(weekOffset);
  const weekParam = weekOffset === 0 ? "current" : "next";

  const loadNews = useCallback(async (week) => {
    setLoading(true);
    setError(null);
    setNews([]);
    try {
      const { events, not_available } = await doFetch(week);
      setNews(events);
      setLastUpdate(new Date());
      if (not_available) {
        setError("Il calendario della prossima settimana non è ancora disponibile su Forex Factory. Riprova sabato sera.");
      }
    } catch (e) {
      setError(`Impossibile caricare le news: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Ricarica quando cambia settimana
  useEffect(() => {
    setCurrencyFilter("TUTTI");
    loadNews(weekOffset === 0 ? "current" : "next");
  }, [weekOffset, loadNews]);

  // Valute presenti nei dati
  const currencies = useMemo(() => {
    const set = new Set(news.map(e => e.currency).filter(Boolean));
    return ["TUTTI", ...[...set].sort()];
  }, [news]);

  // Filtra per valuta — usa confronto diretto su currency
  const filtered = useMemo(() => {
    if (currencyFilter === "TUTTI") return news;
    return news.filter(e => e.currency === currencyFilter);
  }, [news, currencyFilter]);

  // Raggruppa per giorno
  const byDay = useMemo(() => {
    const groups = {};
    for (const event of filtered) {
      const d   = new Date(event.date);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!groups[key]) groups[key] = { label: fmtDay(event.date), date: d, events: [] };
      groups[key].events.push(event);
    }
    return Object.values(groups).sort((a, b) => a.date - b.date);
  }, [filtered]);

  // Alert eventi imminenti
  const upcomingEvents = useMemo(() => {
    if (weekOffset !== 0) return [];
    const now  = new Date();
    const in2h = new Date(now.getTime() + 2 * 3600 * 1000);
    return news.filter(e => { const d = new Date(e.date); return d >= now && d <= in2h; });
  }, [news, weekOffset]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>News High Impact</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            Solo eventi 🔴 alto impatto Forex Factory
            {!loading && !error && ` · ${filtered.length} eventi`}
            {lastUpdate && ` · aggiornato alle ${lastUpdate.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`}
          </p>
        </div>
        <button
          onClick={() => loadNews(weekParam)}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: "0.45rem 1rem",
            color: loading ? "var(--text-muted)" : "var(--text-secondary)",
            cursor: loading ? "not-allowed" : "pointer", fontSize: 14,
          }}
        >
          <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          {loading ? "Caricamento..." : "Aggiorna"}
        </button>
      </div>

      {/* Alert eventi imminenti */}
      {upcomingEvents.length > 0 && (
        <div style={{
          background: "rgba(224,82,82,0.1)", border: "1px solid #e05252",
          borderRadius: "var(--radius-md)", padding: "0.85rem 1.1rem",
          marginBottom: "1rem", display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#e05252", boxShadow: "0 0 8px #e05252", flexShrink: 0, animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 14, color: "#e05252", fontWeight: 600 }}>
            ⚠️ {upcomingEvents.length} evento{upcomingEvents.length > 1 ? "i" : ""} nelle prossime 2 ore:{" "}
            {upcomingEvents.map(e => `${e.currency} — ${e.title}`).join(" · ")}
          </span>
        </div>
      )}

      {/* Navigazione settimana */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", padding: "0.85rem 1.25rem", marginBottom: "1rem",
      }}>
        <button
          onClick={() => setWeekOffset(0)}
          disabled={weekOffset === 0}
          style={{
            background: "none", border: "none",
            color: weekOffset === 0 ? "var(--text-muted)" : "var(--accent)",
            cursor: weekOffset === 0 ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 14, fontWeight: 500,
          }}
        >
          <ChevronLeft size={18} /> Settimana corrente
        </button>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3, letterSpacing: "0.06em" }}>
            {weekOffset === 0 ? "SETTIMANA CORRENTE" : "PROSSIMA SETTIMANA"}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
            {formatWeekLabel(monday, sunday)}
          </div>
        </div>

        <button
          onClick={() => setWeekOffset(1)}
          disabled={weekOffset === 1}
          style={{
            background: "none", border: "none",
            color: weekOffset === 1 ? "var(--text-muted)" : "var(--accent)",
            cursor: weekOffset === 1 ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 14, fontWeight: 500,
          }}
        >
          Prossima settimana <ChevronRight size={18} />
        </button>
      </div>

      {/* Filtro valute */}
      {!loading && news.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 14, color: "var(--text-muted)", marginRight: 4 }}>Filtra per valuta:</span>
          {currencies.map(cur => {
            const isActive = currencyFilter === cur;
            const color    = cur === "TUTTI" ? null : (CURRENCY_COLORS[cur] || "#888");
            return (
              <button
                key={cur}
                onClick={() => setCurrencyFilter(cur)}
                style={{
                  padding: "0.35rem 0.9rem",
                  fontSize: 14,
                  fontFamily: cur === "TUTTI" ? "inherit" : "var(--font-data)",
                  fontWeight: isActive ? 700 : 500,
                  borderRadius: "var(--radius-sm)",
                  border: `2px solid ${isActive ? (color || "var(--accent)") : "var(--border)"}`,
                  background: isActive
                    ? (color ? `${color}22` : "var(--accent-dim)")
                    : "var(--bg-elevated)",
                  color: isActive
                    ? (color || "var(--accent)")
                    : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {cur}
              </button>
            );
          })}
        </div>
      )}

      {/* Contenuto principale */}
      {loading ? (
        <Spinner />
      ) : error && news.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "3rem",
          border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
        }}>
          <div style={{ fontSize: 40, marginBottom: "1rem" }}>⚠️</div>
          <div style={{ color: "var(--danger)", marginBottom: "1.25rem", fontSize: 15, lineHeight: 1.5 }}>{error}</div>
          <button
            onClick={() => loadNews(weekParam)}
            style={{
              padding: "0.6rem 1.5rem", background: "var(--bg-elevated)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              color: "var(--text-secondary)", cursor: "pointer", fontSize: 14,
            }}
          >
            Riprova
          </button>
        </div>
      ) : byDay.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "3rem",
          border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
          color: "var(--text-muted)",
        }}>
          <div style={{ fontSize: 40, marginBottom: "1rem" }}>📰</div>
          <div style={{ fontSize: 15, marginBottom: 8 }}>Nessun evento high impact trovato</div>
          {currencyFilter !== "TUTTI" && (
            <span
              style={{ fontSize: 14, color: "var(--accent)", cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setCurrencyFilter("TUTTI")}
            >
              Rimuovi filtro valuta
            </span>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {byDay.map(({ label, date, events }) => {
            const isToday = isSameDay(date, new Date());
            return (
              <div key={label} style={{
                background: "var(--bg-surface)",
                border: `1px solid ${isToday ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--radius-md)", overflow: "hidden",
                boxShadow: isToday ? "0 0 16px rgba(61,214,140,0.1)" : "none",
              }}>
                {/* Header giorno */}
                <div style={{
                  padding: "0.75rem 1.25rem",
                  background: isToday ? "rgba(61,214,140,0.08)" : "var(--bg-elevated)",
                  borderBottom: "1px solid var(--border)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {isToday && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: "var(--accent)",
                        background: "var(--accent-dim)", padding: "3px 8px",
                        borderRadius: 4, letterSpacing: "0.06em",
                      }}>
                        OGGI
                      </span>
                    )}
                    <span style={{ fontSize: 16, fontWeight: 700, color: isToday ? "var(--accent)" : "var(--text-primary)" }}>
                      {label}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 13, fontFamily: "var(--font-data)", fontWeight: 600,
                    background: "rgba(224,82,82,0.15)", color: "#e05252",
                    padding: "4px 12px", borderRadius: 5,
                  }}>
                    {events.length} evento{events.length > 1 ? "i" : ""}
                  </span>
                </div>

                {/* Lista eventi */}
                <div>
                  {events.map((event, i) => (
                    <NewsCard
                      key={`${event.date}-${event.currency}-${i}`}
                      event={event}
                      isNext={weekOffset === 1}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}