const SHARE_EXPAND_URL = 'https://rmr-share-expand-375541022505.us-central1.run.app';

export default async (request) => {
  const incoming = new URL(request.url);
  const target = (incoming.searchParams.get('url') || '').trim();
  if (!target) {
    return Response.json({ error: 'Pass ?url=' }, { status: 400 });
  }

  const res = await fetch(
    `${SHARE_EXPAND_URL}/expand?url=${encodeURIComponent(target)}`,
    { headers: { Accept: 'application/json' } }
  );
  const body = await res.json().catch(() => ({ error: 'expand failed' }));
  return Response.json(body, { status: res.status });
};
