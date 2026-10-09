import * as path from 'node:path';
import * as vscode from 'vscode';
import type { GroupStore } from '../model/GroupStore.ts';
import { displayName, type SavedGroup } from '../model/types.ts';
import { allTabs, tabUri } from '../tabs/tabs.ts';
import type { Controller } from '../controller.ts';

export type Node =
  | { kind: 'group'; groupId: string }
  | { kind: 'member'; groupId: string; uri: string }
  | { kind: 'ungroupedRoot' }
  | { kind: 'ungrouped'; uri: string }
  | { kind: 'saved'; savedId: string }
  | { kind: 'savedUri'; savedId: string; uri: string };

const TREE_MIME = 'application/vnd.code.tree.tabgroups.groups';
const UNGROUPED_ROOT: Node = { kind: 'ungroupedRoot' };

export function isNode(x: unknown): x is Node {
  return typeof x === 'object' && x !== null && 'kind' in x;
}

/** Live groups → their tabs, plus open ungrouped tabs. Supports drag & drop like the tab strip. */
export class GroupTree implements vscode.TreeDataProvider<Node>, vscode.TreeDragAndDropController<Node> {
  readonly dragMimeTypes = [TREE_MIME];
  readonly dropMimeTypes = [TREE_MIME, 'text/uri-list'];
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly store: GroupStore;
  private readonly controller: Controller;
  private readonly nodes = new Map<string, Node>();

  constructor(store: GroupStore, controller: Controller) {
    this.store = store;
    this.controller = controller;
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  /** Stable node instances so TreeView.reveal can find them. */
  node(n: Node): Node {
    const id = nodeId(n);
    const existing = this.nodes.get(id);
    if (existing) return existing;
    this.nodes.set(id, n);
    return n;
  }

  getChildren(element?: Node): Node[] {
    if (!element) {
      const roots: Node[] = this.store.all().map((g) => this.node({ kind: 'group', groupId: g.id }));
      if (ungroupedUris(this.store).length) roots.push(UNGROUPED_ROOT);
      return roots;
    }
    if (element.kind === 'group') {
      return (this.store.get(element.groupId)?.members ?? []).map((uri) => this.node({ kind: 'member', groupId: element.groupId, uri }));
    }
    if (element.kind === 'ungroupedRoot') {
      return ungroupedUris(this.store).map((uri) => this.node({ kind: 'ungrouped', uri }));
    }
    return [];
  }

  getParent(element: Node): Node | undefined {
    if (element.kind === 'member') return this.node({ kind: 'group', groupId: element.groupId });
    if (element.kind === 'ungrouped') return UNGROUPED_ROOT;
    return undefined;
  }

  getTreeItem(n: Node): vscode.TreeItem {
    switch (n.kind) {
      case 'group': {
        const g = this.store.get(n.groupId);
        if (!g) return new vscode.TreeItem('');
        const item = new vscode.TreeItem(displayName(g), vscode.TreeItemCollapsibleState.Expanded);
        item.id = nodeId(n);
        item.iconPath = new vscode.ThemeIcon(g.collapsed ? 'circle-large-outline' : 'circle-large-filled', new vscode.ThemeColor(`tabGroups.${g.color}`));
        item.description = `${g.members.length} tab${g.members.length === 1 ? '' : 's'}${g.collapsed ? ' · collapsed' : ''}`;
        item.contextValue = g.collapsed ? 'group.collapsed' : 'group';
        item.tooltip = `${displayName(g)} — ${item.description}\nDrag tabs here to add them. Drag groups to reorder.`;
        return item;
      }
      case 'member':
      case 'ungrouped':
      case 'savedUri':
        return fileItem(n, n.kind === 'member' && !!this.store.get(n.groupId)?.collapsed);
      case 'ungroupedRoot': {
        const item = new vscode.TreeItem('Ungrouped tabs', vscode.TreeItemCollapsibleState.Expanded);
        item.id = 'ungrouped-root';
        item.iconPath = new vscode.ThemeIcon('files');
        item.contextValue = 'ungroupedRoot';
        item.tooltip = 'Open tabs that are not in a group. Drag one onto a group to add it.';
        return item;
      }
      default:
        return new vscode.TreeItem('');
    }
  }

  handleDrag(source: readonly Node[], data: vscode.DataTransfer): void {
    data.set(TREE_MIME, new vscode.DataTransferItem(source));
  }

  async handleDrop(target: Node | undefined, data: vscode.DataTransfer): Promise<void> {
    const targetGroup = target?.kind === 'group' || target?.kind === 'member' ? target.groupId : undefined;
    const dragged = data.get(TREE_MIME)?.value as Node[] | undefined;

    if (!dragged) {
      // Files dragged from the Explorer.
      const list = await data.get('text/uri-list')?.asString();
      const uris = (list ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      if (targetGroup && uris.length) await this.controller.addToGroup(targetGroup, uris.map((u) => vscode.Uri.parse(u).toString()));
      return;
    }

    const draggedGroups = dragged.filter((n) => n.kind === 'group').map((n) => n.groupId);
    for (const id of draggedGroups) this.store.move(id, targetGroup);

    const uris = dragged.flatMap((n) => (n.kind === 'member' || n.kind === 'ungrouped' ? [n.uri] : []));
    if (!uris.length) return;
    if (targetGroup) {
      const index = target?.kind === 'member' ? this.store.get(targetGroup)?.members.indexOf(target.uri) : undefined;
      await this.controller.addToGroup(targetGroup, uris, index);
    } else {
      await this.controller.removeFromGroup(uris);
    }
  }
}

/** Saved snapshots (global across workspaces). */
export class SavedTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly store: GroupStore;

  constructor(store: GroupStore) {
    this.store = store;
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getChildren(element?: Node): Node[] {
    if (!element) return this.store.savedGroups().map((s) => ({ kind: 'saved', savedId: s.id }));
    if (element.kind === 'saved') {
      const s = this.saved(element.savedId);
      return (s?.uris ?? []).map((uri) => ({ kind: 'savedUri', savedId: element.savedId, uri }));
    }
    return [];
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.kind === 'savedUri') return fileItem(n, false);
    if (n.kind !== 'saved') return new vscode.TreeItem('');
    const s = this.saved(n.savedId);
    if (!s) return new vscode.TreeItem('');
    const item = new vscode.TreeItem(displayName(s), vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `saved:${s.id}`;
    item.iconPath = new vscode.ThemeIcon('circle-large-filled', new vscode.ThemeColor(`tabGroups.${s.color}`));
    item.description = `${s.uris.length} tab${s.uris.length === 1 ? '' : 's'} · ${new Date(s.savedAt).toLocaleDateString()}`;
    item.contextValue = 'saved';
    item.tooltip = `${displayName(s)} — saved ${new Date(s.savedAt).toLocaleString()}\nClick the folder icon to restore.`;
    return item;
  }

  saved(id: string): SavedGroup | undefined {
    return this.store.savedGroups().find((s) => s.id === id);
  }
}

function fileItem(n: Node & { uri: string }, hidden: boolean): vscode.TreeItem {
  const uri = vscode.Uri.parse(n.uri);
  const item = new vscode.TreeItem(uri, vscode.TreeItemCollapsibleState.None);
  item.id = nodeId(n);
  const rel = vscode.workspace.asRelativePath(uri, false);
  const dir = path.posix.dirname(rel);
  item.description = [dir !== '.' && dir !== rel ? dir : '', hidden ? '(hidden)' : ''].filter(Boolean).join(' ');
  item.contextValue = n.kind;
  item.command = { command: 'tabGroups.openTab', title: 'Open', arguments: [n] };
  return item;
}

function nodeId(n: Node): string {
  switch (n.kind) {
    case 'group':
      return `group:${n.groupId}`;
    case 'member':
      return `member:${n.groupId}:${n.uri}`;
    case 'ungroupedRoot':
      return 'ungrouped-root';
    case 'ungrouped':
      return `ungrouped:${n.uri}`;
    case 'saved':
      return `saved:${n.savedId}`;
    case 'savedUri':
      return `savedUri:${n.savedId}:${n.uri}`;
  }
}

function ungroupedUris(store: GroupStore): string[] {
  const seen = new Set<string>();
  for (const tab of allTabs()) {
    const uri = tabUri(tab)?.toString();
    if (uri && !store.groupOf(uri)) seen.add(uri);
  }
  return [...seen];
}

