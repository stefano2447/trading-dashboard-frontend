export default async function handler(req, res) {
  const week = req.query.week || "current";

  const target = week === "next"
    ? "https://nfs.faireconomy.media/ff_calendar_nextweek.json"
    : "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.forexfactory.com/",
      },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const high = Array.isArray(data) ? data.filter(e => e.impact === "High") : [];

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=1800");
    res.status(200).json({ events: high, total: high.length });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(502).json({ error: e.message, events: [] });
  }
}