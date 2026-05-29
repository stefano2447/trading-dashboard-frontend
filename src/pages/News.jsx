import { useState, useEffect, useMemo } from "react";
import { Spinner } from "../components/ui/Spinner";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_IT = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const MONTHS_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

function getWeekRange(offset = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=dom
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
    const d = new Date(dateStr);
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
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

// Colori per valuta
const CURRENCY_COLORS = {
  USD: "#3d7ef5", EUR: "#e0a952", GBP: "#9b59b6",
  JPY: "#e05252", CHF: "#3dd68c", AUD: "#e07452",
  CAD: "#52b8e0", NZD: "#52e0a4", CNY: "#e05252",
};

// ─── Fetch news da Forex Factory ─────────────────────────────────────────────

async function loadNews() {
  setLoading(true);
  setError(null);
  try {
    const data = await api.getNews(weekOffset === 0 ? "current" : "next");
    setNews(data);
    setLastUpdate(new Date());
  } catch(e) {
    setError("Impossibile caricare le news da Forex Factory. Riprova tra qualche secondo.");
    setNews([]);
  }
  setLoading(false);
}

// ─── Card singolo evento ──────────────────────────────────────────────────────
function NewsCard({ event, isNext }) {
  const currColor = CURRENCY_COLORS[event.currency] || "var(--text-muted)";
  const isPast = new Date(event.date) < new Date();

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: "1rem",
      padding: "0.75rem 1rem",
      borderBottom: "1px solid var(--border)",
      opacity: isPast && !isNext ? 0.5 : 1,
      transition: "background 0.1s",
    }}
    onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      {/* Ora */}
      <div style={{ minWidth: 50, textAlign: "right" }}>
        <span style={{ fontFamily: "var(--font-data)", fontSize: 12, color: "var(--text-secondary)" }}>
          {fmtTime(event.date)}
        </span>
      </div>

      {/* Indicatore high impact */}
      <div style={{ display: "flex", alignItems: "center", paddingTop: 2 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "var(--danger)",
          boxShadow: "0 0 6px var(--danger)",
        }} />
      </div>

      {/* Valuta */}
      <div style={{
        minWidth: 44, textAlign: "center",
        background: `${currColor}22`,
        border: `1px solid ${currColor}44`,
        borderRadius: 4, padding: "2px 6px",
        fontSize: 11, fontWeight: 700, fontFamily: "var(--font-data)",
        color: currColor,
      }}>
        {event.currency}
      </div>

      {/* Titolo evento */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 2 }}>
          {event.title}
        </div>
        {(event.forecast || event.previous) && (
          <div style={{ display: "flex", gap: "1rem", fontSize: 11, color: "var(--text-muted)" }}>
            {event.forecast && (
              <span>Prev: <span style={{ fontFamily: "var(--font-data)", color: "var(--text-secondary)" }}>{event.forecast}</span></span>
            )}
            {event.previous && (
              <span>Prec: <span style={{ fontFamily: "var(--font-data)", color: "var(--text-secondary)" }}>{event.previous}</span></span>
            )}
            {event.actual && (
              <span>Att: <span style={{ fontFamily: "var(--font-data)", color: "var(--accent)", fontWeight: 600 }}>{event.actual}</span></span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────
export function News() {
  const [weekOffset, setWeekOffset]     = useState(0); // 0 = corrente, 1 = prossima
  const [news, setNews]                 = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [currencyFilter, setCurrencyFilter] = useState("TUTTI");
  const [lastUpdate, setLastUpdate]     = useState(null);

  const { monday, sunday } = getWeekRange(weekOffset);

  async function loadNews() {
    setLoading(true);
    setError(null);
    const data = weekOffset === 0
      ? await fetchForexFactoryNews(monday, sunday)
      : await fetchForexFactoryNextWeek();

    if (data === null) {
      setError("Impossibile caricare le news da Forex Factory. Riprova tra qualche secondo.");
      setNews([]);
    } else {
      setNews(data);
      setLastUpdate(new Date());
    }
    setLoading(false);
  }

  useEffect(() => { loadNews(); }, [weekOffset]);

  // Valute disponibili
  const currencies = useMemo(() => {
    const unique = [...new Set(news.map(e => e.currency))].sort();
    return ["TUTTI", ...unique];
  }, [news]);

  // Filtra per valuta
  const filtered = useMemo(() =>
    currencyFilter === "TUTTI" ? news : news.filter(e => e.currency === currencyFilter),
    [news, currencyFilter]
  );

  // Raggruppa per giorno
  const byDay = useMemo(() => {
    const groups = {};
    for (const event of filtered) {
      const d = new Date(event.date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!groups[key]) groups[key] = { label: fmtDay(event.date), date: d, events: [] };
      groups[key].events.push(event);
    }
    return Object.values(groups).sort((a, b) => a.date - b.date);
  }, [filtered]);

  // Evento imminente (prossime 2 ore)
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    const in2h = new Date(now.getTime() + 2 * 3600 * 1000);
    return news.filter(e => {
      const d = new Date(e.date);
      return d >= now && d <= in2h;
    });
  }, [news]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>News High Impact</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Solo eventi ad alto impatto (🔴 Forex Factory) · {filtered.length} eventi
            {lastUpdate && <span> · aggiornato alle {lastUpdate.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>}
          </p>
        </div>
        <button onClick={loadNews} style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "var(--bg-elevated)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)", padding: "0.4rem 0.9rem",
          color: "var(--text-secondary)", cursor: "pointer", fontSize: 13,
        }}>
          <RefreshCw size={13} /> Aggiorna
        </button>
      </div>

      {/* Alert eventi imminenti */}
      {upcomingEvents.length > 0 && weekOffset === 0 && (
        <div style={{
          background: "var(--danger-dim)", border: "1px solid var(--danger)",
          borderRadius: "var(--radius-md)", padding: "0.75rem 1rem",
          marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)", boxShadow: "0 0 6px var(--danger)", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 500 }}>
            ⚠️ {upcomingEvents.length} evento{upcomingEvents.length > 1 ? "i" : ""} high impact nelle prossime 2 ore:
            {" "}{upcomingEvents.map(e => `${e.currency} ${e.title}`).join(", ")}
          </span>
        </div>
      )}

      {/* Navigazione settimana */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)", padding: "0.75rem 1rem",
        marginBottom: "1rem",
      }}>
        <button
          onClick={() => setWeekOffset(0)}
          disabled={weekOffset === 0}
          style={{
            background: "none", border: "none",
            color: weekOffset === 0 ? "var(--text-muted)" : "var(--text-secondary)",
            cursor: weekOffset === 0 ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 4, fontSize: 13,
          }}
        >
          <ChevronLeft size={16} /> Settimana corrente
        </button>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>
            {weekOffset === 0 ? "SETTIMANA CORRENTE" : "PROSSIMA SETTIMANA"}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-data)", color: "var(--text-primary)" }}>
            {formatWeekLabel(monday, sunday)}
          </div>
        </div>

        <button
          onClick={() => setWeekOffset(1)}
          disabled={weekOffset === 1}
          style={{
            background: "none", border: "none",
            color: weekOffset === 1 ? "var(--text-muted)" : "var(--text-secondary)",
            cursor: weekOffset === 1 ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 4, fontSize: 13,
          }}
        >
          Prossima settimana <ChevronRight size={16} />
        </button>
      </div>

      {/* Filtro valute */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Valuta:</span>
        {currencies.map(cur => {
          const color = CURRENCY_COLORS[cur] || "var(--text-secondary)";
          const isActive = currencyFilter === cur;
          return (
            <button key={cur} onClick={() => setCurrencyFilter(cur)} style={{
              padding: "0.25rem 0.75rem", fontSize: 12, fontFamily: "var(--font-data)",
              borderRadius: "var(--radius-sm)", border: `1px solid ${isActive ? color : "var(--border)"}`,
              background: isActive ? `${color}22` : "var(--bg-elevated)",
              color: isActive ? color : "var(--text-secondary)",
              cursor: "pointer", fontWeight: isActive ? 600 : 400,
            }}>
              {cur}
            </button>
          );
        })}
      </div>

      {/* Contenuto */}
      {loading ? <Spinner /> : error ? (
        <div style={{
          textAlign: "center", padding: "3rem",
          border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
          color: "var(--text-muted)",
        }}>
          <div style={{ fontSize: 32, marginBottom: "1rem" }}>⚠️</div>
          <div style={{ marginBottom: 8, color: "var(--danger)" }}>{error}</div>
          <button onClick={loadNews} style={{
            marginTop: "1rem", padding: "0.5rem 1rem",
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", color: "var(--text-secondary)",
            cursor: "pointer", fontSize: 13,
          }}>
            Riprova
          </button>
        </div>
      ) : byDay.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "3rem",
          border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)",
          color: "var(--text-muted)",
        }}>
          <div style={{ fontSize: 32, marginBottom: "1rem" }}>📰</div>
          <div>Nessun evento high impact per questa settimana</div>
          {currencyFilter !== "TUTTI" && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              Prova a rimuovere il filtro valuta
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {byDay.map(({ label, date, events }) => {
            const isToday = isSameDay(date, new Date());
            return (
              <div key={label} style={{
                background: "var(--bg-surface)", border: `1px solid ${isToday ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--radius-md)", overflow: "hidden",
                boxShadow: isToday ? "0 0 12px rgba(61,214,140,0.08)" : "none",
              }}>
                {/* Header giorno */}
                <div style={{
                  padding: "0.6rem 1rem",
                  background: isToday ? "rgba(61,214,140,0.08)" : "var(--bg-elevated)",
                  borderBottom: "1px solid var(--border)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isToday && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: "var(--accent)",
                        background: "var(--accent-dim)", padding: "2px 6px", borderRadius: 3,
                        letterSpacing: "0.05em",
                      }}>
                        OGGI
                      </span>
                    )}
                    <span style={{ fontSize: 13, fontWeight: 600, color: isToday ? "var(--accent)" : "var(--text-primary)" }}>
                      {label}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 11, color: "var(--text-muted)",
                    background: "var(--danger-dim)", color: "var(--danger)",
                    padding: "2px 8px", borderRadius: 4, fontFamily: "var(--font-data)",
                  }}>
                    {events.length} evento{events.length > 1 ? "i" : ""}
                  </span>
                </div>

                {/* Lista eventi del giorno */}
                <div>
                  {events.map((event, i) => (
                    <NewsCard key={i} event={event} isNext={weekOffset === 1} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}