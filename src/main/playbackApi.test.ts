import connect from 'connect';

import assert from 'node:assert/strict';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {test} from 'node:test';

import type {PlaybackSnapshot} from 'src/shared/api/playback';

import {createPlaybackApiMiddleware, isLoopbackAddress} from './playbackApi';

const makeSnapshot = (): PlaybackSnapshot => ({
  current: null,
  devices: [],
  generatedAt: new Date().toISOString(),
  master: null,
  masterDeviceId: null,
  masterStatus: 'unavailable',
  networkState: 'connected',
  previous: null,
  schemaVersion: 1,
});

/**
 * Starts an ephemeral loopback-only HTTP server mounting the playback API
 * middleware at `/api`, mirroring how it's mounted in overlayServer.ts.
 */
const withServer = async (
  getSnapshot: () => PlaybackSnapshot,
  fn: (baseUrl: string) => Promise<void>,
) => {
  const app = connect();
  app.use('/api', createPlaybackApiMiddleware(getSnapshot));

  const server = http.createServer(app);

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const {port} = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
};

test('GET /api/v1/status returns the snapshot as JSON with no-store', async () => {
  await withServer(makeSnapshot, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/v1/status`);
    const {generatedAt, ...body} = await res.json();
    const expected: Partial<PlaybackSnapshot> = makeSnapshot();
    delete expected.generatedAt;

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(typeof generatedAt, 'string');
    assert.deepEqual(body, expected);
  });
});

test('HEAD /api/v1/status returns headers with no body', async () => {
  await withServer(makeSnapshot, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/v1/status`, {method: 'HEAD'});
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.equal(body, '');
  });
});

test('unknown /api/* path returns 404 JSON', async () => {
  await withServer(makeSnapshot, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/v1/nope`);

    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'not_found');
  });
});

test('unsupported method returns 405 with Allow header', async () => {
  await withServer(makeSnapshot, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/v1/status`, {method: 'POST'});

    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
  });
});

test('malformed request path does not crash the server', async () => {
  await withServer(makeSnapshot, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/%`);

    assert.equal(res.status, 404);
  });
});

test('requests are rejected without an Allow-listed Host header', async () => {
  // `fetch` forbids overriding the Host header directly, so use a raw
  // http.request to simulate a spoofed Host.
  await withServer(makeSnapshot, async baseUrl => {
    const {port} = new URL(baseUrl);

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = http.request(
        {
          headers: {host: `evil.example.com:${port}`},
          host: '127.0.0.1',
          path: '/api/v1/status',
          port,
        },
        res => resolve(res.statusCode),
      );
      req.on('error', reject);
      req.end();
    });

    assert.equal(status, 403);
  });
});

test('requests are rejected with a non-local Origin header', async () => {
  await withServer(makeSnapshot, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/v1/status`, {
      headers: {origin: 'https://evil.example.com'},
    });

    assert.equal(res.status, 403);
  });
});

test('requests are accepted with a localhost Origin header', async () => {
  await withServer(makeSnapshot, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/v1/status`, {
      headers: {origin: 'http://localhost:1234'},
    });

    assert.equal(res.status, 200);
  });
});

test('forwarded-for headers do not bypass the loopback restriction', async () => {
  await withServer(makeSnapshot, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/v1/status`, {
      headers: {'x-forwarded-for': '8.8.8.8'},
    });

    // The request still originates from a loopback socket, so this should
    // succeed -- forwarded headers must never be trusted for this check.
    assert.equal(res.status, 200);
  });
});

test('serves the current snapshot at request time, not startup time', async () => {
  let snapshot = makeSnapshot();

  await withServer(
    () => snapshot,
    async baseUrl => {
      const first = await (await fetch(`${baseUrl}/api/v1/status`)).json();
      assert.equal(first.masterStatus, 'unavailable');

      snapshot = {...snapshot, masterStatus: 'ambiguous'};

      const second = await (await fetch(`${baseUrl}/api/v1/status`)).json();
      assert.equal(second.masterStatus, 'ambiguous');
    },
  );
});

test('isLoopbackAddress accepts loopback and IPv4-mapped loopback addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.0.0.5'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
});

test('isLoopbackAddress rejects LAN and undefined addresses', () => {
  assert.equal(isLoopbackAddress('192.168.1.5'), false);
  assert.equal(isLoopbackAddress('10.0.0.2'), false);
  assert.equal(isLoopbackAddress(void 0), false);
});

/**
 * Exercises the middleware directly against a fake request/response, since a
 * real LAN peer can't be simulated from a loopback-only test environment.
 */
const invokeMiddlewareWithRemoteAddress = async (remoteAddress: string) => {
  const middleware = createPlaybackApiMiddleware(makeSnapshot);

  let statusCode = 0;

  const req = {
    headers: {host: 'localhost'},
    method: 'GET',
    socket: {remoteAddress},
    url: '/v1/status',
  } as any;

  const res = {
    end: () => {},
    setHeader: () => {},
    writeHead: (status: number) => {
      statusCode = status;
    },
  } as any;

  await middleware(req, res);

  return statusCode;
};

test('a simulated LAN peer is rejected by the middleware', async () => {
  assert.equal(await invokeMiddlewareWithRemoteAddress('192.168.1.50'), 403);
});

test('a simulated loopback peer is accepted by the middleware', async () => {
  assert.equal(await invokeMiddlewareWithRemoteAddress('127.0.0.1'), 200);
});
