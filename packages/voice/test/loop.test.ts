import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimClock } from '@one-oven/contracts';
import { MemoryTrace } from '@one-oven/agent/trace';
import { AlexaTimerEmulator } from '../src/timers.js';
import { VoiceLoop, type VoiceSession } from '../src/loop.js';
import { pcmToClip } from '../src/audio/clip.js';
import { SilentTts } from '../src/tts/silent.js';
import type { TurnResult } from '@one-oven/agent';
import type { AudioPlayer } from '../src/audio/play.js';

test('timer speaks with chime without calling session; queue serializes simultaneous alerts and cleans up', async () => {
  const clock = new SimClock(0), timers = new AlexaTimerEmulator(clock), trace = new MemoryTrace();
  let turnCalls = 0, active = 0, maxActive = 0, played = 0;
  const player: AudioPlayer = { async play(_clip, start) { active++; maxActive = Math.max(maxActive,active);
    await new Promise(r => setTimeout(r,2)); start?.({startMs: performance.now(), kind:'silent'}); played++; active--; } };
  const session: VoiceSession = { timers, opts: { clock }, async turn() { turnCalls++; throw new Error('Should not call MCP'); } };
  const loop = new VoiceLoop({ session, stt: { async transcribe() { throw new Error('Unused'); } }, tts: new SilentTts(), player, trace });
  timers.set('Salmon',1); timers.set('Rice',1); clock.advance(1); await loop.flush();
  assert.equal(turnCalls,0); assert.equal(played,4); assert.equal(maxActive,1);
  const fires = trace.records.filter(r=>r.type==='timer_fire'); assert.equal(fires.length,2);
  assert.equal(fires[0].text,'Your salmon timer is done.'); assert.equal(fires[0].latenessMs,0);
  await loop.close(); timers.set('Beans',1); clock.advance(1); await loop.flush(); assert.equal(played,4);
});
test('voice rejects empty STT and concurrent input; validated final speech starts synthesis before turn settles', async () => {
  const clock = new SimClock(0), timers = new AlexaTimerEmulator(clock), trace = new MemoryTrace();
  let transcribed = 'Alexa, what is next?', synthesized = false;
  const result = { reply:'Dinner is ready.', timings:{ modelMs:1, toolMs:1, totalMs:2 } } as TurnResult;
  const session: VoiceSession = { timers, opts: {clock}, async turn(text,onSpeech) {
    assert.equal(text,'what is next?'); onSpeech?.('Dinner is ready.');
    await new Promise(r=>setTimeout(r,2)); assert.equal(synthesized,true); return result;
  } };
  const loop = new VoiceLoop({session,trace, stt:{async transcribe(){ return {text:transcribed,ms:0}; }},
    tts:{voiceId:'test',async synthesize(){synthesized=true; return pcmToClip(new Uint8Array(2));}},
    player:{async play(_clip,start){ start?.({startMs:performance.now(),kind:'silent'}); }} });
  try {
    const running = loop.accept(pcmToClip(new Uint8Array(2)));
    await assert.rejects(()=>loop.accept(pcmToClip(new Uint8Array(2))),/running/);
    assert.equal((await running).timings.playbackKind,'silent');
    transcribed=' '; await assert.rejects(()=>loop.accept(pcmToClip(new Uint8Array(2))),/No speech/);
  } finally {await loop.close();}
});
test('timer output failures are reported and do not break subsequent queue jobs', async () => {
  const clock = new SimClock(0), timers = new AlexaTimerEmulator(clock), trace = new MemoryTrace(); let attempts=0;
  const loop=new VoiceLoop({session:{timers,opts:{clock},async turn(){throw new Error('Unused');}},trace,
    stt:{async transcribe(){throw new Error('Unused');}},tts:new SilentTts(),player:{async play(_clip,start){
      if (++attempts===1) throw new Error('No device'); start?.({startMs:performance.now(),kind:'silent'});
    }}});
  timers.set('Salmon',1); timers.set('Rice',1); clock.advance(1);
  await assert.rejects(()=>loop.flush(),/Timer audio failed/); assert.ok(trace.records.some(r=>r.type==='timer_audio_error'));
  assert.ok(trace.records.some(r=>r.type==='timer_fire' && r.label==='Rice')); await loop.close();
});
