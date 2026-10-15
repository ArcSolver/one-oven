import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimClock } from '@one-oven/contracts';
import { AlexaTimerEmulator } from '../src/timers.js';
import { pcmToClip, clipPcm } from '../src/audio/clip.js';
import { stripWakeWord } from '../src/stt/index.js';
import { voiceEngines } from '../src/config.js';
import { PollyTts } from '../src/tts/polly.js';
import { TranscribeStt } from '../src/stt/transcribe.js';

test('timer callbacks fire once, replacement/cancel suppress old deadlines and SimClock notifies immediately', () => {
  const clock = new SimClock(0), timers = new AlexaTimerEmulator(clock), fired: string[] = [];
  timers.onFire(t => fired.push(t.label)); timers.start();
  try {
    timers.set('Salmon', 5); timers.set('Rice', 2); timers.cancel('rice');
    clock.advance(2); timers.set('Salmon', 5); clock.advance(3); assert.deepEqual(fired, []);
    clock.advance(2); timers.poll(); timers.poll(); assert.deepEqual(fired, ['Salmon']);
    timers.set('Salmon', 1); clock.advance(1); assert.deepEqual(fired, ['Salmon', 'Salmon']);
    timers.stop(); timers.set('Beans', 1); clock.advance(1); assert.equal(fired.length, 2);
  } finally { timers.stop(); }
});
test('audio contracts reject invalid formats, wake prefix and config are explicit', () => {
  const pcm = new Uint8Array([1, 2, 3, 4]); assert.deepEqual([...clipPcm(pcmToClip(pcm))], [...pcm]);
  assert.throws(() => clipPcm({ wav: new Uint8Array(44), sampleRate: 16000 }));
  const invalid = pcmToClip(pcm); invalid.wav[24] = 0; assert.throws(() => clipPcm(invalid));
  assert.equal(stripWakeWord(' Alexa, what is next? '), 'what is next?');
  assert.equal(stripWakeWord('Tell Alexa to wait.'), 'Tell Alexa to wait.');
  assert.throws(() => voiceEngines({ VOICE_STT: 'paid-api' }));
  assert.throws(() => voiceEngines({ WHISPER_SERVER_URL: 'https://example.com' }));
});
test('Polly synthesizes PCM through injected client; default cannot make AWS requests', async () => {
  let calls = 0;
  const tts = new PollyTts({}, { async send(command) {
    calls++; assert.equal(command.input.Engine, 'neural'); assert.equal(command.input.SampleRate, '16000');
    assert.equal(command.input.Text, 'Dinner is ready.');
    return { $metadata: {}, AudioStream: { transformToByteArray: async () => new Uint8Array([0, 0]) } as never };
  } });
  assert.equal(clipPcm(await tts.synthesize('Dinner is ready.')).length, 2); assert.equal(calls, 1);
  await assert.rejects(() => new PollyTts().synthesize('Hello.'), /disabled/);
});
test('Transcribe streams PCM chunks, omits partials and deduplicates final results without AWS access', async () => {
  const stt = new TranscribeStt({ vocabularyName: 'cooking' }, { async send(command) {
    assert.equal(command.input.MediaEncoding, 'pcm'); assert.equal(command.input.VocabularyName, 'cooking');
    let bytes = 0; for await (const event of command.input.AudioStream!) bytes += event.AudioEvent?.AudioChunk?.length ?? 0;
    assert.equal(bytes, 6400);
    async function* events() {
      yield { TranscriptEvent: { Transcript: { Results: [{ ResultId: '1', IsPartial: true, Alternatives: [{ Transcript: 'wrong' }] }] } } };
      for (let i = 0; i < 2; i++) yield { TranscriptEvent: { Transcript: { Results: [{ ResultId: '1', IsPartial: false, Alternatives: [{ Transcript: 'The salmon needs five more minutes.' }] }] } } };
    }
    return { $metadata: {}, TranscriptResultStream: events() };
  } });
  assert.equal((await stt.transcribe(pcmToClip(new Uint8Array(6400)))).text, 'The salmon needs five more minutes.');
  await assert.rejects(() => new TranscribeStt().transcribe(pcmToClip(new Uint8Array(2))), /disabled/);
});
