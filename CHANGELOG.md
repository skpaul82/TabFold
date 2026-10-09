# Changelog

Product milestones are v1.0, v1.1, and so on. The package version in `package.json` changes only when a VSIX is cut for release.

## Unreleased: v1.1 hardening

### Added
- **Undo** on the notifications for Ungroup, Close Group and Ungroup All. It restores the name, color, collapsed state and sidebar position. Close Group's undo reopens the tabs.
- **One split per group.** Dragging a group's header to another split takes its tabs along. Dragging all of its tabs takes the header along. Adding a tab from another split moves it into the group's split.
- Extension icon, and a security check (`npm run check:security`) that also runs during `npm run package` and in CI.
- CI workflow: typecheck, unit tests, security check, package, and a VSIX contents check.

### Changed
- Groups stay together in **every** editor split (up to 8), not just the active one. Each split keeps showing its tab, and focus stays where it was.
- A tab dragged *alone* into another split now leaves its group, like dragging a tab to another Chrome window. Before, the group silently spanned both splits. Set `tabGroups.joinByPosition: false` to keep it in the group.

### Fixed
- A header tab that VS Code activates on its own (for example after a neighbor closes, or during keyboard tab cycling) no longer toggles its group. Next/previous editor skips header tabs.
- Focus no longer jumps to another split when undo reopens tabs there.
- Integration suite: errors outside a step are now reported with a stack trace. 26 green runs in a row.

## 0.1.0 (2026-10-09): v1.0, first build

- Create a group from a tab (context menu or `Cmd/Ctrl+K G`), with a name and one of Chrome's 9 colors in a single picker.
- Header tab per group (`▾ Name` / `▸ Name (n)`). Click it to collapse or expand. Closing it hides the header and keeps the group.
- Grouped tabs are kept next to each other, and their titles are drawn in the group color with a badge.
- Collapse closes the group's tabs (after a save prompt for unsaved files) and remembers them. Expand reopens them in order.
- Chrome drag semantics: drag a tab out of the block to leave the group, drop one between members to join.
- Status bar chip, group switcher (`Cmd/Ctrl+K Shift+G`), and a sidebar with drag and drop.
- Groups persist per workspace and follow file renames. Saved groups work across workspaces.
- Settings: `placement`, `headerTabs`, `colorTabs`, `badgeStyle`, `joinByPosition`.
- Security baseline: no runtime dependencies, no network, script-free webviews with CSP `default-src 'none'`, Restricted Mode supported.
