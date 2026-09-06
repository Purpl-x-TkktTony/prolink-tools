import {
  CDJStatus,
  DeviceType,
  MediaSlot,
  NetworkState,
  TrackType,
} from 'prolink-connect/lib/types';
import type {DeviceID, Track} from 'prolink-connect/lib/types';

import type {AppStore, DeviceStore, MixstatusStore, PlayedTrack} from 'src/shared/store';
import metadataIncludes from 'src/utils/metadataIncludes';

/**
 * How long a device's status is considered fresh after it was last received.
 */
export const DEFAULT_FRESHNESS_MS = 5_000;

export type PlaybackTrackDTO = {
  album: string | null;
  artist: string | null;
  bitrate: number | null;
  comment: string | null;
  duration: number | null;
  genre: string | null;
  key: string | null;
  label: string | null;
  masked: boolean;
  mixName: string | null;
  tempo: number | null;
  title: string | null;
  year: number | null;
};

export type PlaybackHistoryEntryDTO = {
  playedAt: string;
  track: PlaybackTrackDTO;
};

export type PlaybackTrackSourceDTO = {
  slot: string;
  sourceDeviceId: DeviceID;
  trackId: number;
  type: string;
};

export type PlaybackDeviceStatusDTO = {
  beat: number | null;
  beatInMeasure: number;
  beatsUntilCue: number | null;
  bpm: number | null;
  effectiveBpm: number | null;
  effectivePitchPercent: number;
  isEmergencyMode: boolean;
  isMaster: boolean;
  isOnAir: boolean;
  isSync: boolean;
  playState: string;
  sliderPitchPercent: number;
  stale: boolean;
  statusLastReceivedAt: string;
  track: PlaybackTrackSourceDTO | null;
  trackBpm: number | null;
};

export type PlaybackDeviceDTO = {
  id: DeviceID;
  name: string;
  status: PlaybackDeviceStatusDTO | null;
  track: PlaybackTrackDTO | null;
  type: string;
};

export type PlaybackMasterStatus = 'available' | 'ambiguous' | 'stale' | 'unavailable';

export type PlaybackSnapshot = {
  current: PlaybackHistoryEntryDTO | null;
  devices: PlaybackDeviceDTO[];
  generatedAt: string;
  master: PlaybackDeviceDTO | null;
  masterDeviceId: DeviceID | null;
  masterStatus: PlaybackMasterStatus;
  networkState: string;
  previous: PlaybackHistoryEntryDTO | null;
  schemaVersion: 1;
};

/**
 * Only the ability to iterate values is needed here. Deliberately not `Map`
 * or `ReadonlyMap`, since mobx's `ObservableMap` return types for
 * `entries()`/`keys()` aren't (and don't need to be) assignable to the
 * newer, stricter `Map` iterator types.
 */
export type PlaybackDeviceSource = {
  values(): Iterable<DeviceStore>;
};

/**
 * Narrow, testable view over the parts of the app store the snapshot needs.
 * Uses structural types (rather than `AppStore` directly) so plain test
 * fixtures satisfy it without needing an observable map/mobx store.
 */
export type PlaybackSnapshotInput = {
  config: Pick<AppStore['config'], 'idMarker'>;
  devices: PlaybackDeviceSource;
  mixstatus: MixstatusStore;
  networkState: NetworkState;
};

const toFiniteOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const isMasked = (track: Track, idMarker: string): boolean =>
  idMarker !== '' && metadataIncludes(track, idMarker);

const nameOrNull = (entity: {name: string} | null | undefined): string | null =>
  entity?.name ?? null;

const maskedTrack = (): PlaybackTrackDTO => ({
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

const mapTrack = (track: Track, masked: boolean): PlaybackTrackDTO => {
  if (masked) {
    return maskedTrack();
  }

  return {
    album: nameOrNull(track.album),
    artist: nameOrNull(track.artist),
    bitrate: toFiniteOrNull(track.bitrate),
    comment: track.comment ?? null,
    duration: toFiniteOrNull(track.duration),
    genre: nameOrNull(track.genre),
    key: nameOrNull(track.key),
    label: nameOrNull(track.label),
    masked: false,
    mixName: track.mixName ?? null,
    tempo: toFiniteOrNull(track.tempo),
    title: track.title ?? null,
    year: toFiniteOrNull(track.year),
  };
};

const mapHistoryEntry = (
  played: PlayedTrack | undefined,
  idMarker: string,
): PlaybackHistoryEntryDTO | null => {
  if (played === undefined) {
    return null;
  }

  const masked = played.metadataIncludes(idMarker);

  return {
    playedAt: played.playedAt.toISOString(),
    // NOTE: masking uses PlayedTrack.metadataIncludes, which already guards
    // against an empty idMarker.
    track: mapTrack(played.track, masked),
  };
};

const mapTrackSource = (
  state: CDJStatus.State,
  masked: boolean,
): PlaybackTrackSourceDTO | null => {
  if (state.trackId === 0) {
    return null;
  }

  // Mask source identifiers on masked decks so the underlying file cannot be
  // correlated back to the "hidden" track via its numeric IDs.
  if (masked) {
    return null;
  }

  return {
    slot: MediaSlot[state.trackSlot] ?? 'unknown',
    sourceDeviceId: state.trackDeviceId,
    trackId: state.trackId,
    type: TrackType[state.trackType] ?? 'unknown',
  };
};

const mapDeviceStatus = (
  state: CDJStatus.State,
  masked: boolean,
  lastStatusReceivedAt: number | undefined,
  now: Date,
  freshnessMs: number,
): PlaybackDeviceStatusDTO | null => {
  if (state === undefined || lastStatusReceivedAt === undefined) {
    return null;
  }

  const stale = now.getTime() - lastStatusReceivedAt > freshnessMs;
  const trackBpm = toFiniteOrNull(state.trackBPM);

  const bpm = trackBpm !== null ? trackBpm * (1 + state.sliderPitch / 100) : null;
  const effectiveBpm =
    trackBpm !== null ? trackBpm * (1 + state.effectivePitch / 100) : null;

  return {
    beat: toFiniteOrNull(state.beat),
    beatInMeasure: state.beatInMeasure,
    beatsUntilCue: toFiniteOrNull(state.beatsUntilCue),
    bpm: toFiniteOrNull(bpm),
    effectiveBpm: toFiniteOrNull(effectiveBpm),
    effectivePitchPercent: state.effectivePitch,
    isEmergencyMode: state.isEmergencyMode,
    isMaster: state.isMaster,
    isOnAir: state.isOnAir,
    isSync: state.isSync,
    playState: CDJStatus.PlayState[state.playState] ?? 'unknown',
    sliderPitchPercent: state.sliderPitch,
    stale,
    statusLastReceivedAt: new Date(lastStatusReceivedAt).toISOString(),
    track: mapTrackSource(state, masked),
    trackBpm,
  };
};

const mapDevice = (
  deviceStore: DeviceStore,
  idMarker: string,
  now: Date,
  freshnessMs: number,
): PlaybackDeviceDTO => {
  const {device, state, track, lastStatusReceivedAt} = deviceStore;

  const masked = track !== undefined && isMasked(track, idMarker);

  return {
    id: device.id,
    name: device.name,
    status:
      state !== undefined
        ? mapDeviceStatus(state, masked, lastStatusReceivedAt, now, freshnessMs)
        : null,
    track: track !== undefined ? mapTrack(track, masked) : null,
    type: DeviceType[device.type] ?? 'unknown',
  };
};

const selectMaster = (
  devices: PlaybackDeviceDTO[],
  networkConnected: boolean,
): {
  master: PlaybackDeviceDTO | null;
  masterDeviceId: DeviceID | null;
  masterStatus: PlaybackMasterStatus;
} => {
  if (!networkConnected) {
    return {master: null, masterDeviceId: null, masterStatus: 'unavailable'};
  }

  const candidates = devices.filter(d => d.status?.isMaster === true);
  const fresh = candidates.filter(d => d.status?.stale === false);
  const stale = candidates.filter(d => d.status?.stale === true);

  if (fresh.length === 1) {
    const master = fresh[0];
    return {master, masterDeviceId: master.id, masterStatus: 'available'};
  }

  if (fresh.length > 1) {
    return {master: null, masterDeviceId: null, masterStatus: 'ambiguous'};
  }

  if (stale.length > 0) {
    return {master: null, masterDeviceId: null, masterStatus: 'stale'};
  }

  return {master: null, masterDeviceId: null, masterStatus: 'unavailable'};
};

const networkStateToString = (state: NetworkState): string =>
  NetworkState[state]?.toLowerCase() ?? 'unknown';

/**
 * Builds a synchronous, read-only projection of the current playback state,
 * intended to be serialized directly as the local playback status API
 * response. No network I/O is performed here; only already available store
 * data is used.
 */
export function getPlaybackSnapshot(
  store: PlaybackSnapshotInput,
  now: Date,
  freshnessMs: number = DEFAULT_FRESHNESS_MS,
): PlaybackSnapshot {
  const idMarker = store.config.idMarker;

  const devices = [...store.devices.values()]
    .sort((a, b) => a.device.id - b.device.id)
    .map(deviceStore => mapDevice(deviceStore, idMarker, now, freshnessMs));

  const networkConnected = store.networkState === NetworkState.Connected;
  const {master, masterDeviceId, masterStatus} = selectMaster(devices, networkConnected);

  const liveTracks = store.mixstatus.liveSet?.tracks ?? [];
  const current = liveTracks[liveTracks.length - 1];
  const previous = liveTracks[liveTracks.length - 2];

  return {
    current: mapHistoryEntry(current, idMarker),
    devices,
    generatedAt: now.toISOString(),
    master,
    masterDeviceId,
    masterStatus,
    networkState: networkStateToString(store.networkState),
    previous: mapHistoryEntry(previous, idMarker),
    schemaVersion: 1,
  };
}
