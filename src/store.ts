import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Kitchen, Plan } from './engine.js';
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kitchens(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, body TEXT NOT NULL);');
  }
  kitchen(id: string): Kitchen { return this.read('kitchens',id); }
  plan(id: string): Plan { return this.read('plans',id); }
  private read<T>(table: 'kitchens'|'plans',id: string): T {
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id);
    if (!row) throw new Error(`Unknown ${table === 'plans' ? 'plan' : 'kitchen'} ID.`);
    return JSON.parse(row.body as string) as T;
  }
  saveKitchen(id: string, k: Kitchen) { this.db.prepare('INSERT INTO kitchens VALUES (?,?)').run(id,JSON.stringify(k)); }
  savePlan(p: Plan) { this.db.prepare('INSERT INTO plans VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.plan_id,JSON.stringify(p)); }
  planIds(): string[] { return this.db.prepare('SELECT id FROM plans ORDER BY id').all().map(r=>r.id as string); }
  close() { this.db.close(); }
}
