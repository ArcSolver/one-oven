export type ModelSpec = {
  provider: 'anthropic' | 'openai' | 'bedrock' | 'scripted';
  modelId: string; region?: string; baseUrl?: string; temperature: number; maxTokens: number;
};

export function parseModelSpec(env: NodeJS.ProcessEnv = process.env): ModelSpec {
  const value = env.AGENT_MODEL ?? 'scripted:weekday-3';
  const match = /^(anthropic|openai|bedrock|scripted):(.+)$/.exec(value);
  if (!match || match[2].trim() !== match[2] || /[<>\s]/.test(match[2])) {
    throw new Error('AGENT_MODEL must be provider:model-id (replace the example placeholder)');
  }
  const provider = match[1] as ModelSpec['provider'];
  const temperature = Number(env.AGENT_TEMPERATURE ?? 0);
  const maxTokens = Number(env.AGENT_MAX_TOKENS ?? 2048);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new Error('Invalid AGENT_TEMPERATURE');
  if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new Error('Invalid AGENT_MAX_TOKENS');
  const baseUrl = provider === 'openai' ? env.OPENAI_BASE_URL : provider === 'anthropic' ? env.ANTHROPIC_BASE_URL : undefined;
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid model base URL');
  }
  return { provider, modelId: match[2], temperature, maxTokens, baseUrl, region: env.AWS_REGION };
}
