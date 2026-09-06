import connect from 'connect';
import httpProxy from 'http-proxy';
import httpStatic from 'node-static';

import fs from 'node:fs';
import http from 'node:http';
import * as path from 'node:path';

import type {PlaybackSnapshot} from 'src/shared/api/playback';
import {WEBSERVER_PORT} from 'src/shared/constants';

import {isDev} from './main';
import {createPlaybackApiMiddleware} from './playbackApi';

const OVERLAY_ROOT = path.resolve(__dirname, 'overlay');

export async function startOverlayServer(getPlaybackSnapshot: () => PlaybackSnapshot) {
  const app = connect();
  const httpServer = http.createServer(app);

  const proxy = httpProxy.createProxy();
  const fileServer = new httpStatic.Server(OVERLAY_ROOT);

  // Must precede the dev proxy / production SPA fallback below so `/api/*`
  // requests are never forwarded there.
  app.use('/api', createPlaybackApiMiddleware(getPlaybackSnapshot));

  const handler: http.RequestListener = isDev
    ? (req, resp) => proxy.web(req, resp, {target: `http://127.0.0.1:2005/`, ws: true})
    : async (req, resp) => {
        const requestUrl = req.url?.replace(/^\//, '');

        const accessErr = await new Promise<NodeJS.ErrnoException | null>(resolve =>
          fs.stat(path.resolve(OVERLAY_ROOT, requestUrl ?? ''), resolve),
        );

        if (requestUrl !== undefined && accessErr !== null) {
          fileServer.serveFile('index.html', 200, {}, req, resp);
        } else {
          fileServer.serve(req, resp);
        }
      };

  app.use(handler);

  // Start listening for connections
  await new Promise<void>(resolve =>
    httpServer.listen(WEBSERVER_PORT, '0.0.0.0', resolve),
  );

  return httpServer;
}
