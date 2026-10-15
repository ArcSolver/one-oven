import { BedrockModel, type Model } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';
import { AnthropicModel } from '@strands-agents/sdk/models/anthropic';
import type { ModelSpec } from './config.js';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { registerRequestIds } from './model-metadata.js';
import { ScriptedModel } from './models/scripted.js';

/** Native providers only. Construction never sends a request or resolves AWS credentials. */
export function createModel(spec: ModelSpec, env: NodeJS.ProcessEnv = process.env): Model {
  const common = { modelId: spec.modelId, temperature: spec.temperature, maxTokens: spec.maxTokens };
  const requestIds: string[] = [];
  const captureFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const id = response.headers.get('x-request-id') ?? response.headers.get('request-id');
    if (id) requestIds.push(id);
    return response;
  };
  switch (spec.provider) {
    case 'scripted': return new ScriptedModel(spec.modelId);
    case 'openai': {
      const local = spec.baseUrl && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(spec.baseUrl).hostname);
      return registerRequestIds(new OpenAIModel({ ...common, api: 'chat', apiKey: env.OPENAI_API_KEY || (local ? 'local-no-key' : undefined),
        clientConfig: { baseURL: spec.baseUrl, timeout: 60000, maxRetries: 0, fetch: captureFetch } }), requestIds);
    }
    case 'anthropic': return registerRequestIds(new AnthropicModel({ ...common, apiKey: env.ANTHROPIC_API_KEY,
      clientConfig: { baseURL: spec.baseUrl, timeout: 60000, maxRetries: 0, fetch: captureFetch } }), requestIds);
    case 'bedrock': {
      const handler = new NodeHttpHandler({ requestTimeout: 60000 });
      const handle = handler.handle.bind(handler);
      handler.handle = async (...args: Parameters<typeof handle>) => {
        const result = await handle(...args);
        const id = result.response.headers['x-amzn-requestid'] ?? result.response.headers['x-amz-request-id'];
        if (id) requestIds.push(id);
        return result;
      };
      return registerRequestIds(new BedrockModel({ ...common, region: spec.region,
        clientConfig: { requestHandler: handler, maxAttempts: 1 } }), requestIds);
    }
  }
}
