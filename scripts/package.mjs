// Assembles the upload package for PHP shared hosting (cPanel). Run via `npm run package`,
// which builds the website first. Output:
//   deploy/public_html/      upload the CONTENTS of this folder into your site's document root
//   deploy/netportal.zip     the same contents zipped, for cPanel's File Manager → Extract
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'deploy');
const site = path.join(outDir, 'public_html');

if (!fs.existsSync(path.join(root, 'client/dist/index.html'))) throw new Error('Missing client/dist: run "npm run build" first');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(site, { recursive: true });

// The built website (includes the SPA .htaccess from client/public).
fs.cpSync(path.join(root, 'client/dist'), site, { recursive: true });

// The PHP API, minus local-only files. config.php is created on the server from config.sample.php.
const skip = new Set(['config.php']);
fs.cpSync(path.join(root, 'api'), path.join(site, 'api'), {
  recursive: true,
  filter: (src) => !skip.has(path.basename(src)),
});

const zip = path.join(outDir, 'netportal.zip');
const zipTools =
  process.platform === 'win32'
    ? [
        // Windows' own bsdtar writes zips with -a (Git Bash's GNU tar on PATH can't).
        [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', site, '.']],
        ['powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${site}\\*' -DestinationPath '${zip}' -Force`]],
      ]
    : [['zip', ['-qr', zip, '.'], { cwd: site }]];
const zipped = zipTools.some(([cmd, args, opts]) => {
  try {
    execFileSync(cmd, args, { stdio: 'inherit', ...opts });
    return fs.existsSync(zip);
  } catch {
    return false;
  }
});
if (!zipped) console.warn('Could not create a zip; upload the deploy/public_html folder contents instead.');

console.log(`\nUpload package ready:\n  ${site}\n  ${fs.existsSync(zip) ? zip : '(no zip)'}`);
