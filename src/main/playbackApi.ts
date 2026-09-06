import type {IncomingMessage, ServerResponse} from 'node:http';

import type {PlaybackSnapshot} from 'src/shared/api/playback';

const ALLOWED_METHODS = 'GET, HEAD';

export const isLoopbackAddress = (address: string | undefined): boolean => {
  if (address === undefined) {
    return false;
  }

  // Normalize IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
  const normalized = address.replace(/^::ffff:/, '');

  return (
    normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('127.')
  );
};

const extractHostname = (value: string): string | null => {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const isLoopbackHostname = (hostname: string | null): boolean =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  (hostname !== null && /^127(\.\d+){3}$/.test(hostname));

const isAllowedHost = (hostHeader: string | undefined): boolean => {
  if (hostHeader === undefined) {
    return false;
  }

  return isLoopbackHostname(extractHostname(hostHeader));
};

const isAllowedOrigin = (originHeader: string | undefined): boolean => {
  // Non-browser clients (curl, Streamer.bot, vMix) don't send an Origin header.
  if (originHeader === undefined) {
    return true;
  }

  try {
    return isLoopbackHostname(new URL(originHeader).hostname.toLowerCase());
  } catch {
    return false;
  }
};

const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  method: string,
  extraHeaders?: Record<string, string>,
) => {
  const payload = JSON.stringify(body);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });

  res.end(method === 'HEAD' ? undefined : payload);
};

/**
 * Creates a Connect-compatible middleware serving the local, read-only
 * playback status API. Intended to be mounted at the `/api` path prefix.
 *
 * Restricted to loopback peers with an allowlisted Host/Origin, since this is
 * unauthenticated and intended for same-machine consumers only (e.g. a local
 * Streamer.bot instance), not remote/LAN access.
 */
export function createPlaybackApiMiddleware(getSnapshot: () => PlaybackSnapshot) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';

    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, {error: 'forbidden'}, method);
      return;
    }

    if (!isAllowedHost(req.headers.host) || !isAllowedOrigin(req.headers.origin)) {
      sendJson(res, 403, {error: 'forbidden'}, method);
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname !== '/v1/status') {
      sendJson(res, 404, {error: 'not_found'}, method);
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, {error: 'method_not_allowed'}, method, {Allow: ALLOWED_METHODS});
      return;
    }

    sendJson(res, 200, getSnapshot(), method);
  };
}
