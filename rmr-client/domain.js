(function installRmrRedditDomain(root) {
  'use strict';

  const CHARS_PER_SECOND = 14;
  const FIXED_MAX_DEPTH = 2;
  const KNOWN_BOT_USERNAMES = Object.freeze(['automoderator', 'spotlight-app']);
  const BOT_FOOTER_RE = /i\s+am\s+a\s+bot,?\s+and\s+this\s+action\s+was\s+performed\s+automatically/i;
  const BOT_USERNAME_SUFFIX_RE = /(^|[-_])bot$/i;
  const REMOVED_DELETED_BODY_RE = /^\[(removed|deleted)\]$/i;
  const IMAGE_ONLY_BODY_RE = /^!?\[\]\([^)]*\)$|^https?:\/\/\S+\.(jpe?g|png|gif|webp|gifv)(\?\S*)?$|^https?:\/\/(i\.redd\.it|preview\.redd\.it|v\.redd\.it)\/\S+$/i;

  function parseInput(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    try {
      return new URL(/^[a-zA-Z][a-zA-Z+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      return null;
    }
  }

  function isRedditHostname(hostname) {
    return /(^|\.)reddit\.com$/i.test(hostname || '');
  }

  function isReddItHostname(hostname) {
    return /(^|\.)redd\.it$/i.test(hostname || '');
  }

  function isRedditHost(url) {
    const parsed = parseInput(url);
    return Boolean(parsed && (isRedditHostname(parsed.hostname) || isReddItHostname(parsed.hostname)));
  }

  function isThreadUrl(url) {
    const parsed = parseInput(url);
    if (!parsed) return false;
    if (isReddItHostname(parsed.hostname)) {
      return /^\/[A-Za-z0-9]+\/?$/.test(parsed.pathname);
    }
    if (!isRedditHostname(parsed.hostname)) return false;
    return /\/comments\/[^/]+/i.test(parsed.pathname) || /\/s\/[^/]+/i.test(parsed.pathname);
  }

  function normalizeThreadUrl(url) {
    const parsed = parseInput(url);
    if (!parsed || !isThreadUrl(parsed.toString())) {
      throw new Error(`Invalid Reddit thread URL: ${String(url || '').trim() || '(empty)'}`);
    }
    if (isReddItHostname(parsed.hostname)) {
      const id = parsed.pathname.replace(/\//g, '');
      return `https://www.reddit.com/comments/${id}`;
    }
    if (/^(old|sh|new)\.reddit\.com$/i.test(parsed.hostname) || parsed.hostname === 'reddit.com') {
      parsed.hostname = 'www.reddit.com';
    }
    parsed.search = '';
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  }

  function toRedditSortParam(sort) {
    if (!['best', 'top', 'new', 'old'].includes(sort)) {
      throw new Error(`Unsupported Reddit sort: ${sort}`);
    }
    return sort === 'best' ? 'confidence' : sort;
  }

  function toRedditJsonUrl(threadUrl, sort, { oldHost = false } = {}) {
    const parsed = new URL(normalizeThreadUrl(threadUrl));
    if (oldHost) parsed.hostname = 'old.reddit.com';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    if (!parsed.pathname.endsWith('.json')) parsed.pathname = `${parsed.pathname}.json`;
    parsed.searchParams.set('sort', toRedditSortParam(sort));
    parsed.searchParams.set('raw_json', '1');
    return parsed.toString();
  }

  function assertUsableListing(json, source = 'unknown') {
    const post = json?.[0]?.data?.children?.[0]?.data;
    if (!post || !post.id) {
      const error = new Error(`${source} Reddit JSON missing post listing`);
      error.status = null;
      error.source = source;
      throw error;
    }
    if (!Array.isArray(json?.[1]?.data?.children)) {
      const error = new Error(`${source} Reddit JSON missing comments listing`);
      error.status = null;
      error.source = source;
      throw error;
    }
    return json;
  }

  function stripUrls(text) {
    return text
      ? text
          .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
          .replace(/https?:\/\/[^\s]+/g, '')
          .trim()
      : '';
  }

  function isBotComment(author, body) {
    const name = String(author || '').toLowerCase();
    return KNOWN_BOT_USERNAMES.includes(name) ||
      BOT_USERNAME_SUFFIX_RE.test(name) ||
      BOT_FOOTER_RE.test(body || '');
  }

  function isNonNarratableBody(rawBody) {
    const trimmed = String(rawBody || '').trim();
    return !trimmed || REMOVED_DELETED_BODY_RE.test(trimmed) || IMAGE_ONLY_BODY_RE.test(trimmed);
  }

  function readNonNegativeInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${name} must be a non-negative integer.`);
    }
    return parsed;
  }

  function processListing(json, options = {}) {
    assertUsableListing(json, 'processListing');
    const postOnly = options.postOnly === true;
    const maxComments = readNonNegativeInteger(options.maxComments, 'maxComments');
    const maxReplies = readNonNegativeInteger(options.maxReplies, 'maxReplies');
    const maxReplyChildren = readNonNegativeInteger(options.maxReplyChildren, 'maxReplyChildren');
    const postData = json[0].data.children[0].data;
    const comments = json[1].data.children;
    const facts = {
      subreddit: postData.subreddit_name_prefixed || 'r/unknown',
      op: postData.author || 'unknown',
      title: postData.title || '',
      body: stripUrls(postData.selftext || ''),
      permalink: postData.permalink || '',
      transcript: []
    };

    const postChars = facts.op.length + facts.title.length + facts.body.length;
    let commentChars = 0;
    let replyChars = 0;
    let replyChildChars = 0;

    function traverse(nodes, depth, parentIndex) {
      if (depth > FIXED_MAX_DEPTH) return;
      let rootCount = 0;
      let siblingsProcessed = 0;
      const siblingCap = depth === 1 ? maxReplies : maxReplyChildren;

      for (const node of nodes) {
        if (node.kind === 'more') continue;
        if (depth === 0 && rootCount >= maxComments) break;
        if (depth > 0 && siblingsProcessed >= siblingCap) break;

        const data = node.data || {};
        const cleaned = stripUrls(data.body || '');
        if (isBotComment(data.author, data.body) || isNonNarratableBody(data.body) || !cleaned) continue;

        const entryChars = String(data.author || '').length + cleaned.length;
        const entryIndex = facts.transcript.length;
        facts.transcript.push({
          user: data.author || '',
          content: cleaned,
          depth,
          parentIndex: depth === 0 ? null : parentIndex
        });

        if (depth === 0) {
          commentChars += entryChars;
          rootCount += 1;
        } else if (depth === 1) {
          replyChars += entryChars;
          siblingsProcessed += 1;
        } else {
          replyChildChars += entryChars;
          siblingsProcessed += 1;
        }

        if (Array.isArray(data.replies?.data?.children)) {
          traverse(data.replies.data.children, depth + 1, entryIndex);
        }
      }
    }

    if (!postOnly) traverse(comments, 0, null);

    return {
      postTitle: facts.title,
      subreddit: facts.subreddit,
      totalChars: postChars + commentChars + replyChars + replyChildChars,
      segments: { postChars, commentChars, replyChars, replyChildChars },
      flatData: facts
    };
  }

  function formatEstimate(chars) {
    const count = Number(chars);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error('Character count must be a non-negative number.');
    }
    const totalSeconds = Math.ceil(count / CHARS_PER_SECOND);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function buildGeneratePayload({ processedData, userId, titleFallback = '', subredditFallback = '' } = {}) {
    if (!processedData?.flatData || typeof processedData.flatData !== 'object') {
      throw new Error('Processed Reddit data with flatData is required.');
    }
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new Error('A non-empty generation userId is required.');
    }
    const title = String(
      processedData.postTitle || processedData.flatData.title || titleFallback || ''
    ).trim();
    const subreddit = String(
      processedData.subreddit || processedData.flatData.subreddit || subredditFallback || ''
    ).trim();
    if (!title) throw new Error('Thread title is required for generation.');
    if (!subreddit) throw new Error('Subreddit is required for generation.');
    return { title, subreddit, flatData: processedData.flatData, userId: userId.trim() };
  }

  const api = Object.freeze({
    CHARS_PER_SECOND,
    assertUsableListing,
    buildGeneratePayload,
    formatEstimate,
    isBotComment,
    isNonNarratableBody,
    isRedditHost,
    isThreadUrl,
    normalizeThreadUrl,
    parseInput,
    processListing,
    stripUrls,
    toRedditJsonUrl,
    toRedditSortParam
  });

  root.RmrRedditDomain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(globalThis));
