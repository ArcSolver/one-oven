import { defineConfig } from '@playwright/test';
const port = Number(process.env.SIM_E2E_PORT ?? 5190);
/** Starts the real stack (MCP server child + Strands host + Vite UI) with the scripted model. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1600, height: 704 }, deviceScaleFactor: 1,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
  webServer: {
    command: 'node --import tsx src/host/main.ts',
    url: `http://127.0.0.1:${port}/api/state`,
    reuseExistingServer: false,
    timeout: 120000,
    stdout: 'pipe',
    env: { SIM_PORT: String(port), SIM_MCP_PORT: process.env.SIM_E2E_MCP_PORT ?? '3020', AGENT_MODEL: 'scripted:weekday-3',
      AGENT_DEVICE: 'show', VOICE_STT: 'fixture', VOICE_TTS: process.env.VOICE_TTS ?? 'system', SIM_CLOCK_START: '2026-10-15T17:05:00-05:00' },
  },
});
