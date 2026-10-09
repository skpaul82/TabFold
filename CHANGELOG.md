# Changelog

## Unreleased

### Fixed
- The license file in the VS Code Marketplace package of 0.1.0 named the copyright holder as "skpaul82". It now says "Sanjoy K Paul", matching the repository and Open VSX.

## 0.1.0 (2026-10-10): first public release (preview)

Published to the VS Code Marketplace and Open VSX.

- **Tab groups:** create a group from any tab (context menu or `Cmd/Ctrl+K G`), then name it and pick one of 9 colors in a single picker.
- **Header tab** in front of each group (`▾ Name` / `▸ Name (n)`). Click it to collapse or expand the group. Closing the header hides it and keeps the group.
- **Collapse** closes the group's tabs (after a save prompt for unsaved files) and remembers them. **Expand** reopens them in order.
- **Tabs stay together** in every editor split (up to 8), header first. Each split keeps showing its tab, and focus stays where it was.
- **One split per group:** dragging a group's header to another split takes its tabs along, and dragging all of its tabs takes the header along. A tab dragged alone into another split leaves its group.
- **Browser-like drag behavior:** drag a tab out of a group to remove it, or drop one between two of the group's tabs to add it (`tabGroups.joinByPosition`).
- **Colored tab titles** with a badge (letter, dot or none).
- **Undo** on Ungroup, Close Group and Ungroup All.
- **Status bar chip, group switcher** (`Cmd/Ctrl+K Shift+G`), and a **sidebar** with drag and drop.
- **Saved groups** that work across workspaces. Live groups persist per workspace and follow file renames.
- Header tabs are only toggled by real clicks, and the default next/previous-editor shortcuts skip them.
- **Security:** no runtime dependencies, no network or telemetry, file contents never read, script-free webviews under a strict CSP, and Restricted Mode support. CI checks these on every commit.
