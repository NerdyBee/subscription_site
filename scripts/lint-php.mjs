// `npm run lint`: syntax-checks every PHP file with the local `php -l`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const api = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../api');
const files = fs.readdirSync(api, { recursive: true }).filter((f) => f.endsWith('.php')).map((f) => path.join(api, f));
let failed = 0;
for (const f of files) {
  try {
    execFileSync('php', ['-l', f], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    process.stderr.write(e.stdout?.toString() || e.message);
  }
}
console.log(`${files.length - failed}/${files.length} PHP files OK`);
process.exit(failed ? 1 : 0);
