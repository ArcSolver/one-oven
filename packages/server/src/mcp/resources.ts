import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dish, dishes } from '../dishes.js';
import type { Service } from '../service.js';
export function registerResources(server: McpServer, service: Service): void {
  server.registerResource('dish', new ResourceTemplate('dish://{id}', {
    list: async () => ({ resources: dishes.map(d => ({ uri: `dish://${d.dish_id}`, name: d.name, mimeType: 'application/json' })) }),
  }), { description: 'Original timing fixtures and resource requirements.', mimeType: 'application/json' },
  async (uri, { id }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(dish(String(id))) }] }));
  server.registerResource('plan', new ResourceTemplate('plan://{id}', {
    list: async () => ({ resources: service.store.planIds().map(id => ({ uri: `plan://${id}`, name: id, mimeType: 'application/json' })) }),
  }), { description: 'Current persisted plan, version and explicit step states.', mimeType: 'application/json' },
  async (uri, { id }) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(service.store.plan(String(id))) }] }));
}
