import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareRecordWithStableCover } from '../src/sync/flywheelSync.js';

test('prepareRecordWithStableCover uploads cover bytes and replaces preview urls', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push([url, options]);
    if (url === 'https://sns-img.example.com/cover.webp') {
      return new Response(new Blob(['image-bytes'], { type: 'image/webp' }), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      });
    }
    if (url === 'https://workbench.example/api/media-assets/cover') {
      const formData = options.body;
      assert.equal(options.headers.Authorization, 'Bearer token_123');
      assert.equal(formData.get('sourceUrl'), 'https://sns-img.example.com/cover.webp');
      assert.equal(formData.get('platform'), 'xhs');
      assert.equal(formData.get('platformContentId'), 'note_1');
      assert.equal(formData.get('file').name, 'cover-note_1.webp');
      return new Response(JSON.stringify({
        asset: {
          id: 'asset_1',
          publicUrl: 'https://blob.example.com/stable-cover.webp',
          storageProvider: 'vercel_blob',
        },
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const record = await prepareRecordWithStableCover({
      serverUrl: 'https://workbench.example',
      apiToken: 'token_123',
    }, {
      platform: 'xhs',
      noteId: 'note_1',
      coverUrl: 'https://sns-img.example.com/cover.webp',
      images: ['https://sns-img.example.com/cover.webp'],
    });

    assert.equal(calls.length, 2);
    assert.equal(record.coverImage, 'https://blob.example.com/stable-cover.webp');
    assert.equal(record.cover, 'https://blob.example.com/stable-cover.webp');
    assert.equal(record.coverImg, 'https://blob.example.com/stable-cover.webp');
    assert.equal(record.coverUrl, 'https://blob.example.com/stable-cover.webp');
    assert.deepEqual(record.images, ['https://blob.example.com/stable-cover.webp']);
    assert.equal(record.sourceCoverUrl, 'https://sns-img.example.com/cover.webp');
    assert.equal(record.originalCoverUrl, 'https://sns-img.example.com/cover.webp');
    assert.equal(record.coverMediaAssetId, 'asset_1');
    assert.equal(record.coverStorageProvider, 'vercel_blob');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prepareRecordWithStableCover keeps the original cover when upload fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === 'https://sns-img.example.com/cover.webp') {
      return new Response(new Blob(['image-bytes'], { type: 'image/webp' }), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      });
    }
    return new Response(JSON.stringify({ error: 'storage missing' }), { status: 503 });
  };

  try {
    const record = await prepareRecordWithStableCover({
      serverUrl: 'https://workbench.example',
      apiToken: 'token_123',
    }, {
      platform: 'xhs',
      noteId: 'note_1',
      coverUrl: 'https://sns-img.example.com/cover.webp',
    });

    assert.equal(record.coverUrl, 'https://sns-img.example.com/cover.webp');
    assert.equal(record.coverAssetUploadStatus, 'failed');
    assert.match(record.coverAssetUploadError, /storage missing|HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
