import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseModelSpec } from '@one-oven/agent/config';
import { createModel } from '@one-oven/agent/models';
import { JsonlTrace, MemoryTrace, type TraceRecord } from '@one-oven/agent/trace';
import { runWeekday } from '../../agent/test/weekday.js';
import { VoiceLoop, type VoiceResult } from '../src/loop.js';
import { voiceEngines } from '../src/config.js';
import { FilePlayer } from '../src/audio/play.js';
import { SystemTts } from '../src/tts/system.js';

export async function runVoiceDemo(options: { speed: number; directory: string; env?: NodeJS.ProcessEnv; instant?: boolean }) {
  const env = options.env ?? process.env;
  const spec = parseModelSpec({ ...env, AGENT_MODEL: env.AGENT_MODEL ?? 'scripted:weekday-3' });
  if (spec.provider !== 'scripted' && (spec.provider !== 'openai' || spec.baseUrl !== 'http://127.0.0.1:10100/v1')) throw new Error('Voice demo allows only scripted or the authorized local endpoint');
  if (!Number.isFinite(options.speed) || options.speed <= 0 || options.speed > 600) throw new Error('Speed must be 0 < speed <= 600');
  await mkdir(options.directory, { recursive: true });
  const memory = new MemoryTrace(), file = new JsonlTrace(join(options.directory, 'trace.jsonl'));
  const trace = { write(record: TraceRecord) { memory.write(record); file.write(record); } };
  const engines = voiceEngines(env), fixtureTts = new SystemTts();
  const voiceTurns: VoiceResult[] = [];
  let loop: VoiceLoop;
  const started = performance.now();
  const result = await runWeekday(createModel(spec, env), spec.provider, trace, true, {
    async session(session) {
      await session.prepare();
      loop = new VoiceLoop({ session, ...engines, trace, player: new FilePlayer(join(options.directory, 'output')) });
    },
    async turn(_session, text) {
      const directory = join(options.directory, 'input'); await mkdir(directory, { recursive: true });
      const path = join(directory, `${createHash('sha256').update(text).digest('hex').slice(0, 12)}.wav`);
      // Completion phrases quote the live step text; only the user WAV generator reads it.
      // The tested model still has to select the tool/ID from the recognized utterance.
      const fixture = text.startsWith('My kitchen') ? '01-kitchen' : text.startsWith('I want salmon') ? '02-meal'
        : text === "What's next?" ? '03-next' : text === 'The salmon needs five more minutes.' ? '04-delay' : undefined;
      const fixtureUrl = fixture ? new URL(`../fixtures/${fixture}.wav`, import.meta.url) : undefined;
      const stepText = text.startsWith("I've finished this step:") ? text.slice("I've finished this step:".length) : undefined;
      const subject = !stepText ? undefined : /salmon/i.test(stepText) ? 'salmon' : /rice/i.test(stepText) ? 'rice' : /beans/i.test(stepText) ? 'green beans' : 'oven';
      const spoken = subject ? `The ${subject} step is finished. What is next?` : fixture ? (await readFile(new URL(`../fixtures/${fixture}.txt`, import.meta.url), 'utf8')).trim() : text;
      const clip = fixtureUrl ? { wav: await readFile(fixtureUrl), sampleRate: 16000 as const } : await fixtureTts.synthesize(spoken);
      await writeFile(path, clip.wav); await writeFile(path.replace(/\.wav$/, '.txt'), spoken + '\n');
      const output = await loop.accept({ ...clip, sourcePath: path }); voiceTurns.push(output);
      console.log(JSON.stringify({ transcript: output.transcript, reply: output.turn.reply, timings: output.timings }));
      return output.turn;
    },
    async advance(clock, target) {
      // Simulation pauses during STT/model/TTS work. Only idle cooking time accelerates.
      while (clock.now() < target) {
        const delta = Math.min(target - clock.now(), 500 * options.speed);
        if (!options.instant) await sleep(delta / options.speed);
        clock.set(clock.now() + delta); await loop.flush();
      }
      await loop.flush();
    },
    async close() { await loop?.close(); },
  });
  const fires = memory.records.filter(r => r.type === 'timer_fire');
  assert.ok(fires.length > 0, 'Timers must produce speech');
  assert.ok(fires.every(r => Math.abs(Number(r.latenessMs)) <= 60000), 'Timer speech must be within one simulated minute');
  const report = { passed: true, stt: engines.sttName, tts: engines.ttsName, provider: spec.provider, model: spec.modelId,
    speed: options.speed, instant: options.instant ?? false, clockPolicy: 'accelerated idle time; paused during turns and output',
    playback: 'file-ready (headless, no speaker measurement)', turns: voiceTurns.length, timerFires: fires.length,
    maxTimerLatenessMs: Math.max(...fires.map(r => Number(r.latenessMs))), finalVersion: result.final.version,
    completedSteps: result.final.steps.length, serveAt: new Date(result.final.serve * 60000).toISOString(),
    totalMs: performance.now() - started, timings: voiceTurns.map(t => t.timings) };
  await writeFile(join(options.directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1]?.endsWith('/demo.ts')) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  if ((arg('--scenario') ?? 'weekday-3') !== 'weekday-3') throw new Error('S3 demo supports weekday-3; other scenarios belong to S4');
  const report = await runVoiceDemo({ speed: Number(arg('--speed') ?? 60), directory: process.env.VOICE_REPORT_DIR ?? `runs/s3-voice-${Date.now()}` });
  console.log(JSON.stringify(report, null, 2));
}
