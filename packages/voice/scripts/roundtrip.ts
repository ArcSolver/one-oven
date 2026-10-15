import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { voiceEngines } from '../src/config.js';
import { COOKING_HINTS } from '../src/stt/index.js';
import { missingIntents } from '../src/intents.js';
const directory = new URL('../fixtures/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')) as { id: string; text: string; intents: string[] }[];
const { stt, sttName } = voiceEngines();
assert.equal(sttName, 'whisper', 'Roundtrip acceptance requires real Whisper, never fixture transcripts');
const rows = [];
for (const fixture of manifest) {
  const result = await stt.transcribe({ wav: await readFile(new URL(`${fixture.id}.wav`, directory)), sampleRate: 16000 }, COOKING_HINTS);
  const missing = missingIntents(result.text, fixture.intents);
  rows.push({ ...fixture, actual: result.text, ms: result.ms, missing, passed: !missing.length });
  console.log(JSON.stringify(rows.at(-1)));
}
const out = process.env.VOICE_REPORT_DIR ?? 'runs/s3-roundtrip'; await mkdir(out, { recursive: true });
await writeFile(`${out}/roundtrip.json`, JSON.stringify({ stt: sttName, model: process.env.WHISPER_MODEL,
  server: process.env.WHISPER_SERVER_URL, hints: COOKING_HINTS, fixtureVoice: 'espeak-ng:en-gb (committed WAVs)', passed: rows.filter(r => r.passed).length, total: rows.length, rows }, null, 2) + '\n');
assert.ok(rows.every(row => row.passed), 'Whisper missed intent words (see roundtrip report)');
