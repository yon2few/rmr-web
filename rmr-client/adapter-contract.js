(function installRmrAdapterContract(root) {
  'use strict';

  const REQUIRED_METHODS = Object.freeze([
    'resolveContext',
    'subscribeContextChanges',
    'fetchListing',
    'resolveTransformBaseUrl',
    'renderContext',
    'showFetchError',
    'setFetchPending',
    'resetContext',
    'onListingLoaded'
  ]);
  const CONTEXT_STATES = Object.freeze([
    'off-reddit',
    'login-required',
    'need-thread',
    'ready'
  ]);

  function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') {
      throw new Error('[RmrAdapterContract] A platform adapter is required.');
    }
    for (const method of REQUIRED_METHODS) {
      if (typeof adapter[method] !== 'function') {
        throw new Error(`[RmrAdapterContract] Platform adapter is missing ${method}().`);
      }
    }
    if (typeof adapter.id !== 'string' || !adapter.id.trim()) {
      throw new Error('[RmrAdapterContract] Platform adapter id is required.');
    }
    if (typeof adapter.userId !== 'string' || !adapter.userId.trim()) {
      throw new Error('[RmrAdapterContract] Platform adapter userId is required.');
    }
    if (typeof adapter.enableMp3Export !== 'boolean') {
      throw new Error('[RmrAdapterContract] Platform adapter enableMp3Export must be boolean.');
    }
    return adapter;
  }

  function validateContext(context) {
    if (!context || !CONTEXT_STATES.includes(context.state)) {
      throw new Error(`[RmrAdapterContract] Invalid context state: ${context?.state}`);
    }
    if (context.state === 'ready' &&
        (typeof context.threadUrl !== 'string' || !context.threadUrl.trim())) {
      throw new Error('[RmrAdapterContract] Ready context is missing threadUrl.');
    }
    return context;
  }

  const api = Object.freeze({ CONTEXT_STATES, REQUIRED_METHODS, validateAdapter, validateContext });
  root.RmrAdapterContract = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(globalThis));
