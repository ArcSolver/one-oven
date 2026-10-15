export type SpeechLintResult = { ok: boolean; violations: string[] };
export function speechLint(text: string): SpeechLintResult {
  const violations: string[] = [];
  if (!text.trim()) violations.push('empty');
  if (text.trim().split(/\s+/).length > 30) violations.push('word_count');
  if ((text.match(/[.!?]+(?=\s|$)/g) ?? []).length > 2) violations.push('sentence_count');
  if (/\b\d{4}-\d\d-\d\dT|\b\d\d:\d\d:\d\d(?:\.\d+)?Z\b/i.test(text)) violations.push('iso_time');
  if (/\b(screen|tap|card)\b|https?:\/\/|[{}\[\]]|\bJSON\b/i.test(text)) violations.push('visual_or_machine_text');
  if (/\b(?:set_kitchen|list_dishes|plan_meal|next_step|report_delay|swap_dish|tools\/call)\b/i.test(text)) violations.push('tool_name');
  if (/\b[\da-f]{8}-[\da-f-]{27,}\b|\b[a-z][a-z0-9_-]*:(?:\d|preheat|transition)|\b(?:plan|step|kitchen|dish)_id\b/i.test(text)) violations.push('id');
  return { ok: violations.length === 0, violations };
}
export function assertSpeech(text: string): void {
  const result = speechLint(text);
  if (!result.ok) throw new Error(`Speech lint: ${result.violations.join(', ')}`);
}
