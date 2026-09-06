import {CDJStatus, DeviceType, NetworkState} from 'prolink-connect/lib/types';
import type {DeviceID, Track} from 'prolink-connect/lib/types';

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {getPlaybackSnapshot} from 'src/shared/api/playback';
import {DeviceStore, MixstatusStore, PlayedTrack} from 'src/shared/store';

const NOW = new Date('2024-01-01T00:00:00.000Z');

const makeTrack = (overrides: Partial<Track> = {}): Track =>
  ({
    id: 1,
    title: 'Track Title',
    duration: 320,
    bitrate: 320,
    tempo: 128,
    rating: 0,
    comment: 'a comment',
    filePath: '/path',
    fileName: 'file.mp3',
    beatGrid: null,
    cueAndLoops: null,
    waveformHd: null,
    artwork: null,
    artist: {id: 1, name: 'Artist'},
    originalArtist: null,
    remixer: null,
    composer: null,
    album: {id: 1, name: 'Album'},
    label: {id: 1, name: 'Label'},
    genre: {id: 1, name: 'Genre'},
    color: null,
    key: {id: 1, name: 'Am'},
    ...overrides,
  }) as Track;

const makeDevice = (id: DeviceID, type = DeviceType.CDJ) => ({
  id,
  name: `CDJ-${id}`,
  type,
  macAddr: new Uint8Array(),
  ip: {address: '10.0.0.1'} as any,
});

const makeState = (overrides: Partial<CDJStatus.State> = {}): CDJStatus.State => ({
  deviceId: 1,
  trackId: 1,
  trackDeviceId: 1,
  trackSlot: 3,
  trackType: 1,
  playState: CDJStatus.PlayState.Playing,
  isOnAir: false,
  isSync: false,
  isMaster: false,
  isEmergencyMode: false,
  trackBPM: 128,
  effectivePitch: 0,
  sliderPitch: 0,
  beatInMeasure: 1,
  beatsUntilCue: null,
  beat: 1,
  packetNum: 0,
  ...overrides,
});

const makeStore = () => ({
  config: {idMarker: '[ID]'},
  devices: new Map<DeviceID, DeviceStore>(),
  mixstatus: new MixstatusStore(),
  networkState: NetworkState.Connected,
});

test('empty store returns null current/previous and empty devices', () => {
  const store = makeStore();
  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.current, null);
  assert.equal(snapshot.previous, null);
  assert.deepEqual(snapshot.devices, []);
  assert.equal(snapshot.master, null);
  assert.equal(snapshot.masterDeviceId, null);
  assert.equal(snapshot.masterStatus, 'unavailable');
  assert.equal(snapshot.networkState, 'connected');
  assert.equal(snapshot.schemaVersion, 1);
});

test('current/previous reflect the newest two tracks in the live set', () => {
  const store = makeStore();

  store.mixstatus.addPlayedTrack(
    new PlayedTrack(new Date('2024-01-01T00:00:01.000Z'), makeTrack({title: 'First'})),
  );
  store.mixstatus.addPlayedTrack(
    new PlayedTrack(new Date('2024-01-01T00:00:02.000Z'), makeTrack({title: 'Second'})),
  );

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.current?.track.title, 'Second');
  assert.equal(snapshot.previous?.track.title, 'First');
});

test('set end clears current/previous for the new live set', () => {
  const store = makeStore();

  store.mixstatus.addPlayedTrack(
    new PlayedTrack(new Date('2024-01-01T00:00:01.000Z'), makeTrack({title: 'First'})),
  );
  store.mixstatus.recordSetEnd();

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.current, null);
  assert.equal(snapshot.previous, null);
});

test('masks track metadata matching the configured ID marker', () => {
  const store = makeStore();

  store.mixstatus.addPlayedTrack(
    new PlayedTrack(
      new Date('2024-01-01T00:00:01.000Z'),
      makeTrack({title: '[ID] Track', comment: 'secret'}),
    ),
  );

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.deepEqual(snapshot.current?.track, {
    album: null,
    artist: 'ID',
    bitrate: null,
    comment: null,
    duration: null,
    genre: null,
    key: null,
    label: null,
    masked: true,
    mixName: null,
    tempo: null,
    title: 'ID',
    year: null,
  });
});

test('normalizes missing/nonfinite numeric metadata to null', () => {
  const store = makeStore();

  store.mixstatus.addPlayedTrack(
    new PlayedTrack(
      new Date('2024-01-01T00:00:01.000Z'),
      makeTrack({bitrate: undefined, year: undefined, duration: Number.NaN}),
    ),
  );

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.current?.track.bitrate, null);
  assert.equal(snapshot.current?.track.year, null);
  assert.equal(snapshot.current?.track.duration, null);
});

test('device without a status packet reports status null', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(33) as any);
  store.devices.set(33, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.devices.length, 1);
  assert.equal(snapshot.devices[0].status, null);
  assert.equal(snapshot.devices[0].track, null);
});

test('devices are sorted ascending by device id', () => {
  const store = makeStore();
  store.devices.set(3, new DeviceStore(makeDevice(3) as any));
  store.devices.set(1, new DeviceStore(makeDevice(1) as any));
  store.devices.set(2, new DeviceStore(makeDevice(2) as any));

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.deepEqual(
    snapshot.devices.map(d => d.id),
    [1, 2, 3],
  );
});

test('bpm and effectiveBpm apply slider and effective pitch respectively', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({trackBPM: 128, sliderPitch: 5, effectivePitch: -5});
  deviceStore.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);
  const status = snapshot.devices[0].status;

  assert.equal(status?.bpm, 134.4);
  assert.equal(status?.effectiveBpm, 121.6);
});

test('null base trackBPM keeps bpm and effectiveBpm null', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({trackBPM: null});
  deviceStore.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);
  const status = snapshot.devices[0].status;

  assert.equal(status?.trackBpm, null);
  assert.equal(status?.bpm, null);
  assert.equal(status?.effectiveBpm, null);
});

test('a device status older than the freshness threshold is stale', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState();
  deviceStore.lastStatusReceivedAt = NOW.getTime() - 6_000;
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.devices[0].status?.stale, true);
});

test('exactly one fresh master is reported as available', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({isMaster: true});
  deviceStore.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, deviceStore);

  const other = new DeviceStore(makeDevice(2) as any);
  other.state = makeState({isMaster: false});
  other.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(2, other);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.masterStatus, 'available');
  assert.equal(snapshot.masterDeviceId, 1);
  assert.equal(snapshot.master?.id, 1);
});

test('multiple fresh masters is ambiguous', () => {
  const store = makeStore();
  const a = new DeviceStore(makeDevice(1) as any);
  a.state = makeState({isMaster: true});
  a.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, a);

  const b = new DeviceStore(makeDevice(2) as any);
  b.state = makeState({isMaster: true});
  b.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(2, b);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.masterStatus, 'ambiguous');
  assert.equal(snapshot.master, null);
  assert.equal(snapshot.masterDeviceId, null);
});

test('on-air non-master device is not selected as master', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({isMaster: false, isOnAir: true});
  deviceStore.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.masterStatus, 'unavailable');
  assert.equal(snapshot.master, null);
});

test('a stale-only master is reported as stale, not available', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({isMaster: true});
  deviceStore.lastStatusReceivedAt = NOW.getTime() - 6_000;
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.masterStatus, 'stale');
  assert.equal(snapshot.master, null);
});

test('disconnected/offline network suppresses master selection', () => {
  const store = makeStore();
  store.networkState = NetworkState.Offline;

  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({isMaster: true});
  deviceStore.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.masterStatus, 'unavailable');
  assert.equal(snapshot.master, null);
});

test('paused master retains master identity, playState reflects paused', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({isMaster: true, playState: CDJStatus.PlayState.Paused});
  deviceStore.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.masterStatus, 'available');
  assert.equal(snapshot.master?.status?.playState, 'Paused');
});

test('missing master bpm yields null bpm without hiding master identity', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({isMaster: true, trackBPM: null});
  deviceStore.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.masterStatus, 'available');
  assert.equal(snapshot.master?.status?.bpm, null);
});

test('device with no track loaded reports a null track source', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({trackId: 0});
  deviceStore.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.devices[0].status?.track, null);
});

test('masked device track also masks the status track source identifiers', () => {
  const store = makeStore();
  const deviceStore = new DeviceStore(makeDevice(1) as any);
  deviceStore.state = makeState({trackId: 42});
  deviceStore.track = makeTrack({title: '[ID] Track'});
  deviceStore.lastStatusReceivedAt = NOW.getTime();
  store.devices.set(1, deviceStore);

  const snapshot = getPlaybackSnapshot(store, NOW);

  assert.equal(snapshot.devices[0].track?.masked, true);
  assert.equal(snapshot.devices[0].status?.track, null);
});
