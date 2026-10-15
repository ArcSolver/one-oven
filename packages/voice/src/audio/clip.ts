/** All adapters exchange mono, 16 kHz, signed 16-bit PCM in a WAV container. */
export type AudioClip = { wav: Uint8Array; sampleRate: 16000; sourcePath?: string };
export function pcmToClip(pcm: Uint8Array): AudioClip {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  wav.set(pcm, 44);
  return { wav, sampleRate: 16000 };
}
export function clipPcm(clip: AudioClip): Uint8Array {
  const wav = Buffer.from(clip.wav);
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected WAV audio');
  let valid = false, pcm: Uint8Array | undefined;
  for (let at = 12; at + 8 <= wav.length;) {
    const name = wav.toString('ascii', at, at + 4), length = wav.readUInt32LE(at + 4), start = at + 8;
    if (start + length > wav.length) throw new Error('Truncated WAV');
    if (name === 'fmt ') valid = length >= 16 && wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1
      && wav.readUInt32LE(start + 4) === 16000 && wav.readUInt16LE(start + 14) === 16;
    if (name === 'data') pcm = wav.subarray(start, start + length);
    at = start + length + (length % 2);
  }
  if (!valid || !pcm || pcm.length % 2) throw new Error('Expected mono 16 kHz PCM16 WAV');
  return pcm;
}
