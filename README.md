# TabFold

**Browser-style tab groups for VS Code.** Group, name, color and collapse your editor tabs, the way tab groups work in Chrome. No network, no telemetry and no runtime dependencies, so you can trust it with work code.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/skpaul82.tabfold?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=skpaul82.tabfold)
[![Open VSX](https://img.shields.io/open-vsx/v/skpaul82/tabfold?label=Open%20VSX)](https://open-vsx.org/extension/skpaul82/tabfold)
[![CI](https://github.com/skpaul82/TabFold/actions/workflows/ci.yml/badge.svg)](https://github.com/skpaul82/TabFold/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/skpaul82/TabFold/blob/main/LICENSE)

<!-- Demo GIF goes here: group → collapse → expand. Store it outside media/ (e.g. .github/assets/demo.gif) so it isn't shipped in the VSIX, and link it with an absolute https://raw.githubusercontent.com/... URL. -->

## Why TabFold

- **Fold away what you're not working on.** Collapse a group and its tabs close. Expand it and they come back, in order.
- **See your context at a glance.** Each group gets a header tab (`▾ API`) and its own color on the tab bar.
- **Private by design.** TabFold never touches the network, never reads your files, and ships no third-party code. [Details below](#security--privacy).

## Install

- **VS Code:** [install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=skpaul82.tabfold), or run `code --install-extension skpaul82.tabfold`.
- **Cursor, VSCodium, Windsurf and other Open VSX editors:** [install from Open VSX](https://open-vsx.org/extension/skpaul82/tabfold), or search for "TabFold" in the Extensions view.
- **Manual:** download the `.vsix` from [GitHub Releases](https://github.com/skpaul82/TabFold/releases) and run **Extensions: Install from VSIX…**.

## Getting started

1. Right-click any editor tab → **Add Tab to New Group**.
2. Type a name, pick a color with the arrow keys, and press Enter.
3. Click the group's header tab (`▾ Name`) to collapse it. Click it again to expand.

## Using it

| Want to… | Do this |
|---|---|
| Make a group | Right-click a tab → **Add Tab to New Group**. Or press `Cmd/Ctrl+K G` and choose a new group |
| Add a tab to a group | Right-click it → **Add Tab to Group…**, drag it between two tabs of the group, or drop it on the group in the sidebar |
| Take a tab out | Drag it out of the group's block, or right-click → **Remove Tab from Group** |
| Collapse / expand | Click the header tab, use the fold button in the sidebar, or press `Cmd/Ctrl+K Alt+G` |
| Rename or recolor | Right-click the group in the sidebar → **Edit Group (Name & Color)…** |
| Jump between groups | Click the group chip in the status bar, or press `Cmd/Ctrl+K Shift+G` |
| Keep a group for later | Sidebar → right-click → **Save Group**. Restore it from **Saved Groups**, in any workspace |
| Undo | Ungroup, Close Group and Ungroup All show an **Undo** button |
| Move the panel to the right | Drag the **Tab Groups** icon to the Secondary Side Bar |

## How it works

VS Code doesn't let extensions draw custom chips on the tab bar, so TabFold builds groups from features VS Code does allow:

- **Header tab:** a small tab titled `▾ Backend` sits in front of each group. Collapsed, it shows `▸ Backend (5)`.
- **Tabs stay together:** a group's tabs are kept next to each other, header first, in every editor split.
- **One split per group:** drag a group's header to another split and its tabs follow. Drag all of its tabs and the header follows. Drag a single tab to another split and it leaves the group, like dragging a tab to another browser window.
- **Color and badge:** grouped tab titles use the group's color and get a badge (the group's first letter, a dot, or nothing).
- **Collapse closes tabs and remembers them.** If a tab has unsaved changes, you're asked to save first. Nothing is ever lost.

Tab colors and badges need `workbench.editor.decorations.colors` and `workbench.editor.decorations.badges`, which are on by default.

## Settings

| Setting | Default | |
|---|---|---|
| `tabGroups.placement` | `top+side` | `top+side`, `top` (tab bar only), or `side` (sidebar only, no tab-bar changes) |
| `tabGroups.headerTabs` | `true` | Show header tabs |
| `tabGroups.colorTabs` | `true` | Color grouped tab titles |
| `tabGroups.badgeStyle` | `letter` | `letter`, `dot`, or `none` |
| `tabGroups.joinByPosition` | `true` | Dragging a tab into or out of a group's block changes which group it's in |

## Security & privacy

- **No network access and no telemetry.** CI checks the source for network and process APIs on every commit.
- **No runtime dependencies.** The published package contains only the bundled extension, its icons, this README, the changelog and the license, and CI verifies that too.
- **Your files are never read.** TabFold stores only file paths, group names, colors and collapsed state, in VS Code's own extension storage on your machine.
- **Locked-down header tabs.** They're webviews with scripts and command links disabled, under a `default-src 'none'` content security policy.
- **Works in Restricted Mode** (untrusted workspaces), because it never runs workspace code.
- **Open source** (MIT), so you can audit everything above.

## Known limits

- Terminals and other extensions' webview tabs can't be grouped, because VS Code doesn't expose them as files that can be reopened.
- Grouping works in up to 8 editor splits. VS Code only offers focus commands for the first 8.
- VS Code doesn't report tab clicks to extensions, so TabFold infers them:
  - A header that becomes active right after a tab opens or closes is ignored.
  - The default next/previous-editor shortcuts skip header tabs. Custom keybindings for those commands don't.
  - Picking a header from the `Ctrl+Tab` list or with `Ctrl+1…9` counts as a click.

## Feedback & contributing

Bug reports and ideas are welcome in [GitHub Issues](https://github.com/skpaul82/TabFold/issues).

```sh
npm install
npm test                   # unit tests, no VS Code needed
npm run test:integration   # drives a real VS Code window (set VSCODE_PATH outside macOS)
npm run package            # typecheck, tests, security check, then build the VSIX
```

Press F5 in VS Code to try your changes in an Extension Development Host. Contributor notes are in [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE)
