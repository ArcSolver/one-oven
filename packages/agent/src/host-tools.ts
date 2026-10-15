import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import type { Clock, TimerSuggestion } from '@one-oven/contracts';
export type TimerView = { label: string; minutes: number; endsAt: string; status: 'running' | 'elapsed' };
export type HostAction = { name: string; args: unknown; result: unknown; source: 'model' | 'auto' };

/** In-memory host state; firing/chimes belong to S3. */
export class HostTimers {
  private timers = new Map<string, { label: string; end: number }>();
  private applied = new Set<string>();
  readonly actions: HostAction[] = [];
  constructor(readonly clock: Clock) {}
  set(label: string, minutes: number): TimerView {
    if (!label.trim() || label.length > 100 || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error('Invalid timer');
    const end = this.clock.now() + minutes * 60000;
    this.timers.set(label.toLowerCase(), { label, end });
    return this.view({ label, end });
  }
  cancel(label: string): boolean { return this.timers.delete(label.toLowerCase()); }
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
