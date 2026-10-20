import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export type TraceRecord = { type: string; [key: string]: unknown };
export interface TraceSink { write(record: TraceRecord): void }

// Never serialize client options, credentials, headers, or arbitrary SDK errors.
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) =>
    [key, /api.?key|authorization|cookie|password|secret|access.?token|refresh.?token/i.test(key) ? '[REDACTED]' : redact(v)]));
  return value;
}
/** Monotonic process clock (performance.now, ms) used for every timestamp that must line up with a recording. */
export const monoMs = (): number => performance.now();
/**
 * JSONL trace. Every record carries mono_ms (monotonic) and wall_iso (wall clock) taken together, so screen and
 * audio recordings can be aligned with the turn milestones; a sync_marker names the instant recording starts.
 */
export class JsonlTrace implements TraceSink {
  constructor(readonly path: string) { mkdirSync(dirname(path), { recursive: true }); }
  write(record: TraceRecord): void {
    const stamped = { ...record, mono_ms: record.mono_ms ?? monoMs(), wall_iso: record.wall_iso ?? new Date().toISOString() };
    appendFileSync(this.path, JSON.stringify(redact(stamped)) + '\n', { mode: 0o600 });
  }
  /** A named instant on the shared clock, e.g. recording_t0 when screen capture starts. */
  mark(name: string): void { this.write({ type: 'sync_marker', name }); }
}
export class MemoryTrace implements TraceSink {
  readonly records: TraceRecord[] = [];
  write(record: TraceRecord): void { this.records.push(structuredClone(redact(record)) as TraceRecord); }
}
