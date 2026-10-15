import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipPcm, type AudioClip } from './clip.js';
export async function startRecording(): Promise<{ stop(): Promise<AudioClip>; cancel(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'one-oven-mic-'));
  const path = join(directory, 'microphone.wav');
  const child = spawn('rec', ['-q', '-r', '16000', '-c', '1', '-b', '16', '-e', 'signed-integer', path, 'trim', '0', '60'], { stdio: 'ignore' });
  let error: Error | undefined;
  const closed = new Promise<void>(resolve => { child.on('error', e => { error = e; resolve(); }); child.on('close', code => { if (code && code !== 130) error ??= new Error(`Recording failed (${code}); check the microphone`); resolve(); }); });
  return {
    async stop() {
      child.kill('SIGINT');
      try { await closed; if (error) throw error; const clip: AudioClip = { wav: await readFile(path), sampleRate: 16000 }; clipPcm(clip); return clip; }
      finally { await rm(directory, { recursive: true, force: true }); }
    },
    async cancel() { child.kill('SIGKILL'); await closed; await rm(directory, { recursive: true, force: true }); },
  };
}
