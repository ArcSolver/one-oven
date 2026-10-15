import { spawn } from 'node:child_process';
/** No shell interpolation: text and file names are always separate arguments. */
export function run(binary: string, args: string[], input?: Uint8Array, timeoutMs = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let bytes = 0, error = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) child.kill('SIGKILL'); else chunks.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString()).slice(-2000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${binary} exited ${code}: ${error}`)); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
