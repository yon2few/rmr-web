const TRANSFORM_RUN_URL =
  'https://read-me-reddit-transform-service-375541022505.us-central1.run.app/run';

export default async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'POST is required.' }, {
      status: 405,
      headers: { Allow: 'POST' }
    });
  }
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return Response.json({ error: 'Content-Type application/json is required.' }, { status: 415 });
  }

  const upstream = await fetch(TRANSFORM_RUN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: request.body,
    redirect: 'manual'
  });
  if (!upstream.body) {
    return Response.json({ error: 'Transform service returned no response body.' }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
};
