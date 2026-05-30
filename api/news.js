export const config = { runtime: "edge" };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const week = searchParams.get("week") || "current";

  const target = week === "next"
    ? "https://nfs.faireconomy.media/ff_calendar_nextweek.json"
    : "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.forexfactory.com/",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
    }

    const data = await res.json();
    const high = Array.isArray(data) ? data.filter(e => e.impact === "High") : [];

    return new Response(JSON.stringify({ events: high, total: high.length }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "s-maxage=1800",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, events: [] }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}