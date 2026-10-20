/**
 * Browser microphone audio → the voice package's clip format: mono, 16 kHz, signed 16-bit PCM WAV
 * (same header as packages/voice/src/audio/clip.ts `pcmToClip`).
 */
export const STT_RATE = 16000;
/** Average-downsample mono float samples to 16 kHz. Input rates must be at least 16 kHz. */
export function downsample(samples: Float32Array, rate: number, target = STT_RATE): Float32Array {
  if (rate === target) return samples;
  if (rate < target) throw new Error('Microphone sample rate is below 16 kHz');
  const ratio = rate / target, length = Math.floor(samples.length / ratio), out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const from = Math.floor(i * ratio), to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to && j < samples.length; j++) sum += samples[j];
    out[i] = sum / (to - from);
  }
  return out;
}
export function encodeWav(samples: Float32Array, rate = STT_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return bytes;
}
