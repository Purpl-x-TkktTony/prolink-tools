import connect from 'connect';
import http from 'node:http';

import type { PlaybackDeviceDTO, PlaybackSnapshot } from '../src/shared/api/playback';

import { createPlaybackApiMiddleware } from '../src/main/playbackApi';

const port = 5152;

const mockDevice: PlaybackDeviceDTO = {
  id: 1,
  name: 'Mock CDJ-3000',
  status: {
    beat: 42,
    beatInMeasure: 1,
    beatsUntilCue: null,
    bpm: 128,
    effectiveBpm: 128,
    effectivePitchPercent: 0,
    isEmergencyMode: false,
    isMaster: true,
    isOnAir: true,
    isSync: false,
    playState: 'Playing',
    sliderPitchPercent: 0,
    stale: false,
    statusLastReceivedAt: '2026-09-09T20:00:00.000Z',
    track: {
      slot: 'USB',
      sourceDeviceId: 1,
      trackId: 123,
      type: 'RB',
    },
    trackBpm: 128,
  },
  track: {
    album: 'Night Drive',
    artist: 'Test Artist',
    bitrate: 320,
    comment: 'Static local API fixture',
    duration: 320,
    genre: 'House',
    key: 'Am',
    label: 'Test Label',
    masked: false,
    mixName: 'Extended Mix',
    tempo: 128,
    title: 'Test Track',
    year: 2026,
  },
  type: 'CDJ',
};

const mockSnapshot: PlaybackSnapshot = {
  current: {
    playedAt: '2026-09-09T20:00:00.000Z',
    track: {
      album: 'Night Drive',
      artist: 'Test Artist',
      bitrate: 320,
      comment: 'Static local API fixture',
      duration: 320,
      genre: 'House',
      key: 'Am',
      label: 'Test Label',
      masked: false,
      mixName: 'Extended Mix',
      tempo: 128,
      title: 'Test Track',
      year: 2026,
    },
  },
  devices: [mockDevice],
  generatedAt: '2026-09-09T20:00:00.000Z',
  master: mockDevice,
  masterDeviceId: 1,
  masterStatus: 'available',
  networkState: 'connected',
  previous: null,
  schemaVersion: 1,
};

const app = connect();
app.use(
  '/api',
  createPlaybackApiMiddleware(() => mockSnapshot),
);

const server = http.createServer(app);
server.listen(port, '127.0.0.1', () => {
  console.log(`Mock Local Playback API listening at http://127.0.0.1:${port}/api/v1/status`);
});

const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close);
process.once('SIGTERM', close);
