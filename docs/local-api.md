# Local Playback API

Prolink Tools exposes a small, read-only, local-only HTTP endpoint that
reports the current playback state: what's playing now/previously, the state
of each connected device, and which device (if any) is the current DJM
"master". It's intended for local tools and apps running on the same machine,
such as [Streamer.bot](https://streamer.bot/) or [MixItUp](https://mixitup.bot/)
as examples.

This is **not** a remote/LAN API, it can only be reached from the same
machine that Prolink Tools is running on.

## Requirements & limitations

- Prolink Tools must be running, and the Pro DJ Link network must have
  finished starting up. Requests made before startup completes (or when the app
  is not running) will fail to connect.
- Only reachable from `localhost`/loopback on the same machine. There is no
  authentication and no LAN/remote access which is intentional, see
  [Security](#security) below.
- No historical/paginated data, artwork, waveform, or precise playhead
  position is exposed, only the current + previous track and per-device status.

## Endpoint

```
GET http://127.0.0.1:5152/api/v1/status
```

### Testing without DJ hardware

You can run a static local fixture for testing Streamer.bot, MixItUp, or other
integrations before connecting real DJ hardware:

```sh
pnpm mock-local-api
```

This serves a sample current track, previous track, and available master at the
same `http://127.0.0.1:5152/api/v1/status` URL. Leave it running while testing
the integration, and stop it with `Ctrl+C`. Do not run it at the same time as
Prolink Tools, since both use port `5152`.

- Response is `application/json; charset=utf-8` with `Cache-Control: no-store`
  (always fetch fresh; there is no caching).
- `HEAD` is also supported (same headers, no body).
- Unknown `/api/*` paths return `404` with a JSON `{"error": "not_found"}` body.
- Unsupported methods on `/api/v1/status` return `405` with an `Allow: GET, HEAD`
  header.

### Response shape

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2024-01-01T00:00:00.000Z", // snapshot time, not a freshness guarantee
  "networkState": "connected", // "offline" | "online" | "connected" | "failed"

  // The most recently played, and second-most-recently played track in the
  // current live set (same selection logic as the "Now Playing" overlay).
  // Both are `null` if unavailable (e.g. nothing has played yet, or the set
  // just ended).
  "current": {
    "playedAt": "2024-01-01T00:00:00.000Z",
    "track": {
      /* Track DTO */
    },
  },
  "previous": null,

  // Every connected device, sorted ascending by device ID.
  "devices": [
    {
      "id": 1,
      "name": "CDJ-3000",
      "type": "CDJ", // "CDJ" | "Mixer" | "Rekordbox" | "unknown"
      // `null` until a status packet has ever been received from this device.
      "status": {
        "statusLastReceivedAt": "2024-01-01T00:00:00.000Z",
        "stale": false, // no packet received in the last 5s
        "playState": "Playing",
        "isMaster": true,
        "isSync": false,
        "isOnAir": true,
        "isEmergencyMode": false,
        "trackBpm": 128.0, // raw BPM of the loaded track, null if unknown
        "sliderPitchPercent": 0,
        "effectivePitchPercent": 0,
        "bpm": 128.0, // trackBpm adjusted by the slider pitch
        "effectiveBpm": 128.0, // trackBpm adjusted by the effective (jog/platter) pitch
        "beat": 42,
        "beatInMeasure": 1,
        "beatsUntilCue": null,
        // Numeric identifiers for the loaded track's source. `null` if no
        // track is loaded, or the loaded track is masked (see below).
        "track": {"trackId": 123, "sourceDeviceId": 1, "slot": "USB", "type": "RB"},
      },
      // Full metadata for the currently loaded track. `null` while
      // unavailable (e.g. metadata hasn't finished loading yet).
      "track": {
        /* Track DTO */
      },
    },
  ],

  // The current DJM "master" device, if exactly one is currently reporting
  // itself as master. See "Master selection" below.
  "masterDeviceId": 1,
  "master": {
    /* device entry, same shape as an entry in `devices` */
  },
  "masterStatus": "available", // "available" | "ambiguous" | "stale" | "unavailable"
}
```

### Track DTO

```jsonc
{
  "title": "Track Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "genre": "Genre",
  "key": "Am",
  "label": "Label Name",
  "comment": "...",
  "mixName": "Extended Mix",
  "tempo": 128.0, // BPM, null if unknown
  "duration": 320, // seconds, null if unknown
  "bitrate": 320, // kbps, null if unknown
  "year": 2024, // null if unknown
  "masked": false,
}
```

Any field with no available value is `null` (never omitted).

### Masking "ID" tracks

If a track's metadata matches your configured "Mark tracks as IDs" string
(the `idMarker` setting, `[ID]` by default), it is reported with
`masked: true` and every field other than `title`/`artist` (both set to `"ID"`)
is `null`. This applies consistently to `current`, `previous`, and each device's
`track`. When a device's loaded track is masked, that device's
`status.track` source identifiers are also nulled out, so the underlying
file can't be correlated back to the "hidden" track.

### Master selection

`masterStatus` explains why `master`/`masterDeviceId` are (or aren't) set:

- `available` - exactly one device is reporting itself as the DJM master and
  its status is fresh (received within the last 5 seconds).
- `ambiguous` - more than one device is currently reporting itself as
  master (a brief transition state).
- `stale` - a device was last known to be master, but hasn't sent a status
  packet recently enough to be trusted.
- `unavailable` - no device is currently known to be master, or the Pro DJ
  Link network isn't connected.

A paused master is still reported as `available`, check `master.status.playState`
for playback state separately. `master.status.bpm`/`effectiveBpm` may be `null`
if the master has no track loaded, but this doesn't affect master selection.

## Streamer.bot integration

The easiest way to wire up `!trackid`, `!lasttrack`, and `!bpm` is a single
Streamer.bot action with all three commands as triggers, sharing one
"Execute C# Code" sub-action that polls the endpoint once per invocation and
posts the right formatted message.

### Setup

#### StreamerBot Import code

An example to get you started already exists in
[../examples/StreamerBot](../examples/StreamerBot/Prolink%20Tools%20API%20Integration.txt).

#### Manual setup

1. In Streamer.bot, create a new **Action** (e.g. "Prolink Tools - Now Playing").
2. Add three **Core > Commands** triggers to it: `!trackid`, `!lasttrack`, `!bpm`. ⚠️ Do not use a general **Twitch > Chat > Chat Message** trigger for this action, it will invoke the C# code for every chat message which is simply not needed. ⚠️
3. Add a single **Execute C# Code** sub-action and paste in the
  [example script](/examples/StreamerBot/prolink%20tools%20action%20script.cs).
1. Click the **Find References** and then **Compile**.
   1. StreamerBot often misses the DLL for the `System` library, so the compile may fail here. If so, you may have to manually add that reference.
      1. Click the **References** tab.
      2. There should already be a bunch of references there like `C:\windows\Microsoft.NET\Framework64\v4.0.30319\mscorlib.dll`, take note of this path.
      3. Right click the empty space below the last export and select **Add reference from file...**.
      4. Follow the same path that the `mscorlib.dll`.
      5. Within that same folder, there should also be a `System.dll`, add that file.
      6. Click on **Compile** again and it should be successful this time.
2. Click **Save**.

### Notes

- This uses `CPH.SendMessage`, which posts to Twitch chat. If you're on Kick
  or YouTube, swap in `CPH.SendKickMessage`/`CPH.SendYouTubeMessage` instead.
- The HTTP call has a 2s timeout and is wrapped in a try/catch so the command
  fails gracefully (rather than hanging or dumping an exception to chat) if
  Prolink Tools isn't running yet.
- A general **Chat Message** trigger can repeatedly invoke the action, since the
  bot will see it's own message and then re-trigger the action again in a loop.
  This has been specifically designed to use the built-in command
- BPM is truncated (not rounded) to drop the decimal portion.

## MixItUp integration

The easiest MixItUp setup is one chat command per public trigger, each with a
**Web Request** action followed by a **Chat** action. MixItUp's Web Request
action waits for the HTTP response and can map JSON values into Special
Identifiers, so no C# script is needed for the basic `!trackid`, `!lasttrack`,
and `!bpm` commands.

### Setup

#### MixItUp Command Imports

There are already some pre-created commands to get you started within the [../examples/MixItUp](../examples/MixItUp)
dir. There are 3 example commands already created:

- [bpm comand](../examples/MixItUp/Prolink%20Tools%20-%20bpm.miucommand)
- [trackId command](../examples/MixItUp/Prolink%20Tools%20-%20TrackId.miucommand)
- [lastTrack command](../examples/MixItUp/Prolink%20Tools%20-%20LastTrack.miucommand)

#### Manual setup

Create three **Chat Commands** in MixItUp:

- `!trackid`
- `!lasttrack`
- `!bpm`

For each command, add a **Web Request** action with these shared settings:

- **Method:** `GET`
- **URL:** `http://127.0.0.1:5152/api/v1/status`
- **Response parse type:** JSON to Special Identifiers

Then add the command-specific JSON mappings below.

#### `!trackid`

| JSON value | Special Identifier |
| --- | --- |
| `current/track/artist` | `$prolinkartist` |
| `current/track/title` | `$prolinktitle` |

Add a **Chat** action after the Web Request action:

```text
$prolinkartist - $prolinktitle
```

#### `!lasttrack`

| JSON value | Special Identifier |
| --- | --- |
| `previous/track/artist` | `$prolinkartist` |
| `previous/track/title` | `$prolinktitle` |

Add a **Chat** action after the Web Request action:

```text
$prolinkartist - $prolinktitle
```

#### `!bpm`

| JSON value | Special Identifier |
| --- | --- |
| `master/status/bpm` | `$prolinkbpm` |

Add a **Chat** action after the Web Request action:

```text
$prolinkbpm BPM
```

### Notes

- MixItUp's JSON mappings use `/` or `\` between nested values.
- Numeric path segments can index arrays, but these commands only need object paths.
- If Prolink Tools is not running, or if a mapped JSON value is unavailable,
  the later Chat action may send an empty or unresolved Special Identifier. Add
  MixItUp Conditional actions if you want friendly fallbacks such as `No track
  played yet`, `No previous track`, or `BPM unavailable`.
- BPM is reported exactly as the API returns it. If you want to truncate the
  decimal portion like the Streamer.bot snippet above, add a Special Identifier
  math/formatting step or use a Script action before the Chat action.

## Security

This endpoint is intentionally restricted to same-machine use:

- Requests are only accepted from a loopback peer (`127.0.0.1`, `::1`, or an
  IPv4-mapped loopback address). LAN/remote requests are rejected with `403`.
- The `Host` header must be an allowlisted localhost/loopback value (this
  guards against DNS rebinding attacks).
- A non-local `Origin` header (i.e. a browser page on another origin trying
  to fetch this from your machine) is rejected with `403`. Requests without
  an `Origin` header (e.g. from Streamer.bot, curl, vMix) are allowed.
- Proxy/forwarding headers (e.g. `X-Forwarded-For`) are never trusted for any
  of the above checks.
- There is no authentication token. If you need LAN or remote access, that
  is an intentionally separate, future enhancement.
