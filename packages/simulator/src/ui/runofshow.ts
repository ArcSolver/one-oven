import type { PlanState } from '../shared/api.js';
import { bars, diffBars, lanes, laneOrder, lockAxis, ticks, xOf, type Axis, type Bar, type BarChange, type Lane, type Track } from '../shared/timeline.js';

/** Fixed pixel layout inside the 1084×532 Run of Show card; never measured, so it cannot drift. */
export const LAYOUT = { trackLeft: 190, trackWidth: 862, lanesTop: 52, lanesBottom: 488, maxLane: 110, maxBar: 56 };
export const ANIM_MS = 600;
const TONES = ['#F2BDCC', '#D9CAF2', '#F6D2AE', '#CDE3D6', '#CBD6EE', '#EBD7C0', '#E3CBE9', '#D2E5E8'];
export const dishName = (id: string) => (id[0].toUpperCase() + id.slice(1)).replaceAll('-', ' ');

export type RenderResult = { changes: Map<string, BarChange>; finished: Promise<void>; axis: Axis; extended: boolean; rebuilt: boolean };
type Geometry = { top: number; height: number };

export class RunOfShow {
  private planId?: string;
  private version?: number;
  private axis?: Axis;
  private order: string[] = [];
  private laneIds: string[] = [];
  private current: Bar[] = [];
  private readonly els = new Map<string, HTMLElement>();
  private readonly labels = new Map<string, HTMLElement>();
  private readonly track: Track = { x0: 0, width: LAYOUT.trackWidth };
  private trackEl!: HTMLElement;
  private nowEl?: { line: HTMLElement; chip: HTMLElement };
  private serveEl?: { line: HTMLElement; chip: HTMLElement };
  private tones = new Map<string, string>();
  constructor(readonly root: HTMLElement, readonly fmt: (minute: number) => string) { this.empty(); }

  private empty(): void {
    this.root.replaceChildren(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Ask for a meal to see the Run of Show.' }));
    this.planId = undefined; this.version = undefined; this.current = []; this.els.clear(); this.labels.clear();
  }
  get plan(): { plan_id?: string; version?: number; axis?: Axis } { return { plan_id: this.planId, version: this.version, axis: this.axis }; }
  /** Draw a plan version. Bars that did not change are not touched, so their pixels stay identical. */
  render(plan: PlanState | undefined, animate = true): RenderResult | undefined {
    if (!plan) { if (this.planId) this.empty(); return undefined; }
    if (plan.plan_id === this.planId && plan.version === this.version) return undefined;
    const rebuilt = plan.plan_id !== this.planId;
    const locked = lockAxis(this.planId && this.axis ? { plan_id: this.planId, axis: this.axis } : undefined, plan.plan_id, plan.steps, plan.serve);
    const present = [...new Set([...plan.dish_ids, ...plan.steps.flatMap(s => s.dish_id ? [s.dish_id] : [])])]
      .filter(id => plan.steps.some(s => s.dish_id === id));
    this.order = laneOrder(rebuilt ? [] : this.order, present);
    const laneList = lanes(this.order, plan.steps);
    const laneIds = laneList.map(l => l.id);
    const relayout = rebuilt || locked.extended || laneIds.join() !== this.laneIds.join();
    if (relayout) this.scaffold(laneList, locked.axis, plan);
    this.axis = locked.axis; this.laneIds = laneIds;
    const next = bars(laneList, plan.steps, locked.axis, this.track);
    const changes = relayout ? new Map(next.map(b => [b.key, 'added' as BarChange])) : diffBars(this.current, next);
    const geometry = this.geometry(laneList);
    const animations: Promise<unknown>[] = [];
    for (const bar of next) {
      const change = changes.get(bar.key);
      if (!change) continue;
      const lane = geometry.get(bar.lane)!;
      let el = this.els.get(bar.key);
      const before = this.current.find(b => b.key === bar.key);
      if (!el) {
        el = document.createElement('div');
        el.dataset.key = bar.key; el.dataset.step = bar.step_id;
        el.append(document.createElement('span'));
        this.trackEl.append(el);
        this.els.set(bar.key, el);
      }
      this.style(el, bar, lane);
      if (!animate || relayout) continue;
      if (change === 'moved' && before) {
        animations.push(el.animate([{ left: `${before.x}px`, width: `${before.width}px` }, { left: `${bar.x}px`, width: `${bar.width}px` }],
          { duration: ANIM_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished);
      } else if (change === 'added') {
        animations.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ANIM_MS, easing: 'ease-out' }).finished);
      }
    }
    for (const [key, change] of changes) {
      if (change !== 'removed') continue;
      const el = this.els.get(key)!;
      this.els.delete(key);
      if (!animate) { el.remove(); continue; }
      animations.push(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ANIM_MS }).finished.then(() => el.remove()));
    }
    this.updateLabels(laneList, plan);
    this.moveServe(plan.serve, animate && !relayout, animations);
    this.current = next; this.planId = plan.plan_id; this.version = plan.version;
    return { changes, finished: Promise.all(animations).then(() => {}), axis: locked.axis, extended: locked.extended, rebuilt };
  }
  setNow(minuteFloat: number): void {
    if (!this.axis || !this.nowEl) return;
    const clamped = Math.min(this.axis.end, Math.max(this.axis.start, minuteFloat));
    const x = `${Math.round(LAYOUT.trackLeft + (clamped - this.axis.start) * LAYOUT.trackWidth / (this.axis.end - this.axis.start))}px`;
    this.nowEl.line.style.left = x; this.nowEl.chip.style.left = x;
    this.nowEl.line.hidden = clamped !== minuteFloat;
    const edge = minuteFloat < this.axis.start ? '← ' : '';
    this.nowEl.chip.textContent = `${edge}Now · ${this.fmt(Math.floor(minuteFloat))}${minuteFloat > this.axis.end ? ' →' : ''}`;
  }
  /** DOM rectangles of every bar relative to the stage: what was actually drawn, for the sync log. */
  measure(stage: HTMLElement): Record<string, unknown>[] {
    const origin = stage.getBoundingClientRect();
    const track = this.trackEl.getBoundingClientRect().left - origin.left;
    return this.current.map(bar => {
      const rect = this.els.get(bar.key)!.getBoundingClientRect();
      const r = (v: number) => Math.round(v * 100) / 100;
      return { key: bar.key, lane: bar.lane, step_id: bar.step_id, dish_id: bar.dish_id, status: bar.status,
        x: r(rect.left - origin.left), y: r(rect.top - origin.top), width: r(rect.width), height: r(rect.height),
        layout_x: r(track + bar.x), layout_width: bar.width,
        start: bar.start, end: bar.end, start_local: this.fmt(bar.start), end_local: this.fmt(bar.end) };
    });
  }
  trackRect(stage: HTMLElement): { x0: number; width: number } {
    const origin = stage.getBoundingClientRect(), rect = this.trackEl.getBoundingClientRect();
    return { x0: Math.round((rect.left - origin.left) * 100) / 100, width: LAYOUT.trackWidth };
  }

  private geometry(laneList: Lane[]): Map<string, Geometry> {
    const height = Math.min(LAYOUT.maxLane, Math.floor((LAYOUT.lanesBottom - LAYOUT.lanesTop) / Math.max(1, laneList.length)));
    return new Map(laneList.map((lane, i) => [lane.id, { top: LAYOUT.lanesTop + i * height, height }]));
  }
  private tone(dishId: string | null): string {
    if (!dishId) return '';
    if (!this.tones.has(dishId)) this.tones.set(dishId, TONES[this.tones.size % TONES.length]);
    return this.tones.get(dishId)!;
  }
  private style(el: HTMLElement, bar: Bar, lane: Geometry): void {
    const height = Math.min(LAYOUT.maxBar, lane.height - 18);
    // Hide a label that would not fit rather than show a clipped fragment; the Now card has the full text.
    const fits = bar.label.length * 8 + 18 <= bar.width;
    el.className = `bar ${bar.status}${bar.source === 'recipe' ? '' : ' system'}${fits ? '' : ' tiny'}`;
    if (bar.source === 'recipe') el.style.setProperty('--tone', this.tone(bar.dish_id));
    Object.assign(el.style, { left: `${bar.x}px`, width: `${bar.width}px`, top: `${lane.top + Math.round((lane.height - height) / 2)}px`, height: `${height}px` });
    el.dataset.status = bar.status;
    el.firstElementChild!.textContent = bar.label;
    el.title = bar.step_id;
  }
  private scaffold(laneList: Lane[], axis: Axis, plan: PlanState): void {
    this.root.replaceChildren();
    this.els.clear(); this.labels.clear(); this.current = [];
    const add = (className: string, style: Partial<CSSStyleDeclaration> = {}, text = '', parent: HTMLElement = this.root) => {
      const el = document.createElement('div'); el.className = className; Object.assign(el.style, style); el.textContent = text; parent.append(el); return el;
    };
    add('title', {}, 'Run of show');
    const geometry = this.geometry(laneList);
    for (const lane of laneList) {
      const g = geometry.get(lane.id)!;
      const label = add('lane-label', { top: `${g.top}px`, height: `${g.height}px` });
      label.dataset.lane = lane.id;
      add('n', {}, lane.kind === 'dish' ? dishName(lane.dish_id!) : `Oven ${lane.oven! + 1}`, label);
      add('r', {}, '', label);
      this.labels.set(lane.id, label);
      add('lane-sep', { top: `${g.top + g.height}px` });
    }
    for (const t of ticks(axis)) {
      const x = xOf(t, axis, this.track) + LAYOUT.trackLeft;
      add('tick', { left: `${x}px` }, this.fmt(t).replace(/ [AP]M$/, '')).dataset.x = String(x);
      add('grid', { left: `${x}px` });
    }
    this.serveEl = { line: add('serve-line'), chip: add('serve-chip') };
    this.trackEl = add('track', { left: `${LAYOUT.trackLeft}px`, width: `${LAYOUT.trackWidth}px` });
    this.nowEl = { line: add('now-line'), chip: add('now-chip') };
    void plan;
  }
  private updateLabels(laneList: Lane[], plan: PlanState): void {
    for (const lane of laneList) {
      const members = plan.steps.filter(s => lane.kind === 'dish' ? s.dish_id === lane.dish_id : s.oven === lane.oven && (s.source !== 'recipe' || s.kind === 'oven'));
      const range = lane.kind === 'dish' && members.length
        ? `${this.fmt(Math.min(...members.map(s => s.start))).replace(/ [AP]M$/, '')}–${this.fmt(Math.max(...members.map(s => s.end))).replace(/ [AP]M$/, '')}`
        : `${members.find(s => s.status === 'running')?.setpoint_f ?? members.find(s => s.setpoint_f)?.setpoint_f ?? ''}°F`;
      const el = this.labels.get(lane.id)!.lastElementChild as HTMLElement;
      if (el.textContent !== range) el.textContent = range;
    }
  }
  private moveServe(serve: number, animate: boolean, animations: Promise<unknown>[]): void {
    if (!this.serveEl || !this.axis) return;
    const x = xOf(serve, this.axis, this.track) + LAYOUT.trackLeft;
    for (const el of [this.serveEl.line, this.serveEl.chip]) {
      const old = el.style.left;
      el.style.left = `${x}px`;
      if (animate && old && old !== `${x}px`) animations.push(el.animate([{ left: old }, { left: `${x}px` }], { duration: ANIM_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished);
    }
    this.serveEl.chip.textContent = `Serve ${this.fmt(serve)}`;
    // The serve chip sits in the tick row; fade the time labels it would cover.
    for (const tick of this.root.querySelectorAll<HTMLElement>('.tick')) tick.classList.toggle('covered', Math.abs(Number(tick.dataset.x) - x) < 78);
  }
}
