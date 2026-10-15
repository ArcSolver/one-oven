import { z } from 'zod';
import { OvenProfileSchema, TimezoneSchema } from './plan.js';
const id = z.string().min(1).max(100);
export const RequestIdSchema = z.string().min(8).max(64);
export const MutationOptionsSchema = z.object({
  request_id: RequestIdSchema.optional(), based_on_version: z.number().int().positive().optional(),
  allow_repeat: z.boolean().optional(),
});
export type MutationOptions = z.infer<typeof MutationOptionsSchema>;
const mutation = MutationOptionsSchema.shape;
export const toolSchemas = {
  set_kitchen: z.object({ ovens: z.number().int().min(0).max(4), burners: z.number().int().min(0).max(8),
    helpers: z.number().int().min(1).max(4), timezone: TimezoneSchema,
    oven_profiles: z.array(OvenProfileSchema.partial()).max(4).optional(), ...mutation }),
  list_dishes: z.object({ course: z.enum(['main', 'side']).optional(), max_minutes: z.number().int().positive().max(1440).optional() }),
  plan_meal: z.object({ dish_ids: z.array(id).min(1).max(8), serve_at: z.union([z.iso.datetime({ offset: true }), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]), kitchen_id: id, ...mutation }),
  next_step: z.object({ plan_id: id, done_step_id: id.optional(), start_step_id: id.optional(), ...mutation }),
  report_delay: z.object({ plan_id: id, dish_id: id, minutes: z.number().int().min(1).max(180), ...mutation }),
  swap_dish: z.object({ plan_id: id, dish_id: id, replacement_id: id, ...mutation }),
};
