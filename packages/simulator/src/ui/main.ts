import type { HostEvent, HostState, PlanState, Speech, ToolCallView } from '../shared/api.js';
import { focus, type StepView } from '../shared/timeline.js';
import { Microphone, Speaker } from './audio.js';
import { flush, syncClocks, uilog } from './log.js';
import { dishName, LAYOUT, RunOfShow } from './runofshow.js';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const params = new URLSearchParams(location.search);
const film = params.has('film') && params.get('film') !== '0';
/** `footer=0` (film only) hides the bottom notice and tool strip; the video carries the notice instead. */
const footer = !(film && params.get('footer') === '0');
document.body.classList.toggle('film', film);
document.body.classList.toggle('no-footer', !footer);
const stage = $('#stage');
let state: HostState | undefined;
let busy = false;
let speaking = false;
let liveTools: ToolCallView[] = [];
/** Take whose sync log has this page's clock pairing and ui_hello. */
let greeted: string | undefined;
const fmt = (minute: number) => new Intl.DateTimeFormat('en-US', { timeZone: state?.timezone ?? 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(minute * 60000);
const ros = new RunOfShow($('#ros'), fmt);
const speaker = new Speaker(active => { speaking = active; activity(); });
const mic = new Microphone();
const sim = { get state() { return state; }, bars: [] as unknown[], film, footer,
  /** Same path as typing in the dock; scripted takes use it so the dock stays out of the recorded frame. */
  say: (utterance: string, label?: { beat?: string; iteration?: number }) => say(utterance, label) };
Object.assign(window, { __sim: sim });

function activity(): void {
  stage.dataset.activity = mic.active ? 'listening' : speaking ? 'speaking' : busy ? 'thinking' : 'idle';
}
function text(selector: string, value: string): void { const el = $(selector); if (el.textContent !== value) el.textContent = value; }
const minutesLeft = (minute: number) => Math.round(minute - (state?.clock.now ?? 0) / 60000);
const owner = (step: StepView) => step.dish_id ? dishName(step.dish_id) : `Oven ${(step.oven ?? 0) + 1}`;

function renderCards(plan?: PlanState): void {
  const { current, also, next } = focus(plan?.steps ?? []);
  if (!plan) {
    text('#now-text', "Tell me about your kitchen, then what's for dinner.");
    text('#now-meta', ''); $('#now-also').replaceChildren(); text('#next-text', '—'); text('#next-at', ''); return;
  }
  if (current) {
    const left = minutesLeft(current.end);
    text('#now-text', current.text);
    const meta = $('#now-meta');
    meta.replaceChildren(`${owner(current)} · until ${fmt(current.end)} · `);
    const span = document.createElement('span');
    span.textContent = left > 0 ? `${left} min left` : 'time is up · say when it is done';
    if (left <= 0) span.className = 'late';
    meta.append(span);
  } else {
    text('#now-text', plan.steps.every(s => s.status === 'done') ? 'Dinner is ready.' : next ? 'Waiting for the next step.' : '—');
    text('#now-meta', next ? `${owner(next)} starts at ${fmt(next.start)}` : '');
  }
  $('#now-also').replaceChildren(...also.slice(0, 3).map(step => {
    const li = document.createElement('li');
    const time = document.createElement('span'); time.className = 'mono'; time.textContent = `until ${fmt(step.end)}`;
    li.append(`Also: ${step.text.replace(/\.$/, '')} · `, time);
    return li;
  }));
  text('#next-text', next ? next.text : plan.steps.some(s => s.status !== 'done') ? 'Nothing else is waiting.' : '—');
  text('#next-at', next ? `${fmt(next.start)} · ${owner(next)}` : '');
}
function renderTools(calls: ToolCallView[]): void {
  const shown = (calls.some(c => c.name !== 'list_dishes') ? calls.filter(c => c.name !== 'list_dishes') : calls).slice(-2);
  const host = $('#tool-calls');
  if (!shown.length) { host.textContent = busy ? '…' : '—'; return; }
  const nodes: (Node | string)[] = [];
  const span = (className: string, value: string) => Object.assign(document.createElement('span'), { className, textContent: value });
  shown.forEach((call, i) => {
    if (i) nodes.push('   ·   ');
    nodes.push(call.name, '{');
    const args = Object.entries((call.args ?? {}) as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined);
    args.forEach(([key, value], j) => {
      if (j) nodes.push(', ');
      const shortId = typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(value) ? `${value.slice(0, 4)}…` : value;
      nodes.push(span('arg', `${key}: `), span(typeof shortId === 'string' ? 'str' : '', JSON.stringify(shortId)));
    });
    nodes.push('} ', call.ok ? span('ok', `✓${call.version !== undefined ? ` v${call.version}` : ''}${call.deduplicated ? ' · deduplicated' : ''}`)
      : span('bad', `✗ ${call.error_code ?? 'error'}`));
  });
  host.replaceChildren(...nodes);
  const pill = $('#tools'); pill.classList.remove('fresh'); void pill.offsetWidth; pill.classList.add('fresh');
}
function logBars(plan: PlanState, reason: string, changes: Record<string, string>): void {
  const axis = ros.plan.axis!;
  const track = ros.trackRect(stage);
  const bars = ros.measure(stage);
  sim.bars = bars;
  uilog('bars', { plan_id: plan.plan_id, version: plan.version, reason, serve_at_local: plan.serve_at_local, changes,
    axis: { start: axis.start, end: axis.end, start_local: fmt(axis.start), end_local: fmt(axis.end), track_x0: track.x0,
      track_width: track.width, px_per_min: LAYOUT.trackWidth / (axis.end - axis.start) },
    stage: { width: stage.offsetWidth, height: stage.offsetHeight, film, footer }, bars });
}
function applyPlan(plan?: PlanState): void {
  const before = ros.plan;
  const result = ros.render(plan);
  renderCards(plan);
  if (!plan || !result) return;
  ros.setNow((state?.clock.now ?? 0) / 60000);
  const changes = Object.fromEntries(result.changes);
  const moving = [...result.changes.values()].some(c => c !== 'status');
  const reason = result.rebuilt ? 'first_draw' : result.extended ? 'axis_extended' : 'version';
  if (!result.rebuilt && moving) uilog('ui_anim_start', { plan_id: plan.plan_id, version: plan.version, from_version: before.version, changes });
  void result.finished.then(() => {
    if (!result.rebuilt && moving) uilog('ui_anim_end', { plan_id: plan.plan_id, version: plan.version });
    // A newer version drawn meanwhile owns the screen; never log its rectangles under this version.
    requestAnimationFrame(() => { if (ros.plan.plan_id === plan.plan_id && ros.plan.version === plan.version) logBars(plan, reason, changes); });
  });
  if (before.version !== undefined && before.plan_id === plan.plan_id) {
    const badge = $('#version'); badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
  }
}
/** SSE events and HTTP responses can arrive out of order; within a take the plan and clock only move forward. */
function newest(next: HostState): HostState {
  if (!state || state.session !== next.session) return next;
  const plan = state.plan && next.plan && state.plan.plan_id === next.plan.plan_id && state.plan.version > next.plan.version ? state.plan : next.plan;
  const clock = state.clock.now > next.clock.now ? state.clock : next.clock;
  return { ...next, plan, clock };
}
function applyState(incoming: HostState): void {
  const next = newest(incoming);
  const previousServe = state?.plan?.serve;
  const takeChanged = state && state.session !== next.session;
  state = next;
  if (takeChanged) liveTools = [];
  // Also the first state: a take opened while this page loaded never sees a change.
  if (greeted !== next.session) { greeted = next.session; void flush().then(hello); }
  stage.classList.toggle('dot', next.device === 'dot');
  stage.classList.toggle('show', next.device === 'show');
  document.querySelectorAll<HTMLButtonElement>('[data-device]').forEach(b => b.classList.toggle('active', b.dataset.device === next.device));
  text('#clock', next.clock.local);
  text('#version-value', next.plan ? `v${next.plan.version}` : '—');
  text('#serve', next.plan?.serve_at_local ?? '—');
  if (previousServe !== undefined && next.plan && previousServe !== next.plan.serve) {
    const serve = $('.serve'); serve.classList.remove('bump'); void serve.offsetWidth; serve.classList.add('bump');
  }
  const dishes = next.plan?.dish_ids.map(dishName).join(', ');
  text('#subtitle', next.device === 'dot' ? 'Voice-only speaker' : dishes ? `Run of show · ${dishes}` : 'Alexa+ kitchen planner');
  applyPlan(next.plan);
  ros.setNow(next.clock.now / 60000);
  renderCards(next.plan);
  if (next.last && !busy) {
    text('#you', next.last.utterance || '—');
    const reply = $('#reply');
    reply.textContent = next.last.error ? `(${next.last.error})` : next.last.reply ?? '—';
    if (next.last.heard !== undefined) $('#you').append(Object.assign(document.createElement('span'), { className: 'heard', textContent: 'heard by Whisper' }));
    renderTools(next.last.tools.length ? next.last.tools : liveTools);
  } else if (!next.last) { text('#you', '—'); text('#reply', '—'); renderTools([]); }
  text('#status', `${next.model} · voice ${next.voice.stt}/${next.voice.tts}${next.voice.ready ? '' : ' (Whisper not running)'} · take ${next.session}\nsync log ${next.log}`);
  activity();
}
function onEvent(event: HostEvent): void {
  if (event.type === 'state') applyState(event.state);
  else if (event.type === 'speech') void speaker.enqueue(event.speech);
  else if (event.type === 'turn_start') {
    busy = true; liveTools = [];
    if (event.utterance) text('#you', event.utterance);
    text('#reply', '…'); renderTools([]); activity();
  } else if (event.type === 'tool') {
    liveTools.push(event.call);
    renderTools(liveTools);
    if (event.plan && state) {
      const next = newest({ ...state, plan: event.plan });
      state = next;
      applyPlan(next.plan);
      text('#version-value', `v${next.plan!.version}`);
    }
  }
}
async function post<T>(path: string, body?: unknown, type = 'application/json'): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': type },
    body: body instanceof Uint8Array ? new Blob([body as BlobPart], { type }) : body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}
async function turn(path: string, body: unknown, type?: string): Promise<void> {
  if (busy) return;
  busy = true; activity();
  void speaker.unlock();
  try {
    const result = await post<{ state: HostState; speech: Speech[] }>(path, body, type);
    busy = false;
    applyState(result.state);
    for (const speech of result.speech) void speaker.enqueue(speech);
  } catch (error) {
    busy = false;
    text('#reply', `(${error instanceof Error ? error.message : 'failed'})`);
  } finally { busy = false; activity(); }
}
async function say(utterance: string, label: { beat?: string; iteration?: number } = {}): Promise<void> {
  uilog('ui_submit', { input: 'text', utterance, ...label });
  text('#you', utterance);
  await turn('/api/turn', { utterance, ...label });
}
async function toggleMic(): Promise<void> {
  void speaker.unlock();
  if (!mic.active) {
    try { await mic.start(); } catch { text('#reply', '(Microphone unavailable)'); }
    $('#mic').classList.toggle('active', mic.active); activity(); return;
  }
  const wav = await mic.stop();
  $('#mic').classList.remove('active'); activity();
  uilog('ui_submit', { input: 'voice', audio_bytes: wav.length });
  text('#you', '…');
  await turn('/api/voice', wav, 'audio/wav');
}
function marker(): void {
  const el = $('#marker');
  requestAnimationFrame(shown => {
    el.classList.add('on');
    uilog('sync_marker', { phase: 'on' }, shown);
    setTimeout(() => requestAnimationFrame(hidden => { el.classList.remove('on'); uilog('sync_marker', { phase: 'off' }, hidden); }), 250);
  });
}

$('#say-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $<HTMLInputElement>('#say');
  const value = input.value.trim();
  if (!value || busy) return;
  input.value = '';
  void say(value);
});
$('#mic').addEventListener('click', () => void toggleMic());
document.querySelectorAll<HTMLButtonElement>('[data-advance]').forEach(button => button.addEventListener('click', () => {
  const value = button.dataset.advance!;
  void post<HostState>('/api/clock', value === 'next' ? { to: 'next' } : { minutes: Number(value) }).then(applyState).catch(error => text('#status', String(error)));
}));
document.querySelectorAll<HTMLButtonElement>('[data-device]').forEach(button => button.addEventListener('click', () => {
  void post<HostState>('/api/device', { device: button.dataset.device }).then(applyState);
}));
$('#film-toggle').addEventListener('click', () => { params.set('film', film ? '0' : '1'); location.search = params.toString(); });
$('#goto-btn').addEventListener('click', () => {
  void post<HostState>('/api/clock', { at: $<HTMLInputElement>('#goto').value.trim() }).then(applyState).catch(error => text('#status', String(error)));
});
$('#mark').addEventListener('click', marker);
$('#take').addEventListener('click', () => { void post<HostState>('/api/take').then(applyState); });
let spaceDown = false;
document.addEventListener('keydown', event => {
  const typing = (event.target as HTMLElement).tagName === 'INPUT';
  if (event.key === '`') { event.preventDefault(); document.body.classList.toggle('dock-open'); return; }
  if (typing) return;
  if (event.code === 'Space' && !event.repeat && !spaceDown) { event.preventDefault(); spaceDown = true; void toggleMic(); }
  else if (event.key === 'm' || event.key === 'M') marker();
});
document.addEventListener('keyup', event => {
  if (event.code === 'Space' && spaceDown) { event.preventDefault(); spaceDown = false; if (mic.active) void toggleMic(); }
});
document.addEventListener('pointerdown', () => void speaker.unlock(), { once: true });
setInterval(() => { if (state?.plan) { renderCards(state.plan); } }, 15000);

/** Every take writes a new sync log, so pair the clocks and describe the page again. */
async function hello(): Promise<void> {
  await document.fonts.ready;
  await syncClocks();
  const rect = stage.getBoundingClientRect();
  uilog('ui_hello', { film, footer, viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
    stage: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, user_agent: navigator.userAgent });
  await flush();
}
const events = new EventSource('/api/events');
events.onmessage = message => onEvent(JSON.parse(message.data) as HostEvent);
