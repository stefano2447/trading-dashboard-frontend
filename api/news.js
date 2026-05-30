export default async function handler(req, res) {
  const week = req.query.week || "current";

  const urls = {
    current: "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    next:    "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
  };

  const target = urls[week] || urls.current;

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.forexfactory.com/",
      },
    });

    // Restituisce info di debug
    const text = await response.text();
    res.status(200).json({
      url: target,
      status: response.status,
      contentType: response.headers.get("content-type"),
      bodyPreview: text.slice(0, 200),
    });

  } catch (e) {
    res.status(500).json({ error: e.message, url: target });
  }
}