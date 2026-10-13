// Assembles the upload package for shared hosting (cPanel "Setup Node.js App").
// Run via `npm run package`, which builds first. Output:
//   deploy/netportal/      the folder to upload as the Node.js app root
//   deploy/netportal.zip   the same folder zipped, for cPanel's File Manager
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'server');
const outDir = path.join(root, 'deploy');
const app = path.join(outDir, 'netportal');

for (const required of ['server/dist/index.js', 'client/dist/index.html']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing ${required}: run "npm run build" first`);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });

const copy = (from, to) => fs.cpSync(from, path.join(app, to), { recursive: true });
copy(path.join(server, 'dist'), 'dist');
copy(path.join(server, 'prisma'), 'prisma');
copy(path.join(root, 'client', 'dist'), 'public');
copy(path.join(server, 'package-lock.json'), 'package-lock.json');
copy(path.join(server, '.env.example'), '.env.example');

// Runtime-only manifest: the host installs dependencies, never builds.
const pkg = JSON.parse(fs.readFileSync(path.join(server, 'package.json'), 'utf8'));
const runtime = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  main: 'app.js',
  scripts: { start: 'node app.js', postinstall: 'prisma generate' },
  engines: pkg.engines,
  dependencies: pkg.dependencies,
};
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(runtime, null, 2) + '\n');

// cPanel defaults the startup file to app.js.
fs.writeFileSync(path.join(app, 'app.js'), "require('./dist/index.js');\n");

const zip = path.join(outDir, 'netportal.zip');
const zipTools =
  process.platform === 'win32'
    ? [
        // Windows' own bsdtar writes zips with -a (Git Bash's GNU tar on PATH can't).
        [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', 'netportal.zip', 'netportal']],
        ['powershell', ['-NoProfile', '-Command', 'Compress-Archive -Path netportal -DestinationPath netportal.zip -Force']],
      ]
    : [['zip', ['-qr', 'netportal.zip', 'netportal']]];
const zipped = zipTools.some(([cmd, args]) => {
  try {
    execFileSync(cmd, args, { cwd: outDir, stdio: 'inherit' });
    return fs.existsSync(zip);
  } catch {
    return false;
  }
});
if (!zipped) console.warn('Could not create a zip; upload the deploy/netportal folder instead.');

console.log(`\nUpload package ready:\n  ${app}\n  ${fs.existsSync(zip) ? zip : '(no zip)'}`);
