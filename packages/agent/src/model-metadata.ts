import type { Model } from '@strands-agents/sdk';
// Transport headers only; never retain authorization or request bodies.
const ids = new WeakMap<Model, string[]>();
export function registerRequestIds(model: Model, list: string[]): Model { ids.set(model, list); return model; }
export function takeRequestIds(model: Model): string[] { return ids.get(model)?.splice(0) ?? []; }
