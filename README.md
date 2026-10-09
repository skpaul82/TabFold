# TabFold

Browser-style tab groups for VS Code: group, name, color and collapse editor tabs the way Chrome does. Groups show up on the
editor tab bar and, if you want, in a sidebar.

## Using it

| Want to… | Do this |
|---|---|
| Make a group | Right-click a tab → **Add Tab to New Group**, or press `Cmd/Ctrl+K G` |
| Name and color it | Type a name, arrow to a color, press Enter (same picker as Chrome's group bubble) |
| Add a tab to a group | Right-click the tab → **Add Tab to Group…**, drag it between two tabs of the group, or drag it onto the group in the sidebar |
| Take a tab out | Drag it out of the group's block, or right-click → **Remove Tab from Group** |
| Collapse / expand | Click the group's **header tab** (`▾ Name`), use the sidebar fold button, or press `Cmd/Ctrl+K Alt+G` |
| Jump between groups | Click the status bar chip, or press `Cmd/Ctrl+K Shift+G` |
| Keep a group for later | Sidebar → right-click → **Save Group**. Restore it from **Saved Groups**, from any workspace |
| Put the panel on the right | Drag the **Tab Groups** icon to the Secondary Side Bar |

### How the tab bar works
VS Code doesn't let extensions draw custom chips in the tab bar, so this extension builds them out of
features VS Code does allow:

- **Header tab:** a small tab titled `▾ Backend` sits in front of each group. Click it to collapse the group (`▸ Backend (5)`) and click it again to expand.
- **Contiguous tabs:** tabs in the same group are kept next to each other.
- **One split per group:** drag a group's header to another split and its tabs follow. Drag all of its tabs and the header follows. Drag a single tab to another split and it leaves the group, like dragging a tab to another Chrome window.
- **Color and badge:** grouped tab titles are drawn in the group color and get a badge (the group's first letter).
- **Collapse closes the group's tabs and remembers them.** Expanding reopens them in order. If any tab has unsaved changes, you're asked to save first.
- **Undo:** Ungroup, Close Group and Ungroup All show a notification with an **Undo** button that brings the group back. Close Group's undo reopens the tabs.

Tab colors and badges depend on `workbench.editor.decorations.colors` and `workbench.editor.decorations.badges`. Both are on by default.

## Settings

| Setting | Default | |
|---|---|---|
| `tabGroups.placement` | `top+side` | `top+side`, `top` (tab bar only), or `side` (sidebar only, no tab-bar changes) |
| `tabGroups.headerTabs` | `true` | Show header tabs |
| `tabGroups.colorTabs` | `true` | Color grouped tab titles |
| `tabGroups.badgeStyle` | `letter` | `letter`, `dot`, or `none` |
| `tabGroups.joinByPosition` | `true` | Dragging a tab into or out of a group's block changes its membership |

## Security

- No runtime dependencies. The shipped VSIX contains only `dist/extension.js`, `media/`, and this README.
- No network access, no telemetry, and file contents are never read. The extension stores only file URIs, group names and colors, in VS Code's own extension storage.
- Header tabs are webviews with scripts and command links disabled, under a `default-src 'none'` CSP.
- Runs in untrusted (Restricted Mode) workspaces, because it never executes or reads workspace code.

## Develop

```sh
npm install
npm test                  # unit tests (ordering / store logic)
npm run test:integration  # drives a real VS Code window (macOS path; set VSCODE_PATH elsewhere)
npm run compile     # typecheck + bundle
# F5 in VS Code → Extension Development Host
npm run check:security  # no runtime deps, no network/child processes in src/
npm run package     # → tabfold-0.1.0.vsix (runs tests + security check, then checks the VSIX contents)
code --install-extension tabfold-0.1.0.vsix
```

## Known limits
- Terminals and other extensions' webview tabs can't be grouped. The VS Code API doesn't expose them as reopenable resources.
- Tabs are reordered in up to 8 editor splits (VS Code only has focus commands for the first 8).
- Header clicks are inferred, because VS Code doesn't report clicks to extensions. A header that becomes active right after a tab opens or closes is ignored, and next/previous-editor shortcuts skip headers. Picking a header explicitly (Ctrl+Tab list, `Ctrl+1…9`) counts as a click. Custom keybindings for next/previous editor don't skip headers, but cycling quickly past a header won't toggle it.

## Roadmap (v2)
Settings Sync for groups, groups tied to Git branches, auto-grouping rules (glob → group), adding a group to AI chat context, a Recent Tabs view, a tree-by-folder view, and cycling between groups.
