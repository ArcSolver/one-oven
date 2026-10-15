import { DomainError } from '@one-oven/contracts';
export const iso = (minute: number) => new Date(minute * 60000).toISOString();
const formatters = new Map<string, Intl.DateTimeFormat>();
export function localTime(minute: number, timezone: string): string {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true });
    formatters.set(timezone, formatter);
  }
  return formatter.format(new Date(minute * 60000));
}
export function servingTime(value: string, timezone: string, now: number): number {
  let result: number;
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    // UTC minute traversal handles both skipped and repeated DST wall times.
    // At most 26h to the next occurrence, or 50h across a skipped local time.
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    result = NaN;
    for (let minute = now + 1; minute <= now + 3000; minute++) {
      if (formatter.format(new Date(minute * 60000)) === value) { result = minute; break; }
    }
  } else result = /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) / 60000 : NaN;
  if (!Number.isInteger(result) || result <= now || result > now + 10080) throw new DomainError('not_enough_time', 'Choose a serving time within the next seven days, including a time zone.');
  return result;
}
