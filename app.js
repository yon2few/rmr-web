document.addEventListener('DOMContentLoaded', async () => {
  const ui = {
    panel: document.getElementById('panel'),
    needThreadGate: document.getElementById('needThreadGate'),
    threadUrlInput: document.getElementById('threadUrlInput'),
    subreddit: document.getElementById('subredditLabel'),
    title: document.getElementById('postTitle'),
    time: document.getElementById('estTime'),
    sortRadios: document.querySelectorAll('input[name="sort"]'),
    postOnlyToggle: document.getElementById('postOnlyToggle'),
    generateAudioBtn: document.getElementById('generateAudioBtn'),
    resetBtn: document.getElementById('rmrInputResetBtn'),
    screenInput: document.getElementById('screen-input'),
    commentLimit: document.getElementById('commentLimit'),
    commentLimitLabel: document.getElementById('commentLimitLabel'),
    maxReplies: document.getElementById('maxReplies'),
    maxRepliesLabel: document.getElementById('maxRepliesLabel'),
    maxReplyChildren: document.getElementById('maxReplyChildren'),
    maxReplyChildrenLabel: document.getElementById('maxReplyChildrenLabel'),
    barPost: document.getElementById('bar-post'),
    barComments: document.getElementById('bar-comments'),
    barReplies: document.getElementById('bar-replies'),
    barReplyChildren: document.getElementById('bar-reply-children'),
    gatedCards: document.querySelectorAll('.gated-by-post-only'),
    replyTreeSvg: document.getElementById('replyTreeSvg')
  };

  let currentTabUrl = null;
  let lastThreadJson = null;
  let currentProcessedData = null;
  let hasAutoFocusedInputSliders = false;
  let generateAbort = null;
  let fetchSeq = 0;
  let fetchBackoffUntil = 0;
  let fetchBackoffMs = 15000;
  const hostReturns = window.ArtReaderHostReturns.createHostPlayer();

  const DEFAULT_TRANSFORM_URL =
    'https://read-me-reddit-transform-service-375541022505.us-central1.run.app';
  const LOCAL_TRANSFORM_URL = 'http://127.0.0.1:8787';
  // Engine AudioSystem.CHUNK_SIZE_CHARS_PER_SECOND — 420 chars = 30s.
  const CHARS_PER_SECOND = 14;

  function pageQueryParams() {
    return new URLSearchParams(window.location.search);
  }

  async function resolveTransformBaseUrl() {
    const params = pageQueryParams();
    const fromQuery = (params.get('adkProxy') || '').trim().replace(/\/$/, '');
    if (fromQuery) return fromQuery;
    const backend = (params.get('generateBackend') || '').trim().toLowerCase();
    if (backend === 'local') return LOCAL_TRANSFORM_URL;
    return DEFAULT_TRANSFORM_URL;
  }

  function buildGeneratePayload() {
    if (!currentProcessedData?.flatData) return null;
    const title =
      currentProcessedData.postTitle ||
      currentProcessedData.flatData.title ||
      ui.title?.textContent?.trim() ||
      '';
    const subreddit =
      currentProcessedData.subreddit ||
      currentProcessedData.flatData.subreddit ||
      ui.subreddit?.textContent?.trim() ||
      '';
    return {
      title: title.trim(),
      subreddit: subreddit.trim(),
      flatData: currentProcessedData.flatData,
      userId: 'read-me-reddit-web'
    };
  }

  async function postGenerateToEngine(payload, signal) {
    const base = (await resolveTransformBaseUrl()).replace(/\/$/, '');
    const endpoint = `${base}/run`;
    console.info('[Read Me Reddit] Generate POST:', endpoint);
    hostReturns.setThreadChrome({
      subreddit: payload.subreddit,
      title: payload.title
    });
    await hostReturns.runGenerate({ endpoint, payload, signal });
  }

  function threadApiUrl(threadUrl, sort) {
    const api = new URL('api/thread', window.location.href);
    api.searchParams.set('url', threadUrl);
    api.searchParams.set('sort', sort);
    return api.toString();
  }

  function getSelectedSort() {
    const checked = Array.from(ui.sortRadios).find((el) => el.checked);
    return checked ? checked.value : 'best';
  }

  function clampRangeToBounds(rangeEl, numberEl) {
    const min = parseInt(rangeEl.min, 10);
    const max = parseInt(rangeEl.max, 10);
    const step = parseInt(rangeEl.step, 10) || 1;
    let value = parseInt(rangeEl.value, 10);
    if (!Number.isFinite(value)) value = min;
    value = Math.max(min, Math.min(max, Math.round(value / step) * step));
    rangeEl.value = value;
    numberEl.value = value;
  }

  function initStaticUi() {
    clampRangeToBounds(ui.commentLimit, ui.commentLimitLabel);
    clampRangeToBounds(ui.maxReplies, ui.maxRepliesLabel);
    clampRangeToBounds(ui.maxReplyChildren, ui.maxReplyChildrenLabel);
    updateSliderFill(ui.commentLimit);
    updateSliderFill(ui.maxReplies);
    updateSliderFill(ui.maxReplyChildren);
    renderReplyTree();
  }

  const TREE_SLIDER_COLOR_VAR = {
    commentLimit: '--tier-comments',
    maxReplies: '--tier-replies',
    maxReplyChildren: '--tier-nested'
  };
  function updateSliderFill(rangeEl) {
    const min = parseFloat(rangeEl.min);
    const max = parseFloat(rangeEl.max);
    const value = parseFloat(rangeEl.value);
    const percent = ((value - min) / (max - min)) * 100;
    const colorVar = TREE_SLIDER_COLOR_VAR[rangeEl.id] || '--tier-post';
    const fillColor = `color-mix(in srgb, var(${colorVar}) 15%, var(--tier-track-background))`;
    rangeEl.style.background = `linear-gradient(to right, ${fillColor} ${percent}%, var(--tier-track-background) ${percent}%)`;
  }

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

  function toRedditJsonUrl(threadUrl, sort) {
    const u = new URL(threadUrl);
    u.hash = '';
    u.search = '';
    u.pathname = u.pathname.replace(/\/+$/, '');
    if (!u.pathname.endsWith('.json')) {
      u.pathname = `${u.pathname}.json`;
    }
    u.searchParams.set('sort', toRedditSortParam(sort));
    u.searchParams.set('raw_json', '1');
    return u.toString();
  }

  function toOldRedditJsonUrl(threadUrl, sort) {
    const u = new URL(toRedditJsonUrl(threadUrl, sort));
    u.hostname = 'old.reddit.com';
    return u.toString();
  }

  function describeError(error) {
    if (error == null) return 'unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error && error.message) return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  function clearDashboardMetrics() {
    currentProcessedData = null;
    ui.time.textContent = '0:00';
    ui.barPost.style.width = '0%';
    ui.barComments.style.width = '0%';
    ui.barReplies.style.width = '0%';
    ui.barReplyChildren.style.width = '0%';
    renderReplyTree();
  }

  function setNeedThreadGate(active) {
    ui.panel.classList.toggle('is-need-thread', active);
    if (active) {
      currentTabUrl = null;
      lastThreadJson = null;
      currentProcessedData = null;
      clearDashboardMetrics();
      ui.title.classList.remove('is-error');
      ui.title.classList.add('truncate');
      ui.subreddit.textContent = 'r/...';
      ui.title.textContent = 'Paste a thread to begin';
    }
  }

  function showFetchError(error) {
    lastThreadJson = null;
    currentProcessedData = null;
    clearDashboardMetrics();
    if (error.status === 429) {
      const waitMs = fetchBackoffMs;
      fetchBackoffUntil = Date.now() + waitMs;
      fetchBackoffMs = Math.min(fetchBackoffMs * 2, 120000);
      const waitSec = Math.ceil(waitMs / 1000);
      ui.subreddit.textContent = 'Reddit rate-limited this fetch';
      ui.title.textContent = `Too many requests. Retrying in ${waitSec}s.`;
      setTimeout(() => {
        if (!currentTabUrl || lastThreadJson || Date.now() < fetchBackoffUntil) return;
        performFetch();
      }, waitMs + 50);
    } else {
      const statusPart = error.status != null ? ` (HTTP ${error.status})` : '';
      ui.subreddit.textContent = 'Thread load failed';
      ui.title.textContent = `${error.message || 'Could not load this thread'}${statusPart}`;
    }
    ui.title.classList.add('is-error');
    ui.title.classList.remove('truncate');
  }

  function readThreadUrlFromUi() {
    const fromInput = (ui.threadUrlInput?.value || '').trim();
    if (fromInput) return fromInput;
    return (pageQueryParams().get('redditUrl') || '').trim();
  }

  function assertUsableThreadListing(json, source) {
    const post = json?.[0]?.data?.children?.[0]?.data;
    if (!post || !post.id) {
      const err = new Error(`${source} Reddit JSON missing post listing`);
      err.status = null;
      err.source = source;
      throw err;
    }
    return json;
  }

  async function fetchNativeThreadJson(threadUrl, sort) {
    const listingUrl = pageQueryParams().get('listingUrl');
    if (listingUrl) {
      const listingRes = await fetch(listingUrl, { headers: { Accept: 'application/json' } });
      if (!listingRes.ok) {
        const err = new Error(`Harness listingUrl failed: HTTP ${listingRes.status}`);
        err.status = listingRes.status;
        err.source = 'listingUrl';
        throw err;
      }
      return assertUsableThreadListing(await listingRes.json(), 'listingUrl');
    }

    const res = await fetch(threadApiUrl(threadUrl, sort), { headers: { Accept: 'application/json' } });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(payload?.error || `Reddit JSON failed: HTTP ${res.status}`);
      err.status = res.status;
      err.source = 'proxy';
      throw err;
    }
    return assertUsableThreadListing(payload, 'proxy');
  }

  function applyFiltersFromCache() {
    if (!lastThreadJson) return;
    const processed = processRedditData(lastThreadJson);
    currentProcessedData = processed;
    ui.title.classList.remove('is-error');
    ui.title.classList.add('truncate');
    updateDashboard(processed);
  }

  async function init() {
    try {
      const rawUrl = readThreadUrlFromUi();
      if (ui.threadUrlInput && !ui.threadUrlInput.value.trim() && rawUrl) {
        ui.threadUrlInput.value = rawUrl;
      }
      if (!rawUrl) {
        setNeedThreadGate(true);
        return;
      }
      if (!isRedditThreadUrl(rawUrl)) {
        setNeedThreadGate(false);
        ui.subreddit.textContent = 'Not a thread URL';
        ui.title.textContent = 'Use a reddit.com, redd.it, or share /s/ link.';
        ui.title.classList.add('is-error');
        ui.title.classList.remove('truncate');
        return;
      }

      setNeedThreadGate(false);
      const cleanUrl = normalizeRedditThreadUrl(rawUrl);
      const urlChanged = cleanUrl !== currentTabUrl;
      if (urlChanged) {
        currentTabUrl = cleanUrl;
        lastThreadJson = null;
        hasAutoFocusedInputSliders = false;
        fetchBackoffUntil = 0;
        fetchBackoffMs = 15000;
      }
      if (lastThreadJson) return;
      if (Date.now() < fetchBackoffUntil) return;
      performFetch();
    } catch (e) {
      console.error('Init error:', e);
      showFetchError(e);
    }
  }

  function abortGenerate() {
    if (generateAbort) {
      generateAbort.abort();
      generateAbort = null;
    }
  }

  async function resetApp() {
    abortGenerate();
    await hostReturns.resetReturns();
    hasAutoFocusedInputSliders = false;
    currentTabUrl = null;
    lastThreadJson = null;
    clearDashboardMetrics();
    ui.title.classList.remove('is-error');
    ui.title.classList.add('truncate');
    if (ui.threadUrlInput) ui.threadUrlInput.value = '';
    const next = new URL(window.location.href);
    next.searchParams.delete('redditUrl');
    window.history.replaceState({}, '', next);
    init();
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TREE_MAX_GROUPS = 4;
  const TREE_BOTTOM_PAD = 6;
  const TREE_POST_X = 22;
  const TREE_POST_Y = 10;
  const TREE_POST_R = 5;
  const TREE_INDENT = { comment: 40, reply: 58, child: 76 };
  const TREE_DOT_R = { comment: 4.5, reply: 3.75, child: 3 };
  const TREE_BAR_RIGHT_EDGE = 320;
  const TREE_BAR_H = 3;
  const TREE_ROW_H = 13;
  const TREE_POST_GROUP_GAP = 32;
  const TREE_GROUP_GAP = 30;
  const TREE_CHIP_GAP = 16;

  function computeMaxSvgHeight(svg) {
    const prevHeight = svg.getBoundingClientRect().height || parseFloat(svg.getAttribute('height')) || 0;
    const spareRoom = window.innerHeight - document.body.getBoundingClientRect().bottom;
    return Math.max(prevHeight + spareRoom, prevHeight);
  }

  function makeSvgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function renderReplyTree() {
    const svg = ui.replyTreeSvg;
    const maxSvgHeight = computeMaxSvgHeight(svg);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const finalizeSvgHeight = (bottomY) => {
      const h = Math.ceil(bottomY + TREE_BOTTOM_PAD);
      svg.setAttribute('viewBox', `0 0 320 ${h}`);
      svg.setAttribute('height', h);
    };

    const addDot = (x, y, r, depth) => {
      svg.appendChild(makeSvgEl('circle', { cx: x, cy: y, r, class: `tree-dot depth-${depth}` }));
    };
    const addBar = (x, y, depth) => {
      const width = TREE_BAR_RIGHT_EDGE - x;
      svg.appendChild(makeSvgEl('rect', {
        x, y: y - TREE_BAR_H / 2, width, height: TREE_BAR_H, rx: 1.5, class: `tree-bar depth-${depth}`
      }));
    };
    const addOverflowChip = (x, y, count) => {
      const label = `+${count} more`;
      const chipW = Math.round(label.length * 5.4 + 16);
      svg.appendChild(makeSvgEl('rect', { x, y: y - 8, width: chipW, height: 16, rx: 4, class: 'tree-overflow-chip' }));
      const text = makeSvgEl('text', { x: x + 8, y: y + 3, 'text-anchor': 'start', class: 'tree-overflow-label' });
      text.textContent = label;
      svg.appendChild(text);
    };

    addDot(TREE_POST_X, TREE_POST_Y, TREE_POST_R, 'post');
    addBar(TREE_POST_X + TREE_POST_R + 6, TREE_POST_Y, 'post');

    const postOnly = ui.postOnlyToggle.checked;
    const maxComments = parseInt(ui.commentLimit.value, 10);
    if (postOnly || !Number.isFinite(maxComments) || maxComments <= 0) {
      finalizeSvgHeight(TREE_POST_Y + TREE_POST_R);
      return;
    }

    const maxReplies = Math.max(parseInt(ui.maxReplies.value, 10) || 0, 0);
    const maxReplyChildren = Math.max(parseInt(ui.maxReplyChildren.value, 10) || 0, 0);
    const rowsPerGroup = maxReplies * (1 + maxReplyChildren);
    const groupSpan = rowsPerGroup * TREE_ROW_H;
    const y0 = TREE_POST_Y + TREE_POST_GROUP_GAP;
    const chipMargin = TREE_ROW_H + TREE_CHIP_GAP + 8;
    const maxYEnd = maxSvgHeight - TREE_BOTTOM_PAD - chipMargin;
    const groupsThatFit = Math.floor((maxYEnd - y0 + TREE_GROUP_GAP) / (groupSpan + TREE_GROUP_GAP));
    const groupsShown = Math.min(maxComments, TREE_MAX_GROUPS, Math.max(1, groupsThatFit));
    const overflowComments = maxComments - groupsShown;

    let y = y0;
    for (let g = 0; g < groupsShown; g++) {
      if (g > 0) y += TREE_GROUP_GAP;
      const depthFor = (depth) => (g === 0 ? depth : 'muted');
      addDot(TREE_INDENT.comment, y, TREE_DOT_R.comment, depthFor('comment'));
      addBar(TREE_INDENT.comment + TREE_DOT_R.comment + 6, y, depthFor('comment'));
      for (let r = 0; r < maxReplies; r++) {
        y += TREE_ROW_H;
        addDot(TREE_INDENT.reply, y, TREE_DOT_R.reply, depthFor('reply'));
        addBar(TREE_INDENT.reply + TREE_DOT_R.reply + 6, y, depthFor('reply'));
        for (let c = 0; c < maxReplyChildren; c++) {
          y += TREE_ROW_H;
          addDot(TREE_INDENT.child, y, TREE_DOT_R.child, depthFor('child'));
          addBar(TREE_INDENT.child + TREE_DOT_R.child + 6, y, depthFor('child'));
        }
      }
    }

    if (overflowComments > 0) {
      y += TREE_ROW_H + TREE_CHIP_GAP;
      addOverflowChip(TREE_INDENT.comment, y, overflowComments);
      finalizeSvgHeight(y + 8);
    } else {
      finalizeSvgHeight(y + TREE_DOT_R.comment);
    }
  }

  function updatePostOnlyGating() {
    const postOnly = ui.postOnlyToggle.checked;
    ui.gatedCards.forEach((card) => {
      card.style.opacity = postOnly ? '0.45' : '1';
      card.querySelectorAll('input').forEach((input) => { input.disabled = postOnly; });
    });
    renderReplyTree();
    applyFiltersFromCache();
  }

  function onFilterControlsChanged() {
    updateSliderFill(ui.commentLimit);
    updateSliderFill(ui.maxReplies);
    updateSliderFill(ui.maxReplyChildren);
    renderReplyTree();
    applyFiltersFromCache();
  }

  function bindSliderPair(rangeEl, numberEl) {
    rangeEl.addEventListener('input', () => {
      numberEl.value = rangeEl.value;
      onFilterControlsChanged();
    });

    numberEl.addEventListener('change', () => {
      const min = parseInt(numberEl.min);
      const max = parseInt(numberEl.max);
      const step = parseInt(numberEl.step) || 1;
      let value = parseInt(numberEl.value);
      if (Number.isNaN(value)) value = parseInt(rangeEl.value);
      value = Math.max(min, Math.min(max, Math.round(value / step) * step));
      numberEl.value = value;
      rangeEl.value = value;
      onFilterControlsChanged();
    });
  }

  bindSliderPair(ui.commentLimit, ui.commentLimitLabel);
  bindSliderPair(ui.maxReplies, ui.maxRepliesLabel);
  bindSliderPair(ui.maxReplyChildren, ui.maxReplyChildrenLabel);

  ui.sortRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      lastThreadJson = null;
      fetchBackoffUntil = 0;
      performFetch();
    });
  });

  function commitThreadUrlFromInput() {
    const raw = (ui.threadUrlInput?.value || '').trim();
    const next = new URL(window.location.href);
    if (raw && isRedditThreadUrl(raw)) {
      next.searchParams.set('redditUrl', normalizeRedditThreadUrl(raw));
    } else if (raw) {
      next.searchParams.set('redditUrl', raw);
    } else {
      next.searchParams.delete('redditUrl');
    }
    window.history.replaceState({}, '', next);
    lastThreadJson = null;
    currentTabUrl = null;
    init();
  }

  ui.threadUrlInput?.addEventListener('change', commitThreadUrlFromInput);
  ui.threadUrlInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitThreadUrlFromInput();
    }
  });

  ui.postOnlyToggle.addEventListener('change', () => {
    updatePostOnlyGating();
  });

  async function performFetch() {
    if (!currentTabUrl) return;
    const seq = ++fetchSeq;
    const sort = getSelectedSort();

    try {
      const json = await fetchNativeThreadJson(currentTabUrl, sort);
      if (seq !== fetchSeq) return;

      lastThreadJson = json;
      fetchBackoffUntil = 0;
      fetchBackoffMs = 15000;
      applyFiltersFromCache();

      if (!hasAutoFocusedInputSliders && ui.screenInput.style.display !== 'none') {
        hasAutoFocusedInputSliders = true;
        ui.commentLimit.focus();
      }
    } catch (error) {
      if (seq !== fetchSeq) return;
      if (error.status == null && /not ready/i.test(error.message || '')) {
        console.warn('[Read Me Reddit] Thread fetch waiting for Reddit tab:', error.message);
        return;
      }
      console.error(
        `[Read Me Reddit] Thread fetch failed: ${describeError(error)} (HTTP ${error.status ?? '?'}, ${error.source || 'unknown'})`
      );
      showFetchError(error);
    }
  }

  function formatTime(chars) {
    const totalSec = Math.ceil(chars / CHARS_PER_SECOND);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  const stripUrls = (text) => (text
    ? text
        .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
        .replace(/https?:\/\/[^\s]+/g, '')
        .trim()
    : '');

  const KNOWN_BOT_USERNAMES = ['automoderator', 'spotlight-app'];
  const BOT_FOOTER_RE = /i\s+am\s+a\s+bot,?\s+and\s+this\s+action\s+was\s+performed\s+automatically/i;
  const BOT_USERNAME_SUFFIX_RE = /(^|[-_])bot$/i;
  function isBotComment(author, body) {
    const name = (author || '').toLowerCase();
    if (KNOWN_BOT_USERNAMES.includes(name)) return true;
    if (BOT_USERNAME_SUFFIX_RE.test(name)) return true;
    if (BOT_FOOTER_RE.test(body || '')) return true;
    return false;
  }

  const REMOVED_DELETED_BODY_RE = /^\[(removed|deleted)\]$/i;
  const IMAGE_ONLY_BODY_RE = /^!?\[\]\([^)]*\)$|^https?:\/\/\S+\.(jpe?g|png|gif|webp|gifv)(\?\S*)?$|^https?:\/\/(i\.redd\.it|preview\.redd\.it|v\.redd\.it)\/\S+$/i;
  function isNonNarratableBody(rawBody) {
    const trimmed = (rawBody || '').trim();
    if (!trimmed) return true;
    if (REMOVED_DELETED_BODY_RE.test(trimmed)) return true;
    if (IMAGE_ONLY_BODY_RE.test(trimmed)) return true;
    return false;
  }

  const FIXED_MAX_DEPTH = 2;

  function processRedditData(json) {
    const postData = json[0]?.data?.children?.[0]?.data;
    const comments = json[1]?.data?.children || [];
    const postOnly = ui.postOnlyToggle.checked;
    const maxComments = parseInt(ui.commentLimit.value);
    const maxDepth = FIXED_MAX_DEPTH;
    const maxReplies = parseInt(ui.maxReplies.value);
    const maxReplyChildren = parseInt(ui.maxReplyChildren.value);

    const facts = {
      subreddit: postData?.subreddit_name_prefixed || 'r/unknown',
      op: postData?.author || 'unknown',
      title: postData?.title || '',
      body: stripUrls(postData?.selftext || ''),
      transcript: []
    };

    let postChars = facts.op.length + facts.title.length + facts.body.length;
    let commentChars = 0;
    let replyChars = 0;
    let replyChildChars = 0;

    function traverse(nodes, depth, parentIndex) {
      if (depth > maxDepth) return;
      let count = 0;
      let siblingsProcessed = 0;
      const siblingCap = depth === 1 ? maxReplies : maxReplyChildren;

      for (const node of nodes) {
        if (node.kind === 'more') continue;
        if (depth === 0 && count >= maxComments) break;
        if (depth > 0 && siblingsProcessed >= siblingCap) break;

        const d = node.data;
        const cleaned = stripUrls(d.body || '');
        if (isBotComment(d.author, d.body) || isNonNarratableBody(d.body) || !cleaned) continue;

        const entryChars = (d.author?.length || 0) + cleaned.length;
        const entryIndex = facts.transcript.length;
        facts.transcript.push({
          user: d.author || '',
          content: cleaned,
          depth,
          parentIndex: depth === 0 ? null : parentIndex
        });

        if (depth === 0) {
          commentChars += entryChars;
          count++;
        } else if (depth === 1) {
          replyChars += entryChars;
          siblingsProcessed++;
        } else {
          replyChildChars += entryChars;
          siblingsProcessed++;
        }

        if (d.replies?.data?.children) {
          traverse(d.replies.data.children, depth + 1, entryIndex);
        }
      }
    }

    if (!postOnly) {
      traverse(comments, 0, null);
    }

    return {
      postTitle: facts.title,
      subreddit: facts.subreddit,
      totalChars: postChars + commentChars + replyChars + replyChildChars,
      segments: { postChars, commentChars, replyChars, replyChildChars },
      flatData: { ...facts, permalink: postData?.permalink || '' }
    };
  }

  function updateMetricsUI(facts) {
    const totalChars = facts.totalChars || 1;
    const segments = facts.segments || { postChars: 0, commentChars: 0, replyChars: 0, replyChildChars: 0 };
    ui.barPost.style.width = `${(segments.postChars / totalChars) * 100}%`;
    ui.barComments.style.width = `${(segments.commentChars / totalChars) * 100}%`;
    ui.barReplies.style.width = `${(segments.replyChars / totalChars) * 100}%`;
    ui.barReplyChildren.style.width = `${(segments.replyChildChars / totalChars) * 100}%`;
  }

  function updateDashboard(data) {
    ui.title.classList.remove('is-error');
    ui.title.classList.add('truncate');
    ui.title.textContent = data.postTitle || 'Waiting...';
    ui.subreddit.textContent = data.subreddit || 'r/unknown';
    ui.time.textContent = formatTime(data.totalChars);
    updateMetricsUI(data);
    const permalink = data.flatData?.permalink || lastThreadJson?.[0]?.data?.children?.[0]?.data?.permalink;
    if (permalink && ui.threadUrlInput) {
      const full = permalink.startsWith('http')
        ? permalink.replace(/\/+$/, '')
        : `https://www.reddit.com${String(permalink).replace(/\/+$/, '')}`;
      ui.threadUrlInput.value = full;
      currentTabUrl = normalizeRedditThreadUrl(full);
      const next = new URL(window.location.href);
      next.searchParams.set('redditUrl', currentTabUrl);
      window.history.replaceState({}, '', next);
    }
  }

  ui.resetBtn.addEventListener('click', () => {
    resetApp();
  });
  hostReturns.onReset = () => {
    resetApp();
  };

  ui.generateAudioBtn.addEventListener('click', async () => {
    const payload = buildGeneratePayload();
    if (!payload) {
      alert('No filtered Reddit thread is loaded yet.');
      return;
    }
    if (!payload.title) {
      alert('Thread title is missing; cannot generate audio.');
      return;
    }
    if (!payload.subreddit) {
      alert('Subreddit is missing; cannot generate audio.');
      return;
    }

    abortGenerate();
    generateAbort = new AbortController();
    const signal = generateAbort.signal;
    try {
      ui.generateAudioBtn.disabled = true;
      await postGenerateToEngine(payload, signal);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Generation failed:', err);
      alert(`Audio generation failed: ${err.message}`);
    } finally {
      if (generateAbort && generateAbort.signal === signal) generateAbort = null;
      ui.generateAudioBtn.disabled = false;
    }
  });

  const SLIDER_NAV_ORDER = [ui.commentLimit, ui.maxReplies, ui.maxReplyChildren];
  document.addEventListener('keydown', (e) => {
    if (ui.screenInput.style.display === 'none') return;
    const currentIndex = SLIDER_NAV_ORDER.indexOf(e.target);
    if (currentIndex === -1) return;
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      SLIDER_NAV_ORDER[(currentIndex - 1 + SLIDER_NAV_ORDER.length) % SLIDER_NAV_ORDER.length].focus();
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      SLIDER_NAV_ORDER[(currentIndex + 1) % SLIDER_NAV_ORDER.length].focus();
    }
  });

  document.querySelectorAll('.stair-row').forEach((row) => {
    const rangeInput = row.querySelector('input[type="range"]');
    if (!rangeInput) return;
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      rangeInput.focus();
    });
  });

  window.__rmrLoadListingForTest = function loadListingForTest(json) {
    lastThreadJson = json;
    setOffRedditGate(false);
    setLoginRequiredGate(false);
    setNeedThreadGate(false);
    applyFiltersFromCache();
  };

  initStaticUi();
  init();
});
