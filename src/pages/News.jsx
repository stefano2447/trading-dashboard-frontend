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

// Cache in memoria nel browser — evita chiamate ripetute ai proxy
const _cache = {};

async function fetchFromProxies(week) {
  const target = week === "current"
    ? "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
    : "https://nfs.faireconomy.media/ff_calendar_nextweek.json";

  const cacheKey = `news_${week}`;
  const now = Date.now();
  if (_cache[cacheKey] && now - _cache[cacheKey].ts < 30 * 60 * 1000) {
    console.log(`[News] Cache browser hit per ${week}`);
    return _cache[cacheKey].data;
  }

  // allorigins restituisce {status:{...}, contents:"[...]"}
  const alloriginsUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`;

  try {
    console.log(`[News] Fetch via allorigins`);
    const res = await fetch(alloriginsUrl, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const wrapper = await res.json();
    if (!wrapper.contents) throw new Error("Nessun contenuto da allorigins");
    
    const data = JSON.parse(wrapper.contents);
    if (!Array.isArray(data)) throw new Error("Formato non valido");
    
    const high = data.filter(e => e.impact === "High");
    console.log(`[News] OK — ${high.length} eventi high impact`);
    _cache[cacheKey] = { ts: now, data: high };
    return high;
  } catch (e) {
    console.log(`[News] allorigins fallito:`, e.message);
    
    // Usa cache vecchia se disponibile
    if (_cache[cacheKey]) {
      console.log(`[News] Uso cache vecchia`);
      return _cache[cacheKey].data;
    }
    
    throw new Error(`Fetch fallito: ${e.message}`);
  }
}

// ─── Card evento ──────────────────────────────────────────────────────────────
function NewsCard({ event, isNext }) {
  const currColor = CURRENCY_COLORS[event.currency] || "#888";
  const isPast    = new Date(event.date) < new Date();

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: "1rem",
        padding: "0.9rem 1.1rem", borderBottom: "1px solid var(--border)",
        opacity: isPast && !isNext ? 0.45 : 1, transition: "background 0.1s",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      {/* Ora */}
      <div style={{ minWidth: 55, textAlign: "right", paddingTop: 1 }}>
        <span style={{ fontFamily: "var(--font-data)", fontSize: 13, color: "var(--text-secondary)" }}>
          {fmtTime(event.date)}
        </span>
      </div>

      {/* Dot rosso */}
      <div style={{ display: "flex", alignItems: "center", paddingTop: 4 }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 0 7px var(--danger)", flexShrink: 0 }} />
      </div>

      {/* Badge valuta */}
      <div style={{
        minWidth: 48, textAlign: "center", flexShrink: 0,
        background: `${currColor}22`, border: `1px solid ${currColor}55`,
        borderRadius: 5, padding: "3px 8px",
        fontSize: 12, fontWeight: 700, fontFamily: "var(--font-data)", color: currColor,
        marginTop: 1,
      }}>
        {event.currency}
      </div>

      {/* Titolo + dati */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", marginBottom: 4, lineHeight: 1.3 }}>
          {event.title}
        </div>
        {(event.forecast || event.previous || event.actual) && (
          <div style={{ display: "flex", gap: "1.25rem", fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
            {event.forecast && (
              <span>Previsto: <span style={{ fontFamily: "var(--font-data)", color: "var(--text-secondary)", fontWeight: 500 }}>{event.forecast}</span></span>
            )}
            {event.previous && (
              <span>Precedente: <span style={{ fontFamily: "var(--font-data)", color: "var(--text-secondary)", fontWeight: 500 }}>{event.previous}</span></span>
            )}
            {event.actual && (
              <span>Attuale: <span style={{ fontFamily: "var(--font-data)", color: "var(--accent)", fontWeight: 700 }}>{event.actual}</span></span>
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

  const fetchNews = useCallback(async (week) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFromProxies(week);
      setNews(data);
      setLastUpdate(new Date());
    } catch (e) {
      setError(`Impossibile caricare le news: ${e.message}`);
      setNews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const week = weekOffset === 0 ? "current" : "next";
    fetchNews(week);
  }, [weekOffset, fetchNews]);

  // Valute uniche presenti nei dati
  const currencies = useMemo(() => {
    const unique = [...new Set(news.map(e => e.currency).filter(Boolean))].sort();
    return ["TUTTI", ...unique];
  }, [news]);

  // Reset filtro valuta quando cambia settimana
  useEffect(() => {
    setCurrencyFilter("TUTTI");
  }, [weekOffset]);

  // Filtra per valuta selezionata
  const filtered = useMemo(() => {
    if (currencyFilter === "TUTTI") return news;
    return news.filter(e => e.currency === currencyFilter);
  }, [news, currencyFilter]);

  // Raggruppa per giorno
  const byDay = useMemo(() => {
    const groups = {};
    for (const event of filtered) {
      const d   = new Date(event.date);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      if (!groups[key]) groups[key] = { label: fmtDay(event.date), date: d, events: [] };
      groups[key].events.push(event);
    }
    return Object.values(groups).sort((a, b) => a.date - b.date);
  }, [filtered]);

  // Eventi nelle prossime 2 ore
  const upcomingEvents = useMemo(() => {
    if (weekOffset !== 0) return [];
    const now  = new Date();
    const in2h = new Date(now.getTime() + 2 * 3600 * 1000);
    return news.filter(e => {
      const d = new Date(e.date);
      return d >= now && d <= in2h;
    });
  }, [news, weekOffset]);

  const currentWeek = weekOffset === 0 ? "current" : "next";

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>News High Impact</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Solo eventi 🔴 alto impatto Forex Factory · {filtered.length} eventi
            {lastUpdate && <span> · aggiornato alle {lastUpdate.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>}
          </p>
        </div>
        <button
          onClick={() => fetchNews(currentWeek)}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: "0.4rem 0.9rem",
            color: loading ? "var(--text-muted)" : "var(--text-secondary)",
            cursor: loading ? "not-allowed" : "pointer", fontSize: 13,
          }}
        >
          <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          {loading ? "Caricamento..." : "Aggiorna"}
        </button>
      </div>

      {/* Alert eventi imminenti */}
      {upcomingEvents.length > 0 && (
        <div style={{
          background: "var(--danger-dim)", border: "1px solid var(--danger)",
          borderRadius: "var(--radius-md)", padding: "0.75rem 1rem",
          marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 0 7px var(--danger)", flexShrink: 0, animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 14, color: "var(--danger)", fontWeight: 500 }}>
            ⚠️ {upcomingEvents.length > 1 ? `${upcomingEvents.length} eventi` : "1 evento"} high impact nelle prossime 2 ore:{" "}
            {upcomingEvents.map(e => `${e.currency} — ${e.title}`).join(" · ")}
          </span>
        </div>
      )}

      {/* Navigazione settimana */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", padding: "0.75rem 1.25rem", marginBottom: "1rem",
      }}>
        <button
          onClick={() => setWeekOffset(0)}
          disabled={weekOffset === 0}
          style={{
            background: "none", border: "none",
            color: weekOffset === 0 ? "var(--text-muted)" : "var(--accent)",
            cursor: weekOffset === 0 ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 5, fontSize: 14, fontWeight: 500,
          }}
        >
          <ChevronLeft size={17} /> Settimana corrente
        </button>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3, letterSpacing: "0.05em" }}>
            {weekOffset === 0 ? "SETTIMANA CORRENTE" : "PROSSIMA SETTIMANA"}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
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
            display: "flex", alignItems: "center", gap: 5, fontSize: 14, fontWeight: 500,
          }}
        >
          Prossima settimana <ChevronRight size={17} />
        </button>
      </div>

      {/* Filtro valute */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Filtra:</span>
        {currencies.map(cur => {
          const color    = cur === "TUTTI" ? "var(--text-secondary)" : (CURRENCY_COLORS[cur] || "#888");
          const isActive = currencyFilter === cur;
          return (
            <button
              key={cur}
              onClick={() => setCurrencyFilter(cur)}
              style={{
                padding: "0.3rem 0.85rem", fontSize: 13, fontFamily: cur === "TUTTI" ? "inherit" : "var(--font-data)",
                borderRadius: "var(--radius-sm)",
                border: `1px solid ${isActive ? (cur === "TUTTI" ? "var(--accent)" : color) : "var(--border)"}`,
                background: isActive ? (cur === "TUTTI" ? "var(--accent-dim)" : `${color}22`) : "var(--bg-elevated)",
                color: isActive ? (cur === "TUTTI" ? "var(--accent)" : color) : "var(--text-secondary)",
                cursor: "pointer", fontWeight: isActive ? 700 : 400,
                transition: "all 0.15s",
              }}
            >
              {cur}
            </button>
          );
        })}
      </div>

      {/* Contenuto principale */}
      {loading ? (
        <Spinner />
      ) : error ? (
        <div style={{ textAlign: "center", padding: "3rem", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)" }}>
          <div style={{ fontSize: 36, marginBottom: "1rem" }}>⚠️</div>
          <div style={{ color: "var(--danger)", marginBottom: "1rem", fontSize: 14 }}>{error}</div>
          <button
            onClick={() => fetchNews(currentWeek)}
            style={{
              padding: "0.5rem 1.25rem", background: "var(--bg-elevated)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              color: "var(--text-secondary)", cursor: "pointer", fontSize: 13,
            }}
          >
            Riprova
          </button>
        </div>
      ) : byDay.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 36, marginBottom: "1rem" }}>📰</div>
          <div style={{ fontSize: 15 }}>Nessun evento high impact trovato</div>
          {currencyFilter !== "TUTTI" && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Prova a rimuovere il filtro valuta —{" "}
              <span style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => setCurrencyFilter("TUTTI")}>
                mostra tutti
              </span>
            </div>
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
                boxShadow: isToday ? "0 0 14px rgba(61,214,140,0.09)" : "none",
              }}>
                {/* Header giorno */}
                <div style={{
                  padding: "0.65rem 1.1rem",
                  background: isToday ? "rgba(61,214,140,0.08)" : "var(--bg-elevated)",
                  borderBottom: "1px solid var(--border)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isToday && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: "var(--accent)",
                        background: "var(--accent-dim)", padding: "2px 7px",
                        borderRadius: 3, letterSpacing: "0.06em",
                      }}>
                        OGGI
                      </span>
                    )}
                    <span style={{ fontSize: 14, fontWeight: 600, color: isToday ? "var(--accent)" : "var(--text-primary)" }}>
                      {label}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 12, fontFamily: "var(--font-data)",
                    background: "var(--danger-dim)", color: "var(--danger)",
                    padding: "3px 10px", borderRadius: 4, fontWeight: 600,
                  }}>
                    {events.length} evento{events.length > 1 ? "i" : ""}
                  </span>
                </div>

                {/* Lista eventi */}
                <div>
                  {events.map((event, i) => (
                    <NewsCard key={`${event.date}-${event.currency}-${i}`} event={event} isNext={weekOffset === 1} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}