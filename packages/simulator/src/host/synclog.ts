import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
/**
 * Recording-sync log (format: packages/simulator/SYNC_LOG.md). `t_ms` is a monotonic host clock
 * that never decreases within one file; UI records also carry the browser's own `ui_ms`.
 */
export class SyncLog {
  private readonly t0: number;
  private last = 0;
  private seq = 0;
  private offset?: { value: number; rtt: number };
  constructor(readonly path: string, private readonly now: () => number = () => performance.now(),
    private readonly wall: () => number = () => Date.now()) {
    mkdirSync(dirname(path), { recursive: true });
    this.t0 = now();
  }
  /** Milliseconds since the log opened on the host monotonic clock (never decreases). */
  t(): number { this.last = Math.max(this.last, Math.round((this.now() - this.t0) * 1000) / 1000); return this.last; }
  write(type: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
    const record: Record<string, unknown> = { seq: ++this.seq, t_ms: this.t(), wall: new Date(this.wall()).toISOString(), type, ...fields };
    if (typeof fields.ui_ms === 'number' && this.offset) record.ui_t_ms = Math.round((fields.ui_ms + this.offset.value) * 1000) / 1000;
    appendFileSync(this.path, JSON.stringify(record) + '\n', { mode: 0o600 });
    return record;
  }
  /** NTP-style pairing of the browser clock with t_ms; the lowest round trip wins. */
  sync(uiSend: number, uiReceive: number, host: number): void {
    const rtt = uiReceive - uiSend;
    if (rtt < 0) return;
    if (!this.offset || rtt <= this.offset.rtt) this.offset = { value: host - (uiSend + uiReceive) / 2, rtt };
    this.write('clock_sync', { ui_send_ms: uiSend, ui_receive_ms: uiReceive, host_t_ms: host, rtt_ms: rtt,
      offset_ms: Math.round(this.offset.value * 1000) / 1000 });
  }
}
