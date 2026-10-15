import { z } from 'zod';
export const ErrorCodeSchema = z.enum([
  'unknown_plan', 'unknown_dish', 'not_enough_time', 'infeasible_kitchen', 'conflict_frozen',
  'invalid_delay', 'step_not_running', 'overdue_step', 'request_id_reused', 'version_conflict',
  'unauthorized_scope',
]);
export const ToolErrorSchema = z.object({
  error_code: ErrorCodeSchema, say: z.string(), retryable: z.boolean(),
  current_version: z.number().int().positive().optional(),
});
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ToolError = z.infer<typeof ToolErrorSchema>;
export class DomainError extends Error {
  constructor(readonly error_code: ErrorCode, say: string, readonly current_version?: number) {
    super(say);
  }
  toJSON(): ToolError {
    return { error_code: this.error_code, say: this.message,
      retryable: this.error_code === 'version_conflict',
      ...(this.current_version === undefined ? {} : { current_version: this.current_version }) };
  }
}
