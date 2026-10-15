import { TranscribeStreamingClient, StartStreamTranscriptionCommand, type StartStreamTranscriptionCommandOutput } from '@aws-sdk/client-transcribe-streaming';
import { clipPcm, type AudioClip } from '../audio/clip.js';
import type { SttEngine } from './index.js';
type Sender = { send(command: StartStreamTranscriptionCommand): Promise<StartStreamTranscriptionCommandOutput> };
export class TranscribeStt implements SttEngine {
  private client?: Sender;
  constructor(readonly config: { region?: string; vocabularyName?: string; allowAws?: boolean } = {}, client?: Sender) { this.client = client; }
  async transcribe(audio: AudioClip, _hints: string[] = []) {
    if (!this.client && !this.config.allowAws) throw new Error('AWS voice calls are disabled; use VOICE_STT=whisper');
    this.client ??= new TranscribeStreamingClient({ region: this.config.region, maxAttempts: 1 });
    const pcm = clipPcm(audio), at = performance.now();
    async function* chunks() {
      for (let offset = 0; offset < pcm.length; offset += 3200) yield { AudioEvent: { AudioChunk: pcm.subarray(offset, offset + 3200) } };
    }
    // Transcribe uses a provisioned vocabulary name, not arbitrary inline hints.
    const response = await this.client.send(new StartStreamTranscriptionCommand({ LanguageCode: 'en-US', MediaEncoding: 'pcm',
      MediaSampleRateHertz: 16000, AudioStream: chunks(), VocabularyName: this.config.vocabularyName }));
    const finals = new Map<string, string>();
    for await (const event of response.TranscriptResultStream ?? []) {
      for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
        if (!result.IsPartial && result.ResultId) finals.set(result.ResultId, result.Alternatives?.[0]?.Transcript ?? '');
      }
    }
    return { text: [...finals.values()].join(' ').trim(), ms: performance.now() - at };
  }
}
