import * as vscode from 'vscode';
import type { GroupSnapshot, GroupStore } from './model/GroupStore.ts';
import { displayName, type Group, type GroupColor, type SavedGroup } from './model/types.ts';
import { computeTargetOrder, planMoves, reconcilePositions, type OrderItem } from './model/ordering.ts';
import { HEADER_SETTLE_MS, isHeaderClick, neighborIndex } from './model/headerClick.ts';
import { planSplits, type OutsidePolicy } from './model/splits.ts';
import { config } from './config.ts';
import { allTabs, delay, isHeaderTab, openUris, tabUri, tabsFor } from './tabs/tabs.ts';
import { HeaderTabs } from './topbar/HeaderTabs.ts';

/** Puts back what an ungroup or close did. Safe to call more than once. */
export type Undo = () => Promise<void>;

interface TabId {
  uri?: string;
  headerOf?: string;
  label: string;
}

const FOCUS_SPLIT = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'].map(
  (n) => `workbench.action.focus${n}EditorGroup`,
);

interface StripItem extends OrderItem {
  uri?: string;
}

/**
 * Keeps the editor tab strip in line with the GroupStore: header tabs, contiguous groups,
 * collapse/expand, and Chrome-like membership changes when tabs are dragged around.
 */
export class Controller implements vscode.Disposable {
  readonly headers: HeaderTabs;
  private readonly store: GroupStore;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly lastLayout = new Map<number, string>();
  private busy = 0;
  /** Set when membership changed through a command; the tab strip isn't a user drag then. */
  private membershipChanged = false;
  private reconciling = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Last time a tab opened or closed by the user's doing (not ours). */
  private lastStructuralChange = 0;
  /** Latest header activation awaiting a click/not-a-click verdict. */
  private pendingHeader: { groupId: string; at: number } | undefined;

  constructor(ext: vscode.ExtensionContext, store: GroupStore) {
    this.store = store;
    this.headers = new HeaderTabs(ext, store, (id) => this.onHeaderActivated(id), () => this.busy > 0);
    this.disposables.push(
      this.headers,
      vscode.window.tabGroups.onDidChangeTabs((e) => this.onTabsChanged(e)),
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        this.updateNavigationContext();
        this.schedule();
      }),
      vscode.workspace.onDidRenameFiles((e) => {
        for (const f of e.files) store.replaceUri(f.oldUri.toString(), f.newUri.toString());
      }),
      store.onChange(() => {
        if (!this.reconciling) this.membershipChanged = true;
        this.schedule();
      }),
    );
    this.pruneClosedMembers();
    this.updateNavigationContext();
    this.schedule();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }

  // ---------- queries ----------

  /** Group of the active tab (file tab or header tab). */
  activeGroup(): Group | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!tab) return undefined;
    const headerOf = this.headers.groupIdForTab(tab);
    if (headerOf) return this.store.get(headerOf);
    const uri = tabUri(tab);
    return uri ? this.store.groupOf(uri.toString()) : undefined;
  }

  // ---------- group operations ----------

  createGroup(uris: string[], init: { name: string; color: GroupColor; id?: string }): Group {
    const viewColumn = this.columnOf(uris) ?? vscode.window.tabGroups.activeTabGroup.viewColumn;
    return this.store.create({ ...init, uris, viewColumn });
  }

  /** Adds tabs to a group, opening or closing them so they match the group's collapsed state. */
  async addToGroup(groupId: string, uris: string[], index?: number): Promise<void> {
    const g = this.store.get(groupId);
    if (!g) return;
    this.headers.unsuppress(groupId);
    const wasHidden = this.hiddenUris();
    this.store.addMembers(groupId, uris, index);
    if (g.collapsed) {
      await this.withBusy(() => vscode.window.tabGroups.close(tabsFor(uris), true));
    } else {
      await this.openAll(uris.filter((u) => wasHidden.has(u) || !openUris().has(u)), g.viewColumn, true);
    }
  }

  /** Ungroups tabs; tabs that were hidden in a collapsed group are reopened. */
  async removeFromGroup(uris: string[]): Promise<void> {
    const hidden = this.hiddenUris();
    this.store.removeMembers(uris);
    await this.openAll(uris.filter((u) => hidden.has(u)), undefined, true);
  }

  async collapse(groupId: string): Promise<void> {
    const g = this.store.get(groupId);
    if (!g || g.collapsed) return;
    const tabs = tabsFor(g.members);
    const dirty = tabs.filter((t) => t.isDirty);
    if (dirty.length) {
      const choice = await vscode.window.showWarningMessage(
        `${dirty.length} tab${dirty.length === 1 ? '' : 's'} in "${displayName(g)}" ${dirty.length === 1 ? 'has' : 'have'} unsaved changes.`,
        { modal: true },
        'Save and Collapse',
      );
      if (!choice) return;
      for (const t of dirty) {
        const uri = tabUri(t);
        if (uri) await vscode.workspace.save(uri);
      }
    }
    await this.withBusy(async () => {
      this.headers.unsuppress(groupId);
      this.store.update(groupId, { collapsed: true });
      this.headers.sync();
      await vscode.window.tabGroups.close(tabsFor(g.members), true);
      await this.focusAwayFromHeader(g.id);
    });
  }

  async expand(groupId: string, focus = true): Promise<void> {
    const g = this.store.get(groupId);
    if (!g || !g.collapsed) return;
    await this.withBusy(async () => {
      this.headers.unsuppress(groupId);
      // Activate the header so reopened tabs land right after it, then sync once members are open.
      this.headers.reveal(groupId);
      this.store.update(groupId, { collapsed: false });
      await this.openAll(g.members.filter((u) => !openUris().has(u)), g.viewColumn, false);
      if (this.headers.sync()) await this.headersSettled();
      await this.orderActiveGroup();
      if (focus && g.members[0]) await this.reveal(g.members[0], g.viewColumn);
    });
  }

  async toggle(groupId: string): Promise<void> {
    const g = this.store.get(groupId);
    if (g?.collapsed) await this.expand(groupId);
    else if (g) await this.collapse(groupId);
  }

  async collapseAll(exceptId?: string): Promise<void> {
    for (const g of [...this.store.all()]) {
      if (g.id !== exceptId) await this.collapse(g.id);
    }
  }

  async expandAll(): Promise<void> {
    for (const g of [...this.store.all()]) await this.expand(g.id, false);
  }

  /** Switch to a group: expand it if needed and show its first tab. */
  async focusGroup(groupId: string): Promise<void> {
    const g = this.store.get(groupId);
    if (!g) return;
    if (g.collapsed) await this.expand(groupId);
    else if (g.members[0]) await this.reveal(g.members[0], g.viewColumn);
  }

  /** Removes the group and keeps its tabs open. Returns the undo, which is also offered in a notification. */
  ungroup(groupId: string): Undo | undefined {
    const g = this.store.get(groupId);
    if (!g) return undefined;
    const snaps = this.store.snapshot([groupId]);
    this.store.remove(groupId);
    return this.offerUndo(`Ungrouped "${displayName(g)}".`, snaps);
  }

  /** Closes the group's tabs and removes the group. Undo reopens them. */
  async closeGroup(groupId: string): Promise<Undo | undefined> {
    const g = this.store.get(groupId);
    if (!g) return undefined;
    const snaps = this.store.snapshot([groupId]);
    const tabs = tabsFor(g.members);
    this.store.remove(groupId);
    await this.withBusy(() => vscode.window.tabGroups.close(tabs));
    const n = g.members.length;
    return this.offerUndo(`Closed "${displayName(g)}" (${n} tab${n === 1 ? '' : 's'}).`, snaps);
  }

  /** Ungroups every group; tabs hidden in collapsed groups are reopened. Undo collapses them again. */
  async ungroupAll(): Promise<Undo | undefined> {
    const groups = this.store.all();
    if (!groups.length) return undefined;
    const snaps = this.store.snapshot(groups.map((g) => g.id));
    await this.removeFromGroup(groups.flatMap((g) => g.members));
    const n = snaps.length;
    return this.offerUndo(`Ungrouped ${n} group${n === 1 ? '' : 's'}.`, snaps);
  }

  /** Shows `message` with an Undo button and returns the same undo for programmatic use (tests). */
  private offerUndo(message: string, snaps: GroupSnapshot[]): Undo {
    let done = false;
    const undo: Undo = async () => {
      if (done) return;
      done = true;
      await this.restoreGroups(snaps);
    };
    void vscode.window.showInformationMessage(message, 'Undo').then((choice) => (choice === 'Undo' ? undo() : undefined));
    return undo;
  }

  /**
   * Brings removed groups back: expanded groups get their tabs reopened (files that no longer exist
   * are dropped), collapsed groups get their tabs closed again.
   */
  private async restoreGroups(snaps: GroupSnapshot[]): Promise<void> {
    const expanded: GroupSnapshot[] = [];
    const collapsed: GroupSnapshot[] = [];
    for (const s of snaps) {
      if (this.store.get(s.group.id)) continue;
      if (s.group.collapsed) collapsed.push(s);
      else expanded.push({ ...s, group: { ...s.group, members: await this.existing(s.group.members) } });
    }
    await this.withBusy(async () => {
      // vscode.open moves focus into another split even with preserveFocus, so put it back after.
      const home = vscode.window.tabGroups.activeTabGroup;
      const homeColumn = home.viewColumn;
      const homeTab = home.activeTab ? this.identify(home.activeTab) : undefined;
      for (const s of expanded) {
        await this.openAll(s.group.members.filter((u) => !openUris().has(u)), s.group.viewColumn, true);
        s.group.members = s.group.members.filter((u) => openUris().has(u));
      }
      if (vscode.window.tabGroups.activeTabGroup.viewColumn !== homeColumn && (await this.focusSplit(homeColumn)) && homeTab) {
        await this.activate(homeTab);
      }
    });
    for (const g of this.store.restore([...expanded, ...collapsed])) this.headers.unsuppress(g.id);
    const toClose = collapsed.flatMap((s) => s.group.members);
    if (toClose.length) await this.withBusy(() => vscode.window.tabGroups.close(tabsFor(toClose), true));
  }

  async restoreSaved(snap: SavedGroup): Promise<void> {
    const live = this.store.get(snap.id);
    const existing = await this.existing(snap.uris);
    if (!existing.length) {
      void vscode.window.showWarningMessage(`None of the files in "${displayName(snap)}" exist anymore.`);
      return;
    }
    if (live) {
      await this.addToGroup(live.id, existing);
      await this.focusGroup(live.id);
    } else {
      await this.withBusy(() => this.openAll(existing, undefined, false));
      const g = this.createGroup(existing, { name: snap.name, color: snap.color, id: snap.id });
      await this.focusGroup(g.id);
    }
    const missing = snap.uris.length - existing.length;
    if (missing) void vscode.window.showInformationMessage(`Restored "${displayName(snap)}". ${missing} missing file(s) skipped.`);
  }

  // ---------- event handling ----------

  schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), 120);
  }

  private onTabsChanged(e: vscode.TabChangeEvent): void {
    this.updateNavigationContext();
    if (this.busy) return;
    if (e.opened.length || e.closed.length) this.lastStructuralChange = Date.now();
    const open = openUris();
    const gone: string[] = [];
    for (const tab of e.closed) {
      const uri = tabUri(tab)?.toString();
      if (!uri || open.has(uri)) continue;
      const g = this.store.groupOf(uri);
      if (g && !g.collapsed) gone.push(uri);
    }
    if (gone.length) this.store.removeMembers(gone);

    for (const tab of e.opened) {
      const uri = tabUri(tab)?.toString();
      const g = uri ? this.store.groupOf(uri) : undefined;
      if (g?.collapsed) {
        // Opening a tab of a collapsed group expands the group, like clicking a collapsed chip.
        void this.expand(g.id, false);
        return;
      }
    }
    this.schedule();
  }

  /** Run `fn` without its tab changes being read as user actions (header clicks, drags). */
  quietly<T>(fn: () => Thenable<T> | Promise<T> | T): Promise<T> {
    return this.withBusy(fn);
  }

  /**
   * A header tab became active. Decide after a short settle whether it was a click (toggle) or
   * VS Code activating it on its own, e.g. after closing a neighbor (move focus off it so the next
   * real click registers).
   */
  private onHeaderActivated(groupId: string): void {
    const at = Date.now();
    this.pendingHeader = { groupId, at };
    setTimeout(() => void this.decideHeaderActivation(groupId, at), HEADER_SETTLE_MS);
  }

  private async decideHeaderActivation(groupId: string, at: number): Promise<void> {
    if (this.pendingHeader?.at !== at) return;
    this.pendingHeader = undefined;
    if (this.busy) return;
    const stillActive = vscode.window.tabGroups.activeTabGroup.activeTab
      ? this.headers.groupIdForTab(vscode.window.tabGroups.activeTabGroup.activeTab) === groupId
      : false;
    if (isHeaderClick({ activatedAt: at, lastStructuralChange: this.lastStructuralChange, stillActive })) {
      await this.toggle(groupId);
    } else if (stillActive) {
      await this.withBusy(() => this.focusAwayFromHeader(groupId));
    }
  }

  /**
   * Context keys telling keybindings whether next/previous editor would land on a header tab,
   * so those shortcuts can skip it instead (see tabGroups.next/previousEditorSkipHeader).
   */
  private updateNavigationContext(): void {
    const flat = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    const active = flat.findIndex((t) => t.isActive && t.group.isActive);
    const next = neighborIndex(flat.length, active, 1);
    const prev = neighborIndex(flat.length, active, -1);
    const nextIsHeader = next !== undefined && isHeaderTab(flat[next]);
    const prevIsHeader = prev !== undefined && isHeaderTab(flat[prev]);
    if (nextIsHeader !== this.navContext.next) {
      this.navContext.next = nextIsHeader;
      void vscode.commands.executeCommand('setContext', 'tabGroups.nextIsHeader', nextIsHeader);
    }
    if (prevIsHeader !== this.navContext.prev) {
      this.navContext.prev = prevIsHeader;
      void vscode.commands.executeCommand('setContext', 'tabGroups.prevIsHeader', prevIsHeader);
    }
  }

  private readonly navContext = { next: false, prev: false };

  private async tick(): Promise<void> {
    if (this.busy) {
      this.schedule();
      return;
    }
    const byCommand = this.membershipChanged;
    if (config().joinByPosition && !byCommand) {
      this.reconciling = true;
      try {
        this.reconcileDrags();
      } finally {
        this.reconciling = false;
      }
    }
    this.membershipChanged = false;
    if (config().reorder) await this.followSplits(byCommand ? 'bring' : config().joinByPosition ? 'leave' : 'keep');
    await this.refreshTabStrip();
  }

  /** Applies Chrome's drag semantics to tabs the user moved since the last snapshot. */
  private reconcileDrags(): void {
    for (const eg of vscode.window.tabGroups.all) {
      const prev = this.lastLayout.get(eg.viewColumn);
      if (prev === undefined || prev === this.layoutOf(eg)) continue;
      const items = this.stripItems(eg);
      const activeIndex = eg.tabs.findIndex((t) => t.isActive);
      const { leave, join } = reconcilePositions(items, activeIndex >= 0 ? `t${activeIndex}` : undefined);
      const uriOf = (key: string) => items.find((x) => x.key === key)?.uri;
      const leaving = leave.map(uriOf).filter((u): u is string => !!u);
      if (leaving.length) this.store.removeMembers(leaving);
      for (const j of join) {
        const uri = uriOf(j.key);
        if (uri) this.store.addMembers(j.group, [uri]);
      }
    }
  }

  /**
   * Keeps every group in one split: a dragged header takes its members along, members dragged
   * away all together take the header along, and members dragged away alone follow `outside`.
   */
  private async followSplits(outside: OutsidePolicy): Promise<void> {
    const columns = new Map<string, number[]>();
    for (const t of allTabs()) {
      const uri = tabUri(t)?.toString();
      if (uri) columns.set(uri, [...(columns.get(uri) ?? []), t.group.viewColumn]);
    }
    const moves: { uris: string[]; groupId: string }[] = [];
    this.reconciling = true;
    try {
      for (const g of [...this.store.all()]) {
        const plan = planSplits(
          {
            home: g.viewColumn,
            headerColumn: this.headers.columnOf(g.id),
            members: g.members.map((uri) => ({ uri, columns: columns.get(uri) ?? [] })),
          },
          outside,
        );
        if (plan.leave.length) this.store.removeMembers(plan.leave);
        if (plan.home !== g.viewColumn && this.store.get(g.id)) this.store.update(g.id, { viewColumn: plan.home });
        if (plan.bring.length) moves.push({ uris: plan.bring, groupId: g.id });
      }
    } finally {
      this.reconciling = false;
    }
    if (moves.length) await this.withBusy(() => this.moveIntoSplits(moves));
  }

  /** Moves member tabs into their group's split, then puts focus back where it was. */
  private async moveIntoSplits(moves: { uris: string[]; groupId: string }[]): Promise<void> {
    const home = vscode.window.tabGroups.activeTabGroup;
    const homeTab = home.activeTab ? this.identify(home.activeTab) : undefined;
    for (const { uris, groupId } of moves) {
      const g = this.store.get(groupId);
      const target = g && this.split(g.viewColumn);
      if (!target) continue;
      for (const uri of uris) {
        const tab = allTabs().find((t) => tabUri(t)?.toString() === uri && t.group.viewColumn !== target.viewColumn);
        if (!tab || !(await this.focusSplit(tab.group.viewColumn))) continue;
        await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', tab.group.tabs.indexOf(tab));
        await vscode.commands.executeCommand('moveActiveEditor', { to: 'position', by: 'group', value: target.viewColumn });
        for (let i = 0; i < 20 && !target.tabs.some((t) => tabUri(t)?.toString() === uri); i++) await delay(25);
        await this.moveAfterGroup(target, uri, groupId);
      }
      // Moving a split's last tab out closes that split and renumbers the ones after it.
      if (this.store.get(groupId)?.viewColumn !== target.viewColumn) {
        this.reconciling = true;
        try {
          this.store.update(groupId, { viewColumn: target.viewColumn });
        } finally {
          this.reconciling = false;
        }
      }
    }
    if (vscode.window.tabGroups.all.includes(home) && (await this.focusSplit(home.viewColumn)) && homeTab) await this.activate(homeTab);
  }

  /** A tab moved into a split lands after the active tab; put it at the end of its group, like Chrome. */
  private async moveAfterGroup(split: vscode.TabGroup, uri: string, groupId: string): Promise<void> {
    const members = new Set(this.store.get(groupId)?.members);
    const tabs = split.tabs;
    const i = tabs.findIndex((t) => tabUri(t)?.toString() === uri);
    let last = -1;
    tabs.forEach((t, j) => {
      const u = tabUri(t)?.toString();
      if (j !== i && (this.headers.groupIdForTab(t) === groupId || (u && members.has(u)))) last = j;
    });
    if (i < 0 || last < 0 || i === last + 1) return;
    const to = i < last ? last : last + 1;
    await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', i);
    await vscode.commands.executeCommand('moveActiveEditor', { to: 'position', by: 'tab', value: to + 1 });
  }

  private async refreshTabStrip(): Promise<void> {
    await this.withBusy(async () => {
      const home = vscode.window.tabGroups.activeTabGroup.viewColumn;
      // What each split shows now; new header panels and reordering both change it.
      const shown = new Map<number, TabId>();
      for (const eg of vscode.window.tabGroups.all) if (eg.activeTab) shown.set(eg.viewColumn, this.identify(eg.activeTab));
      const created = this.headers.sync();
      if (created) await this.headersSettled();
      const moved = config().reorder ? await this.orderAllSplits() : false;
      if (created || moved) await this.restoreShown(shown, home);
    });
  }

  /** Reorders every split so each tab group is contiguous with its header first. */
  private async orderAllSplits(): Promise<boolean> {
    let moved = false;
    for (const column of vscode.window.tabGroups.all.map((eg) => eg.viewColumn)) {
      const eg = this.split(column);
      if (!eg || !this.planFor(eg).length) continue;
      if (!(await this.focusSplit(column))) continue;
      moved = (await this.orderActiveGroup()) || moved;
    }
    return moved;
  }

  /** Reorders the active editor group so each tab group is contiguous with its header first. */
  private async orderActiveGroup(): Promise<boolean> {
    const moves = this.planFor(vscode.window.tabGroups.activeTabGroup);
    for (const m of moves) {
      await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', m.from);
      await vscode.commands.executeCommand('moveActiveEditor', { to: 'position', by: 'tab', value: m.to + 1 });
    }
    return moves.length > 0;
  }

  private planFor(eg: vscode.TabGroup) {
    const items = this.stripItems(eg);
    return planMoves(items.map((x) => x.key), computeTargetOrder(items));
  }

  /** Puts back the tab each split showed, then returns focus to the split that had it. */
  private async restoreShown(shown: Map<number, TabId>, home: number): Promise<void> {
    for (const [column, id] of shown) {
      if (column === home) continue;
      const active = this.split(column)?.activeTab;
      if (active && this.sameTab(active, id)) continue;
      if (await this.focusSplit(column)) await this.activate(id);
    }
    await this.focusSplit(home);
    const homeTab = shown.get(home);
    if (homeTab) await this.activate(homeTab);
  }

  // ---------- helpers ----------

  /** New webview panels reach the extension's tab model asynchronously. */
  private async headersSettled(): Promise<void> {
    for (let i = 0; i < 20 && !this.headers.allVisibleAsTabs(); i++) await delay(25);
  }

  private stripItems(eg: vscode.TabGroup): StripItem[] {
    return eg.tabs.map((tab, i) => {
      const key = `t${i}`;
      const headerOf = this.headers.groupIdForTab(tab);
      if (headerOf) return { key, group: headerOf, isHeader: true, pinned: tab.isPinned };
      const uri = tabUri(tab)?.toString();
      const group = uri ? this.store.groupOf(uri)?.id : undefined;
      return { key, uri, group, pinned: tab.isPinned };
    });
  }

  private layoutOf(eg: vscode.TabGroup): string {
    return eg.tabs.map((t) => this.headers.groupIdForTab(t) ?? tabUri(t)?.toString() ?? t.label).join('\n');
  }

  private snapshotLayouts(): void {
    this.lastLayout.clear();
    for (const eg of vscode.window.tabGroups.all) this.lastLayout.set(eg.viewColumn, this.layoutOf(eg));
  }

  private identify(tab: vscode.Tab): TabId {
    return { uri: tabUri(tab)?.toString(), headerOf: this.headers.groupIdForTab(tab), label: tab.label };
  }

  private sameTab(t: vscode.Tab, id: TabId): boolean {
    return id.headerOf ? this.headers.groupIdForTab(t) === id.headerOf : id.uri ? tabUri(t)?.toString() === id.uri : t.label === id.label;
  }

  private split(column: number): vscode.TabGroup | undefined {
    return vscode.window.tabGroups.all.find((eg) => eg.viewColumn === column);
  }

  /** Focuses the split in `column` (1–8, VS Code's own limit for these commands). */
  private async focusSplit(column: number): Promise<boolean> {
    if (vscode.window.tabGroups.activeTabGroup.viewColumn === column) return true;
    const command = FOCUS_SPLIT[column - 1];
    if (!command || !this.split(column)) return false;
    await vscode.commands.executeCommand(command);
    for (let i = 0; i < 20 && vscode.window.tabGroups.activeTabGroup.viewColumn !== column; i++) await delay(25);
    return vscode.window.tabGroups.activeTabGroup.viewColumn === column;
  }

  private async activate(id: TabId): Promise<void> {
    const eg = vscode.window.tabGroups.activeTabGroup;
    const index = eg.tabs.findIndex((t) => this.sameTab(t, id));
    if (index >= 0 && !eg.tabs[index].isActive) {
      await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', index);
    }
  }

  /** After collapsing, don't leave the header tab active (clicking it again must register). */
  private async focusAwayFromHeader(groupId: string): Promise<void> {
    const eg = vscode.window.tabGroups.activeTabGroup;
    const h = eg.tabs.findIndex((t) => this.headers.groupIdForTab(t) === groupId);
    if (h < 0 || !eg.tabs[h].isActive) return;
    const candidates = [...eg.tabs.keys()].filter((i) => !isHeaderTab(eg.tabs[i]));
    const next = candidates.find((i) => i > h) ?? candidates.reverse().find((i) => i < h);
    if (next !== undefined) await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', next);
  }

  private async reveal(uri: string, viewColumn: number): Promise<void> {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(uri), { viewColumn, preview: false });
  }

  private async openAll(uris: string[], viewColumn: number | undefined, preserveFocus: boolean): Promise<void> {
    const failed: string[] = [];
    for (const uri of uris) {
      try {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(uri), {
          viewColumn: viewColumn ?? vscode.ViewColumn.Active,
          preview: false,
          preserveFocus,
        });
      } catch {
        failed.push(uri);
      }
    }
    const opened = uris.filter((u) => !failed.includes(u));
    for (let i = 0; i < 40 && opened.some((u) => !openUris().has(u)); i++) await delay(25);
    if (failed.length) {
      this.store.removeMembers(failed);
      void vscode.window.showWarningMessage(`${failed.length} file(s) could not be opened and were removed from their group.`);
    }
  }

  private async existing(uris: string[]): Promise<string[]> {
    const checks = await Promise.all(
      uris.map((u) =>
        Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.parse(u))).then(
          () => true,
          () => false,
        ),
      ),
    );
    return uris.filter((_, i) => checks[i]);
  }

  private hiddenUris(): Set<string> {
    return new Set(this.store.all().filter((g) => g.collapsed).flatMap((g) => g.members));
  }

  private columnOf(uris: string[]): number | undefined {
    const set = new Set(uris);
    return allTabs().find((t) => set.has(tabUri(t)?.toString() ?? ''))?.group.viewColumn;
  }

  /** Members of expanded groups whose tabs were closed while the extension wasn't running. */
  private pruneClosedMembers(): void {
    const open = openUris();
    const stale = this.store
      .all()
      .filter((g) => !g.collapsed)
      .flatMap((g) => g.members.filter((m) => !open.has(m)));
    if (stale.length) this.store.removeMembers(stale);
  }

  private async withBusy<T>(fn: () => Thenable<T> | Promise<T> | T): Promise<T> {
    this.busy++;
    try {
      return await fn();
    } finally {
      // Let VS Code deliver the tab events our own changes caused before listening again.
      await delay(80);
      this.busy--;
      if (!this.busy) this.snapshotLayouts();
    }
  }
}
