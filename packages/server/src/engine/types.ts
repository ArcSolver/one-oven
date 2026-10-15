export type { Kitchen, Plan, Dish, RecipeStep, OvenProfile, OvenSegment, Warning } from '@one-oven/contracts';
export type { ScheduledStep as Step } from '@one-oven/contracts';
export { DomainError } from '@one-oven/contracts';
import type { ScheduledStep } from '@one-oven/contracts';
export const order = (a: ScheduledStep, b: ScheduledStep) => a.start - b.start || a.step_id.localeCompare(b.step_id);
export const overlap = (a: ScheduledStep, b: ScheduledStep) => a.start < b.end && b.start < a.end;
