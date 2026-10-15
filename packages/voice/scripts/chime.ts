import { writeFile } from 'node:fs/promises';
import { pcmToClip } from '../src/audio/clip.js';
// Original two-note sine chime, 0.6 seconds, authored for One Oven (MIT).
const pcm = Buffer.alloc(9600 * 2);
for (let i = 0; i < 9600; i++) pcm.writeInt16LE(Math.trunc(11000 * Math.sin(2 * Math.PI * (i < 4800 ? 660 : 880) * i / 16000)
  * Math.sin(Math.PI * (i % 4800) / 4800) ** 2), i * 2);
await writeFile(new URL('../src/audio/chime.wav', import.meta.url), pcmToClip(pcm).wav);
