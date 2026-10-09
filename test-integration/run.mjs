import { runTests } from '@vscode/test-electron';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ws = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'tabgroups-ws-'));
for (const f of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) writeFileSync(join(ws, `${f}.txt`), `${f}\n`);

try {
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_PATH ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'test-integration', 'suite.cjs'),
    launchArgs: [ws, '--disable-extensions', '--user-data-dir', mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'tabgroups-ud-'))],
  });
} catch (e) {
  console.error(`run failed: ${e?.stack ?? e}`);
  process.exit(1);
}
