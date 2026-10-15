import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store/db.js';
import { defaultOven } from '@one-oven/contracts';

test('migrations upgrade an existing v1 database and survive reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'one-oven-v1-'));
  const path = join(dir, 'state.sqlite');
  try {
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE kitchens(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE plans(id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    const kitchen = { ovens: 1, burners: 4, helpers: 1 };
    db.prepare('INSERT INTO kitchens VALUES (?, ?)').run('k', JSON.stringify(kitchen));
    const old = { plan_id: 'p', kitchen_id: 'k', kitchen, version: 7, serve: 1000,
      steps: [{ step_id: 'salmon:1', dish_id: 'salmon', index: 1, text: 'Roast the salmon.', minutes: 18, hands: 0, burners: 0, temperature: 400, start: 980, end: 998, oven: 0, status: 'pending' }] };
    db.prepare('INSERT INTO plans VALUES (?, ?)').run('p', JSON.stringify(old));
    db.close();
    let store = new Store(path);
    assert.deepEqual(store.kitchen('k').ovens, [defaultOven()]);
    const plan = store.plan('p');
    assert.equal(plan.schema, 2);
    assert.equal(plan.version, 7);
    assert.equal(plan.household_id, 'local');
    assert.equal(plan.steps[0].source, 'preheat');
    assert.deepEqual(store.planVersion('p', 7), plan);
    store.close();
    store = new Store(path);
    assert.deepEqual(store.plan('p'), plan);
    assert.equal(store.db.prepare('SELECT * FROM schema_migrations').all().length, 2);
    assert.equal(store.events('p').length, 1);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('BEGIN IMMEDIATE rolls back all writes and households scope queries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'one-oven-store-'));
  const path = join(dir, 'state.sqlite');
  const a = new Store(path);
  const b = new Store(path, 'other');
  const kitchen = { ovens: [defaultOven()], burners: 4, helpers: 1, timezone: 'America/Chicago' };
  try {
    assert.throws(() => a.transaction(() => { a.saveKitchen('rolled-back', kitchen); throw new Error('injected'); }));
    assert.throws(() => a.kitchen('rolled-back'));
    a.transaction(() => a.saveKitchen('visible', kitchen));
    assert.deepEqual(a.kitchen('visible'), kitchen);
    assert.throws(() => b.kitchen('visible'));
    assert.deepEqual(b.planIds(), []);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});
