import express from 'express';
import { pathToFileURL } from 'node:url';
import { openSession } from './runtime.js';
import type { ConversationSession } from './session.js';

export type GatewaySession = Pick<ConversationSession, 'turn' | 'close'>;
/** Local unauthenticated S2 gateway. Session ids select independent conversations. */
export function createGateway(factory: (id: string) => Promise<GatewaySession>) {
  const app = express();
  const sessions = new Map<string, Promise<GatewaySession>>();
  const busy = new Set<string>();
  app.use((request, response, next) => {
    const host = request.hostname;
    const origin = request.headers.origin;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || (origin && origin !== `http://${request.headers.host}`)) {
      response.status(403).json({ error: 'Local same-origin gateway only' }); return;
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.post('/session/:id/turn', async (request, response) => {
    const id = request.params.id;
    const utterance = request.body?.utterance;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof utterance !== 'string' || !utterance.trim() || utterance.length > 4000) {
      response.status(400).json({ error: 'Valid session id and utterance required' }); return;
    }
    if (busy.has(id)) { response.status(409).json({ error: 'Session turn already running' }); return; }
    if (!sessions.has(id) && sessions.size >= 32) { response.status(429).json({ error: 'Close an unused session first' }); return; }
    busy.add(id);
    const sse = request.headers.accept?.includes('text/event-stream');
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      if (!sessions.has(id)) {
        const created = factory(id).catch(error => { sessions.delete(id); throw error; });
        sessions.set(id, created);
      }
      const session = await sessions.get(id)!;
      if (sse) {
        response.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        response.flushHeaders();
        response.write(`event: start\ndata: ${JSON.stringify({ sessionId: id })}\n\n`);
        // Send only validated final speech, never unlinted model token deltas.
        heartbeat = setInterval(() => { if (!response.destroyed) response.write(': working\n\n'); }, 10000);
      }
      const result = await session.turn(utterance);
      if (!response.destroyed) {
        if (sse) { response.write(`event: turn\ndata: ${JSON.stringify(result)}\n\n`); response.end(); }
        else response.json(result);
      }
    } catch {
      if (!response.destroyed) {
        if (response.headersSent) { response.write('event: error\ndata: {"error":"Turn failed; inspect local trace"}\n\n'); response.end(); }
        else response.status(502).json({ error: 'Turn failed; inspect local trace' });
      }
    } finally { if (heartbeat) clearInterval(heartbeat); busy.delete(id); }
  });
  app.delete('/session/:id', async (request, response) => {
    const id = request.params.id;
    if (busy.has(id)) { response.status(409).json({ error: 'Session turn already running' }); return; }
    const session = sessions.get(id);
    sessions.delete(id);
    if (session) await (await session).close();
    response.status(204).end();
  });
  const close = async () => {
    const all = await Promise.allSettled([...sessions.values()]);
    await Promise.allSettled(all.flatMap(s => s.status === 'fulfilled' ? [s.value.close()] : []));
    sessions.clear();
  };
  return { app, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gateway = createGateway(async id => {
    const runtime = await openSession(process.env, `gateway-${id}-${Date.now()}`);
    return { turn: async utterance => { await runtime.serverClock?.sync(); return runtime.session.turn(utterance); }, close: () => runtime.session.close() };
  });
  const server = gateway.app.listen(Number(process.env.GATEWAY_PORT ?? 3001), '127.0.0.1', () => console.log('One Oven gateway on loopback'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close(() => { void gateway.close().then(() => process.exit(0)); });
  });
}
