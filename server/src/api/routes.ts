import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as store from '../db/eventStore.js';
import { getSession } from '../game/sessionManager.js';
import { isDemoRunning, startDemo, isRoguelikeDemoRunning, startRoguelikeDemo } from '../game/demoRunner.js';
import { listAgentSkills, getAgentSkill } from '../skills/agentSkills.js';

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function parseBoolQuery(value: string | undefined): boolean {
  if (!value) return false;
  const lowered = value.trim().toLowerCase();
  return lowered === '1' || lowered === 'true' || lowered === 'yes';
}

export function registerApiRoutes(app: FastifyInstance): void {
  // GET /api/session/current
  app.get('/api/session/current', async (_req: FastifyRequest, reply: FastifyReply) => {
    const session = getSession();
    if (!session) {
      // Check DB for any non-ended session
      const dbSession = store.getCurrentSession();
      if (dbSession) {
        return reply.send({
          sessionId: dbSession.id,
          state: dbSession.state,
          genre: dbSession.genre,
          title: dbSession.title,
          startedAt: dbSession.started_at,
        });
      }
      return reply.code(404).send({ error: 'no active session' });
    }

    return reply.send({
      sessionId: session.sessionId,
      state: session.state,
      genre: session.genre,
      title: session.title,
      startedAt: session.startedAt,
    });
  });

  // GET /api/archive
  app.get('/api/archive', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '100', 10), 100);
    const sessions = store.getArchiveSessions(limit);
    return reply.send(sessions.map(s => ({
      sessionId: s.id,
      genre: s.genre,
      title: s.title,
      state: s.state,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      createdAt: s.created_at,
    })));
  });

  // GET /api/session/:sessionId/events
  app.get('/api/session/:sessionId/events', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { sessionId: string };
    const query = req.query as { fromSeq?: string; limit?: string };
    const fromSeq = parseInt(query.fromSeq || '1', 10);
    const limit = Math.min(parseInt(query.limit || '500', 10), 10000);

    const events = store.getEvents(params.sessionId, fromSeq, limit);
    return reply.send(events);
  });

  // POST /api/session/demo — start demo game
  app.post('/api/session/demo', async (_req: FastifyRequest, reply: FastifyReply) => {
    const session = getSession();
    if (!session) {
      return reply.code(404).send({ error: 'no active session' });
    }
    if (session.state !== 'LOBBY') {
      return reply.code(409).send({ error: 'session is not in LOBBY state' });
    }
    if (isDemoRunning()) {
      return reply.code(409).send({ error: 'demo already running' });
    }

    // Fire and forget — demo runs asynchronously
    startDemo();
    return reply.send({ ok: true });
  });

  // POST /api/session/roguelike — start roguelike demo
  app.post('/api/session/roguelike', async (_req: FastifyRequest, reply: FastifyReply) => {
    const session = getSession();
    if (!session) {
      return reply.code(404).send({ error: 'no active session' });
    }
    if (session.state !== 'LOBBY') {
      return reply.code(409).send({ error: 'session is not in LOBBY state' });
    }
    if (isDemoRunning() || isRoguelikeDemoRunning()) {
      return reply.code(409).send({ error: 'demo already running' });
    }

    startRoguelikeDemo();
    return reply.send({ ok: true });
  });

  // GET /v1/skills
  app.get('/v1/skills', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      target?: string | string[];
      include_content?: string | string[];
      includeContent?: string | string[];
    };

    const target = firstQueryValue(query.target);
    const includeContent = parseBoolQuery(
      firstQueryValue(query.include_content) ?? firstQueryValue(query.includeContent)
    );

    const skills = listAgentSkills({ target, includeContent });
    return reply.send({
      format: 'skill-md/v1',
      total: skills.length,
      skills,
    });
  });

  // GET /v1/skills/:skillId
  app.get('/v1/skills/:skillId', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { skillId: string };
    const query = req.query as {
      target?: string | string[];
      include_content?: string | string[];
      includeContent?: string | string[];
    };

    const hasIncludeFlag = query.include_content !== undefined || query.includeContent !== undefined;
    const includeContent = hasIncludeFlag
      ? parseBoolQuery(firstQueryValue(query.include_content) ?? firstQueryValue(query.includeContent))
      : true;

    const target = firstQueryValue(query.target);
    const skill = getAgentSkill(params.skillId, { target, includeContent });
    if (!skill) {
      return reply.code(404).send({ error: `skill not found: ${params.skillId}` });
    }

    return reply.send(skill);
  });

  // Health check
  app.get('/api/health', async (_req, reply) => {
    return reply.send({ ok: true, time: Date.now() });
  });
}
