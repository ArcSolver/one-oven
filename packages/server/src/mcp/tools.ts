import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { assertSpeech, DomainError, RequestIdSchema, ToolEnvelopeSchema, toolSchemas, type MutationOptions } from '@one-oven/contracts';
import type { Service } from '../service.js';

const descriptions: Record<keyof typeof toolSchemas, string> = {
  set_kitchen: 'Describe the ovens, burners, people and time zone in your kitchen. Returns a kitchen ID for planning dinner.',
  list_dishes: 'Find dishes by course and total cooking time. Returns dish IDs to use in a meal plan.',
  plan_meal: 'Plan selected dishes backward from a serving time using your kitchen. Returns a stable plan ID and the first action.',
  next_step: 'Get the next action or confirm a running step is complete. You can also start an available future step now.',
  report_delay: 'Add time to the first unfinished step of a dish. Preserves completed work and returns changed steps with the revised serving time.',
  swap_dish: 'Replace a dish that has not started cooking. Keeps the plan ID and returns the new version and changed steps.',
};
export function callTool(service: Service, name: string, args: unknown, meta?: Record<string, unknown>): CallToolResult {
  try {
    const metadataId = meta?.['io.oneoven/request_id'];
    const raw = args && typeof args === 'object' ? args as Record<string, unknown> : {};
    if (metadataId !== undefined) RequestIdSchema.parse(metadataId);
    if (raw.request_id !== undefined && metadataId !== undefined && raw.request_id !== metadataId) throw new DomainError('request_id_reused', 'The request identifiers disagree. Try again with one request.');
    const input = { ...raw, ...(metadataId === undefined ? {} : { request_id: metadataId }) };
    let data: Record<string, unknown>;
    switch (name) {
      case 'set_kitchen': { const a = toolSchemas.set_kitchen.parse(input); data = service.setKitchen(a, a); break; }
      case 'list_dishes': { const a = toolSchemas.list_dishes.parse(input); data = service.listDishes(a.course, a.max_minutes); break; }
      case 'plan_meal': { const a = toolSchemas.plan_meal.parse(input); data = service.planMeal(a.dish_ids, a.serve_at, a.kitchen_id, a); break; }
      case 'next_step': { const a = toolSchemas.next_step.parse(input); data = service.nextStep(a.plan_id, a.done_step_id, a, a.start_step_id); break; }
      case 'report_delay': { const a = toolSchemas.report_delay.parse(input); data = service.reportDelay(a.plan_id, a.dish_id, a.minutes, a); break; }
      case 'swap_dish': { const a = toolSchemas.swap_dish.parse(input); data = service.swapDish(a.plan_id, a.dish_id, a.replacement_id, a); break; }
      default: throw new DomainError('infeasible_kitchen', 'That action is unavailable. Ask for the next cooking step.');
    }
    ToolEnvelopeSchema.parse(data);
    assertSpeech(data.say as string);
    return { content: [{ type: 'text', text: data.say as string }], structuredContent: data };
  } catch (error) {
    const failure = error instanceof DomainError ? error : new DomainError(
      name === 'report_delay' ? 'invalid_delay' : 'infeasible_kitchen',
      name === 'report_delay' ? 'Check the dish and add between one and 180 whole minutes.' : 'Check your cooking details and try again.');
    const data = failure.toJSON();
    assertSpeech(data.say);
    return { isError: true, content: [{ type: 'text', text: data.say }], structuredContent: data };
  }
}
export function registerTools(server: McpServer, service: Service): void {
  for (const name of Object.keys(toolSchemas) as (keyof typeof toolSchemas)[]) {
    server.registerTool(name, { description: descriptions[name], inputSchema: toolSchemas[name].shape,
      annotations: name === 'list_dishes' ? { readOnlyHint: true } : { destructiveHint: false, idempotentHint: false } },
    (args: MutationOptions) => callTool(service, name, args));
  }
  // Public low-level handler keeps schema-validation errors in the same speech-safe envelope
  // and exposes request _meta without relying on SDK private methods.
  server.server.setRequestHandler(CallToolRequestSchema, request => callTool(service, request.params.name,
    request.params.arguments, request.params._meta));
}
