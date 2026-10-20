import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Browser microphone → 16 kHz WAV → host → local Whisper → Strands → MCP. Chromium's fake capture
 * device loops a committed fixture recording; skipped when no local Whisper server is available.
 */
const clip = fileURLToPath(new URL('../../voice/fixtures/01-kitchen.wav', import.meta.url));
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${clip}`] } });

test('a microphone turn is transcribed by Whisper and handled by the agent', async ({ page }) => {
  const ready = (await (await page.request.get('/api/state')).json()).voice.ready;
  test.skip(!ready, 'No local Whisper server (npm run voice:setup)');
  await page.goto('/');
  await page.request.post('/api/take');
  await expect(page.locator('#clock')).toHaveText('5:05 PM');
  const path = (await (await page.request.get('/api/state')).json()).log as string;
  const seconds = (readFileSync(clip).length - 44) / 32000;
  await page.locator('#mic').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-activity', 'listening');
  // Two loops guarantee one complete sentence whatever the fake device's start offset.
  await page.waitForTimeout(Math.round(seconds * 2000) + 300);
  const response = page.waitForResponse(r => r.url().endsWith('/api/voice'));
  await page.locator('#mic').click();
  expect((await response).ok()).toBe(true);
  const state = await (await page.request.get('/api/state')).json();
  expect(state.last.heard.toLowerCase()).toContain('kitchen has one oven');
  expect(state.last.tools.map((t: { name: string }) => t.name)).toContain('set_kitchen');
  await expect(page.locator('#you .heard')).toHaveText('heard by Whisper');
  const types = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line).type);
  for (const type of ['mic_start', 'mic_end', 'ui_submit', 'stt_end', 'tool_return', 'tts_ready']) expect(types).toContain(type);
});
