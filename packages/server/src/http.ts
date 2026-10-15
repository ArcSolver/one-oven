import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Service } from './service.js';
import { mcp } from './mcp/server.js';

export function app(service: Service) {
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  app.use('/mcp', (request, response, next) => {
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`) {
      response.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  });
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
