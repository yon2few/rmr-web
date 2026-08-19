const http = require('http');

const REDDIT_UA = 'rmr-web/1.0 by yon2few (https://artreader.art/rmr)';

let cachedToken = { value: '', expiresAt: 0 };

function parseRedditInput(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-zA-Z][a-zA-Z+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function commentsUrlFromText(text) {
  const raw = String(text || '');
  const match = raw.match(
    /(?:https?:\/\/(?:www\.|old\.|oauth\.)?reddit\.com)?\/(?:r\/([^/]+)\/|u(?:ser)?\/[^/]+\/)?comments\/([A-Za-z0-9]+)/i
  );
  if (!match) return '';
  const sub = match[1];
  const id = match[2];
  if (sub) return `https://www.reddit.com/r/${sub}/comments/${id}`;
  return `https://www.reddit.com/comments/${id}`;
}

function isReddItHost(hostname) {
  return /(^|\.)redd\.it$/i.test(hostname || '');
}

function toRedditSortParam(sort) {
  return sort === 'best' ? 'confidence' : sort;
}

function hasPostListing(json) {
  return Boolean(json?.[0]?.data?.children?.[0]?.data?.id);
}

function normalizeTargetUrl(raw) {
  const parsed = parseRedditInput(raw);
  if (!parsed) {
    throw new Error('Pass a reddit.com share URL as ?url=');
  }
  if (isReddItHost(parsed.hostname)) {
    const id = parsed.pathname.replace(/\//g, '');
    if (!id) throw new Error('Pass a redd.it post link as ?url=');
    return `https://www.reddit.com/comments/${id}`;
  }
  if (!/(^|\.)reddit\.com$/i.test(parsed.hostname)) {
    throw new Error('Pass a reddit.com share URL as ?url=');
  }
  if (/^(old|sh|new|oauth)\.reddit\.com$/i.test(parsed.hostname) || parsed.hostname === 'reddit.com') {
    parsed.hostname = 'www.reddit.com';
  }
  parsed.protocol = 'https:';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  if (/\/comments\/[^/]+/i.test(parsed.pathname)) {
    return parsed.toString();
  }
  if (!/\/s\/[^/]+/i.test(parsed.pathname)) {
    throw new Error('Pass a reddit.com /s/ or /comments/ URL as ?url=');
  }
  return parsed.toString();
}

async function redditAppToken() {
  const id = process.env.REDDIT_CLIENT_ID || '';
  const secret = process.env.REDDIT_CLIENT_SECRET || '';
  if (!id || !secret) {
    throw new Error('REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are not set.');
  }
  if (cachedToken.value && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT_UA
    },
    body: 'grant_type=client_credentials'
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const detail = body.error || body.message || '';
    throw new Error(`Reddit token failed (HTTP ${res.status}${detail ? `: ${detail}` : ''}).`);
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(30, Number(body.expires_in || 3600) - 60) * 1000
  };
  return cachedToken.value;
}

function foundFromLocation(location, baseUrl) {
  if (!location) return '';
  try {
    return commentsUrlFromText(new URL(location, baseUrl).toString());
  } catch {
    return commentsUrlFromText(location);
  }
}

async function authorizedGet(url, token) {
  return fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': REDDIT_UA
    }
  });
}

async function expandWithOAuth(shareUrl) {
  const token = await redditAppToken();
  const path = new URL(shareUrl).pathname.replace(/\/+$/, '');
  const attempts = [];
  for (const target of [`https://oauth.reddit.com${path}`, `https://www.reddit.com${path}`]) {
    const res = await authorizedGet(target, token);
    const location = res.headers.get('location') || '';
    const commentsUrl = foundFromLocation(location, target) || commentsUrlFromText(res.url || '');
    attempts.push({ target, status: res.status, location, commentsUrl });
    if (commentsUrl) {
      return { commentsUrl, status: res.status, location, attempts };
    }
  }
  const summary = attempts
    .map((item) => `${item.target}: HTTP ${item.status}${item.location ? '' : ', no Location'}`)
    .join('; ');
  const error = new Error(`OAuth expand found no /comments/ URL (${summary}).`);
  error.attempts = attempts;
  throw error;
}

async function expand(rawUrl) {
  const target = normalizeTargetUrl(rawUrl);
  if (/\/comments\/[^/]+/i.test(new URL(target).pathname)) {
    return { commentsUrl: target, status: 200, location: '' };
  }
  return expandWithOAuth(target);
}

function toOauthListingUrl(commentsUrl, sort) {
  const parsed = new URL(commentsUrl);
  const path = parsed.pathname.replace(/\/+$/, '');
  const listing = new URL(`https://oauth.reddit.com${path}.json`);
  listing.searchParams.set('sort', toRedditSortParam(sort));
  listing.searchParams.set('raw_json', '1');
  return listing.toString();
}

async function fetchThreadListing(rawUrl, sort) {
  const { commentsUrl } = await expand(rawUrl);
  const token = await redditAppToken();
  const target = toOauthListingUrl(commentsUrl, sort);
  const res = await fetch(target, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': REDDIT_UA
    }
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !hasPostListing(json)) {
    const detail = json?.message || json?.error || '';
    throw new Error(
      `OAuth thread listing failed (HTTP ${res.status}${detail ? `: ${detail}` : ''}).`
    );
  }
  return json;
}

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url, 'http://localhost');
  if (incoming.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (incoming.pathname === '/thread') {
    const target = (incoming.searchParams.get('url') || '').trim();
    const sort = (incoming.searchParams.get('sort') || 'best').trim() || 'best';
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Pass ?url=' }));
      return;
    }
    try {
      const listing = await fetchThreadListing(target, sort);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listing));
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message || 'thread failed' }));
    }
    return;
  }
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
    const result = await expand(target);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        commentsUrl: '',
        error: error.message || 'expand failed',
        attempts: error.attempts || []
      })
    );
  }
});

server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
