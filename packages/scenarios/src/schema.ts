import { z } from 'zod';

/** Local wall-clock time on the scenario date, in the scenario timezone. */
const LocalTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const ScenarioId = z.enum(['weekday-3', 'thanksgiving-8', 'salmon-delay', 'swap']);
export const UiMode = z.enum(['inline', 'fullscreen', 'dot']);

/** Tool arguments may reference IDs returned earlier with "$kitchen" and "$plan". */
export const ExpectedTool = z.object({ name: z.string().min(1), args: z.record(z.string(), z.unknown()).optional() }).strict();
export const StateExpectation = z.object({
  serve_local: z.string().optional(),
  changed_steps: z.array(z.string()).optional(),
  unchanged_dishes: z.array(z.string()).optional(),
  running: z.array(z.string()).optional(),
  no_warnings: z.boolean().optional(),
  // Extensions beyond DESIGN.md 6: needed to judge dedup, swap identity and the Thanksgiving oven story.
  deduplicated: z.boolean().optional(),
  version_delta: z.number().int().min(0).optional(),
  same_plan: z.boolean().optional(),
  all_done: z.boolean().optional(),
  system_steps: z.array(z.enum(['preheat', 'transition'])).optional(),
  overlaps: z.array(z.object({ step: z.string(), with: z.array(z.string()).min(1) }).strict()).optional(),
}).strict();
export const Expectation = z.object({
  tools: z.array(ExpectedTool).optional(),
  state: StateExpectation.optional(),
  reply_includes: z.array(z.string()).optional(),
  reply_excludes: z.array(z.string()).optional(),
}).strict();
export const Video = z.object({
  shot: z.string().min(1),
  caption: z.string().optional(),
  narration: z.string().optional(),
  ui: UiMode.optional(),
  /** Show the host timer announcement that fired while the clock advanced to this beat. */
  timer: z.boolean().optional(),
}).strict();
/** Repeat a cooking beat: complete the step that just ended, or ask what's next, until the condition holds. */
export const Repeat = z.object({
  until: z.union([z.literal('all_done'), z.object({ running: z.string() }).strict(), z.object({ at: LocalTime }).strict()]),
  max_turns: z.number().int().min(1).max(200).default(120),
}).strict();
export const BeatSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  at: LocalTime.optional(),
  advance_to: z.union([z.enum(['next_event', 'timer']), z.object({ minutes: z.number().positive().max(1440) }).strict()]).optional(),
  /** Repeat beats use {subject} for the finished step and the next line for idle turns. */
  user: z.string().min(1).max(300),
  user_idle: z.string().min(1).max(300).optional(),
  repeat: Repeat.optional(),
  /** Words speech recognition must preserve for the voice mode; derived from user when omitted. */
  intents: z.array(z.string()).optional(),
  expect: Expectation.default({}),
  video: Video.optional(),
}).strict().superRefine((beat, ctx) => {
  if (beat.at && beat.advance_to) ctx.addIssue({ code: 'custom', message: 'Use either at or advance_to' });
  if (beat.repeat && !beat.user.includes('{subject}')) ctx.addIssue({ code: 'custom', message: 'Repeat beats need {subject}' });
  if (!beat.repeat && beat.user.includes('{subject}')) ctx.addIssue({ code: 'custom', message: '{subject} is only for repeat beats' });
});
export const ScenarioSchema = z.object({
  id: ScenarioId,
  title: z.string().min(1),
  device: z.enum(['show', 'dot']),
  timezone: z.string().refine(tz => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone'),
  date: z.string().regex(/^\d{4}-\d\d-\d\d$/).default('2026-10-15'),
  clock_start: LocalTime,
  kitchen: z.object({ ovens: z.number().int().min(0).max(4), burners: z.number().int().min(0).max(8),
    helpers: z.number().int().min(1).max(4), oven_profiles: z.array(z.unknown()).optional() }).strict(),
  video: z.object({ order: z.number().int().min(1), scene: z.string().min(1), intro: z.string().optional() }).strict(),
  beats: z.array(BeatSchema).min(1),
}).strict().superRefine((scenario, ctx) => {
  const ids = scenario.beats.map(b => b.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Beat ids must be unique' });
});
export type Scenario = z.infer<typeof ScenarioSchema>;
export type Beat = z.infer<typeof BeatSchema>;
export type ExpectedToolCall = z.infer<typeof ExpectedTool>;
export type StateExpect = z.infer<typeof StateExpectation>;
