const REDDIT_UA = 'ArTReader-RMR/1.0 (https://artreader.art/rmr)';

function isRedditHost(url) {
  try {
    return /(^|\.)reddit\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isRedditThreadUrl(url) {
  try {
    const u = new URL(url);
    if (!isRedditHost(url)) return false;
    return /\/(?:r\/[^/]+|u(?:ser)?\/[^/]+)\/comments\/[^/]+/i.test(u.pathname);
  } catch {
    return false;
  }
}

function normalizeRedditThreadUrl(url) {
  const u = new URL(url);
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
  const match = new URL(url).pathname.match(/\/comments\/([^/]+)/i);
  return match ? match[1] : '';
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
  if (!id) return null;
  const order = pullpushSort(sort);
  const postUrl = `https://api.pullpush.io/reddit/search/submission/?ids=${encodeURIComponent(id)}`;
  const commentUrl =
    `https://api.pullpush.io/reddit/search/comment/?link_id=${encodeURIComponent(`t3_${id}`)}` +
    `&size=100&sort=${order.sort}&sort_type=${order.sort_type}`;
  const [postRes, commentRes] = await Promise.all([fetchJson(postUrl), fetchJson(commentUrl)]);
  const post = postRes.json?.data?.[0];
  if (!post?.id) return null;
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
      body: JSON.stringify({ error: 'Pass a reddit.com /comments/ thread URL as ?url=' })
    };
  }

  const threadUrl = normalizeRedditThreadUrl(rawUrl);
  try {
    const fromReddit = await fetchFromReddit(threadUrl, sort);
    if (fromReddit) {
      return { statusCode: 200, headers, body: JSON.stringify(fromReddit) };
    }
    const fromArchive = await fetchFromPullpush(threadUrl, sort);
    if (fromArchive) {
      return { statusCode: 200, headers, body: JSON.stringify(fromArchive) };
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
    body: JSON.stringify({ error: 'Could not load that Reddit thread.' })
  };
};
