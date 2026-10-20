import type { ToolCallTrace } from '@one-oven/agent/mcp';
import type { PlanState, ToolCallView } from '../shared/api.js';
import type { StepView } from '../shared/timeline.js';
type Envelope = { plan_id?: string; version?: number; serve_at?: string; serve_at_local?: string; deduplicated?: boolean;
  error_code?: string; changed_steps?: { step_id: string }[]; display?: { steps?: StepView[] } };

export function toolView(call: ToolCallTrace): ToolCallView {
  const data = call.result?.structuredContent as Envelope | undefined;
  return { name: call.name, args: call.args, ok: !call.error && !call.result?.isError, ms: Math.round(call.ms),
    ...(data?.deduplicated ? { deduplicated: true } : {}), ...(data?.version !== undefined ? { version: data.version } : {}),
    ...(data?.error_code ? { error_code: data.error_code } : {}) };
}
/** Plan state exactly as the MCP server returned it in structuredContent.display; never computed here. */
export function planFrom(call: ToolCallTrace, previous: PlanState | undefined): PlanState | undefined {
  const data = call.result?.structuredContent as Envelope | undefined;
  if (call.error || call.result?.isError || !data?.plan_id || !data.display?.steps || data.version === undefined || !data.serve_at) return previous;
  if (previous?.plan_id === data.plan_id && data.version < previous.version) return previous;
  const steps = data.display.steps.map(s => ({ step_id: s.step_id, dish_id: s.dish_id, source: s.source, kind: s.kind, text: s.text,
    start: s.start, end: s.end, status: s.status, oven: s.oven ?? null, setpoint_f: s.setpoint_f, temperature_f: s.temperature_f, index: s.index }));
  const args = call.args as { dish_ids?: string[] } | null;
  const dish_ids = call.name === 'plan_meal' && Array.isArray(args?.dish_ids) ? args.dish_ids
    : previous?.plan_id === data.plan_id ? previous.dish_ids : [...new Set(steps.flatMap(s => s.dish_id ? [s.dish_id] : []))];
  return { plan_id: data.plan_id, version: data.version, serve: Date.parse(data.serve_at) / 60000, serve_at_local: data.serve_at_local ?? '',
    steps, dish_ids, changed_step_ids: data.deduplicated ? [] : (data.changed_steps ?? []).map(c => c.step_id) };
}
/** Next clock event like the scenario runner: earliest running end or pending start, never in the past. */
export function nextEvent(plan: PlanState | undefined, nowMs: number): number {
  const times = (plan?.steps ?? []).filter(s => s.status !== 'done').map(s => (s.status === 'running' ? s.end : s.start) * 60000);
  return times.length ? Math.max(nowMs, Math.min(...times)) : nowMs;
}
/** Epoch ms for a kitchen-local HH:MM on the simulated day of `nowMs` (NaN if malformed). */
export function sameDayAt(nowMs: number, hhmm: string, timezone: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return NaN;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(nowMs);
  const minuteOfDay = Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
  const startOfMinute = Math.floor(nowMs / 60000) * 60000;
  return startOfMinute + (Number(match[1]) * 60 + Number(match[2]) - minuteOfDay) * 60000;
}
