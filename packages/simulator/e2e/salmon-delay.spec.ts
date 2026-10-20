import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HostState } from '../src/shared/api.js';
import type { StepView } from '../src/shared/timeline.js';

/**
 * salmon-delay through the UI with text input: kitchen, plan, cook until 6:20 PM with the salmon
 * roasting, then "The salmon needs five more minutes." The sync log must show that only salmon bars
 * moved (by exactly five minutes of pixels) and every rice and green-bean bar kept its coordinates.
 */
const out = resolve(process.env.SIM_E2E_OUT ?? join(import.meta.dirname, '../../../runs/sim-e2e'));
type Bar = { key: string; lane: string; step_id: string; dish_id: string | null; x: number; y: number; width: number; height: number; layout_x: number; layout_width: number; status: string };
type Record = { seq: number; t_ms: number; type: string; [key: string]: unknown };
const spoken = (step: StepView) => step.source === 'preheat' ? 'oven preheat'
  : step.source === 'transition' ? 'oven temperature change' : (step.dish_id ?? 'oven').replaceAll('-', ' ');

async function state(page: Page): Promise<HostState> { return (await page.request.get('/api/state')).json(); }
function log(path: string): Record[] { return readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line)); }
async function say(page: Page, utterance: string): Promise<HostState> {
  await page.keyboard.press('`');
  await page.locator('#say').fill(utterance);
  const response = page.waitForResponse(r => r.url().endsWith('/api/turn'));
  await page.locator('#say').press('Enter');
  expect((await response).ok(), utterance).toBe(true);
  await page.keyboard.press('`');
  return state(page);
}
async function dock(page: Page, selector: string, time?: string): Promise<void> {
  await page.keyboard.press('`');
  if (time) await page.locator('#goto').fill(time);
  const response = page.waitForResponse(r => r.url().endsWith('/api/clock'));
  await page.locator(selector).click();
  expect((await response).ok()).toBe(true);
  await page.keyboard.press('`');
}
/** Decoded RGBA comparison (PNG bytes may differ for identical pixels). */
async function differingPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(async ([first, second]) => {
    const decode = async (b64: string) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [x, y] = [await decode(first), await decode(second)];
    if (x.length !== y.length) return -1;
    let differing = 0;
    for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) differing++;
    return differing;
  }, [a.toString('base64'), b.toString('base64')]);
}
async function barsFor(path: string, version: number): Promise<{ bars: Bar[]; px_per_min: number }> {
  await expect.poll(() => log(path).some(r => r.type === 'bars' && r.version === version), { timeout: 10000 }).toBe(true);
  const record = log(path).findLast(r => r.type === 'bars' && r.version === version)!;
  return { bars: record.bars as Bar[], px_per_min: (record.axis as { px_per_min: number }).px_per_min };
}

test('salmon delay moves only the salmon bars by five minutes', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  await page.goto('/?film=1');
  await page.request.post('/api/take');
  await expect(page.locator('#clock')).toHaveText('5:05 PM');
  const path = (await state(page)).log;

  await say(page, 'My kitchen has one oven, four burners, and one cook.');
  let current = await say(page, 'I want salmon, rice and green beans on the table at 6:30 PM.');
  expect(current.plan?.serve_at_local).toBe('6:30 PM');
  await expect(page.locator('#serve')).toHaveText('6:30 PM');

  const stopAt = Date.parse('2026-10-15T18:20:00-05:00');
  for (let i = 0; i < 40; i++) {
    const plan = current.plan!;
    const times = plan.steps.filter(s => s.status !== 'done').map(s => (s.status === 'running' ? s.end : s.start) * 60000);
    const target = Math.max(current.clock.now, Math.min(...times));
    if (target > stopAt) { await dock(page, '#goto-btn', '18:20'); break; }
    await dock(page, '[data-advance="next"]');
    current = await state(page);
    const now = current.clock.now / 60000;
    const done = current.plan!.steps.filter(s => s.status === 'running' && s.end <= now)
      .sort((a, b) => a.end - b.end || a.step_id.localeCompare(b.step_id))[0];
    current = await say(page, done ? `I'm done with the ${spoken(done)}. What's next?` : "What's next?");
  }
  current = await state(page);
  expect(current.clock.local).toBe('6:20 PM');
  expect(current.plan!.steps.find(s => s.step_id === 'salmon:1')?.status).toBe('running');
  const before = current.plan!.version;
  const { bars: barsBefore, px_per_min } = await barsFor(path, before);
  await page.waitForTimeout(300);
  await page.locator('#stage').screenshot({ path: join(out, 'film-before-delay.png') });
  const unchangedShots = new Map<string, Buffer>();
  for (const bar of barsBefore.filter(b => b.dish_id === 'rice' || b.dish_id === 'green-beans')) {
    unchangedShots.set(bar.key, await page.locator(`[data-key="${bar.key}"]`).screenshot());
  }

  current = await say(page, 'The salmon needs five more minutes.');
  expect(current.plan!.version).toBe(before + 1);
  expect(current.plan!.serve_at_local).toBe('6:35 PM');
  expect(current.last?.tools.map(t => t.name)).toEqual(['report_delay']);
  const { bars: barsAfter } = await barsFor(path, before + 1);
  await expect(page.locator('#serve')).toHaveText('6:35 PM');
  await page.waitForTimeout(1000);
  await page.locator('#stage').screenshot({ path: join(out, 'film-after-delay.png') });

  const records = log(path);
  const animStart = records.findLast(r => r.type === 'ui_anim_start' && r.version === before + 1)!;
  const animated = Object.keys(animStart.changes as object).sort();
  expect(animated).toEqual(['dish:salmon/salmon:1', 'dish:salmon/salmon:2', 'oven:0/salmon:1']);
  const find = (list: Bar[], key: string) => list.find(b => b.key === key)!;
  const five = 5 * px_per_min;
  for (const key of ['dish:salmon/salmon:1', 'oven:0/salmon:1']) {
    expect(find(barsAfter, key).x).toBe(find(barsBefore, key).x);
    expect(Math.abs(find(barsAfter, key).width - find(barsBefore, key).width - five)).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(find(barsAfter, 'dish:salmon/salmon:2').x - find(barsBefore, 'dish:salmon/salmon:2').x - five)).toBeLessThanOrEqual(1);
  const fixed = barsBefore.filter(b => b.dish_id !== 'salmon');
  expect(fixed.length).toBeGreaterThan(6);
  for (const bar of fixed) expect(find(barsAfter, bar.key), bar.key).toEqual(bar);
  for (const bar of barsAfter) expect([bar.x, bar.width], `${bar.key} drawn = layout`).toEqual([bar.layout_x, bar.layout_width]);
  for (const [key, shot] of unchangedShots) {
    expect(await differingPixels(page, shot, await page.locator(`[data-key="${key}"]`).screenshot()), `${key} pixels`).toBe(0);
  }

  current = await say(page, 'The salmon needs five more minutes.');
  expect(current.last?.tools[0]).toMatchObject({ name: 'report_delay', deduplicated: true, version: before + 1 });
  expect(current.plan!.serve_at_local).toBe('6:35 PM');

  await page.request.post('/api/device', { data: { device: 'dot' } });
  await expect(page.locator('#stage')).toHaveClass(/dot/);
  await page.waitForTimeout(800);
  await page.locator('#stage').screenshot({ path: join(out, 'speaker-mode.png') });
  await page.request.post('/api/device', { data: { device: 'show' } });

  const final = log(path);
  for (let i = 1; i < final.length; i++) expect(final[i].t_ms).toBeGreaterThanOrEqual(final[i - 1].t_ms);
  const drawn = final.filter(r => r.type === 'bars').map(r => r.version as number);
  expect(drawn, 'bar snapshots never go back a version').toEqual([...drawn].sort((a, b) => a - b));
  expect(final.some(r => r.type === 'tts_play_start' && r.kind === 'reply')).toBe(true);
  expect(final.some(r => r.type === 'clock_sync')).toBe(true);
  copyFileSync(path, join(out, 'salmon-delay.sync.jsonl'));
});
