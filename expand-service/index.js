const http = require('http');

const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url, 'http://localhost');
  if (incoming.pathname !== '/expand') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const target = (incoming.searchParams.get('url') || '').trim();
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Pass ?url=' }));
    return;
  }
  try {
    const upstream = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': BROWSER_UA
      }
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: upstream.status,
      location: upstream.headers.get('location') || '',
      finalUrl: upstream.url || ''
    }));
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message || 'expand failed' }));
  }
});

server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
