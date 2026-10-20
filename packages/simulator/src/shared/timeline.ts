/**
 * Pure Run of Show geometry. Everything here works in minute epochs (the server's step
 * `start`/`end`) and integer CSS pixels, so an unchanged step always maps to the same pixels.
 */
export type StepStatus = 'pending' | 'running' | 'done';
export type StepView = {
  step_id: string; dish_id: string | null; source: 'recipe' | 'preheat' | 'transition'; kind: string;
  text: string; start: number; end: number; status: StepStatus; oven?: number | null;
  setpoint_f?: number; temperature_f?: number; index: number;
};
export type Axis = { start: number; end: number };
export type Track = { x0: number; width: number };
export type Lane = { id: string; kind: 'dish' | 'oven'; dish_id?: string; oven?: number };
export type Bar = {
  key: string; lane: string; step_id: string; dish_id: string | null; source: StepView['source'];
  start: number; end: number; status: StepStatus; label: string; x: number; width: number;
};
export type BarChange = 'moved' | 'status' | 'added' | 'removed';

export const PAD_MINUTES = 15;
export const TICK_MINUTES = 10;
export const BAR_GAP = 4;
/** Two 2px borders; a zero-minute step stays visible without growing past its slot. */
export const MIN_BAR = 6;

const floorTo = (value: number, step: number) => Math.floor(value / step) * step;
const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step;

/** Axis for a new plan: first step to serving time, rounded to 5 minutes and padded 15 minutes each side. */
export function planAxis(steps: Pick<StepView, 'start' | 'end'>[], serve: number): Axis {
  const first = Math.min(serve, ...steps.map(s => s.start));
  const last = Math.max(serve, ...steps.map(s => s.end));
  return { start: floorTo(first, 5) - PAD_MINUTES, end: ceilTo(last, 5) + PAD_MINUTES };
}
/**
 * The axis is frozen for a plan ID. It only grows (and reports so) if a later version would put a
 * bar or the serving time outside it; a different plan ID gets a fresh axis.
 */
export function lockAxis(previous: { plan_id: string; axis: Axis } | undefined, plan_id: string,
  steps: Pick<StepView, 'start' | 'end'>[], serve: number): { axis: Axis; extended: boolean } {
  if (!previous || previous.plan_id !== plan_id) return { axis: planAxis(steps, serve), extended: false };
  const needed = planAxis(steps, serve);
  const first = Math.min(serve, ...steps.map(s => s.start)), last = Math.max(serve, ...steps.map(s => s.end));
  if (first >= previous.axis.start && last <= previous.axis.end) return { axis: previous.axis, extended: false };
  return { axis: { start: Math.min(previous.axis.start, needed.start), end: Math.max(previous.axis.end, needed.end) }, extended: true };
}
export function xOf(minute: number, axis: Axis, track: Track): number {
  return Math.round(track.x0 + (minute - axis.start) * track.width / (axis.end - axis.start));
}
export function ticks(axis: Axis, every = TICK_MINUTES): number[] {
  const result: number[] = [];
  for (let t = ceilTo(axis.start, every); t <= axis.end; t += every) result.push(t);
  return result;
}
/**
 * Dish lanes keep their first order for a plan. A swapped-out dish hands its slot to the
 * replacement; other new dishes append. Oven lanes follow the dishes.
 */
export function laneOrder(previous: string[], dishIds: string[]): string[] {
  const added = dishIds.filter(id => !previous.includes(id));
  const order = previous.map(id => dishIds.includes(id) ? id : added.shift()).filter((id): id is string => !!id);
  return [...order, ...added];
}
export function lanes(dishOrder: string[], steps: StepView[]): Lane[] {
  const ovens = [...new Set(steps.flatMap(s => s.oven === undefined || s.oven === null ? [] : [s.oven]))].sort((a, b) => a - b);
  return [...dishOrder.map(id => ({ id: `dish:${id}`, kind: 'dish' as const, dish_id: id })),
    ...ovens.map(oven => ({ id: `oven:${oven}`, kind: 'oven' as const, oven }))];
}
/** Short verb label for a bar; the full sentence stays in the Now card. */
export function shortLabel(step: StepView): string {
  if (step.source === 'preheat') return `Preheat ${step.setpoint_f ?? step.temperature_f ?? ''}°F`.replace(' °F', '');
  if (step.source === 'transition') return `To ${step.setpoint_f ?? ''}°F`.replace(' °F', '');
  const text = step.text.replace(/\.$/, '');
  const simmer = /^Bring .* to a (\w+)/.exec(text);
  const words = simmer ? [simmer[1][0].toUpperCase() + simmer[1].slice(1)] : [];
  if (!simmer) for (const word of text.split(' ')) {
    if (words.length && /^(the|a|an|in|and|to|for|before|off|over|with)$/i.test(word)) break;
    words.push(word);
  }
  const temperature = step.kind === 'oven' && step.temperature_f ? ` ${step.temperature_f}°F` : '';
  return words.slice(0, 2).join(' ') + temperature;
}
export function bars(laneList: Lane[], steps: StepView[], axis: Axis, track: Track): Bar[] {
  const result: Bar[] = [];
  for (const lane of laneList) {
    const members = steps.filter(s => lane.kind === 'dish' ? s.dish_id === lane.dish_id
      : s.oven === lane.oven && (s.source !== 'recipe' || s.kind === 'oven'));
    for (const step of members) {
      const x = xOf(step.start, axis, track);
      const width = Math.max(MIN_BAR, xOf(step.end, axis, track) - x - BAR_GAP);
      const label = lane.kind === 'oven' && step.dish_id
        ? `${step.dish_id[0].toUpperCase()}${step.dish_id.slice(1).replaceAll('-', ' ')} ${shortLabel(step).split(' ')[0].toLowerCase()}` : shortLabel(step);
      result.push({ key: `${lane.id}/${step.step_id}`, lane: lane.id, step_id: step.step_id, dish_id: step.dish_id,
        source: step.source, start: step.start, end: step.end, status: step.status, label, x, width });
    }
  }
  return result;
}
/** Bars whose pixels must change. Anything not listed keeps its exact x, width and status. */
export function diffBars(previous: Bar[], next: Bar[]): Map<string, BarChange> {
  const before = new Map(previous.map(b => [b.key, b]));
  const changes = new Map<string, BarChange>();
  for (const bar of next) {
    const old = before.get(bar.key);
    if (!old) changes.set(bar.key, 'added');
    else if (old.x !== bar.x || old.width !== bar.width) changes.set(bar.key, 'moved');
    else if (old.status !== bar.status || old.label !== bar.label) changes.set(bar.key, 'status');
    before.delete(bar.key);
  }
  for (const key of before.keys()) changes.set(key, 'removed');
  return changes;
}
/** What the Now and Next cards show: running steps first (earliest start), then the earliest pending step. */
export function focus(steps: StepView[]): { current?: StepView; also: StepView[]; next?: StepView } {
  const order = (a: StepView, b: StepView) => a.start - b.start || a.end - b.end || a.step_id.localeCompare(b.step_id);
  const running = steps.filter(s => s.status === 'running').sort(order);
  const pending = steps.filter(s => s.status === 'pending').sort(order);
  return { current: running[0], also: running.slice(1), next: pending[0] };
}
