import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openSession } from '@one-oven/agent/runtime';
import { JsonlTrace } from '@one-oven/agent/trace';
import { parseModelSpec } from '@one-oven/agent/config';
import { voiceEngines } from './config.js';
import { VoiceLoop } from './loop.js';
import { SoxPlayer } from './audio/play.js';
import { startRecording } from './audio/record.js';
const spec = parseModelSpec();
if (spec.provider !== 'scripted' && (spec.provider !== 'openai' || spec.baseUrl !== 'http://127.0.0.1:10100/v1')) throw new Error('S3 voice uses only the authorized local model endpoint');
const run = `voice-${Date.now()}`, directory = join('runs', run);
const runtime = await openSession({ ...process.env, AGENT_VOICE_MODE: '1' }, run);
const trace = new JsonlTrace(join(directory, 'voice.jsonl'));
const loop = new VoiceLoop({ session: runtime.session, ...voiceEngines(), player: new SoxPlayer(), trace });
const input = createInterface({ input: stdin, output: stdout });
let recording: Awaited<ReturnType<typeof startRecording>> | undefined;
let count = 0;
try {
  await runtime.session.prepare();
  console.log('One Oven voice. Enter starts/stops recording; :mark notes recording_t0 when screen capture starts; :quit exits. Local recordings are saved under ' + directory);
  while (true) {
    const answer = await input.question('Enter to record > ');
    if (answer === ':quit') break;
    if (answer === ':mark') { trace.mark('recording_t0'); console.log('Marked recording_t0'); continue; }
    await loop.flush();
    recording = await startRecording();
    trace.write({ type: 'mic_start' });
    await input.question('Listening. Enter to finish > ');
    const clip = await recording.stop(); recording = undefined;
    trace.write({ type: 'mic_end' });
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, `user-${++count}.wav`), clip.wav);
    await runtime.serverClock?.sync();
    try { const result = await loop.accept(clip); console.log(`You: ${result.transcript}\nOne Oven: ${result.turn.reply}`); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Voice turn failed'); }
  }
} finally {
  input.close(); await recording?.cancel();
  try { await loop.close(); } finally { await runtime.session.close(); }
}
