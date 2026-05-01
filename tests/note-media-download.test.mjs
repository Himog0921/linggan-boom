import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { createNoteMediaDownloadService } from '../src/content/noteMediaDownload.js';
import { mediaAssetStore } from '../src/db/mediaAssetStore.js';

function installBrowserMocks() {
  const listeners = new Map();
  const downloads = [];
  const objectUrls = [];
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  globalThis.URL = {
    createObjectURL(blob) {
      const url = `blob:mock-${objectUrls.length + 1}`;
      objectUrls.push({ url, blob });
      return url;
    },
    revokeObjectURL() {},
  };
  globalThis.window = {
    location: {
      href: 'https://example.com/dashboard',
      host: 'example.com',
      protocol: 'https:',
      origin: 'https://example.com',
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatchEvent(event) {
      const handler = listeners.get(event?.type);
      if (handler) handler(event);
      return true;
    },
  };
  globalThis.document = {
    body: {
      appendChild() {},
    },
    createElement() {
      return {
        style: {},
        click() {
          downloads.push({
            href: this.href,
            download: this.download,
          });
        },
        remove() {},
        set src(value) {
          this._src = value;
        },
        get src() {
          return this._src;
        },
      };
    },
  };
  return {
    downloads,
    objectUrls,
  };
}

function uninstallBrowserMocks() {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.CustomEvent;
  delete globalThis.URL;
  delete globalThis.fetch;
  delete globalThis.XMLHttpRequest;
}

test('downloadNoteMediaFromRecord refreshes douyin note before first download when queue is empty', async () => {
  installBrowserMocks();
  const originalBulkUpsert = mediaAssetStore.bulkUpsert;
  const assetWrites = [];
  mediaAssetStore.bulkUpsert = async (assets) => {
    assetWrites.push(assets);
  };

  const noteUpdates = [];
  const bgCalls = [];

  try {
    const service = createNoteMediaDownloadService({
      MSG: { DOWNLOAD_MEDIA_FILE: 'downloadMediaFile' },
      noteStore: {
        async updateById(noteId, patch) {
          noteUpdates.push({ noteId, patch });
        },
      },
      sendToBackground: async (action, payload) => {
        bgCalls.push({ action, payload });
        return {
          success: true,
          quality: 'HD',
          sourceUrl: payload.candidates?.[0] || '',
          via: 'chrome.downloads',
        };
      },
      collectNote: async () => null,
      loadDouyinRuntime: async () => ({
        extractDouyinContentId: () => '',
        collectDouyinVideo: async () => null,
        refreshDouyinNoteMediaById: async (note) => ({
          ...note,
          platform: 'douyin',
          noteId: 'dy_123',
          contentId: 'dy_123',
          platformContentId: '123',
          title: '新视频',
          videoDownloadUrl: 'https://cdn.example/fresh.mp4',
          videoPlayUrl: 'https://cdn.example/fresh.mp4',
          videoStreams: [{ url: 'https://cdn.example/fresh.mp4', bitrate: 1 }],
        }),
      }),
      extractNoteId: () => '',
    });

    const summary = await service.downloadNoteMediaFromRecord({
      platform: 'douyin',
      noteId: 'dy_123',
      contentId: 'dy_123',
      platformContentId: '123',
      title: '旧视频',
    });

    assert.equal(summary.total, 1);
    assert.equal(summary.success, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.refreshed, true);
    assert.equal(bgCalls.length, 1);
    assert.equal(bgCalls[0].payload.candidates[0], 'https://cdn.example/fresh.mp4');
    assert.ok(noteUpdates.some((entry) => entry.patch?.videoDownloadUrl === 'https://cdn.example/fresh.mp4'));
    assert.ok(assetWrites.length >= 2);
  } finally {
    mediaAssetStore.bulkUpsert = originalBulkUpsert;
    uninstallBrowserMocks();
  }
});

test('downloadNoteMediaFromRecord retries douyin video download after refreshing stale media urls', async () => {
  installBrowserMocks();
  const originalBulkUpsert = mediaAssetStore.bulkUpsert;
  const assetWrites = [];
  mediaAssetStore.bulkUpsert = async (assets) => {
    assetWrites.push(assets);
  };

  const noteUpdates = [];
  const bgCalls = [];
  globalThis.fetch = async () => ({ ok: false, status: 403 });

  try {
    const service = createNoteMediaDownloadService({
      MSG: { DOWNLOAD_MEDIA_FILE: 'downloadMediaFile' },
      noteStore: {
        async updateById(noteId, patch) {
          noteUpdates.push({ noteId, patch });
        },
      },
      sendToBackground: async (action, payload) => {
        bgCalls.push({ action, payload });
        if (bgCalls.length === 1) {
          return { success: false, error: 'expired_url' };
        }
        return {
          success: true,
          quality: 'HD',
          sourceUrl: payload.candidates?.[0] || '',
          via: 'chrome.downloads',
        };
      },
      collectNote: async () => null,
      loadDouyinRuntime: async () => ({
        extractDouyinContentId: () => '',
        collectDouyinVideo: async () => null,
        refreshDouyinNoteMediaById: async (note) => ({
          ...note,
          platform: 'douyin',
          noteId: 'dy_123',
          contentId: 'dy_123',
          platformContentId: '123',
          title: '新视频',
          videoDownloadUrl: 'https://cdn.example/fresh.mp4',
          videoPlayUrl: 'https://cdn.example/fresh.mp4',
          videoStreams: [{ url: 'https://cdn.example/fresh.mp4', bitrate: 1 }],
        }),
      }),
      extractNoteId: () => '',
    });

    const summary = await service.downloadNoteMediaFromRecord({
      platform: 'douyin',
      noteId: 'dy_123',
      contentId: 'dy_123',
      platformContentId: '123',
      title: '旧视频',
      videoDownloadUrl: 'https://cdn.example/stale.mp4',
      videoPlayUrl: 'https://cdn.example/stale.mp4',
      videoStreams: [{ url: 'https://cdn.example/stale.mp4', bitrate: 1 }],
    });

    assert.equal(summary.total, 1);
    assert.equal(summary.success, 1);
    assert.equal(summary.failed, 0);
    assert.equal(summary.refreshed, true);
    assert.equal(bgCalls.length, 2);
    assert.equal(bgCalls[0].payload.candidates[0], 'https://cdn.example/stale.mp4');
    assert.equal(bgCalls[1].payload.candidates[0], 'https://cdn.example/fresh.mp4');
    assert.ok(noteUpdates.some((entry) => entry.patch?.videoDownloadUrl === 'https://cdn.example/fresh.mp4'));
    assert.ok(assetWrites.length >= 3);
  } finally {
    mediaAssetStore.bulkUpsert = originalBulkUpsert;
    uninstallBrowserMocks();
  }
});

test('downloadNoteMediaFromRecord packages xhs note media into a single zip download', async () => {
  const browser = installBrowserMocks();
  const originalBulkUpsert = mediaAssetStore.bulkUpsert;
  mediaAssetStore.bulkUpsert = async () => {};

  const bgCalls = [];

  try {
    const service = createNoteMediaDownloadService({
      MSG: {
        DOWNLOAD_MEDIA_FILE: 'downloadMediaFile',
        FETCH_BINARY_AS_DATA_URL: 'fetchBinaryAsDataUrl',
      },
      noteStore: {
        async updateById() {},
      },
      sendToBackground: async (action, payload) => {
        bgCalls.push({ action, payload });
        if (action !== 'fetchBinaryAsDataUrl') {
          throw new Error(`unexpected action: ${action}`);
        }
        const first = String(payload.candidates?.[0] || '');
        if (first.endsWith('.mp4')) {
          return {
            success: true,
            dataUrl: `data:video/mp4;base64,${Buffer.from('video-binary').toString('base64')}`,
            candidate: first,
            candidateIndex: 0,
          };
        }
        return {
          success: true,
          dataUrl: `data:image/jpeg;base64,${Buffer.from(first).toString('base64')}`,
          candidate: first,
          candidateIndex: 0,
        };
      },
      collectNote: async () => null,
      loadDouyinRuntime: async () => ({
        extractDouyinContentId: () => '',
        collectDouyinVideo: async () => null,
        refreshDouyinNoteMediaById: async () => null,
      }),
      extractNoteId: () => '',
    });

    const summary = await service.downloadNoteMediaFromRecord({
      platform: 'xhs',
      noteId: 'xhs_note_1',
      contentId: 'xhs_note_1',
      title: '测试标题',
      imageCandidates: [
        ['https://sns.example/1.jpg'],
        ['https://sns.example/2.jpg'],
      ],
      videoDownloadUrl: 'https://sns.example/video.mp4',
    });

    assert.equal(summary.total, 3);
    assert.equal(summary.success, 3);
    assert.equal(summary.failed, 0);
    assert.equal(summary.zipped, true);
    assert.equal(bgCalls.length, 3);
    assert.equal(browser.downloads.length, 1);
    assert.match(browser.downloads[0].download, /测试标题.*\.zip|xhs_note_1_测试标题.*\.zip/);
    assert.equal(browser.objectUrls.length, 1);

    const zip = await JSZip.loadAsync(await browser.objectUrls[0].blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    assert.deepEqual(names, ['图_01.jpg', '图_02.jpg', '测试标题.mp4']);
  } finally {
    mediaAssetStore.bulkUpsert = originalBulkUpsert;
    uninstallBrowserMocks();
  }
});
