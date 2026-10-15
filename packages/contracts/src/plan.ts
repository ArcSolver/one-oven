import { z } from 'zod';
import { RecipeStepSchema } from './dish.js';

export const TimezoneSchema = z.string().refine(value => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
  catch { return false; }
}, 'Use an IANA time zone.');
export const OvenProfileSchema = z.object({
  capacity_units: z.number().int().min(1).max(20).default(4),
  preheat_f_per_min: z.number().positive().max(100).default(25),
  cool_f_per_min: z.number().positive().max(100).default(10),
  ambient_f: z.number().min(0).max(150).default(70),
}).strict();
export const defaultOven = () => OvenProfileSchema.parse({});
export const KitchenSchema = z.object({
  ovens: z.array(OvenProfileSchema).max(4),
  burners: z.number().int().min(0).max(8),
  helpers: z.number().int().min(1).max(4),
  timezone: TimezoneSchema,
}).strict();
export const ScheduledStepSchema = RecipeStepSchema.extend({
  // Actual completion can shorten a step to zero or a delay can extend it.
  minutes: z.number().int().nonnegative(),
  step_id: z.string(), source: z.enum(['recipe', 'preheat', 'transition']),
  dish_id: z.string().nullable(), index: z.number().int(),
  start: z.number().int(), end: z.number().int(),
  oven: z.number().int().nonnegative().optional(),
  setpoint_f: z.number().optional(),
  status: z.enum(['pending', 'running', 'done']),
  actual_start: z.number().int().optional(), actual_end: z.number().int().optional(),
});
export const OvenSegmentSchema = z.object({
  oven: z.number().int().nonnegative(), setpoint_f: z.number(),
  start: z.number().int(), end: z.number().int(), units_peak: z.number().int().positive(),
});
export const WarningSchema = z.object({
  code: z.literal('hold_exceeded'), dish_id: z.string(),
  hold_minutes: z.number().nonnegative(), hold_max_minutes: z.number().nonnegative(),
});
export const PlanSchema = z.object({
  plan_id: z.string(), household_id: z.string(), kitchen_id: z.string(), kitchen: KitchenSchema,
  version: z.number().int().positive(), serve_requested: z.number().int(), serve: z.number().int(),
  steps: z.array(ScheduledStepSchema), oven_segments: z.array(OvenSegmentSchema),
  warnings: z.array(WarningSchema), created_at: z.number().int(), updated_at: z.number().int(), schema: z.literal(2),
}).strict();
export type OvenProfile = z.infer<typeof OvenProfileSchema>;
export type Kitchen = z.infer<typeof KitchenSchema>;
export type ScheduledStep = z.infer<typeof ScheduledStepSchema>;
export type OvenSegment = z.infer<typeof OvenSegmentSchema>;
export type Warning = z.infer<typeof WarningSchema>;
export type Plan = z.infer<typeof PlanSchema>;
