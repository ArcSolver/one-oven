const offsets = new Map<string, Intl.DateTimeFormat>();
function offsetMs(at: number, timezone: string): number {
  let formatter = offsets.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    offsets.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - at;
}
/** Epoch milliseconds of a local wall time on a date in an IANA timezone. */
export function localEpoch(date: string, time: string, timezone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, h, mi);
  let at = naive - offsetMs(naive, timezone);
  at = naive - offsetMs(at, timezone);
  return at;
}
export function clockLabel(at: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(at));
}
/** "18:30" or an ISO timestamp with offset, as local HH:MM in the timezone. */
export function localHHMM(value: string, timezone: string): string {
  if (/^\d\d:\d\d$/.test(value)) return value;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return value;
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
}
