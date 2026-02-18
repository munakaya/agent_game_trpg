import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { initDb } from './db/schema.js';
import { seedDummyEvents } from './db/eventStore.js';
import { registerApiRoutes } from './api/routes.js';
import { registerSseRoutes } from './realtime/sse.js';
import { initWsGateway } from './agents/wsGateway.js';
import type { GameEvent } from './shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '49731', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  // Init DB
  const db = initDb();
  console.log('[DB] SQLite initialized');

  // Seed dummy events from specs
  const dummyPath = path.join(__dirname, '..', '..', 'specs', 'dummy_events.json');
  if (fs.existsSync(dummyPath)) {
    const raw = fs.readFileSync(dummyPath, 'utf-8');
    const events: GameEvent[] = JSON.parse(raw);
    seedDummyEvents(events);
    console.log('[DB] Dummy events seeded');
  }

  // Fastify
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  // Serve web build (if exists)
  const webDistPath = path.join(__dirname, '..', '..', 'web', 'dist');
  if (fs.existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // API routes
  registerApiRoutes(app);

  // SSE routes
  registerSseRoutes(app);

  // Start HTTP server
  await app.listen({ port: PORT, host: HOST });
  console.log(`[Server] Listening on http://${HOST}:${PORT}`);

  // WS gateway (use the underlying Node http server)
  const httpServer = app.server;
  initWsGateway(httpServer);
  console.log('[WS] Agent gateway ready on /ws/agents');

  // Log setup
  const logDir = path.join(__dirname, '..', '..', 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${formatDate()}.txt`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: any[]) => {
    const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
    logStream.write(line + '\n');
    origLog(...args);
  };
  console.error = (...args: any[]) => {
    const line = `[${new Date().toISOString()}] ERROR ${args.join(' ')}`;
    logStream.write(line + '\n');
    origErr(...args);
  };

  console.log('[Server] Ready');
}

function formatDate(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad3(d.getMilliseconds())}`;
}

function pad(n: number): string { return n.toString().padStart(2, '0'); }
function pad3(n: number): string { return n.toString().padStart(3, '0'); }

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
