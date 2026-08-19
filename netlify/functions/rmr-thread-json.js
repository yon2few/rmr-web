const REDDIT_UA = 'ArTReader-RMR/1.0 (https://artreader.art/rmr)';
const SHARE_EXPAND_URL =
  process.env.RMR_SHARE_EXPAND_URL ||
  'https://rmr-share-expand-375541022505.us-central1.run.app';

function parseRedditInput(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-zA-Z][a-zA-Z+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function isReddItHost(hostname) {
  return /(^|\.)redd\.it$/i.test(hostname || '');
}

function isRedditHost(url) {
  try {
    const host = new URL(url).hostname;
    return /(^|\.)reddit\.com$/i.test(host) || isReddItHost(host);
  } catch {
    return false;
  }
}

function isRedditThreadUrl(url) {
  const u = parseRedditInput(url);
  if (!u) return false;
  if (isReddItHost(u.hostname)) {
    return /^\/[A-Za-z0-9]+\/?$/.test(u.pathname);
  }
  if (!/(^|\.)reddit\.com$/i.test(u.hostname)) return false;
  return /\/comments\/[^/]+/i.test(u.pathname) || /\/s\/[^/]+/i.test(u.pathname);
}

function normalizeRedditThreadUrl(url) {
  const u = parseRedditInput(url);
  if (!u) throw new Error('Invalid Reddit URL');
  if (isReddItHost(u.hostname)) {
    const id = u.pathname.replace(/\//g, '');
    return `https://www.reddit.com/comments/${id}`;
  }
  if (/^(old|sh|new)\.reddit\.com$/i.test(u.hostname)) {
    u.hostname = 'www.reddit.com';
  } else if (u.hostname === 'reddit.com') {
    u.hostname = 'www.reddit.com';
  }
  u.search = '';
  u.hash = '';
  u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

function toRedditSortParam(sort) {
  return sort === 'best' ? 'confidence' : sort;
}

function threadIdFromUrl(url) {
  const u = parseRedditInput(url);
  if (!u) return '';
  if (isReddItHost(u.hostname)) {
    return u.pathname.replace(/\//g, '');
  }
  const comments = u.pathname.match(/\/comments\/([^/]+)/i);
  if (comments) return comments[1];
  return '';
}

function commentsUrlFromText(text) {
  const match = String(text || '').match(/https?:\/\/(?:www\.|old\.)?reddit\.com\/(?:r\/[^/]+\/|u(?:ser)?\/[^/]+\/)?comments\/([A-Za-z0-9]+)/i);
  if (!match) return '';
  const id = match[1];
  const sub = String(text || '').match(/reddit\.com\/r\/([^/]+)\/comments\//i);
  if (sub) return `https://www.reddit.com/r/${sub[1]}/comments/${id}`;
  return `https://www.reddit.com/comments/${id}`;
}

function isSharePath(url) {
  const parsed = parseRedditInput(url);
  return Boolean(parsed && /\/s\/[^/]+/i.test(parsed.pathname));
}

function requireCommentsUrl(url, detail) {
  const id = threadIdFromUrl(url);
  if (id) {
    const parsed = parseRedditInput(url);
    const sub = parsed?.pathname.match(/^\/r\/([^/]+)\//i);
    if (sub) return `https://www.reddit.com/r/${sub[1]}/comments/${id}`;
    return `https://www.reddit.com/comments/${id}`;
  }
  const fromText = commentsUrlFromText(url);
  if (fromText) return fromText;
  throw new Error(detail || 'Could not expand that Reddit share link. Open it once and paste the /comments/ URL from the address bar.');
}

async function expandViaOAuthService(url) {
  const api = `${SHARE_EXPAND_URL.replace(/\/+$/, '')}/expand?url=${encodeURIComponent(url)}`;
  const res = await fetch(api, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  const found = commentsUrlFromText(body?.commentsUrl || '');
  if (found) return found;
  throw new Error(body?.error || `OAuth expand failed (HTTP ${res.status}).`);
}

async function expandShareShortlink(url) {
  if (!isSharePath(url)) return normalizeRedditThreadUrl(url);
  try {
    return requireCommentsUrl(await expandViaOAuthService(url), 'OAuth expand had no post id.');
  } catch (error) {
    throw new Error(
      `${error.message || 'OAuth expand failed'}. Open it once and paste the /comments/ URL from the address bar.`
    );
  }
}

async function fetchFromOAuthService(url, sort) {
  const api =
    `${SHARE_EXPAND_URL.replace(/\/+$/, '')}/thread` +
    `?url=${encodeURIComponent(url)}&sort=${encodeURIComponent(sort)}`;
  const res = await fetch(api, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (res.ok && hasPostListing(body)) return body;
  throw new Error(body?.error || `OAuth thread failed (HTTP ${res.status}).`);
}

function toJsonUrl(threadUrl, sort, host) {
  const u = new URL(threadUrl);
  if (host) u.hostname = host;
  u.hash = '';
  u.search = '';
  u.pathname = u.pathname.replace(/\/+$/, '');
  if (!u.pathname.endsWith('.json')) u.pathname = `${u.pathname}.json`;
  u.searchParams.set('sort', toRedditSortParam(sort));
  u.searchParams.set('raw_json', '1');
  return u.toString();
}

function hasPostListing(json) {
  return Boolean(json?.[0]?.data?.children?.[0]?.data?.id);
}

function rebuildListing(post, comments) {
  const byName = new Map();
  const roots = [];
  comments.forEach((comment) => {
    byName.set(`t1_${comment.id}`, {
      kind: 't1',
      data: {
        author: comment.author,
        body: comment.body,
        id: comment.id,
        parent_id: comment.parent_id,
        score: comment.score,
        replies: { kind: 'Listing', data: { children: [] } }
      }
    });
  });
  comments.forEach((comment) => {
    const node = byName.get(`t1_${comment.id}`);
    const parentId = comment.parent_id || '';
    if (parentId.startsWith('t3_')) {
      roots.push(node);
    } else if (byName.has(parentId)) {
      byName.get(parentId).data.replies.data.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return [
    {
      kind: 'Listing',
      data: { children: [{ kind: 't3', data: post }] }
    },
    {
      kind: 'Listing',
      data: { children: roots }
    }
  ];
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': REDDIT_UA
    }
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

async function fetchFromReddit(threadUrl, sort) {
  const hosts = ['www.reddit.com', 'old.reddit.com'];
  let last = { ok: false, status: 502, json: null };
  for (const host of hosts) {
    last = await fetchJson(toJsonUrl(threadUrl, sort, host));
    if (last.ok && hasPostListing(last.json)) return last.json;
    if (last.status !== 429 && last.status !== 403) break;
  }
  return null;
}

function pullpushSort(sort) {
  if (sort === 'old') return { sort: 'asc', sort_type: 'created_utc' };
  if (sort === 'new') return { sort: 'desc', sort_type: 'created_utc' };
  return { sort: 'desc', sort_type: 'score' };
}

async function fetchFromPullpush(threadUrl, sort) {
  const id = threadIdFromUrl(threadUrl);
  if (!id) throw new Error('Thread id missing from URL.');
  const order = pullpushSort(sort);
  const postUrl = `https://api.pullpush.io/reddit/search/submission/?ids=${encodeURIComponent(id)}`;
  const commentUrl =
    `https://api.pullpush.io/reddit/search/comment/?link_id=${encodeURIComponent(`t3_${id}`)}` +
    `&size=100&sort=${order.sort}&sort_type=${order.sort_type}`;
  const [postRes, commentRes] = await Promise.all([fetchJson(postUrl), fetchJson(commentUrl)]);
  const post = postRes.json?.data?.[0];
  if (!post?.id) {
    throw new Error(
      `Archive post lookup failed (HTTP ${postRes.status}${postRes.json ? '' : ', non-JSON'}).`
    );
  }
  const comments = Array.isArray(commentRes.json?.data) ? commentRes.json.data : [];
  return rebuildListing(post, comments);
}

async function fetchFromArcticShift(threadUrl) {
  const id = threadIdFromUrl(threadUrl);
  if (!id) throw new Error('Thread id missing from URL.');
  const postUrl = `https://arctic-shift.photon-reddit.com/api/posts/ids?ids=${encodeURIComponent(id)}`;
  const commentUrl =
    `https://arctic-shift.photon-reddit.com/api/comments/search?link_id=${encodeURIComponent(id)}&limit=100`;
  const [postRes, commentRes] = await Promise.all([fetchJson(postUrl), fetchJson(commentUrl)]);
  const post = postRes.json?.data?.[0];
  if (!post?.id) {
    throw new Error(
      `Arctic post lookup failed (HTTP ${postRes.status}${postRes.json ? '' : ', non-JSON'}).`
    );
  }
  const comments = Array.isArray(commentRes.json?.data) ? commentRes.json.data : [];
  return rebuildListing(post, comments);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'GET only' }) };
  }

  const rawUrl = String(event.queryStringParameters?.url || '').trim();
  const sort = String(event.queryStringParameters?.sort || 'best').trim() || 'best';
  if (!rawUrl || !isRedditThreadUrl(rawUrl)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Pass a reddit.com, redd.it, or /s/ thread link as ?url=' })
    };
  }

  const failures = [];
  try {
    const fromOauth = await fetchFromOAuthService(rawUrl, sort);
    if (fromOauth) {
      return { statusCode: 200, headers, body: JSON.stringify(fromOauth) };
    }
  } catch (oauthError) {
    failures.push(oauthError.message || 'oauth thread failed');
  }

  let threadUrl;
  try {
    threadUrl = isSharePath(rawUrl)
      ? await expandShareShortlink(rawUrl)
      : normalizeRedditThreadUrl(rawUrl);
  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: error.message || 'Could not expand that Reddit share link.' })
    };
  }
  if (!threadIdFromUrl(threadUrl)) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: 'Could not expand that Reddit share link. Open it once and paste the /comments/ URL from the address bar.'
      })
    };
  }
  try {
    const fromReddit = await fetchFromReddit(threadUrl, sort);
    if (fromReddit) {
      return { statusCode: 200, headers, body: JSON.stringify(fromReddit) };
    }
    failures.push('reddit blocked or empty');

    try {
      const fromArchive = await fetchFromPullpush(threadUrl, sort);
      if (fromArchive) {
        return { statusCode: 200, headers, body: JSON.stringify(fromArchive) };
      }
    } catch (archiveError) {
      failures.push(archiveError.message || 'pullpush failed');
    }

    const fromArctic = await fetchFromArcticShift(threadUrl);
    if (fromArctic) {
      return { statusCode: 200, headers, body: JSON.stringify(fromArctic) };
    }
  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: error.message || 'Thread fetch failed' })
    };
  }

  return {
    statusCode: 502,
    headers,
    body: JSON.stringify({ error: `Could not load that Reddit thread (${failures.join('; ')}).` })
  };
};
