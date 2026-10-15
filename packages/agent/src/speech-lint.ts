import { speechLint, type SpeechLintResult } from '@one-oven/contracts';
export function lintReply(text: string): SpeechLintResult {
  const result = speechLint(text);
  if (/\b(set_timer|cancel_timer|list_timers)\b/i.test(text)) result.violations.push('host_tool_name');
  if (/\b(display|click|swipe|button|look at)\b/i.test(text)) result.violations.push('visual_reference');
  result.ok = result.violations.length === 0;
  return result;
}
