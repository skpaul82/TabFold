import * as vscode from 'vscode';
import { GroupStore } from './model/GroupStore.ts';
import { Controller } from './controller.ts';
import { GroupDecorations } from './topbar/GroupDecorations.ts';
import { StatusBarChip } from './topbar/StatusBarChip.ts';
import { GroupTree, SavedTree, type Node } from './sidebar/GroupTree.ts';
import { registerCommands } from './commands/index.ts';
import { tabUri } from './tabs/tabs.ts';

/** The returned API is used by the integration tests. */
export function activate(ext: vscode.ExtensionContext): { store: GroupStore; controller: Controller } {
  const store = new GroupStore(ext.workspaceState, ext.globalState);
  const controller = new Controller(ext, store);
  const decorations = new GroupDecorations(store);
  const status = new StatusBarChip(store, () => controller.activeGroup());
  const tree = new GroupTree(store, controller);
  const saved = new SavedTree(store);

  const groupsView = vscode.window.createTreeView<Node>('tabGroups.groups', {
    treeDataProvider: tree,
    dragAndDropController: tree,
    canSelectMany: true,
    showCollapseAll: false,
  });
  const savedView = vscode.window.createTreeView<Node>('tabGroups.saved', { treeDataProvider: saved });

  const refreshUi = () => {
    tree.refresh();
    saved.refresh();
    decorations.refresh();
    status.update();
  };

  /** Keep the sidebar selection on the active editor's tab. */
  const revealActive = () => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const uri = tab && tabUri(tab)?.toString();
    if (!uri || !groupsView.visible) return;
    const g = store.groupOf(uri);
    const node = tree.node(g ? { kind: 'member', groupId: g.id, uri } : { kind: 'ungrouped', uri });
    groupsView.reveal(node, { select: true, focus: false }).then(undefined, () => undefined);
  };

  ext.subscriptions.push(
    controller,
    status,
    groupsView,
    savedView,
    vscode.window.registerFileDecorationProvider(decorations),
    store.onChange(refreshUi),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      tree.refresh();
      status.update();
      revealActive();
    }),
    vscode.window.tabGroups.onDidChangeTabGroups(() => status.update()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('tabGroups')) return;
      refreshUi();
      controller.schedule();
    }),
    ...registerCommands(store, controller, saved),
  );
  return { store, controller };
}

export function deactivate(): void {}
