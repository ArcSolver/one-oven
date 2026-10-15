import { z } from 'zod';

export const StepKindSchema = z.enum(['prep', 'stove', 'oven', 'rest', 'finish']);
export const RecipeStepSchema = z.object({
  text: z.string().min(1).max(120),
  minutes: z.number().int().min(1).max(300),
  kind: StepKindSchema,
  hands: z.union([z.literal(0), z.literal(1)]),
  burners: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  temperature_f: z.number().int().min(200).max(550).optional(),
  oven_units: z.number().int().positive().optional(),
  doneness_check: z.string().min(1).max(200).optional(),
}).strict();
export const DishSchema = z.object({
  dish_id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1).max(60),
  course: z.enum(['main', 'side']),
  servings: z.number().int().min(1).max(24),
  steps: z.array(RecipeStepSchema).min(1).max(20),
  hold_max_minutes: z.number().int().min(0).max(120),
  safety_note: z.string().min(1).max(300).optional(),
  provenance: z.object({
    author: z.literal('one-oven'),
    written_at: z.iso.date(),
    calibrated: z.object({
      date: z.iso.date(),
      measured_minutes: z.array(z.number().positive()),
      note: z.string().min(1),
    }).strict().optional(),
  }).strict(),
  tags: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)),
}).strict();
export type StepKind = z.infer<typeof StepKindSchema>;
export type RecipeStep = z.infer<typeof RecipeStepSchema>;
export type Dish = z.infer<typeof DishSchema>;
