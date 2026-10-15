import { cpSync, existsSync } from 'node:fs';
for (const path of ['data/dishes', 'store/migrations']) {
  const source = new URL(`../src/${path}`, import.meta.url);
  if (existsSync(source)) cpSync(source, new URL(`../dist/src/${path}`, import.meta.url), { recursive: true });
}
