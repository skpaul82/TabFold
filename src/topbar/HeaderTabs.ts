import * as vscode from 'vscode';
import type { GroupStore } from '../model/GroupStore.ts';
import { displayName, type Group } from '../model/types.ts';
import { config } from '../config.ts';
import { HEADER_VIEW_TYPE, isHeaderTab, openUris } from '../tabs/tabs.ts';

/**
 * The closest thing to Chrome's group chip that the extension API allows: a small, script-free
 * webview tab titled with the group name, kept in front of the group's tabs. Activations are
 * reported to the controller, which decides whether they were clicks (toggle the group).
 */
export class HeaderTabs implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  /** Groups whose header the user closed; they stay header-less until expanded or edited. */
  private readonly suppressed = new Set<string>();
  private readonly ours = new WeakSet<vscode.WebviewPanel>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly ext: vscode.ExtensionContext;
  private readonly store: GroupStore;
  private readonly onActivate: (groupId: string) => void;
  private readonly isBusy: () => boolean;
  /** Ignore activations while VS Code restores the window. */
  private readonly readyAt = Date.now() + 2000;

  constructor(ext: vscode.ExtensionContext, store: GroupStore, onActivate: (groupId: string) => void, isBusy: () => boolean) {
    this.ext = ext;
    this.store = store;
    this.onActivate = onActivate;
    this.isBusy = isBusy;
    this.disposables.push(
      vscode.window.registerWebviewPanelSerializer(HEADER_VIEW_TYPE, {
        deserializeWebviewPanel: async (panel) => this.adopt(panel),
      }),
    );
  }

  /** Group id for a header tab in the tab strip. */
  groupIdForTab(tab: vscode.Tab): string | undefined {
    if (!isHeaderTab(tab)) return undefined;
    for (const [id, panel] of this.panels) {
      if (panel.title === tab.label && panel.viewColumn === tab.group.viewColumn) return id;
    }
    return undefined;
  }

  /** True once every header panel shows up in vscode.window.tabGroups, in its group's split. */
  allVisibleAsTabs(): boolean {
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter(isHeaderTab);
    return [...this.panels].every(([id, p]) => {
      const column = this.store.get(id)?.viewColumn ?? p.viewColumn;
      return p.viewColumn === column && tabs.some((t) => t.label === p.title && t.group.viewColumn === column);
    });
  }

  /** Split the group's header tab is in, if it has one. */
  columnOf(groupId: string): number | undefined {
    return this.panels.get(groupId)?.viewColumn;
  }

  reveal(groupId: string): void {
    const panel = this.panels.get(groupId);
    panel?.reveal(panel.viewColumn, false);
  }

  unsuppress(groupId: string): void {
    this.suppressed.delete(groupId);
  }

  /** Creates, updates, moves and removes header tabs to match the store. Returns true if a header was created or moved. */
  sync(): boolean {
    const wanted = this.wanted();
    for (const [id, panel] of this.panels) {
      if (!wanted.has(id)) this.close(id, panel);
    }
    for (const id of this.suppressed) {
      if (!this.store.get(id)) this.suppressed.delete(id);
    }
    const titles = this.titles([...wanted.values()]);
    let created = false;
    for (const g of wanted.values()) {
      const title = titles.get(g.id)!;
      let panel = this.panels.get(g.id);
      if (!panel) {
        panel = vscode.window.createWebviewPanel(
          HEADER_VIEW_TYPE,
          title,
          { viewColumn: g.viewColumn, preserveFocus: true },
          { enableScripts: false, enableFindWidget: false, enableCommandUris: false },
        );
        this.attach(g.id, panel);
        created = true;
      }
      else if (panel.viewColumn !== undefined && panel.viewColumn !== g.viewColumn) {
        // The group moved to another split; the header follows.
        panel.reveal(g.viewColumn, true);
        created = true;
      }
      if (panel.title !== title) panel.title = title;
      this.render(panel, g);
    }
    return created;
  }

  dispose(): void {
    for (const [id, panel] of this.panels) this.close(id, panel);
    this.disposables.forEach((d) => d.dispose());
  }

  private wanted(): Map<string, Group> {
    const wanted = new Map<string, Group>();
    if (!config().headerTabs) return wanted;
    const open = openUris();
    for (const g of this.store.all()) {
      if (this.suppressed.has(g.id)) continue;
      if (g.collapsed || g.members.some((m) => open.has(m))) wanted.set(g.id, g);
    }
    return wanted;
  }

  /** Tab titles must be unique so header tabs can be matched back to their group. */
  private titles(groups: Group[]): Map<string, string> {
    const out = new Map<string, string>();
    const seen = new Set<string>();
    for (const g of groups) {
      const base = `${g.collapsed ? '▸' : '▾'} ${displayName(g)}${g.collapsed ? ` (${g.members.length})` : ''}`;
      let title = base;
      for (let i = 2; seen.has(title); i++) title = `${base} #${i}`;
      seen.add(title);
      out.set(g.id, title);
    }
    return out;
  }

  private adopt(panel: vscode.WebviewPanel): void {
    const wanted = this.wanted();
    const titles = this.titles([...wanted.values()]);
    const match = [...wanted.values()].find((g) => !this.panels.has(g.id) && titles.get(g.id) === panel.title);
    if (!match) {
      this.ours.add(panel);
      panel.dispose();
      return;
    }
    panel.webview.options = { enableScripts: false, enableCommandUris: false };
    this.attach(match.id, panel);
    this.render(panel, match);
  }

  private attach(groupId: string, panel: vscode.WebviewPanel): void {
    this.panels.set(groupId, panel);
    panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active && !this.isBusy() && Date.now() > this.readyAt) this.onActivate(groupId);
    });
    panel.onDidDispose(() => {
      if (this.panels.get(groupId) === panel) this.panels.delete(groupId);
      if (!this.ours.has(panel) && this.store.get(groupId)) this.suppressed.add(groupId);
    });
  }

  private close(groupId: string, panel: vscode.WebviewPanel): void {
    this.ours.add(panel);
    this.panels.delete(groupId);
    panel.dispose();
  }

  private render(panel: vscode.WebviewPanel, g: Group): void {
    panel.iconPath = vscode.Uri.joinPath(this.ext.extensionUri, 'media', 'dots', `${g.color}.svg`);
    const html = headerHtml(g);
    if (panel.webview.html !== html) panel.webview.html = html;
  }
}

function headerHtml(g: Group): string {
  const name = escapeHtml(displayName(g));
  const count = g.members.length;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); display: grid; place-items: center; height: 100vh; margin: 0; }
  .chip { display: inline-flex; align-items: center; gap: .5em; padding: .35em .9em; border-radius: 999px; font-weight: 600;
          background: var(--vscode-tabGroups-${g.color}); color: var(--vscode-editor-background); }
  p { opacity: .75; text-align: center; line-height: 1.6; }
  kbd { font-family: var(--vscode-editor-font-family); border: 1px solid var(--vscode-widget-border, currentColor); border-radius: 3px; padding: 0 .3em; }
</style></head>
<body><div>
  <p><span class="chip">${name}</span></p>
  <p>${count} tab${count === 1 ? '' : 's'} · ${g.collapsed ? 'collapsed' : 'expanded'}<br>
  Click this header tab to ${g.collapsed ? 'expand' : 'collapse'} the group.<br>
  <kbd>Cmd/Ctrl+K</kbd> <kbd>Shift+G</kbd> switches groups.</p>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
