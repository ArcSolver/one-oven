import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WhisperStt } from '../src/stt/whisper.js';
import { pcmToClip } from '../src/audio/clip.js';
import { missingIntents } from '../src/intents.js';

test('Whisper adapter sends real WAV and common hints to loopback; bad responses never use fixture text', async () => {
  let status = 200, valid = true, requests = 0;
  const server = createServer(async (request, response) => {
    requests++; assert.equal(request.url, '/inference');
    const chunks=[]; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('latin1');
    assert.match(body, /RIFF/); assert.match(body, /name="prompt"/); assert.match(body, /salmon, rice/);
    assert.match(body, /name="audio_ctx"\r\n\r\n0/);
    response.writeHead(status, {'Content-Type':'application/json'});
    response.end(JSON.stringify(valid ? {text:'The salmon needs five more minutes.'} : {}));
  }).listen(0,'127.0.0.1');
  await once(server,'listening'); const address=server.address(); assert.ok(address && typeof address!=='string');
  const stt=new WhisperStt({serverUrl:`http://127.0.0.1:${address.port}`});
  const audio=pcmToClip(new Uint8Array(320));
  try {
    assert.match((await stt.transcribe(audio,['salmon','rice'])).text,/salmon/);
    valid=false; await assert.rejects(()=>stt.transcribe(audio,['salmon','rice']),/Invalid Whisper response/);
    status=503; await assert.rejects(()=>stt.transcribe(audio,['salmon','rice']),/503/);
    assert.equal(requests,3);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('intent grading handles clock suffixes but does not infer missing dishes or counts', () => {
  assert.deepEqual(missingIntents('Salmon at 6.30pm.', ['salmon','6','30']), []);
  assert.deepEqual(missingIntents('four burners and one cook', ['1 oven','4 burners','1 cook']), ['1 oven']);
  assert.deepEqual(missingIntents('cooking marine beans', ['green beans']), ['green beans']);
});
