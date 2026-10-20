import express, { type Request, type Response } from 'express';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertSpeech } from '@one-oven/contracts';
import type { OneOvenMcpClient } from '@one-oven/agent/mcp';
import type { openSession } from '@one-oven/agent/runtime';
import type { TimerView } from '@one-oven/agent/host-tools';
import { COOKING_HINTS, stripWakeWord, type SttEngine } from '../../../voice/src/stt/index.js';
import type { TtsEngine } from '../../../voice/src/tts/index.js';
import type { AudioClip } from '../../../voice/src/audio/clip.js';
import type { Device, HostEvent, HostState, PlanState, Speech, TurnView } from '../shared/api.js';
import { SyncLog } from './synclog.js';
import { nextEvent, planFrom, sameDayAt, toolView } from './state.js';

export type Runtime = Awaited<ReturnType<typeof openSession>>;
/** Starts a fresh take: its own MCP server state, Strands session and run directory. */
export interface Backend {
  open(): Promise<{ id: string; dir: string; runtime: Runtime; mcpUrl: string }>;
  close(): Promise<void>;
}
export type SimHostOptions = { backend: Backend; stt: SttEngine; tts: TtsEngine; sttName: string; ttsName: string;
  sttReady: () => Promise<boolean>; timezone: string; chime: Uint8Array };
type Take = { id: string; dir: string; runtime: Runtime; log: SyncLog; turns: number; busy: boolean; plan?: PlanState;
  last?: TurnView; speeches: number; stopTimers: () => void };
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

export function createSimHost(options: SimHostOptions) {
  const router = express.Router();
  const clients = new Set<Response>();
  let take: Take | undefined;
  let voiceReady = false;
  const local = (ms: number) => new Intl.DateTimeFormat('en-US', { timeZone: options.timezone, hour: 'numeric', minute: '2-digit' }).format(ms);
  const current = (): Take => { if (!take) throw new HttpError(503, 'Simulator is starting'); return take; };
  const clockView = (t: Take) => ({ now: t.runtime.session.timers.clock.now(), local: local(t.runtime.session.timers.clock.now()), sim: !!t.runtime.serverClock });
  const state = (): HostState => {
    const t = current();
    return { session: t.id, device: t.runtime.device.deviceClass, timezone: options.timezone, clock: clockView(t),
      model: `${t.runtime.session.provider}:${t.runtime.session.modelId}`, voice: { stt: options.sttName, tts: options.ttsName, ready: voiceReady },
      plan: t.plan, last: t.last, busy: t.busy, log: join(t.dir, 'sync.jsonl') };
  };
  const broadcast = (event: HostEvent) => { for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`); };
  const synthesize = async (t: Take, text: string, kind: Speech['kind'], turn?: number): Promise<Speech> => {
    const at = performance.now();
    const clip = await options.tts.synthesize(text);
    const id = `${t.id}-s${++t.speeches}`;
    t.log.write('tts_ready', { id, turn, kind, text, voice: options.tts.voiceId, synth_ms: Math.round(performance.now() - at),
      audio_ms: Math.round((clip.wav.length - 44) / 32) });
    return { id, text, wav: b64(clip.wav), kind, turn };
  };
  const announce = async (t: Take, timer: TimerView) => {
    let text = `Your ${timer.label.toLowerCase()} timer is done.`;
    try { assertSpeech(text); } catch { text = 'Your cooking timer is done.'; }
    t.log.write('timer_fire', { label: timer.label, ends_at: timer.endsAt, text, sim_now: new Date(t.runtime.session.timers.clock.now()).toISOString() });
    broadcast({ type: 'speech', speech: { id: `${t.id}-chime${++t.speeches}`, text: '', wav: b64(options.chime), kind: 'chime' } });
    broadcast({ type: 'speech', speech: await synthesize(t, text, 'timer') });
  };

  async function openTake(): Promise<void> {
    const previous = take;
    take = undefined;
    if (previous) { previous.stopTimers(); previous.log.write('take_end', {}); }
    await options.backend.close();
    const opened = await options.backend.open();
    const log = new SyncLog(join(opened.dir, 'sync.jsonl'));
    const t: Take = { ...opened, log, turns: 0, busy: false, speeches: 0, stopTimers: () => {} };
    const mcp = opened.runtime.session.opts.mcp as OneOvenMcpClient;
    const inner = mcp.onResult;
    mcp.onResult = call => {
      inner?.(call);
      const before = t.plan;
      t.plan = planFrom(call, t.plan);
      const view = toolView(call);
      log.write('tool_return', { turn: t.turns, ...view, plan_id: t.plan?.plan_id });
      if (t.plan && t.plan !== before) log.write('plan', { turn: t.turns, plan_id: t.plan.plan_id, version: t.plan.version,
        serve_at_local: t.plan.serve_at_local, changed_step_ids: t.plan.changed_step_ids });
      broadcast({ type: 'tool', turn: t.turns, call: view, plan: t.plan });
    };
    const timers = opened.runtime.session.timers;
    const unsubscribe = timers.onFire(timer => { void announce(t, timer).catch(() => log.write('timer_audio_error', { label: timer.label })); });
    timers.start();
    t.stopTimers = () => { unsubscribe(); timers.stop(); };
    voiceReady = await options.sttReady();
    log.write('take_start', { take: t.id, trace: opened.runtime.tracePath, mcp_url: opened.mcpUrl,
      protocol: mcp.protocolVersion, model: `${opened.runtime.session.provider}:${opened.runtime.session.modelId}`,
      device: opened.runtime.device.deviceClass, sim_now: new Date(timers.clock.now()).toISOString(), timezone: options.timezone,
      stt: options.sttName, tts: options.tts.voiceId });
    take = t;
    broadcast({ type: 'state', state: state() });
  }

  async function runTurn(input: { kind: 'text'; utterance: string } | { kind: 'voice'; wav: Uint8Array }) {
    const t = current();
    if (t.busy) throw new HttpError(409, 'A turn is already running');
    t.busy = true;
    const turn = ++t.turns;
    const view: TurnView = { turn, input: input.kind, utterance: input.kind === 'text' ? input.utterance : '', tools: [] };
    t.log.write('turn_start', { turn, input: input.kind, ...(input.kind === 'text' ? { utterance: input.utterance } : { audio_bytes: input.wav.length }) });
    broadcast({ type: 'turn_start', turn, input: input.kind, utterance: view.utterance || undefined });
    try {
      await t.runtime.serverClock?.sync();
      if (input.kind === 'voice') {
        // Kept like `npm run voice` keeps runs/voice-*/user-N.wav: local, ignored by Git.
        writeFileSync(join(t.dir, `user-${turn}.wav`), input.wav, { mode: 0o600 });
        const at = performance.now();
        const heard = await options.stt.transcribe({ wav: input.wav, sampleRate: 16000 } as AudioClip, COOKING_HINTS);
        view.heard = heard.text;
        view.utterance = stripWakeWord(heard.text);
        t.log.write('stt_end', { turn, heard: heard.text, utterance: view.utterance, stt_ms: Math.round(performance.now() - at) });
        if (!view.utterance) throw new HttpError(422, 'No speech recognized; please try again');
      }
      const speeches: Promise<Speech>[] = [];
      const result = await t.runtime.session.turn(view.utterance, text => {
        t.log.write('reply_ready', { turn, text });
        // Synthesis starts on validated final speech while Strands finishes the turn (voice package pattern).
        speeches.push(synthesize(t, text, 'reply', turn));
      });
      Object.assign(view, { reply: result.reply, replySource: result.replySource, tools: result.toolCalls.map(toolView) });
      t.last = view;
      t.log.write('turn_end', { turn, utterance: view.utterance, reply: result.reply, reply_source: result.replySource,
        total_ms: Math.round(result.timings.totalMs), model_ms: Math.round(result.timings.modelMs), tool_ms: Math.round(result.timings.toolMs),
        tools: view.tools.map(c => c.name) });
      const speech = await Promise.all(speeches);
      broadcast({ type: 'state', state: state() });
      return { state: state(), speech };
    } catch (error) {
      view.error = error instanceof HttpError ? error.message : 'The turn did not finish; check the local trace.';
      t.last = view;
      t.log.write('turn_error', { turn, error: view.error });
      broadcast({ type: 'state', state: state() });
      throw error instanceof HttpError ? error : new HttpError(502, view.error);
    } finally { t.busy = false; }
  }

  const handle = (fn: (request: Request) => Promise<unknown> | unknown) => async (request: Request, response: Response) => {
    try { response.json(await fn(request)); }
    catch (error) { response.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Failed' }); }
  };
  router.use('/api', (request, response, next) => {
    const origin = request.headers.origin;
    if (!loopback.includes(request.hostname) || (origin && origin !== `http://${request.headers.host}`)) {
      response.status(403).json({ error: 'Local same-origin simulator only' }); return;
    }
    next();
  });
  router.get('/api/state', handle(() => state()));
  router.get('/api/events', (request, response) => {
    response.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    response.flushHeaders();
    clients.add(response);
    if (take) response.write(`data: ${JSON.stringify({ type: 'state', state: state() })}\n\n`);
    const heartbeat = setInterval(() => response.write(': idle\n\n'), 15000);
    request.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
  });
  router.post('/api/turn', express.json({ limit: '8kb' }), handle(request => {
    const utterance = request.body?.utterance;
    if (typeof utterance !== 'string' || !utterance.trim() || utterance.length > 4000) throw new HttpError(400, 'Utterance required');
    return runTurn({ kind: 'text', utterance: utterance.trim() });
  }));
  router.post('/api/voice', express.raw({ type: 'audio/wav', limit: '4mb' }), handle(request => {
    if (!Buffer.isBuffer(request.body) || request.body.length < 45) throw new HttpError(400, 'Send 16 kHz mono WAV audio');
    return runTurn({ kind: 'voice', wav: new Uint8Array(request.body) });
  }));
  router.post('/api/clock', express.json({ limit: '1kb' }), handle(async request => {
    const t = current();
    const clock = t.runtime.serverClock;
    if (!clock) throw new HttpError(409, 'Simulation clock is disabled');
    if (t.busy) throw new HttpError(409, 'Wait for the current turn');
    await clock.sync();
    const now = clock.now();
    const body = request.body ?? {};
    let target = typeof body.minutes === 'number' ? now + body.minutes * 60000 : body.to === 'next' ? nextEvent(t.plan, now)
      : typeof body.at === 'string' ? sameDayAt(now, body.at, options.timezone) : NaN;
    if (typeof body.until === 'number') target = Math.min(target, body.until);
    if (!Number.isFinite(target) || target < now || target - now > 1440 * 60000) throw new HttpError(400, 'Advance 0–1440 minutes forward');
    const minutes = (target - now) / 60000;
    await clock.advance(minutes);
    t.log.write('clock', { reason: body.to === 'next' ? 'next_event' : body.at ? `at ${body.at}` : 'advance', minutes, sim_now: new Date(clock.now()).toISOString(), sim_local: local(clock.now()) });
    t.runtime.session.timers.poll();
    broadcast({ type: 'state', state: state() });
    return state();
  }));
  router.post('/api/device', express.json({ limit: '1kb' }), handle(request => {
    const device = request.body?.device as Device;
    if (device !== 'show' && device !== 'dot') throw new HttpError(400, 'Device is show or dot');
    const t = current();
    t.runtime.device.deviceClass = device;
    t.log.write('device', { device });
    broadcast({ type: 'state', state: state() });
    return state();
  }));
  router.post('/api/take', handle(async () => {
    if (take?.busy) throw new HttpError(409, 'Wait for the current turn');
    await openTake();
    return state();
  }));
  router.post('/api/ping', handle(() => ({ t_ms: current().log.t() })));
  router.post('/api/uilog', express.json({ limit: '256kb' }), handle(request => {
    const t = current();
    const records = request.body?.records;
    if (!Array.isArray(records) || records.length > 200) throw new HttpError(400, 'records[] required');
    for (const record of records) {
      if (!record || typeof record.type !== 'string' || !/^[a-z_]{2,32}$/.test(record.type)) continue;
      if (record.type === 'clock_sync') { t.log.sync(Number(record.ui_send_ms), Number(record.ui_receive_ms), Number(record.host_t_ms)); continue; }
      const { type, ...fields } = record;
      t.log.write(type, { src: 'ui', ...fields });
    }
    return { ok: true };
  }));
  return {
    router, openTake, state,
    async close() { take?.stopTimers(); take?.log.write('take_end', {}); for (const client of clients) client.end(); await options.backend.close(); },
  };
}
