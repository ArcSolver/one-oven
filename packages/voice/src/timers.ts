import { HostTimers } from '@one-oven/agent/host-tools';
/** The session and voice output share this one store; no duplicate shadow timers. */
export class AlexaTimerEmulator extends HostTimers {}
