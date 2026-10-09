// Security gate (SEC-01, SEC-02, SEC-05). Runs locally and in CI; exits 1 on any finding.
//   node scripts/check-security.mjs          package.json + src/
//   node scripts/check-security.mjs --vsix   also the packaged VSIX contents
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const problems = [];

// SEC-01: no runtime dependencies.
for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) {
  if (pkg[key] && Object.keys(pkg[key]).length) problems.push(`package.json has "${key}" (SEC-01: dev dependencies only)`);
}

// SEC-02: no network or child processes in the extension source.
const forbidden = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/, 'browser networking'],
  [/(?:from\s+|require\s*\(\s*|import\s*\(\s*)['"](?:node:)?(?:https?|http2|net|tls|dgram|dns|child_process|worker_threads)['"]/, 'network/process module'],
  [/\bvscode\.env\.openExternal\b/, 'openExternal'],
];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
for (const file of walk(join(root, 'src')).filter((f) => /\.[cm]?[jt]s$/.test(f))) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [re, what] of forbidden) {
        if (re.test(line)) problems.push(`${relative(root, file)}:${i + 1}: ${what} (SEC-02)`);
      }
    });
}

// SEC-05: the VSIX ships only the bundle, media, manifest and docs.
if (process.argv.includes('--vsix')) {
  const vsix = join(root, `${pkg.name}-${pkg.version}.vsix`);
  const allowed = [
    /^extension\.vsixmanifest$/,
    /^\[Content_Types\]\.xml$/,
    /^extension\/package\.json$/,
    /^extension\/dist\/extension\.js$/,
    /^extension\/media\/[\w./-]+\.(svg|png)$/,
    /^extension\/(readme|changelog)\.md$/i,
    /^extension\/license(\.txt)?$/i,
  ];
  const entries = execFileSync('unzip', ['-Z1', vsix], { encoding: 'utf8' }).split('\n').filter((e) => e && !e.endsWith('/'));
  for (const e of entries) if (!allowed.some((re) => re.test(e))) problems.push(`${relative(root, vsix)} contains ${e} (SEC-05)`);
  console.log(`VSIX: ${entries.length} files checked`);
}

if (problems.length) {
  console.error(`Security check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('Security check passed (SEC-01, SEC-02' + (process.argv.includes('--vsix') ? ', SEC-05)' : ')'));
