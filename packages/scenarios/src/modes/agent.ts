import type { Model } from '@strands-agents/sdk';
import { ConversationSession, type DeviceContext } from '@one-oven/agent';
import { OneOvenMcpClient } from '@one-oven/agent/mcp';
import type { TraceSink } from '@one-oven/agent/trace';
import type { Harness } from '../harness.js';
import type { Scenario } from '../schema.js';
import { ScenarioScriptedModel } from '../scripted.js';
import { timerSpeech, type Driver, type TimerFire, type TurnInput, type TurnOutput } from '../types.js';

export type AgentOptions = { model?: () => Model; provider?: string; voiceMode?: boolean };
/** Strands agent + McpClient against the real HTTP server; scripted by default, a live model when supplied. */
export class AgentDriver implements Driver {
  readonly mode: 'agent' | 'voice' = 'agent';
  readonly live: boolean;
  protected harness!: Harness;
  protected session!: ConversationSession;
  protected mcp!: OneOvenMcpClient;
  protected scripted?: ScenarioScriptedModel;
  private device?: DeviceContext;
  private reported = new Set<string>();
  constructor(readonly options: AgentOptions = {}) { this.live = !!options.model; }
  get description(): string {
    return `Strands agent, ${this.live ? `live ${this.options.provider}` : 'scripted model'}, ${this.options.voiceMode ? 'voice-mode replies' : 'model replies'}`;
  }
  async open(harness: Harness, scenario: Scenario, trace: TraceSink, _directory?: string): Promise<void> {
    this.harness = harness;
    this.mcp = new OneOvenMcpClient(await harness.listen(), trace);
    const model = this.options.model ? this.options.model() : (this.scripted = new ScenarioScriptedModel());
    this.device = { deviceClass: scenario.device, timezone: scenario.timezone, nowIso: new Date(harness.clock.now()).toISOString() };
    this.session = new ConversationSession({ model, mcp: this.mcp, clock: harness.clock, trace,
      provider: this.options.provider ?? 'scripted', autoTimers: !this.live, voiceMode: this.options.voiceMode ?? false,
      device: this.device });
    await this.mcp.listTools();
  }
  protected prime(input: TurnInput): void { this.scripted?.prime(input.calls, input.intents); }
  async turn(input: TurnInput): Promise<TurnOutput> {
    this.prime(input);
    const result = await this.session.turn(input.utterance);
    return { reply: result.reply, rawReply: result.rawReply, toolCalls: result.toolCalls, lint: result.lint.violations,
      rawLint: result.rawLint.violations, replySource: result.replySource, fallback: result.fallback,
      modelRequests: result.modelRequests.length, timings: result.timings };
  }
  async advance(target: number): Promise<TimerFire[]> {
    if (target > this.harness.clock.now()) this.harness.clock.set(target);
    const now = this.harness.clock.now();
    const fired: TimerFire[] = [];
    for (const timer of this.session.timers.list()) {
      const key = `${timer.label}@${timer.endsAt}`;
      if (timer.status !== 'elapsed' || this.reported.has(key)) continue;
      this.reported.add(key);
      fired.push({ label: timer.label, text: timerSpeech(timer.label), endsAt: timer.endsAt, latenessMs: now - Date.parse(timer.endsAt) });
    }
    return fired;
  }
  setDevice(device: Scenario['device']): void { if (this.device) this.device.deviceClass = device; }
  protocolVersion(): string | undefined { return this.mcp?.protocolVersion; }
  async close(): Promise<void> { await this.session?.close(); }
}
