(function installRmrWebAdapter() {
  'use strict';

  document.documentElement.dataset.rmrPlatform = 'web';

  const DEFAULT_TRANSFORM_URL =
    'https://rmr-backend-cloudrun-375541022505.us-central1.run.app';
  let contextListener = null;
  let inputError = '';

  function requireElement(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`[RmrWebAdapter] Missing #${id}.`);
    return element;
  }

  function requireDomain() {
    if (!window.RmrRedditDomain) {
      throw new Error('[RmrWebAdapter] rmr-client/domain.js did not load.');
    }
    return window.RmrRedditDomain;
  }

  function queryParams() {
    return new URLSearchParams(window.location.search);
  }

  function setPasteError(message) {
    const gate = requireElement('webNeedThreadGate');
    const status = requireElement('pasteStatus');
    status.textContent = message;
    gate.classList.toggle('has-error', Boolean(message));
  }

  function setPasteButton({ disabled, label }) {
    const button = requireElement('pasteThreadBtn');
    const text = button.querySelector('.btn-label');
    if (!text) throw new Error('[RmrWebAdapter] Missing #pasteThreadBtn .btn-label.');
    button.disabled = disabled;
    text.textContent = label;
  }

  function readThreadUrl() {
    const input = requireElement('threadUrlInput');
    return input.value.trim() || String(queryParams().get('redditUrl') || '').trim();
  }

  function commitThreadUrl(raw) {
    const domain = requireDomain();
    const next = new URL(window.location.href);
    const input = requireElement('threadUrlInput');
    input.value = raw;
    inputError = '';
    if (!raw) {
      next.searchParams.delete('redditUrl');
    } else if (!domain.isThreadUrl(raw)) {
      inputError = 'Use a reddit.com, redd.it, or share /s/ link.';
      next.searchParams.set('redditUrl', raw);
    } else {
      next.searchParams.set('redditUrl', domain.normalizeThreadUrl(raw));
    }
    window.history.replaceState({}, '', next);
    if (!contextListener) throw new Error('[RmrWebAdapter] Context subscription is not active.');
    contextListener();
  }

  async function pasteAndCommit() {
    setPasteError('');
    let raw;
    try {
      raw = (await navigator.clipboard.readText()).trim();
    } catch (error) {
      setPasteError(`Clipboard access failed: ${error.message || error}. Copy the thread URL and try Paste again.`);
      return;
    }
    if (!raw) {
      setPasteError('Clipboard is empty. Copy a Reddit thread link, then try again.');
      return;
    }
    if (!requireDomain().isThreadUrl(raw)) {
      setPasteError('Use a reddit.com, redd.it, or share /s/ link.');
      return;
    }
    setPasteButton({ disabled: true, label: 'Getting thread…' });
    commitThreadUrl(raw);
  }

  function threadApiUrl(threadUrl, sort) {
    const href = window.location.href;
    const base = href.endsWith('/') ? href : `${href}/`;
    const api = new URL('api/thread', base);
    api.searchParams.set('url', threadUrl);
    api.searchParams.set('sort', sort);
    return api.toString();
  }

  const adapter = Object.freeze({
    id: 'web',
    userId: 'read-me-reddit-web',
    enableMp3Export: false,

    async resolveTransformBaseUrl() {
      return DEFAULT_TRANSFORM_URL;
    },

    subscribeContextChanges(listener) {
      if (typeof listener !== 'function') {
        throw new Error('[RmrWebAdapter] Context listener is required.');
      }
      contextListener = listener;
      const input = requireElement('threadUrlInput');
      const pasteButton = requireElement('pasteThreadBtn');
      const onChange = () => commitThreadUrl(input.value.trim());
      const onKeydown = (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commitThreadUrl(input.value.trim());
      };
      const onPaste = () => void pasteAndCommit();
      input.addEventListener('change', onChange);
      input.addEventListener('keydown', onKeydown);
      pasteButton.addEventListener('click', onPaste);
      return () => {
        input.removeEventListener('change', onChange);
        input.removeEventListener('keydown', onKeydown);
        pasteButton.removeEventListener('click', onPaste);
        contextListener = null;
      };
    },

    async resolveContext() {
      const domain = requireDomain();
      const rawUrl = readThreadUrl();
      const input = requireElement('threadUrlInput');
      if (!input.value.trim() && rawUrl) input.value = rawUrl;
      if (!rawUrl) return { state: 'need-thread', message: '' };
      if (inputError || !domain.isThreadUrl(rawUrl)) {
        return {
          state: 'need-thread',
          message: inputError || 'Use a reddit.com, redd.it, or share /s/ link.'
        };
      }
      return { state: 'ready', threadUrl: domain.normalizeThreadUrl(rawUrl) };
    },

    async fetchListing({ threadUrl, sort, signal }) {
      if (!(signal instanceof AbortSignal)) {
        throw new Error('[RmrWebAdapter] fetchListing requires an AbortSignal.');
      }
      const domain = requireDomain();
      const listingUrl = String(queryParams().get('listingUrl') || '').trim();
      const url = listingUrl || threadApiUrl(threadUrl, sort);
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        const invalid = new Error(`Thread service returned invalid JSON: ${error.message || error}`);
        invalid.status = response.status;
        invalid.source = listingUrl ? 'listingUrl' : 'proxy';
        throw invalid;
      }
      if (!response.ok) {
        const failure = new Error(payload?.error || `Thread service failed: HTTP ${response.status}`);
        failure.status = response.status;
        failure.source = listingUrl ? 'listingUrl' : 'proxy';
        throw failure;
      }
      return domain.assertUsableListing(payload, listingUrl ? 'listingUrl' : 'proxy');
    },

    renderContext(context) {
      const panel = requireElement('panel');
      const footer = requireElement('platformFooterLabel');
      panel.classList.remove('is-off-reddit', 'is-login-required');
      panel.classList.toggle('is-need-thread', context.state === 'need-thread');
      footer.textContent = 'Software by ArT Reader';
      if (context.state === 'need-thread') {
        requireElement('subredditLabel').textContent = 'r/...';
        requireElement('postTitle').textContent = 'Paste a Reddit URL to begin';
        setPasteButton({ disabled: false, label: 'Paste Reddit URL' });
        setPasteError(context.message || '');
      } else {
        setPasteError('');
      }
    },

    showFetchError({ error, retrySeconds }) {
      requireElement('panel').classList.add('is-need-thread');
      setPasteButton({ disabled: false, label: 'Paste Reddit URL' });
      const status = error.status != null ? ` (HTTP ${error.status})` : '';
      const message = retrySeconds != null
        ? `Too many requests. Retrying in ${retrySeconds}s.`
        : `${error.message || 'Could not load this thread'}${status}`;
      setPasteError(message);
    },

    setFetchPending(isPending) {
      requireElement('panel').setAttribute('aria-busy', String(isPending === true));
      setPasteButton({
        disabled: isPending === true,
        label: isPending === true ? 'Getting thread…' : 'Paste Reddit URL'
      });
    },

    async resetContext() {
      inputError = '';
      requireElement('threadUrlInput').value = '';
      const next = new URL(window.location.href);
      next.searchParams.delete('redditUrl');
      window.history.replaceState({}, '', next);
    },

    onListingLoaded({ listing, processedData }) {
      const permalink = processedData?.flatData?.permalink ||
        listing?.[0]?.data?.children?.[0]?.data?.permalink;
      if (typeof permalink !== 'string' || !permalink.trim()) {
        throw new Error('[RmrWebAdapter] Loaded listing is missing its permalink.');
      }
      const fullUrl = permalink.startsWith('http')
        ? permalink.replace(/\/+$/, '')
        : `https://www.reddit.com${permalink.replace(/\/+$/, '')}`;
      const normalized = requireDomain().normalizeThreadUrl(fullUrl);
      requireElement('threadUrlInput').value = normalized;
      const next = new URL(window.location.href);
      next.searchParams.set('redditUrl', normalized);
      window.history.replaceState({}, '', next);
    }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    if (!window.RmrClient || !window.ArtReaderHostReturns) {
      throw new Error('[RmrWebAdapter] Shared RMR client scripts did not load.');
    }
    window.RmrPlatformAdapter = adapter;
    window.rmrClientController = await window.RmrClient.mount({ adapter });
  });
}());
