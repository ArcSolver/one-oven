import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HostState } from '../src/shared/api.js';
import type { StepView } from '../src/shared/timeline.js';

/**
 * One recorded film take of salmon-delay: the 1600×704 film frame is captured by Playwright while
 * the scenario beats are typed through the UI's own text path (`__sim.say`, so the dock never covers
 * the frame). A sync marker is pressed after recording starts and again at the end. Every turn
 * carries its scenario beat, so the take's trace can be matched beat by beat like a runner trace.
 * Skipped unless SIM_FILM_OUT names an output directory:
 *   SIM_FILM_OUT=runs/film-take npm run sim:e2e -- film-take
 * SIM_FILM_FOOTER=0 records with `footer=0` (no bottom notice or tool strip in the frame).
 */
const outDir = process.env.SIM_FILM_OUT;
const url = process.env.SIM_FILM_FOOTER === '0' ? '/?film=1&footer=0' : '/?film=1';
const frame = { width: 1600, height: 704 };
type Record = { seq: number; t_ms: number; type: string; [key: string]: unknown };
const spoken = (step: StepView) => step.source === 'preheat' ? 'oven preheat'
  : step.source === 'transition' ? 'oven temperature change' : (step.dish_id ?? 'oven').replaceAll('-', ' ');
const log = (path: string): Record[] => readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));

test('film take: salmon delay on the screen device, recorded at 1600x704', async ({ browser }) => {
  test.skip(!outDir, 'Set SIM_FILM_OUT to record a film take');
  test.setTimeout(900000);
  const out = resolve(outDir!);
  mkdirSync(out, { recursive: true });
  const context = await browser.newContext({ viewport: frame, deviceScaleFactor: 1, recordVideo: { dir: join(out, 'video'), size: frame } });
  const page = await context.newPage();
  const state = async (): Promise<HostState> => (await page.request.get('/api/state')).json();
  let path = '';
  const after = (seq: number, type: string, match: (r: Record) => boolean = () => true) => log(path).find(r => r.seq > seq && r.type === type && match(r));
  const lastSeq = () => log(path).at(-1)!.seq;
  /** Let replies and timer announcements finish so the recording paces like a cook would. */
  const settle = async (seq: number, kinds: string[]) => {
    for (const kind of kinds) {
      const ready = log(path).filter(r => r.seq > seq && r.type === 'tts_ready' && r.kind === kind);
      for (const r of ready) await expect.poll(() => !!after(seq, 'tts_play_end', x => x.id === r.id), { timeout: 30000 }).toBe(true);
    }
    await page.waitForTimeout(700);
  };
  const say = async (utterance: string, beat: string, iteration?: number): Promise<HostState> => {
    const seq = lastSeq();
    await page.evaluate(([u, b, i]) => (window as unknown as { __sim: { say: (u: string, l: object) => Promise<void> } })
      .__sim.say(u as string, i === null ? { beat: b } : { beat: b, iteration: i }), [utterance, beat, iteration ?? null] as const);
    await expect.poll(() => !!after(seq, 'turn_end') || !!after(seq, 'turn_error'), { timeout: 30000 }).toBe(true);
    expect(after(seq, 'turn_error'), utterance).toBeUndefined();
    await expect.poll(() => !!after(seq, 'tts_ready', r => r.kind === 'reply'), { timeout: 30000 }).toBe(true);
    await settle(seq, ['reply']);
    return state();
  };
  const clock = async (body: object): Promise<HostState> => {
    const seq = lastSeq();
    expect((await page.request.post('/api/clock', { data: body })).ok()).toBe(true);
    await page.waitForTimeout(600);
    await settle(seq, ['timer']);
    return state();
  };
  const marker = async () => {
    const seq = lastSeq();
    await page.keyboard.press('M');
    await expect.poll(() => !!after(seq, 'sync_marker', r => r.phase === 'off'), { timeout: 10000 }).toBe(true);
  };
  /** Runner rule for `advance_to: next_event` beats: confirm the step that just ended, else ask what's next. */
  const cook = async (beat: string, until: (s: HostState) => boolean, stopAt?: number) => {
    let current = await state();
    for (let i = 1; i <= 40 && !until(current); i++) {
      const times = current.plan!.steps.filter(s => s.status !== 'done').map(s => (s.status === 'running' ? s.end : s.start) * 60000);
      const target = Math.max(current.clock.now, Math.min(...times));
      if (stopAt !== undefined && target > stopAt) { await clock({ at: '18:20' }); break; }
      current = await clock({ to: 'next' });
      const now = current.clock.now / 60000;
      const done = current.plan!.steps.filter(s => s.status === 'running' && s.end <= now)
        .sort((a, b) => a.end - b.end || a.step_id.localeCompare(b.step_id))[0];
      current = await say(done ? `I'm done with the ${spoken(done)}. What's next?` : "What's next?", beat, i);
    }
    return state();
  };

  await page.goto(url);
  await page.request.post('/api/take');
  await expect(page.locator('#clock')).toHaveText('5:05 PM');
  path = (await state()).log;
  await expect.poll(() => log(path).some(r => r.type === 'clock_sync') && log(path).some(r => r.type === 'ui_hello'), { timeout: 10000 }).toBe(true);
  await page.waitForTimeout(1000);
  await marker();
  await page.waitForTimeout(1000);

  await say('My kitchen has one oven, four burners, and one cook.', 'kitchen');
  let current = await say('I want salmon, rice and green beans on the table at 6:30 PM.', 'plan');
  expect(current.plan?.serve_at_local).toBe('6:30 PM');
  current = await cook('roast', () => false, Date.parse('2026-10-15T18:20:00-05:00'));
  expect(current.clock.local).toBe('6:20 PM');
  expect(current.plan!.steps.find(s => s.step_id === 'salmon:1')?.status).toBe('running');
  const before = current.plan!.version;
  await page.waitForTimeout(1500);
  await page.locator('#stage').screenshot({ path: join(out, 'still-before-delay.png') });

  const seq = lastSeq();
  current = await say('The salmon needs five more minutes.', 'delay');
  expect(current.plan!.version).toBe(before + 1);
  expect(current.plan!.serve_at_local).toBe('6:35 PM');
  await expect.poll(() => !!after(seq, 'ui_anim_end', r => r.version === before + 1), { timeout: 10000 }).toBe(true);
  await page.waitForTimeout(2500);
  await page.locator('#stage').screenshot({ path: join(out, 'still-after-delay.png') });
  const animated = Object.keys(after(seq, 'ui_anim_start', r => r.version === before + 1)!.changes as object).sort();
  expect(animated).toEqual(['dish:salmon/salmon:1', 'dish:salmon/salmon:2', 'oven:0/salmon:1']);

  current = await say('The salmon needs five more minutes.', 'delay-again');
  expect(current.last?.tools[0]).toMatchObject({ name: 'report_delay', deduplicated: true, version: before + 1 });
  await page.waitForTimeout(1500);

  // Same device pattern as the step-8 runner take: voice-only speaker from beat `finish`.
  expect((await page.request.post('/api/device', { data: { device: 'dot' } })).ok()).toBe(true);
  await expect(page.locator('#stage')).toHaveClass(/dot/);
  await page.waitForTimeout(1200);
  current = await cook('finish', s => s.plan!.steps.every(x => x.status === 'done'));
  expect(current.plan!.steps.every(s => s.status === 'done')).toBe(true);
  expect(current.plan!.serve_at_local).toBe('6:35 PM');
  expect(current.last?.reply).toContain('meal is ready');
  await page.waitForTimeout(1500);
  await marker();
  await page.waitForTimeout(1000);

  const video = page.video()!;
  await context.close();
  const final = log(path);
  const start = final.find(r => r.type === 'take_start')!;
  writeFileSync(join(out, 'take.json'), JSON.stringify({ sync_log: path, trace: start.trace, take: start.take, video: await video.path(),
    url, frame, markers: final.filter(r => r.type === 'sync_marker').map(r => ({ phase: r.phase, ui_t_ms: r.ui_t_ms })),
    plan_versions: { before_delay: before, after_delay: before + 1, final: current.plan!.version } }, null, 2) + '\n');
});

test('film footer option hides only the bottom notice and tool strip', async ({ page }) => {
  const box = async (selector: string) => page.locator(selector).boundingBox();
  await page.goto('/?film=1');
  await expect(page.locator('.bottom')).toBeVisible();
  const shown = { ros: await box('#ros'), screen: await box('.screen'), marker: await box('#marker') };
  await page.goto('/?footer=0');
  await expect(page.locator('.bottom')).toBeVisible();
  await page.goto('/?film=1&footer=0');
  await expect(page.locator('.bottom')).toBeHidden();
  await expect(page.locator('.honesty')).toBeHidden();
  await expect(page.locator('#tools')).toBeHidden();
  expect({ ros: await box('#ros'), screen: await box('.screen'), marker: await box('#marker') }).toEqual(shown);
  // A new take writes a new sync log, and the page describes itself there again.
  const { log: path } = (await (await page.request.post('/api/take')).json()) as HostState;
  await expect.poll(() => log(path).find(r => r.type === 'ui_hello')?.footer, { timeout: 10000 }).toBe(false);
});
