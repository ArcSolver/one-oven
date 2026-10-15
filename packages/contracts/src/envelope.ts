import { z } from 'zod';
import { WarningSchema } from './plan.js';
export const TimerSuggestionSchema = z.object({
  step_id: z.string(), label: z.string(), minutes: z.number().nonnegative(),
  ends_at: z.iso.datetime({ offset: true }), say: z.string(),
});
export const ToolEnvelopeSchema = z.object({
  plan_id: z.string().optional(), kitchen_id: z.string().optional(), version: z.number().int().optional(),
  serve_at: z.iso.datetime({ offset: true }).optional(), serve_at_local: z.string().optional(),
  say: z.string(), display: z.unknown(), timer_suggestions: z.array(TimerSuggestionSchema).optional(),
  warnings: z.array(WarningSchema).optional(), request_id: z.string().optional(), deduplicated: z.boolean().optional(),
}).passthrough();
export type TimerSuggestion = z.infer<typeof TimerSuggestionSchema>;
export type ToolEnvelope = z.infer<typeof ToolEnvelopeSchema>;
