// Mimic plugs into the existing games server: the same HTTP server serves its built React app at /mimic/
// and its Socket.IO connection at /mimic/socket.io. Nothing here needs a database.

import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { Server } from 'socket.io';
import { MAX_RECORDING_BYTES, SOCKET_PATH } from '../shared/constants';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../shared/types';
import { log } from './log';
import { loadLibrary } from './sounds';
import { type HandlerOptions, type MimicServer, registerMimicHandlers } from './socket-handlers';

export interface MimicOptions extends HandlerOptions {
  /** Folder with the built client (index.html + assets). */
  clientDir?: string;
  /** Extra origins allowed to open the socket, e.g. "https://mygames.onrender.com". Same-origin always works. */
  allowedOrigins?: string[];
  /** Built sound library (library.json + refs/). Defaults to dist/mimic/library. */
  libraryDir?: string;
  /** Trust X-Forwarded-For for the client IP (on Render this is the real visitor). */
  trustProxy?: boolean;
}

export interface MimicHandle {
  /** Returns true if this request belongs to Mimic and was handled. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
  io: MimicServer;
  manager: ReturnType<typeof registerMimicHandlers>['manager'];
  close(): Promise<void>;
}

const isDev = process.env.NODE_ENV !== 'production';

function originAllowed(origin: string | undefined, host: string | undefined, allowed: string[]): boolean {
  if (!origin) return true; // same-origin polling requests and non-browser clients send no Origin
  if (allowed.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (host && u.host === host) return true;
    if (isDev && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  } catch {
    return false;
  }
  return false;
}

export function attachMimic(httpServer: HttpServer, options: MimicOptions = {}): MimicHandle {
  const lib = loadLibrary(options.libraryDir); // throws with a clear message if the library is broken
  const clientDir = options.clientDir ?? path.join(__dirname, '..', 'client');
  const allowed = options.allowedOrigins ?? (process.env.MIMIC_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const trustProxy = options.trustProxy ?? (process.env.TRUST_PROXY === '1' || !!process.env.RENDER);

  const io: MimicServer = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: MAX_RECORDING_BYTES + 16 * 1024, // one recorded take plus framing
    pingInterval: 20_000,
    pingTimeout: 20_000,
    destroyUpgrade: false, // the other games' WebSocket shares this HTTP server
    cors: allowed.length ? { origin: allowed } : undefined,
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, req.headers.host, allowed)),
  });
  io.use((socket, next) => {
    const fwd = socket.handshake.headers['x-forwarded-for'];
    const first = typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : undefined;
    socket.data.ip = (trustProxy && first) || socket.handshake.address;
    next();
  });
  const handlers = registerMimicHandlers(io, lib, options);

  const app = express();
  app.disable('x-powered-by');
  app.set('strict routing', true); // so GET /mimic (redirect) and /mimic/ (the app) are different routes
  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()), mimicRooms: handlers.manager.rooms.size });
  });
  app.get('/mimic', (req, res) => {
    const q = req.originalUrl.indexOf('?');
    res.redirect(302, '/mimic/' + (q >= 0 ? req.originalUrl.slice(q) : ''));
  });
  app.use('/mimic', (req, res, next) => {
    const host = req.headers.host ?? '';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        `connect-src 'self' ws://${host} wss://${host}`,
        "img-src 'self' data:",
        "media-src 'self' blob:",
        "frame-ancestors 'self'",
      ].join('; '),
    );
    next();
  });

  const indexFile = path.join(clientDir, 'index.html');
  app.use(
    '/mimic',
    express.static(clientDir, {
      index: false,
      setHeaders: (res, file) => {
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  // SPA fallback: any other page under /mimic/ gets the app, but missing files (anything with an extension) stay 404.
  app.use('/mimic', (req, res) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path.extname(req.path)) {
      res.status(404).type('text').send('Not found');
      return;
    }
    if (!fs.existsSync(indexFile)) {
      res.status(503).type('html').send('<h1>Mimic is not built yet</h1><p>Run <code>npm run build</code>, then restart the server.</p>');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  if (!fs.existsSync(indexFile)) log('client_missing', { dir: clientDir });
  log('ready', { clips: lib.clips.length, categories: lib.categories.length });

  return {
    io,
    manager: handlers.manager,
    handle(req, res) {
      const url = req.url ?? '/';
      if (url === '/health' || url.startsWith('/health?') || url === '/mimic' || url.startsWith('/mimic/') || url.startsWith('/mimic?')) {
        app(req as express.Request, res as express.Response);
        return true;
      }
      return false;
    },
    close: () =>
      new Promise<void>(resolve => {
        handlers.stop();
        io.disconnectSockets(true);
        // io.close() would also close the shared HTTP server; the caller owns that.
        io.engine.close();
        resolve();
      }),
  };
}
