import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@duality/shared';
import { DualityRoom } from './rooms/DualityRoom.js';
import { log } from './log.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 2567);
// The built web client lives next to the server bundle in production.
const candidates = [
  process.env.STATIC_DIR,
  path.resolve(here, '../../web/dist'),
  path.resolve(here, '../web/dist'),
].filter(Boolean) as string[];
const staticDir = candidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
const startedAt = Date.now();

/** One process serves the static client, the matchmaking API and the game WebSockets. */
export function createGameServer(): Server {
  const server = new Server({
    greet: false,
    transport: new WebSocketTransport({ pingInterval: 4000, pingMaxRetries: 3 }),
    express: (app) => {
      app.get('/health', async (_req, res) => {
        const rooms = await matchMaker.query({});
        res.json({ ok: true, uptimeS: Math.round((Date.now() - startedAt) / 1000), rooms: rooms.length });
      });
      if (staticDir) {
        app.use('/assets', express.static(path.join(staticDir, 'assets'), { immutable: true, maxAge: '365d' }));
        app.use(express.static(staticDir, { maxAge: 0 }));
        log('info', 'static_serving', { dir: staticDir });
      }
    },
  });
  server.define(ROOM_NAME, DualityRoom);
  return server;
}

if (process.env.DUALITY_NO_LISTEN !== '1') {
  createGameServer().listen(port).then(() => {
    log('info', 'server_listening', { port, static: !!staticDir });
  });
}

process.on('unhandledRejection', (err) => log('error', 'unhandled_rejection', { err: String(err) }));
