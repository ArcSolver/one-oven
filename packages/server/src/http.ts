import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { SimClock } from './clock.js';
import { z } from 'zod';
import type { Service } from './service.js';
import { mcp } from './mcp/server.js';

export function app(service: Service, options: { devClock?: SimClock } = {}) {
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.use('/mcp', (request, response, next) => {
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`) {
      response.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  });
  if (options.devClock) {
    const clock = options.devClock;
    app.use('/dev/clock', (request, response, next) => {
      const remote = request.socket.remoteAddress;
      const origin = request.headers.origin;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '') ||
          (origin && origin !== `http://${request.headers.host}`)) {
        response.status(403).json({ error: 'Local development only' });
        return;
      }
      next();
    });
    const state = () => ({ kind: 'sim', nowIso: new Date(clock.now()).toISOString() });
    app.get('/dev/clock', (_request, response) => { response.json(state()); });
    app.post('/dev/clock', (request, response) => {
      const parsed = z.object({ minutes: z.number().finite().min(0).max(1440) }).strict().safeParse(request.body);
      if (!parsed.success) { response.status(400).json({ error: 'Supply minutes from 0 to 1440' }); return; }
      clock.advance(parsed.data.minutes);
      response.json(state());
    });
  }
  app.post('/mcp', async (request, response) => {
    const server = mcp(service);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', id: null,
        error: { code: -32603, message: 'Internal server error' } });
    }
  });
  app.get('/mcp', (_request, response) => { response.status(405).set('Allow', 'POST').end(); });
  app.delete('/mcp', (_request, response) => { response.status(405).set('Allow', 'POST').end(); });
  return app;
}
