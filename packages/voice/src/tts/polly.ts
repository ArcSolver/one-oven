import { PollyClient, SynthesizeSpeechCommand, type SynthesizeSpeechCommandOutput, type VoiceId } from '@aws-sdk/client-polly';
import { pcmToClip } from '../audio/clip.js';
import type { TtsEngine } from './index.js';
type Sender = { send(command: SynthesizeSpeechCommand): Promise<SynthesizeSpeechCommandOutput> };
export class PollyTts implements TtsEngine {
  readonly voiceId: string;
  private client?: Sender;
  constructor(readonly config: { voice?: VoiceId; region?: string; allowAws?: boolean } = {}, client?: Sender) {
    this.voiceId = `polly:${config.voice ?? 'Joanna'}`; this.client = client;
  }
  async synthesize(text: string) {
    if (!this.client && !this.config.allowAws) throw new Error('AWS voice calls are disabled; use VOICE_TTS=system');
    this.client ??= new PollyClient({ region: this.config.region, maxAttempts: 1 });
    const response = await this.client.send(new SynthesizeSpeechCommand({ Text: text, TextType: 'text', VoiceId: this.config.voice ?? 'Joanna',
      Engine: 'neural', OutputFormat: 'pcm', SampleRate: '16000' }));
    if (!response.AudioStream) throw new Error('Polly returned no audio');
    return pcmToClip(await response.AudioStream.transformToByteArray());
  }
}
