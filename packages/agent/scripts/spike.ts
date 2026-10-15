import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Agent, BedrockModel, McpClient, Model } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { AnthropicModel } from '@strands-agents/sdk/models/anthropic';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../../server/src/store.js';
import { Service } from '../../server/src/service.js';
import { app } from '../../server/src/http.js';

const store = new Store(':memory:');
const server = app(new Service(store)).listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (typeof init?.body === 'string' && JSON.parse(init.body).method === 'initialize') {
      const body = await response.clone().json();
      assert.equal(body.result.protocolVersion, '2025-11-25');
      console.log('initialize:', body.result.protocolVersion);
    }
    return response;
  },
});
const mcp = new McpClient({ transport });
try {
  const listed = await mcp.listTools();
  assert.equal(listed.length, 6);
  console.log('tools/list:', listed.map(tool => tool.name).join(', '));
  assert.ok([Agent, BedrockModel, OpenAIModel, AnthropicModel, Model].every(value => typeof value === 'function'));
  console.log('Public exports: Agent, BedrockModel, OpenAIModel, AnthropicModel, abstract Model');
  const kitchen = listed.find(tool => tool.name === 'set_kitchen')!;
  const args = { ovens: 1, burners: 4, helpers: 1, timezone: 'America/Chicago' };
  const raw = await mcp.callTool(kitchen, args) as Record<string, unknown>;
  assert.ok(raw.structuredContent);
  const stream = kitchen.stream({
    toolUse: { name: kitchen.name, toolUseId: 'spike', input: args },
    agent: new Agent({ model: new BedrockModel({ modelId: 'constructor-only', region: 'us-east-1' }), printer: false }),
    invocationState: {}, cancelSignal: new AbortController().signal,
    interrupt: () => { throw new Error('Unexpected interrupt'); },
  });
  const converted = (await stream.next()).value;
  console.log('Raw structuredContent present:', !!raw.structuredContent);
  console.log('McpTool converted result:', JSON.stringify(converted));
  console.log('Decision: A — native TypeScript providers and Streamable HTTP work. No cloud/model requests.');
} finally {
  await mcp.disconnect();
  await new Promise<void>(resolve => server.close(() => resolve()));
  store.close();
}
