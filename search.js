// api/search.js — Vercel serverless function
// Proxies SerpAPI calls to avoid CORS issues from the frontend

export default async function handler(req, res) {
  // Allow all origins (your PWA needs this)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { q, api_key } = req.query;

  if (!q || !api_key) {
    return res.status(400).json({ error: 'Parâmetros q e api_key são obrigatórios' });
  }

  try {
    const serpUrl = new URL('https://serpapi.com/search.json');
    serpUrl.searchParams.set('engine', 'google_shopping');
    serpUrl.searchParams.set('q', q);
    serpUrl.searchParams.set('gl', 'br');
    serpUrl.searchParams.set('hl', 'pt-br');
    serpUrl.searchParams.set('api_key', api_key);

    const response = await fetch(serpUrl.toString());
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error });
    }

    // Filter and return only what the app needs
    const items = data.shopping_results || data.inline_shopping_results || [];
    return res.status(200).json({ shopping_results: items });

  } catch (err) {
    return res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
}
