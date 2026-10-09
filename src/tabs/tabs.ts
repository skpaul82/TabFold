import * as vscode from 'vscode';

export const HEADER_VIEW_TYPE = 'tabGroups.header';

/** The resource a tab shows, for tab kinds that can be reopened. Terminals, webviews etc. return undefined. */
export function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) return input.uri;
  if (input instanceof vscode.TabInputTextDiff) return input.modified;
  if (input instanceof vscode.TabInputCustom) return input.uri;
  if (input instanceof vscode.TabInputNotebook) return input.uri;
  if (input instanceof vscode.TabInputNotebookDiff) return input.modified;
  return undefined;
}

export function isHeaderTab(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(HEADER_VIEW_TYPE);
}

export function allTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((g) => g.tabs);
}

export function openUris(): Set<string> {
  const set = new Set<string>();
  for (const tab of allTabs()) {
    const uri = tabUri(tab);
    if (uri) set.add(uri.toString());
  }
  return set;
}

export function tabsFor(uris: Iterable<string>): vscode.Tab[] {
  const set = new Set(uris);
  return allTabs().filter((t) => {
    const uri = tabUri(t);
    return uri !== undefined && set.has(uri.toString());
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
