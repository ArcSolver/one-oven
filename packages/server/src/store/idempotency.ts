import { createHash } from 'node:crypto';
export type SavedResponse = Record<string, unknown> & { say: string; version?: number; plan_id?: string; kitchen_id?: string };
export type IdempotencyRecord = { request_key: string; household_id: string; tool: string; args_hash: string;
  plan_id: string | null; result_version: number | null; response: string; created_at: number };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const argsHash = (args: unknown) => createHash('sha256').update(JSON.stringify(canonical(args))).digest('hex');
export const explicitKey = (household: string, requestId: string) => JSON.stringify([household, requestId]);
