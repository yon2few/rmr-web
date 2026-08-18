const REDDIT_UA = 'ArTReader-RMR/1.0 (https://artreader.art/rmr)';

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

async function followShareShortlink(url) {
  let current = url;
  for (let i = 0; i < 6; i += 1) {
    const parsed = parseRedditInput(current);
    if (!parsed) break;
    if (isReddItHost(parsed.hostname) || /\/comments\/[^/]+/i.test(parsed.pathname)) {
      return normalizeRedditThreadUrl(current);
    }
    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/html', 'User-Agent': REDDIT_UA }
    });
    const location = res.headers.get('location');
    if (!location) break;
    current = new URL(location, current).toString();
  }
  return normalizeRedditThreadUrl(current);
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

  const parsed = parseRedditInput(rawUrl);
  const threadUrl = parsed && /\/s\/[^/]+/i.test(parsed.pathname)
    ? await followShareShortlink(rawUrl)
    : normalizeRedditThreadUrl(rawUrl);
  const failures = [];
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
