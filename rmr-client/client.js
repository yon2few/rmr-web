window.RmrClient = Object.freeze({
  async mount({ adapter } = {}) {
  const contract = window.RmrAdapterContract;
  if (!contract || typeof contract.validateAdapter !== 'function') {
    throw new Error('[RmrClient] rmr-client/adapter-contract.js did not load.');
  }
  contract.validateAdapter(adapter);
  const domain = window.RmrRedditDomain;
  if (!domain || typeof domain.processListing !== 'function') {
    throw new Error('[RmrClient] rmr-client/domain.js did not load.');
  }
  if (!window.RmrClientMarkup || typeof window.RmrClientMarkup.mount !== 'function') {
    throw new Error('[RmrClient] rmr-client/markup.js did not load.');
  }
  const root = document.getElementById('rmr-root');
  if (!root) {
    throw new Error('[RmrClient] Missing #rmr-root.');
  }
  document.documentElement.dataset.rmrPlatform = adapter.id;
  window.RmrClientMarkup.mount(root);

  function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`[RmrClient] Missing #${id}.`);
    return element;
  }

  const sortRadios = document.querySelectorAll('input[name="sort"]');
  if (!sortRadios.length) {
    throw new Error('[RmrClient] Missing sort controls.');
  }
  const gatedCards = document.querySelectorAll('.gated-by-post-only');
  if (!gatedCards.length) {
    throw new Error('[RmrClient] Missing .gated-by-post-only.');
  }

  const ui = {
    panel: requireElement('panel'),
    subreddit: requireElement('subredditLabel'),
    title: requireElement('postTitle'),
    time: requireElement('estTime'),
    sortRadios,
    postOnlyToggle: requireElement('postOnlyToggle'),
    generateAudioBtn: requireElement('generateAudioBtn'),
    generationError: requireElement('generationError'),
    resetBtn: requireElement('rmrInputResetBtn'),
    screenInput: requireElement('screen-input'),
    commentLimit: requireElement('commentLimit'),
    commentLimitLabel: requireElement('commentLimitLabel'),
    maxReplies: requireElement('maxReplies'),
    maxRepliesLabel: requireElement('maxRepliesLabel'),
    maxReplyChildren: requireElement('maxReplyChildren'),
    maxReplyChildrenLabel: requireElement('maxReplyChildrenLabel'),
    barPost: requireElement('bar-post'),
    barComments: requireElement('bar-comments'),
    barReplies: requireElement('bar-replies'),
    barReplyChildren: requireElement('bar-reply-children'),
    gatedCards,
    replyTreeSvg: requireElement('replyTreeSvg')
  };

  let currentTabUrl = null;
  let lastThreadJson = null;
  let currentProcessedData = null;
  let hasAutoFocusedInputSliders = false;
  let generateAbort = null;
  let fetchAbort = null;
  let fetchSeq = 0;
  let fetchBackoffUntil = 0;
  let fetchBackoffMs = 15000;
  const hostReturns = window.ArtReaderHostReturns.createHostPlayer({
    enableMp3Export: adapter.enableMp3Export
  });

  async function resolveTransformBaseUrl() {
    const baseUrl = await adapter.resolveTransformBaseUrl();
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
      throw new Error('[RmrClient] Adapter returned an invalid transform base URL.');
    }
    return baseUrl.trim().replace(/\/$/, '');
  }

  function buildGeneratePayload() {
    if (!currentProcessedData?.flatData) return null;
    return domain.buildGeneratePayload({
      processedData: currentProcessedData,
      userId: adapter.userId,
      titleFallback: ui.title.textContent,
      subredditFallback: ui.subreddit.textContent
    });
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

  const unsubscribeContextChanges = adapter.subscribeContextChanges(() => {
    setTimeout(() => init(), 200);
  });
  if (typeof unsubscribeContextChanges !== 'function') {
    throw new Error('[RmrClient] subscribeContextChanges() must return an unsubscribe function.');
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

  function clearThreadState() {
    currentTabUrl = null;
    lastThreadJson = null;
    currentProcessedData = null;
    clearDashboardMetrics();
    ui.title.classList.remove('is-error');
  }

  function showFetchError(error) {
    lastThreadJson = null;
    currentProcessedData = null;
    clearDashboardMetrics();
    let retrySeconds = null;
    if (error.status === 429) {
      const waitMs = fetchBackoffMs;
      fetchBackoffUntil = Date.now() + waitMs;
      fetchBackoffMs = Math.min(fetchBackoffMs * 2, 120000);
      retrySeconds = Math.ceil(waitMs / 1000);
      setTimeout(() => {
        if (!currentTabUrl || lastThreadJson || Date.now() < fetchBackoffUntil) return;
        performFetch();
      }, waitMs + 50);
    }
    adapter.showFetchError({ error, retrySeconds });
  }

  async function fetchThreadListing(threadUrl, sort, signal) {
    const json = await adapter.fetchListing({ threadUrl, sort, signal });
    return domain.assertUsableListing(json, adapter.id);
  }

  function applyFiltersFromCache() {
    if (!lastThreadJson) return;
    const processed = domain.processListing(lastThreadJson, {
      postOnly: ui.postOnlyToggle.checked,
      maxComments: ui.commentLimit.value,
      maxReplies: ui.maxReplies.value,
      maxReplyChildren: ui.maxReplyChildren.value
    });
    currentProcessedData = processed;
    ui.title.classList.remove('is-error');
    ui.title.classList.add('truncate');
    updateDashboard(processed);
  }

  async function init() {
    try {
      const context = contract.validateContext(await adapter.resolveContext());
      adapter.renderContext(context);
      if (context.state !== 'ready') {
        clearThreadState();
        return;
      }
      const cleanUrl = context.threadUrl.trim();
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
    if (fetchAbort) {
      fetchAbort.abort();
      fetchAbort = null;
    }
    await hostReturns.resetReturns();
    hasAutoFocusedInputSliders = false;
    clearThreadState();
    ui.title.classList.remove('is-error');
    ui.title.classList.add('truncate');
    ui.generationError.textContent = '';
    ui.generationError.hidden = true;
    await adapter.resetContext();
    await init();
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

  ui.postOnlyToggle.addEventListener('change', () => {
    updatePostOnlyGating();
  });

  async function performFetch() {
    if (!currentTabUrl) return;
    const seq = ++fetchSeq;
    const sort = getSelectedSort();
    if (fetchAbort) fetchAbort.abort();
    fetchAbort = new AbortController();
    const signal = fetchAbort.signal;
    adapter.setFetchPending(true);

    try {
      const json = await fetchThreadListing(currentTabUrl, sort, signal);
      if (seq !== fetchSeq) return;

      lastThreadJson = json;
      fetchBackoffUntil = 0;
      fetchBackoffMs = 15000;
      applyFiltersFromCache();
      adapter.onListingLoaded({
        threadUrl: currentTabUrl,
        listing: lastThreadJson,
        processedData: currentProcessedData
      });

      if (!hasAutoFocusedInputSliders && ui.screenInput.style.display !== 'none') {
        hasAutoFocusedInputSliders = true;
        ui.commentLimit.focus();
      }
    } catch (error) {
      if (seq !== fetchSeq) return;
      if (error?.name === 'AbortError') return;
      console.error(
        `[Read Me Reddit] Thread fetch failed: ${describeError(error)} (HTTP ${error.status ?? '?'}, ${error.source || 'unknown'})`
      );
      showFetchError(error);
    } finally {
      if (fetchAbort?.signal === signal) fetchAbort = null;
      if (seq === fetchSeq) adapter.setFetchPending(false);
    }
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
    ui.time.textContent = domain.formatEstimate(data.totalChars);
    updateMetricsUI(data);
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
    abortGenerate();
    generateAbort = new AbortController();
    const signal = generateAbort.signal;
    try {
      ui.generationError.textContent = '';
      ui.generationError.hidden = true;
      ui.generateAudioBtn.disabled = true;
      await postGenerateToEngine(payload, signal);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Generation failed:', err);
      await hostReturns.resetReturns();
      ui.generationError.textContent = `Audio generation failed: ${err.message || err}`;
      ui.generationError.hidden = false;
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
    lastThreadJson = domain.assertUsableListing(json, 'test');
    applyFiltersFromCache();
  };

  initStaticUi();
  await init();
  return Object.freeze({
    reload: init,
    reset: resetApp,
    dispose() {
      abortGenerate();
      if (fetchAbort) fetchAbort.abort();
      unsubscribeContextChanges();
    }
  });
  }
});
