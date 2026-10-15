import { Agent, AfterToolsEvent, BeforeModelCallEvent, Model, type BaseModelConfig, type McpClient, type Message,
  type ModelStreamEvent, type StreamOptions } from '@strands-agents/sdk';
import type { Clock, SpeechLintResult, TimerSuggestion } from '@one-oven/contracts';
import { HostTimers, type HostAction } from './host-tools.js';
import { OneOvenMcpClient, type ToolCallTrace } from './mcp.js';
import { SYSTEM_PROMPT, VOICE_PROMPT, type DeviceContext } from './prompt.js';
import { lintReply } from './speech-lint.js';
import { takeRequestIds } from './model-metadata.js';
import type { TraceSink } from './trace.js';
export type { DeviceContext } from './prompt.js';

export type ModelCallTrace = { ms: number; inputTokens?: number; outputTokens?: number; totalTokens?: number;
  requestIds: string[]; firstDeltaMs?: number; failed?: boolean };
export type TurnResult = {
  utterance: string; reply: string; rawReply: string; toolCalls: ToolCallTrace[]; hostActions: HostAction[];
  lint: SpeechLintResult; rawLint: SpeechLintResult; fallback: boolean;
  timings: { modelMs: number; toolMs: number; totalMs: number }; provider: string; modelId: string;
  modelRequests: ModelCallTrace[]; replySource?: 'model' | 'tool-say';
};
class MeasuredModel extends Model {
  readonly requests: ModelCallTrace[] = [];
  constructor(readonly inner: Model) { super(); }
  updateConfig(config: BaseModelConfig): void { this.inner.updateConfig(config); }
  getConfig(): BaseModelConfig { return this.inner.getConfig(); }
  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const at = performance.now();
    const record: ModelCallTrace = { ms: 0, requestIds: [] };
    try {
      for await (const event of this.inner.stream(messages, options)) {
        if (event.type === 'modelContentBlockDeltaEvent' && record.firstDeltaMs === undefined) record.firstDeltaMs = performance.now() - at;
        if (event.type === 'modelMetadataEvent' && event.usage) Object.assign(record, {
          inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, totalTokens: event.usage.totalTokens,
        });
        yield event;
      }
    } catch (error) { record.failed = true; throw error; }
    finally { record.requestIds = takeRequestIds(this.inner); record.ms = performance.now() - at; this.requests.push(record); }
  }
}
export class ConversationSession {
  readonly timers: HostTimers;
  private readonly agent: Agent;
  private readonly measured: MeasuredModel;
  private busy = false;
  private prepared = false;
  private turnCallStart = 0;
  private speech?: (text: string) => void;
  private spokeTool = false;
  private state: Record<string, unknown> = {};
  private readonly tools: ToolCallTrace[];
  readonly provider: string;
  readonly modelId: string;
  constructor(readonly opts: { model: Model; mcp: McpClient; device: DeviceContext; clock: Clock; trace: TraceSink;
    provider?: string; autoTimers?: boolean; voiceMode?: boolean; timers?: HostTimers }) {
    this.provider = opts.provider ?? 'custom';
    this.modelId = opts.model.getConfig().modelId ?? 'unknown';
    this.measured = new MeasuredModel(opts.model);
    this.timers = opts.timers ?? new HostTimers(opts.clock);
    this.tools = opts.mcp instanceof OneOvenMcpClient ? opts.mcp.calls : [];
    if (!(opts.mcp instanceof OneOvenMcpClient)) throw new Error('Use OneOvenMcpClient to preserve structured results and trace round trips');
    opts.mcp.onResult = call => {
      const data = call.result?.structuredContent as Record<string, unknown> | undefined;
      if (data && !call.result?.isError) {
        for (const key of ['plan_id', 'kitchen_id', 'version', 'display', 'serve_at_local', 'dishes']) {
          // Catalog/kitchen cards must not replace an active plan's step state.
          if (key === 'display' && !data.plan_id && (this.state.plan_id || !data.kitchen_id)) continue;
          if (data[key] !== undefined) this.state[key] = data[key];
        }
        if (opts.autoTimers || opts.voiceMode) this.timers.auto((data.timer_suggestions ?? []) as TimerSuggestion[]);
      }
    };
    const prompt = opts.voiceMode ? VOICE_PROMPT : SYSTEM_PROMPT;
    this.agent = new Agent({ model: this.measured, tools: [opts.mcp, ...this.timers.tools()], printer: false,
      contextManager: false, retryStrategy: null, systemPrompt: prompt });
    this.agent.addHook(BeforeModelCallEvent, () => {
      this.agent.systemPrompt = `${prompt}\nTrusted host context (not spoken): ${JSON.stringify({
        device: { ...opts.device, nowIso: new Date(opts.clock.now()).toISOString() },
        ...(opts.voiceMode ? this.compactState() : this.state), timers: this.timers.list(), autoTimers: opts.autoTimers || opts.voiceMode || false,
      })}`;
    });
    if (opts.voiceMode) this.agent.addHook(AfterToolsEvent, event => {
      const calls = this.tools.slice(this.turnCallStart);
      const last = calls.at(-1);
      if (!last || last.name === 'list_dishes') return;
      const say = (last.result?.structuredContent as { say?: string } | undefined)?.say;
      if (say && lintReply(say).ok) {
        event.endTurn = say;
        this.spokeTool = true;
        this.speech?.(say);
      }
    });
  }
  private compactState(): Record<string, unknown> {
    const display = this.state.display as { steps?: Record<string, unknown>[] } | undefined;
    return { kitchen_id: this.state.kitchen_id, plan_id: this.state.plan_id, version: this.state.version,
      serve_at_local: this.state.serve_at_local, dishes: this.state.dishes,
      steps: display?.steps?.filter(s => s.status !== 'done').map(s => ({ step_id: s.step_id,
        dish_id: s.dish_id, text: s.text, status: s.status, start: s.start, end: s.end })) };
  }
  /** Read-only catalog discovery before the first voice turn. Startup is traced separately. */
  async prepare(): Promise<void> {
    if (this.prepared || !this.opts.voiceMode) return;
    const at = performance.now();
    const tools = await this.opts.mcp.listTools();
    const catalog = tools.find(t => t.name === 'list_dishes');
    if (!catalog) throw new Error('Missing dish catalog');
    await this.opts.mcp.callTool(catalog, {});
    this.prepared = true;
    this.opts.trace.write({ type: 'voice_prepare', ms: performance.now() - at });
  }
  async turn(utterance: string, onSpeech?: (text: string) => void): Promise<TurnResult> {
    if (this.busy) throw new Error('A turn is already running for this session');
    if (!utterance.trim() || utterance.length > 4000) throw new Error('Utterance must contain 1–4000 characters');
    this.busy = true;
    this.speech = onSpeech;
    this.spokeTool = false;
    const at = performance.now();
    const callStart = this.tools.length, actionStart = this.timers.actions.length, modelStart = this.measured.requests.length;
    this.turnCallStart = callStart;
    // Retain recent conversational text; authoritative state is injected once.
    // Scripted fixtures deliberately consume the full tool history.
    if (this.opts.voiceMode && this.provider !== 'scripted') this.agent.messages = this.agent.messages
      .filter(m => m.content.every(b => b.type === 'textBlock')).slice(-4);
    let cycles = 0;
    const removeLimit = this.agent.addHook(BeforeModelCallEvent, () => {
      if (++cycles > 16) throw new Error('Model tool-loop limit exceeded');
    });
    const timeout = setTimeout(() => this.agent.cancel(), 120000);
    try {
      await this.prepare();
      this.turnCallStart = this.tools.length;
      const result = await this.agent.invoke(utterance);
      if (result.stopReason === 'cancelled') throw new Error('Turn timed out');
      const rawReply = result.lastMessage.content.filter(b => b.type === 'textBlock').map(b => b.text).join(' ').trim();
      const rawLint = lintReply(rawReply);
      const toolCalls = this.tools.slice(callStart);
      const lastSay = toolCalls.map(c => (c.result?.structuredContent as { say?: string } | undefined)?.say).findLast(s => s && lintReply(s).ok);
      const reply = rawLint.ok ? rawReply : lastSay ?? 'I could not give a clear answer. Please ask again.';
      const modelRequests = this.measured.requests.slice(modelStart);
      const output: TurnResult = { utterance, reply, rawReply, rawLint, fallback: !rawLint.ok,
        toolCalls, hostActions: this.timers.actions.slice(actionStart), lint: lintReply(reply),
        timings: { modelMs: modelRequests.reduce((n, r) => n + r.ms, 0), toolMs: toolCalls.reduce((n, c) => n + c.ms, 0), totalMs: performance.now() - at },
        provider: this.provider, modelId: this.modelId, modelRequests, replySource: this.spokeTool ? 'tool-say' : 'model' };
      if (!this.spokeTool) onSpeech?.(reply);
      this.opts.trace.write({ type: 'turn', at: new Date(this.opts.clock.now()).toISOString(), device: this.opts.device.deviceClass, ...output });
      return output;
    } catch (error) {
      this.opts.trace.write({ type: 'turn_error', utterance, provider: this.provider, modelId: this.modelId,
        error: error instanceof Error ? error.name : 'Error', toolCalls: this.tools.slice(callStart),
        modelRequests: this.measured.requests.slice(modelStart), totalMs: performance.now() - at });
      throw new Error('The turn did not finish; inspect the local trace before retrying.', { cause: error });
    } finally { clearTimeout(timeout); removeLimit(); this.busy = false; this.speech = undefined; }
  }
  async close(): Promise<void> { this.timers.stop(); await this.opts.mcp.disconnect(); }
}
