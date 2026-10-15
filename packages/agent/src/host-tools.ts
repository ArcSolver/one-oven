import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import type { Clock, TimerSuggestion } from '@one-oven/contracts';
export type TimerView = { label: string; minutes: number; endsAt: string; status: 'running' | 'elapsed' };
export type HostAction = { name: string; args: unknown; result: unknown; source: 'model' | 'auto' };

/** Host-owned timers. Polling never calls the cooking server. */
export class HostTimers {
  private timers = new Map<string, { label: string; end: number; fired: boolean }>();
  private applied = new Set<string>();
  readonly actions: HostAction[] = [];
  private listeners = new Set<(timer: TimerView) => void>();
  private stopClock?: () => void;
  private ticker?: ReturnType<typeof setInterval>;
  constructor(readonly clock: Clock) {}
  onFire(listener: (timer: TimerView) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  start(): void {
    if (this.ticker) return;
    this.stopClock = this.clock.onChange?.(() => this.poll());
    this.ticker = setInterval(() => this.poll(), 50);
    this.ticker.unref();
    this.poll();
  }
  stop(): void { clearInterval(this.ticker); this.ticker = undefined; this.stopClock?.(); this.stopClock = undefined; }
  poll(): void {
    for (const timer of this.timers.values()) {
      if (timer.fired || timer.end > this.clock.now()) continue;
      timer.fired = true;
      for (const listener of this.listeners) listener(this.view(timer));
    }
  }
  set(label: string, minutes: number): TimerView {
    if (!label.trim() || label.length > 100 || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error('Invalid timer');
    const end = this.clock.now() + minutes * 60000;
    this.timers.set(label.trim().toLowerCase(), { label: label.trim(), end, fired: false });
    return this.view({ label, end });
  }
  cancel(label: string): boolean { return this.timers.delete(label.trim().toLowerCase()); }
  private view(timer: { label: string; end: number }): TimerView {
    return { label: timer.label, minutes: Math.max(0, (timer.end - this.clock.now()) / 60000),
      endsAt: new Date(timer.end).toISOString(), status: timer.end > this.clock.now() ? 'running' : 'elapsed' };
  }
  list(): TimerView[] { return [...this.timers.values()].map(t => this.view(t)); }
  auto(suggestions: TimerSuggestion[]): void {
    for (const suggestion of suggestions) {
      const key = `${suggestion.step_id}:${suggestion.ends_at}`;
      const minutes = (Date.parse(suggestion.ends_at) - this.clock.now()) / 60000;
      if (this.applied.has(key) || minutes <= 0) continue;
      this.applied.add(key);
      const args = { label: suggestion.label, minutes };
      this.actions.push({ name: 'set_timer', args, result: this.set(args.label, minutes), source: 'auto' });
    }
  }
  tools() {
    const label = z.string().trim().min(1).max(100);
    return [
      tool({ name: 'set_timer', description: 'Set or replace a host timer for a cooking task.',
        inputSchema: z.object({ label, minutes: z.number().positive().max(1440) }),
        callback: args => { const result = this.set(args.label, args.minutes); this.actions.push({ name: 'set_timer', args, result, source: 'model' }); return result; } }),
      tool({ name: 'cancel_timer', description: 'Cancel a host timer by its label.', inputSchema: z.object({ label }),
        callback: args => { const result = { cancelled: this.cancel(args.label) }; this.actions.push({ name: 'cancel_timer', args, result, source: 'model' }); return result; } }),
      tool({ name: 'list_timers', description: 'List host timers and their remaining minutes.', inputSchema: z.object({}),
        callback: args => { const result = this.list(); this.actions.push({ name: 'list_timers', args, result, source: 'model' }); return result; } }),
    ];
  }
}
