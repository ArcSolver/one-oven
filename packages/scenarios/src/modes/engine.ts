import { lintReply } from '@one-oven/agent/speech-lint';
import type { TraceSink } from '@one-oven/agent/trace';
import { callTool } from '../../../server/src/mcp/tools.js';
import type { Harness } from '../harness.js';
import type { Driver, ObservedCall, TurnInput, TurnOutput } from '../types.js';

export function sayOf(call: ObservedCall | undefined): string {
  const data = call?.result?.structuredContent as { say?: unknown } | undefined;
  return typeof data?.say === 'string' ? data.say : '';
}
export function directOutput(toolCalls: ObservedCall[], started: number): TurnOutput {
  const reply = sayOf(toolCalls.at(-1));
  const lint = lintReply(reply).violations;
  return { reply, rawReply: reply, toolCalls, lint, rawLint: lint,
    timings: { totalMs: performance.now() - started, toolMs: toolCalls.reduce((n, c) => n + c.ms, 0) } };
}
/** Calls the service through the same dispatcher the MCP server uses, without a transport. */
export class EngineDriver implements Driver {
  readonly mode = 'engine' as const;
  readonly live = false;
  readonly description = 'Service through the MCP tool dispatcher, no transport';
  private harness!: Harness;
  private trace!: TraceSink;
  async open(harness: Harness, _scenario: unknown, trace: TraceSink): Promise<void> { this.harness = harness; this.trace = trace; }
  async turn(input: TurnInput): Promise<TurnOutput> {
    const started = performance.now();
    const toolCalls: ObservedCall[] = [];
    for (const call of input.calls) {
      const at = performance.now();
      const result = callTool(this.harness.service, call.name, call.args) as ObservedCall['result'];
      toolCalls.push({ name: call.name, args: call.args, result, ms: performance.now() - at });
    }
    const output = directOutput(toolCalls, started);
    this.trace.write({ type: 'engine_turn', utterance: input.utterance, toolCalls, reply: output.reply });
    return output;
  }
  async advance(target: number) { if (target > this.harness.clock.now()) this.harness.clock.set(target); return []; }
  protocolVersion(): string | undefined { return undefined; }
  async close(): Promise<void> {}
}
