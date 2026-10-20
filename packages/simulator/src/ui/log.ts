/** Browser half of the sync log: records carry `ui_ms` (performance.now) and are batched to the host. */
type UiRecord = { type: string; ui_ms: number; [key: string]: unknown };
const queue: UiRecord[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
export function uilog(type: string, fields: Record<string, unknown> = {}, ui_ms = performance.now()): void {
  queue.push({ type, ui_ms: Math.round(ui_ms * 1000) / 1000, ...fields });
  timer ??= setTimeout(flush, 120);
}
export async function flush(): Promise<void> {
  timer = undefined;
  if (!queue.length) return;
  const records = queue.splice(0, queue.length);
  try { await fetch('/api/uilog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }) }); }
  catch { queue.unshift(...records); timer ??= setTimeout(flush, 1000); }
}
/** Pair the browser clock with the host's monotonic `t_ms` (lowest round trip wins on the host). */
export async function syncClocks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const send = performance.now();
    const response = await fetch('/api/ping', { method: 'POST' });
    const receive = performance.now();
    const { t_ms } = await response.json() as { t_ms: number };
    await fetch('/api/uilog', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ type: 'clock_sync', ui_send_ms: send, ui_receive_ms: receive, host_t_ms: t_ms }] }) });
  }
}
