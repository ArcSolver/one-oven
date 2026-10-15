import { WhisperStt } from './stt/whisper.js';
import { FixtureStt } from './stt/fixture.js';
import { TranscribeStt } from './stt/transcribe.js';
import { SystemTts } from './tts/system.js';
import { SilentTts } from './tts/silent.js';
import { PollyTts } from './tts/polly.js';
export function voiceEngines(env: NodeJS.ProcessEnv = process.env) {
  const sttName = env.VOICE_STT ?? 'whisper', ttsName = env.VOICE_TTS ?? 'system';
  const threads = Number(env.WHISPER_THREADS ?? 4);
  if (!Number.isInteger(threads) || threads < 1 || threads > 64) throw new Error('Invalid WHISPER_THREADS');
  const stt = sttName === 'whisper' ? new WhisperStt({ binary: env.WHISPER_BIN, model: env.WHISPER_MODEL, serverUrl: env.WHISPER_SERVER_URL, threads })
    : sttName === 'fixture' ? new FixtureStt() : sttName === 'transcribe' ? new TranscribeStt({ region: env.AWS_REGION, vocabularyName: env.TRANSCRIBE_VOCABULARY }) : undefined;
  const tts = ttsName === 'system' ? new SystemTts(env.SYSTEM_TTS_VOICE) : ttsName === 'silent' ? new SilentTts()
    : ttsName === 'polly' ? new PollyTts({ region: env.AWS_REGION }) : undefined;
  if (!stt || !tts) throw new Error('VOICE_STT must be whisper|fixture|transcribe and VOICE_TTS system|silent|polly');
  // S3 CLI intentionally has no environment switch that permits real AWS calls.
  return { stt, tts, sttName, ttsName };
}
