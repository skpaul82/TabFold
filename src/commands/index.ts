import * as vscode from 'vscode';
import type { GroupStore } from '../model/GroupStore.ts';
import { COLOR_EMOJI, displayName, type Group } from '../model/types.ts';
import type { Controller } from '../controller.ts';
import { isNode, type Node, type SavedTree } from '../sidebar/GroupTree.ts';
import { editGroupPicker, type PickerAction } from '../ui/editGroupPicker.ts';
import { isHeaderTab, tabUri } from '../tabs/tabs.ts';

export function registerCommands(store: GroupStore, controller: Controller, saved: SavedTree): vscode.Disposable[] {
  /** Tabs a command applies to: tree selection, a right-clicked editor tab, or the active tab. */
  const targetUris = (arg?: unknown, selection?: unknown): string[] => {
    const nodes = Array.isArray(selection) && selection.length && selection.every(isNode) ? (selection as Node[]) : isNode(arg) ? [arg] : [];
    if (nodes.length) return nodes.flatMap((n) => (n.kind === 'member' || n.kind === 'ungrouped' ? [n.uri] : []));
    if (arg instanceof vscode.Uri) return [arg.toString()];
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const uri = tab && tabUri(tab);
    return uri ? [uri.toString()] : [];
  };

  /** Group a command applies to: tree node, else the active tab's group, else ask. */
  const targetGroup = async (arg?: unknown): Promise<Group | undefined> => {
    if (isNode(arg) && (arg.kind === 'group' || arg.kind === 'member')) return store.get(arg.groupId);
    if (arg instanceof vscode.Uri) return store.groupOf(arg.toString());
    return controller.activeGroup() ?? pickGroup(store, 'Which group?');
  };

  const newGroup = async (uris: string[]) => {
    if (!uris.length) {
      void vscode.window.showInformationMessage('Open a file tab first, then group it.');
      return;
    }
    // Like Chrome: the group exists immediately; naming it is optional.
    const g = controller.createGroup(uris, { name: '', color: store.nextColor() });
    await edit(g, false);
  };

  const edit = async (g: Group, withActions = true) => {
    const actions: PickerAction[] = withActions
      ? [
          { id: 'toggle', label: g.collapsed ? '$(unfold) Expand group' : '$(fold) Collapse group' },
          { id: 'save', label: '$(save) Save group' },
          { id: 'ungroup', label: '$(ungroup-by-ref-type) Ungroup' },
          { id: 'close', label: '$(close-all) Close group' },
        ]
      : [];
    const res = await editGroupPicker({ title: withActions ? 'Edit tab group' : 'Name your new tab group', name: g.name, color: g.color, actions });
    if (!res) return;
    if ('action' in res) {
      if (res.action === 'toggle') await controller.toggle(g.id);
      if (res.action === 'save') save(g);
      if (res.action === 'ungroup') controller.ungroup(g.id);
      if (res.action === 'close') await controller.closeGroup(g.id);
      return;
    }
    controller.headers.unsuppress(g.id);
    store.update(g.id, { name: res.name, color: res.color });
  };

  const save = (g: Group) => {
    store.saveSnapshot(g.id);
    void vscode.window.showInformationMessage(`Saved "${displayName(g)}" (${g.members.length} tabs). Restore it from Saved Groups.`);
  };

  const withGroup = (fn: (g: Group) => unknown) => async (arg?: unknown) => {
    const g = await targetGroup(arg);
    if (g) await fn(g);
  };

  const reg = vscode.commands.registerCommand;
  return [
    reg('tabGroups.addTabToNewGroup', (arg?: unknown, sel?: unknown) => newGroup(targetUris(arg, sel))),

    reg('tabGroups.addTabToGroup', async (arg?: unknown, sel?: unknown) => {
      const uris = targetUris(arg, sel);
      if (!uris.length) return;
      const choice = await pickGroup(store, 'Add tab to group', true);
      if (choice === 'new') await newGroup(uris);
      else if (choice) await controller.addToGroup(choice.id, uris);
    }),

    reg('tabGroups.removeTabFromGroup', async (arg?: unknown, sel?: unknown) => {
      const uris = targetUris(arg, sel).filter((u) => store.groupOf(u));
      if (!uris.length) {
        void vscode.window.showInformationMessage('This tab is not in a group.');
        return;
      }
      await controller.removeFromGroup(uris);
    }),

    reg('tabGroups.editGroup', withGroup((g) => edit(g))),
    reg('tabGroups.toggleCollapse', withGroup((g) => controller.toggle(g.id))),
    reg('tabGroups.collapseOthers', withGroup(async (g) => {
      await controller.expand(g.id, false);
      await controller.collapseAll(g.id);
    })),
    reg('tabGroups.collapseAll', () => controller.collapseAll()),
    reg('tabGroups.expandAll', () => controller.expandAll()),
    reg('tabGroups.ungroup', withGroup((g) => controller.ungroup(g.id))),
    reg('tabGroups.closeGroup', withGroup((g) => controller.closeGroup(g.id))),
    reg('tabGroups.saveGroup', withGroup(save)),

    // Keyboard tab cycling skips header tabs: they aren't editors, and landing on one must not toggle it.
    reg('tabGroups.nextEditorSkipHeader', () => skipHeaders(controller, 'workbench.action.nextEditor')),
    reg('tabGroups.previousEditorSkipHeader', () => skipHeaders(controller, 'workbench.action.previousEditor')),

    reg('tabGroups.switchGroup', () => switchGroup(store, controller, newGroup, edit, targetUris)),

    reg('tabGroups.openTab', async (n: Node) => {
      if (n.kind === 'member' && store.get(n.groupId)?.collapsed) await controller.expand(n.groupId, false);
      if ('uri' in n) await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(n.uri), { preview: false });
    }),

    reg('tabGroups.restoreSaved', async (n?: Node) => {
      const snap = n?.kind === 'saved' ? saved.saved(n.savedId) : undefined;
      if (snap) await controller.restoreSaved(snap);
    }),

    reg('tabGroups.deleteSaved', async (n?: Node) => {
      const snap = n?.kind === 'saved' ? saved.saved(n.savedId) : undefined;
      if (!snap) return;
      const ok = await vscode.window.showWarningMessage(`Delete saved group "${displayName(snap)}"?`, { modal: true }, 'Delete');
      if (ok) store.deleteSaved(snap.id);
    }),

    reg('tabGroups.resetAll', async () => {
      if (!store.all().length) return;
      const ok = await vscode.window.showWarningMessage(
        'Ungroup all tabs? Hidden tabs of collapsed groups are reopened. Saved groups are kept.',
        { modal: true },
        'Ungroup All',
      );
      if (ok) await controller.ungroupAll();
    }),
  ];
}

function skipHeaders(controller: Controller, command: string): Promise<void> {
  return controller.quietly(async () => {
    const total = vscode.window.tabGroups.all.reduce((n, g) => n + g.tabs.length, 0);
    for (let i = 0; i < total; i++) {
      await vscode.commands.executeCommand(command);
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (!tab || !isHeaderTab(tab)) return;
    }
  });
}

async function pickGroup(store: GroupStore, title: string): Promise<Group | undefined>;
async function pickGroup(store: GroupStore, title: string, allowNew: true): Promise<Group | 'new' | undefined>;
async function pickGroup(store: GroupStore, title: string, allowNew = false): Promise<Group | 'new' | undefined> {
  type Item = vscode.QuickPickItem & { group?: Group; isNew?: boolean };
  const items: Item[] = store.all().map((g) => ({ label: `${COLOR_EMOJI[g.color]}  ${displayName(g)}`, description: describe(g), group: g }));
  if (allowNew) items.unshift({ label: '$(add)  New group…', isNew: true });
  if (!items.length) {
    void vscode.window.showInformationMessage('No tab groups yet.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(items, { title, placeHolder: 'Choose a group' });
  return pick?.isNew ? 'new' : pick?.group;
}

async function switchGroup(
  store: GroupStore,
  controller: Controller,
  newGroup: (uris: string[]) => Promise<void>,
  edit: (g: Group) => Promise<void>,
  targetUris: () => string[],
): Promise<void> {
  type Item = vscode.QuickPickItem & { group?: Group; isNew?: boolean };
  const btn = {
    edit: { iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Edit name & color' },
    fold: { iconPath: new vscode.ThemeIcon('fold'), tooltip: 'Collapse / expand' },
    close: { iconPath: new vscode.ThemeIcon('close-all'), tooltip: 'Close group' },
  };
  const active = controller.activeGroup();
  const build = (): Item[] => [
    ...store.all().map((g) => ({
      label: `${COLOR_EMOJI[g.color]}  ${displayName(g)}`,
      description: describe(g) + (g.id === active?.id ? ' · current' : ''),
      group: g,
      buttons: [btn.edit, btn.fold, btn.close],
    })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(add)  Add current tab to a new group', isNew: true },
  ];

  const qp = vscode.window.createQuickPick<Item>();
  qp.title = 'Tab groups';
  qp.placeholder = 'Jump to a group (Enter) · buttons: edit, collapse, close';
  qp.items = build();
  qp.onDidTriggerItemButton(async (e) => {
    const g = e.item.group;
    if (!g) return;
    if (e.button === btn.edit) {
      qp.hide();
      await edit(g);
      return;
    }
    if (e.button === btn.fold) await controller.toggle(g.id);
    if (e.button === btn.close) await controller.closeGroup(g.id);
    qp.items = build();
  });
  qp.onDidAccept(async () => {
    const item = qp.selectedItems[0];
    qp.hide();
    if (item?.isNew) await newGroup(targetUris());
    else if (item?.group) await controller.focusGroup(item.group.id);
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

function describe(g: Group): string {
  return `${g.members.length} tab${g.members.length === 1 ? '' : 's'}${g.collapsed ? ' · collapsed' : ''}`;
}
