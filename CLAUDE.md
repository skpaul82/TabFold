# CLAUDE.md

**TabFold**: a VS Code extension that adds browser-style tab groups: named, colored, collapsible groups on the tab bar and in a sidebar. User-facing docs are in `README.md`, release notes in `CHANGELOG.md`.

## Rules
1. **No runtime dependencies.** `package.json` never gets a `dependencies` block.
2. **No network, telemetry or child processes in `src/`, and no reading file contents.** Only URIs, names, colors and flags are stored.
3. **Official VS Code API only.** No workbench patching, no proposed APIs.
4. Webviews: `enableScripts: false`, `enableCommandUris: false`, CSP `default-src 'none'`.
5. Never lose user work: prompt before closing dirty tabs.

`npm run check:security` enforces 1 and 2 and runs as part of `npm run package` and CI.

## Commands
```sh
npm install
npm run typecheck          # tsc --noEmit (esbuild does the bundling)
npm test                   # unit tests, plain Node, no VS Code
npm run test:integration   # drives a real VS Code window (set VSCODE_PATH off macOS)
npm run package            # typecheck + tests + security check + bundle + VSIX
```
F5 opens the Extension Development Host.

## Code conventions
- Node runs the `.ts` tests directly, so relative imports include the `.ts` extension, type-only imports use `import type`, and enums, parameter properties and namespaces aren't allowed.
- `src/model/` is pure logic and must not import `vscode`.
- 2 spaces, single quotes, ~130 columns, short JSDoc on non-obvious code.
- Pure logic changes need unit tests in `test/`. Tab-bar behavior changes need a step in `test-integration/suite.cjs`.
- User-visible changes get a `CHANGELOG.md` entry under "Unreleased".
