(function () {
  if (window.__lgboom_xhs_api_capture_installed) return;
  window.__lgboom_xhs_api_capture_installed = true;

  window.__lgboom_xhs_comment_pages = window.__lgboom_xhs_comment_pages || {};
  window.__lgboom_xhs_sub_comment_pages = window.__lgboom_xhs_sub_comment_pages || {};

  const BRIDGE_SOURCE = 'lgboom-xhs-api-capture';
  const REQUEST_SOURCE = 'lgboom-xhs-content';
  const SNAPSHOT_REQUEST_TYPE = '__lgboom_xhs_comment_api_request__';
  const SNAPSHOT_RESPONSE_TYPE = '__lgboom_xhs_comment_api_response__';
  const PAGE_FETCH_REQUEST_TYPE = '__lgboom_xhs_page_fetch_request__';
  const PAGE_FETCH_RESPONSE_TYPE = '__lgboom_xhs_page_fetch_response__';
  const API_PATTERNS = [
    '/api/sns/web/v2/comment/page',
    '/api/sns/web/v2/comment/sub/page',
  ];

  function safeClone(value) {
    if (value == null) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function isRelevantApi(url) {
    const raw = String(url || '');
    return API_PATTERNS.some((pattern) => raw.includes(pattern));
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function readPayload(json) {
    if (json?.data && typeof json.data === 'object') return json.data;
    return json || {};
  }

  function extractComments(json) {
    const payload = readPayload(json);
    const candidates = [
      payload?.comments,
      payload?.comment_list,
      payload?.list,
      json?.comments,
      json?.comment_list,
      Array.isArray(payload) ? payload : null,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.map((item) => safeClone(item)).filter(Boolean);
      }
    }
    return [];
  }

  function readCursor(json) {
    const payload = readPayload(json);
    const candidates = [
      payload?.cursor,
      payload?.next_cursor,
      payload?.nextCursor,
      json?.cursor,
      json?.next_cursor,
      json?.nextCursor,
    ];
    for (const value of candidates) {
      if (value == null) continue;
      const text = normalizeText(value);
      if (text) return text;
    }
    return '';
  }

  function readHasMore(json) {
    const payload = readPayload(json);
    const candidates = [
      payload?.has_more,
      payload?.hasMore,
      payload?.more,
      json?.has_more,
      json?.hasMore,
      json?.more,
    ];
    for (const value of candidates) {
      if (value === true || value === 1 || value === '1') return true;
      if (value === false || value === 0 || value === '0') return false;
    }
    return false;
  }

  function buildSnapshot(json, sourceUrl = '') {
    let parsedUrl = null;
    try {
      parsedUrl = new URL(sourceUrl, window.location.origin);
    } catch {
      parsedUrl = null;
    }

    const payload = readPayload(json);
    const endpoint = String(sourceUrl || '').includes('/api/sns/web/v2/comment/sub/page') ? 'sub' : 'page';
    const noteId = normalizeText(
      parsedUrl?.searchParams.get('note_id')
      || payload?.note_id
      || payload?.noteId
      || json?.note_id
      || json?.noteId
    );
    const rootCommentId = normalizeText(
      parsedUrl?.searchParams.get('root_comment_id')
      || payload?.root_comment_id
      || payload?.rootCommentId
      || json?.root_comment_id
      || json?.rootCommentId
    );

    if (!noteId) return null;

    return {
      endpoint,
      noteId,
      rootCommentId,
      cursor: readCursor(json),
      hasMore: readHasMore(json),
      comments: extractComments(json),
      sourceUrl: normalizeText(sourceUrl),
      capturedAt: Date.now(),
    };
  }

  function upsertPage(store, key, snapshot) {
    if (!key || !snapshot) return;
    const current = Array.isArray(store[key]) ? store[key] : [];
    const pageKey = `${snapshot.endpoint}|${snapshot.cursor || '__first__'}|${snapshot.sourceUrl || '__source__'}`;
    const filtered = current.filter((item) => {
      const itemKey = `${normalizeText(item?.endpoint)}|${normalizeText(item?.cursor) || '__first__'}|${normalizeText(item?.sourceUrl) || '__source__'}`;
      return itemKey !== pageKey;
    });
    filtered.push(snapshot);
    filtered.sort((a, b) => Number(a?.capturedAt || 0) - Number(b?.capturedAt || 0));
    store[key] = filtered.slice(-30);
  }

  function handleJson(url, json) {
    const snapshot = buildSnapshot(json, url);
    if (!snapshot) return;

    if (snapshot.endpoint === 'sub') {
      const key = `${snapshot.noteId}::${snapshot.rootCommentId || '__root__'}`;
      upsertPage(window.__lgboom_xhs_sub_comment_pages, key, snapshot);
      return;
    }
    upsertPage(window.__lgboom_xhs_comment_pages, snapshot.noteId, snapshot);
  }

  function attachFetchHook() {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
      const response = await originalFetch(...args);
      try {
        const requestUrl = String(args?.[0]?.url || args?.[0] || response?.url || '');
        if (response?.ok && isRelevantApi(requestUrl)) {
          response.clone().json().then((json) => {
            handleJson(requestUrl, json);
          }).catch(() => {});
        }
      } catch {
        // ignore capture failures
      }
      return response;
    };
  }

  function attachXhrHook() {
    if (typeof XMLHttpRequest === 'undefined') return;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__lgboom_xhs_request_url = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const requestUrl = String(this.__lgboom_xhs_request_url || this.responseURL || '');
          if (this.status >= 200 && this.status < 300 && isRelevantApi(requestUrl)) {
            const json = JSON.parse(String(this.responseText || '{}'));
            handleJson(requestUrl, json);
          }
        } catch {
          // ignore capture failures
        }
      });
      return originalSend.call(this, ...args);
    };
  }

  function respond(type, payload) {
    try {
      window.postMessage({
        source: BRIDGE_SOURCE,
        type,
        payload,
      }, '*');
    } catch {
      // ignore bridge failures
    }
  }

  async function fetchViaPage(urls = []) {
    let lastError = null;
    for (const url of Array.isArray(urls) ? urls : []) {
      const requestUrl = normalizeText(url);
      if (!requestUrl) continue;
      try {
        const response = await fetch(requestUrl, { credentials: 'include' });
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        const json = await response.clone().json();
        handleJson(requestUrl, json);
        return json;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('page_fetch_failed');
  }

  function handleBridgeMessage(event) {
    try {
      if (event.source !== window) return;
      const data = event.data || {};
      if (data.source !== REQUEST_SOURCE) return;

      if (data.type === SNAPSHOT_REQUEST_TYPE) {
        const requestId = normalizeText(data.payload?.requestId);
        const noteId = normalizeText(data.payload?.noteId);
        const pages = safeClone(window.__lgboom_xhs_comment_pages[noteId] || []) || [];
        const subPages = Object.entries(window.__lgboom_xhs_sub_comment_pages || {})
          .filter(([key]) => key.startsWith(`${noteId}::`))
          .flatMap(([, value]) => Array.isArray(value) ? value : [])
          .map((item) => safeClone(item))
          .filter(Boolean);
        respond(SNAPSHOT_RESPONSE_TYPE, {
          requestId,
          ok: true,
          noteId,
          pages,
          subPages,
        });
        return;
      }

      if (data.type === PAGE_FETCH_REQUEST_TYPE) {
        const requestId = normalizeText(data.payload?.requestId);
        fetchViaPage(data.payload?.urls)
          .then((json) => {
            respond(PAGE_FETCH_RESPONSE_TYPE, {
              requestId,
              ok: true,
              json: safeClone(json),
            });
          })
          .catch((error) => {
            respond(PAGE_FETCH_RESPONSE_TYPE, {
              requestId,
              ok: false,
              error: String(error?.message || error || 'page_fetch_failed'),
            });
          });
      }
    } catch {
      // ignore bridge failures
    }
  }

  attachFetchHook();
  attachXhrHook();
  window.addEventListener('message', handleBridgeMessage);
})();
