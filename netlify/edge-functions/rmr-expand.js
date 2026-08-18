const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export default async (request) => {
  const incoming = new URL(request.url);
  const target = (incoming.searchParams.get('url') || '').trim();
  if (!target) {
    return Response.json({ error: 'Pass ?url=' }, { status: 400 });
  }

  const res = await fetch(target, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': BROWSER_UA
    }
  });

  return Response.json({
    status: res.status,
    location: res.headers.get('location') || '',
    finalUrl: res.url || ''
  });
};
