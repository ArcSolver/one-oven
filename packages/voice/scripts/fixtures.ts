import { readFile, writeFile } from 'node:fs/promises';
import { SystemTts } from '../src/tts/system.js';
const directory = new URL('../fixtures/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')) as { id: string; text: string }[];
const tts = new SystemTts(process.env.SYSTEM_TTS_VOICE, Number(process.env.SYSTEM_TTS_RATE ?? 155));
for (const fixture of manifest) {
  await writeFile(new URL(`${fixture.id}.wav`, directory), (await tts.synthesize(fixture.text)).wav);
  await writeFile(new URL(`${fixture.id}.txt`, directory), fixture.text + '\n');
}
console.log(`Generated ${manifest.length} original utterance WAVs using ${tts.voiceId}`);
