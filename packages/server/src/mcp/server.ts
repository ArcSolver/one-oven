import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Service } from '../service.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
export function mcp(service: Service): McpServer {
  const server = new McpServer({ name: 'one-oven', version: '0.2.0' });
  registerTools(server, service);
  registerResources(server, service);
  return server;
}
