// api/search.js
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { q, api_key } = req.query;
  if (!q || !api_key) return res.status(400).json({ error: 'q e api_key sao obrigatorios' });

  try {
    const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(q)}&gl=br&hl=pt-br&api_key=${encodeURIComponent(api_key)}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error });
    return res.status(200).json({ shopping_results: data.shopping_results || data.inline_shopping_results || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
