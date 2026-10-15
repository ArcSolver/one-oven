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
export class JsonlTrace implements TraceSink {
  constructor(readonly path: string) { mkdirSync(dirname(path), { recursive: true }); }
  write(record: TraceRecord): void {
    appendFileSync(this.path, JSON.stringify(redact(record)) + '\n', { mode: 0o600 });
  }
}
export class MemoryTrace implements TraceSink {
  readonly records: TraceRecord[] = [];
  write(record: TraceRecord): void { this.records.push(structuredClone(redact(record)) as TraceRecord); }
}
