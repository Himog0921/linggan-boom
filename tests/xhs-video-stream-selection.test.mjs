import test from 'node:test';
import assert from 'node:assert/strict';

import { pickBestVideoStream } from '../src/shared/utils.js';

test('pickBestVideoStream keeps xhs h266 and backup video urls as download candidates', () => {
  const result = pickBestVideoStream({
    h266: [
      {
        masterUrl: 'https://sns-video.example/h266-master.mp4',
        backupUrls: [
          'https://sns-video.example/h266-backup-1.mp4',
          'https://sns-video.example/h266-backup-2.mp4',
        ],
        avgBitrate: 5000,
        width: 1920,
        height: 1080,
      },
    ],
    h264: [
      {
        masterUrl: 'https://sns-video.example/h264-master.mp4',
        backup_url: 'https://sns-video.example/h264-backup.mp4',
        avgBitrate: 1000,
        width: 1280,
        height: 720,
      },
    ],
    h_265: [
      {
        master_url: 'https://sns-video.example/h265-snake-master.mp4',
        avg_bitrate: 3000,
        width: 1440,
        height: 900,
      },
    ],
  });

  assert.equal(result.url, 'https://sns-video.example/h266-master.mp4');
  assert.deepEqual(
    result.streams.map((item) => item.url),
    [
      'https://sns-video.example/h266-master.mp4',
      'https://sns-video.example/h266-backup-1.mp4',
      'https://sns-video.example/h266-backup-2.mp4',
      'https://sns-video.example/h265-snake-master.mp4',
      'https://sns-video.example/h264-master.mp4',
      'https://sns-video.example/h264-backup.mp4',
    ],
  );
});
