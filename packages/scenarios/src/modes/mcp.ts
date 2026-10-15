import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { TraceSink } from '@one-oven/agent/trace';
import type { Harness } from '../harness.js';
import type { Driver, ObservedCall, TurnInput, TurnOutput } from '../types.js';
import { directOutput } from './engine.js';

/** A plain MCP SDK client over Streamable HTTP calls the YAML tools verbatim. */
export class McpDriver implements Driver {
  readonly mode = 'mcp' as const;
  readonly live = false;
  readonly description = 'MCP SDK client over Streamable HTTP, tools from YAML';
  private harness!: Harness;
  private client!: Client;
  private transport!: StreamableHTTPClientTransport;
  private trace!: TraceSink;
  async open(harness: Harness, _scenario: unknown, trace: TraceSink): Promise<void> {
    this.harness = harness; this.trace = trace;
    this.transport = new StreamableHTTPClientTransport(new URL(await harness.listen()));
    this.client = new Client({ name: 'one-oven-scenarios', version: '0.1.0' });
    await this.client.connect(this.transport);
    const { tools } = await this.client.listTools();
    trace.write({ type: 'mcp_tools_list', names: tools.map(t => t.name), protocolVersion: this.transport.protocolVersion });
    if (tools.length !== 6) throw new Error(`Expected 6 MCP tools, found ${tools.length}`);
  }
  async turn(input: TurnInput): Promise<TurnOutput> {
    const started = performance.now();
    const toolCalls: ObservedCall[] = [];
    for (const call of input.calls) {
      const at = performance.now();
      const result = await this.client.callTool({ name: call.name, arguments: call.args }) as ObservedCall['result'];
      toolCalls.push({ name: call.name, args: call.args, result, ms: performance.now() - at });
    }
    const output = directOutput(toolCalls, started);
    this.trace.write({ type: 'mcp_turn', utterance: input.utterance, toolCalls, reply: output.reply });
    return output;
  }
  async advance(target: number) { if (target > this.harness.clock.now()) this.harness.clock.set(target); return []; }
  protocolVersion(): string | undefined { return this.transport?.protocolVersion; }
  async close(): Promise<void> { await this.client?.close(); }
}
