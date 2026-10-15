/** Normalize spelling, punctuation and spoken small numbers, without supplying missing intent words. */
export function normalize(text: string): string {
  const numbers: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', thirty: '30' };
  return text.toLowerCase().replace(/(\d)([a-z])/g, '$1 $2').replace(/\b(one|two|three|four|five|six|thirty)\b/g, word => numbers[word])
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
export function missingIntents(text: string, intents: string[]): string[] {
  const actual = ` ${normalize(text)} `;
  return intents.filter(intent => !actual.includes(` ${normalize(intent)} `));
}
