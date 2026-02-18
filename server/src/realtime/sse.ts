import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { addViewer, removeViewer } from './viewerRegistry.js';
import { getEvents, getBootstrapEvents, getLastSeq } from '../db/eventStore.js';
import { getSession, createNewSession } from '../game/sessionManager.js';
import { onGameEvent } from '../shared/eventBus.js';
import type { GameEvent } from '../shared/types.js';

const sseClients = new Set<{ reply: FastifyReply; sessionId: string }>();
const SSE_CATCHUP_LIMIT = Number.parseInt(process.env.SSE_CATCHUP_LIMIT || '500', 10);
const SSE_BOOTSTRAP_TAIL = Number.parseInt(process.env.SSE_BOOTSTRAP_TAIL || '120', 10);

function toPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

// Subscribe to game events and broadcast to SSE clients
onGameEvent((ev: GameEvent) => {
  const data = JSON.stringify(ev);
  for (const client of sseClients) {
    if (client.sessionId === ev.sessionId) {
      try {
        client.reply.raw.write(`id: ${ev.seq}\ndata: ${data}\n\n`);
      } catch {
        sseClients.delete(client);
      }
    }
  }
});

export function registerSseRoutes(app: FastifyInstance): void {
  app.get('/api/session/current/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { fromSeq?: string };
    const parsedFromSeq = parseInt(query.fromSeq || '1', 10);
    const fromSeq = Number.isFinite(parsedFromSeq) && parsedFromSeq > 0 ? parsedFromSeq : 1;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    reply.raw.write(':ok\n\n');

    // Track viewer
    addViewer(reply);

    // Check if we need to create a session
    let session = getSession();
    if (!session) {
      session = createNewSession();
    }

    const sessionId = session.sessionId;

    // Catch-up: send events from DB
    if (fromSeq >= 1) {
      const maxSeq = getLastSeq(sessionId);
      const pending = Math.max(0, maxSeq - fromSeq + 1);
      const catchupLimit = toPositiveInt(SSE_CATCHUP_LIMIT, 500);
      const bootstrapTail = toPositiveInt(SSE_BOOTSTRAP_TAIL, 120);

      let events: GameEvent[];
      if (pending > catchupLimit) {
        events = getBootstrapEvents(sessionId, bootstrapTail);
        console.log(
          `[SSE] catch-up compressed session=${sessionId} fromSeq=${fromSeq} pending=${pending} sent=${events.length}`
        );
      } else {
        events = getEvents(sessionId, fromSeq);
      }

      for (const ev of events) {
        const data = JSON.stringify(ev);
        reply.raw.write(`id: ${ev.seq}\ndata: ${data}\n\n`);
      }
    }

    // Register for live events
    const client = { reply, sessionId };
    sseClients.add(client);

    // Heartbeat
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(':heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    // Cleanup on close
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(client);
      removeViewer(reply);
    });

    // Don't close the reply — SSE keeps it open
    await new Promise(() => {});
  });
}
