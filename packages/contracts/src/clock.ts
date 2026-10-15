/** Milliseconds since Unix epoch. Scheduling converts this to minute epochs. */
export interface Clock { now(): number; onChange?(listener: () => void): () => void }
export class SystemClock implements Clock {
  now(): number { return Date.now(); }
}
export class SimClock implements Clock {
  private at: number;
  private listeners = new Set<() => void>();
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(): void { for (const listener of this.listeners) listener(); }
  constructor(start: string | number) {
    this.at = typeof start === 'string' ? Date.parse(start) : start;
    if (!Number.isFinite(this.at)) throw new Error('Invalid simulation start');
  }
  now(): number { return this.at; }
  advance(minutes: number): void {
    if (!Number.isFinite(minutes) || minutes < 0) throw new Error('Clock advance must be nonnegative');
    this.at += minutes * 60000;
    this.changed();
  }
  set(at: number): void {
    if (!Number.isFinite(at) || at < this.at) throw new Error('Clock cannot move backwards');
    this.at = at;
    this.changed();
  }
}
