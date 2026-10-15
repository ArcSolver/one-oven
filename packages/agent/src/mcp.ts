import { McpClient, type JSONValue, type ToolSpec } from '@strands-agents/sdk';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { TraceSink } from './trace.js';

export type ToolCallTrace = {
  name: string; args: JSONValue; result?: Record<string, unknown>; ms: number; error?: string;
};
type Schema = NonNullable<ToolSpec['inputSchema']>;
const objectSchema = (value: unknown): Schema => value && typeof value === 'object' && !Array.isArray(value) ? value as Schema : {};
// Compatible endpoints may enforce all listed properties. Nullable optional fields
// let the model explicitly abstain; strip null only where the MCP contract allows omission.
export function nullableOptionals(schema: Schema): Schema {
  const result = structuredClone(schema);
  if (result.properties) for (const [key, child] of Object.entries(result.properties)) {
    const converted = nullableOptionals(objectSchema(child));
    result.properties[key] = result.required?.includes(key) ? converted : { anyOf: [converted, { type: 'null' }] };
  }
  if (result.items) result.items = nullableOptionals(objectSchema(result.items));
  return result;
}
export function omitOptionalNulls(value: JSONValue, schema: Schema): JSONValue {
  if (Array.isArray(value)) return value.map(v => omitOptionalNulls(v, objectSchema(schema.items)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, v]) => !(v === null && schema.properties?.[key] && !schema.required?.includes(key)))
    .map(([key, v]) => [key, omitOptionalNulls(v, objectSchema(schema.properties?.[key]))]));
  return value;
}
export class OneOvenMcpClient extends McpClient {
  private schemas = new Map<string, Schema>();
  readonly calls: ToolCallTrace[] = [];
  protocolVersion?: string;
  onResult?: (call: ToolCallTrace) => void;
  constructor(url: string, readonly trace: TraceSink) {
    let negotiated: string | undefined;
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (typeof init?.body === 'string' && JSON.parse(init.body).method === 'initialize' && response.ok) {
          const data = await response.clone().json();
          negotiated = data.result?.protocolVersion;
          trace.write({ type: 'mcp_initialize', protocolVersion: negotiated, server: data.result?.serverInfo });
        }
        return response;
      },
    });
    super({ transport, applicationName: 'one-oven-agent', applicationVersion: '0.1.0' });
    Object.defineProperty(this, 'protocolVersion', { get: () => negotiated });
  }
  override async listTools(...params: Parameters<McpClient['listTools']>): ReturnType<McpClient['listTools']> {
    const tools = await super.listTools(...params);
    for (const tool of tools) {
      if (!this.schemas.has(tool.name)) this.schemas.set(tool.name, structuredClone(tool.toolSpec.inputSchema ?? {}));
      const schema = structuredClone(this.schemas.get(tool.name)!);
      // Transport retry IDs and UI optimistic versions are host-owned, not model guesses.
      delete schema.properties?.request_id;
      delete schema.properties?.based_on_version;
      tool.toolSpec.inputSchema = nullableOptionals(schema);
    }
    this.trace.write({ type: 'mcp_tools_list', names: tools.map(tool => tool.name), protocolVersion: this.protocolVersion });
    return tools;
  }
  override async callTool(...params: Parameters<McpClient['callTool']>): Promise<JSONValue> {
    params[1] = omitOptionalNulls(params[1], this.schemas.get(params[0].name) ?? {});
    const start = performance.now();
    const call: ToolCallTrace = { name: params[0].name, args: structuredClone(params[1]), ms: 0 };
    try {
      const raw = await super.callTool(...params) as Record<string, JSONValue>;
      call.ms = performance.now() - start;
      call.result = raw;
      this.calls.push(call);
      this.onResult?.(call);
      // F-12: native McpTool drops structuredContent. Add it to the model-facing
      // content while preserving the original envelope in the wire trace.
      return raw.structuredContent && Array.isArray(raw.content)
        ? { ...raw, content: [...raw.content, { type: 'text', text: JSON.stringify(raw.structuredContent) }] }
        : raw;
    } catch {
      call.ms = performance.now() - start;
      call.error = 'mcp_transport_error';
      this.calls.push(call);
      throw new Error('One Oven MCP request failed');
    }
  }
}
