import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError, type Kitchen, type Plan } from '@one-oven/contracts';
import { upgradeKitchen, upgradePlan } from './plans.js';
import { eventBody, type PlanEvent } from './events.js';
import type { IdempotencyRecord } from './idempotency.js';

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, readonly householdId = 'local') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.transaction(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
      for (const [version, file] of [[1, '001_init.sql'], [2, '002_household.sql']] as const) {
        if (this.db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(version)) continue;
        this.db.exec(readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'));
        if (version === 2) {
          for (const row of this.db.prepare('SELECT id, body FROM kitchens').all()) {
            this.db.prepare('UPDATE kitchens SET body=? WHERE id=?').run(JSON.stringify(upgradeKitchen(JSON.parse(row.body as string))), row.id);
          }
          for (const row of this.db.prepare('SELECT body FROM plans').all()) {
            const plan = upgradePlan(JSON.parse(row.body as string));
            this.savePlan(plan);
            this.appendEvent(undefined, plan, 'migration', null, Date.now());
          }
        }
        this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(version, Date.now());
      }
      this.db.prepare('INSERT OR IGNORE INTO households VALUES (?, ?)').run(householdId, Date.now());
    });
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  kitchen(id: string): Kitchen {
    const row = this.db.prepare('SELECT body FROM kitchens WHERE id=? AND household_id=?').get(id, this.householdId);
    if (!row) throw new DomainError('infeasible_kitchen', 'That kitchen is unavailable. Describe your kitchen again.');
    return upgradeKitchen(JSON.parse(row.body as string));
  }
  plan(id: string): Plan {
    const row = this.db.prepare('SELECT body FROM plans WHERE id=? AND household_id=?').get(id, this.householdId);
    if (!row) throw new DomainError('unknown_plan', 'That meal plan is unavailable. Plan your meal again.');
    return upgradePlan(JSON.parse(row.body as string));
  }
  saveKitchen(id: string, kitchen: Kitchen, at = Date.now()): void {
    this.db.prepare('INSERT INTO kitchens(id, household_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(id, this.householdId, JSON.stringify(kitchen), at);
  }
  savePlan(plan: Plan): void {
    if (plan.household_id !== this.householdId) throw new DomainError('unknown_plan', 'That meal plan is unavailable. Plan your meal again.');
    this.db.prepare(`INSERT INTO plans(id, household_id, version, body, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version=excluded.version, body=excluded.body, updated_at=excluded.updated_at
      WHERE plans.household_id=excluded.household_id`).run(plan.plan_id, this.householdId, plan.version, JSON.stringify(plan), plan.updated_at);
  }
  planIds(): string[] {
    return this.db.prepare('SELECT id FROM plans WHERE household_id=? ORDER BY id').all(this.householdId).map(r => r.id as string);
  }
  appendEvent(before: Plan | undefined, after: Plan, tool: string, requestKey: string | null, at: number): void {
    this.db.prepare('INSERT INTO plan_events VALUES (?, ?, ?, ?, ?, ?)')
      .run(after.plan_id, after.version, tool, requestKey, JSON.stringify(eventBody(before, after)), at);
  }
  events(id: string): PlanEvent[] {
    this.plan(id);
    return this.db.prepare(`SELECT e.* FROM plan_events e JOIN plans p ON p.id=e.plan_id
      WHERE p.household_id=? AND e.plan_id=? ORDER BY e.version`).all(this.householdId, id)
      .map(r => ({ ...r, changes: JSON.parse(r.changes as string) }) as PlanEvent);
  }
  planVersion(id: string, version: number): Plan | undefined {
    return this.events(id).find(e => e.version === version)?.changes.plan;
  }
  explicit(key: string): IdempotencyRecord | undefined {
    return this.db.prepare('SELECT * FROM idempotency WHERE request_key=? AND household_id=?').get(key, this.householdId) as IdempotencyRecord | undefined;
  }
  recent(tool: string, hash: string, at: number): IdempotencyRecord[] {
    return this.db.prepare(`SELECT * FROM idempotency WHERE household_id=? AND tool=? AND args_hash=?
      AND created_at>=? AND created_at<=? ORDER BY created_at DESC, rowid DESC`).all(this.householdId, tool, hash, at - 20000, at) as IdempotencyRecord[];
  }
  remember(record: IdempotencyRecord): void {
    this.db.prepare('INSERT INTO idempotency VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(record.request_key,
      record.household_id, record.tool, record.args_hash, record.plan_id, record.result_version, record.response, record.created_at);
  }
  close(): void { this.db.close(); }
}
