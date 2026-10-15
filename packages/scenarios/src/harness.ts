import { once } from 'node:events';
import type { Server } from 'node:http';
import { SimClock } from '@one-oven/contracts';
import { Store } from '../../server/src/store.js';
import { Service } from '../../server/src/service.js';
import { app } from '../../server/src/http.js';
import type { Scenario } from './schema.js';
import { localEpoch } from './time.js';

/**
 * In-process One Oven server on a simulated clock. The clock is injected into the
 * service only; the HTTP app is the production app without the /dev/clock route.
 */
export class Harness {
  readonly clock: SimClock;
  readonly store = new Store(':memory:');
  readonly service: Service;
  private server?: Server;
  url?: string;
  constructor(readonly scenario: Scenario) {
    this.clock = new SimClock(localEpoch(scenario.date, scenario.clock_start, scenario.timezone));
    this.service = new Service(this.store, () => Math.ceil(this.clock.now() / 60000), () => this.clock.now());
  }
  async listen(): Promise<string> {
    if (this.url) return this.url;
    this.server = app(this.service).listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('No harness address');
    this.url = `http://127.0.0.1:${address.port}/mcp`;
    return this.url;
  }
  at(time: string): number { return localEpoch(this.scenario.date, time, this.scenario.timezone); }
  async close(): Promise<void> {
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.store.close();
  }
}
