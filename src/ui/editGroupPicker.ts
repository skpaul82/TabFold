import * as vscode from 'vscode';
import { COLOR_EMOJI, GROUP_COLORS, capitalize, type GroupColor } from '../model/types.ts';

export interface PickerAction {
  id: string;
  label: string;
}

type Item = vscode.QuickPickItem & { color?: GroupColor; action?: string };

export type PickerResult = { name: string; color: GroupColor } | { action: string } | undefined;

/**
 * Chrome's group bubble as a single Quick Pick: type the name, arrow to a color, press Enter.
 * Extra actions (collapse, ungroup, close…) are listed below the colors.
 */
export function editGroupPicker(opts: { title: string; name: string; color: GroupColor; actions?: PickerAction[] }): Promise<PickerResult> {
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick<Item>();
    qp.title = opts.title;
    qp.placeholder = 'Group name — then pick a color and press Enter';
    qp.value = opts.name;
    qp.matchOnDescription = false;
    const colorItems: Item[] = GROUP_COLORS.map((c) => ({
      label: `${COLOR_EMOJI[c]}  ${capitalize(c)}`,
      description: c === opts.color ? 'current' : undefined,
      color: c,
      alwaysShow: true,
    }));
    const actionItems: Item[] = (opts.actions ?? []).map((a) => ({ label: a.label, action: a.id, alwaysShow: true }));
    qp.items = actionItems.length
      ? [...colorItems, { label: 'Group', kind: vscode.QuickPickItemKind.Separator, alwaysShow: true }, ...actionItems]
      : colorItems;
    const current = colorItems.find((i) => i.color === opts.color)!;
    qp.activeItems = [current];
    // Typing filters and resets the highlighted row; keep it on the chosen color.
    let chosen: Item = current;
    qp.onDidChangeActive((items) => {
      if (items[0]) chosen = items[0];
    });
    qp.onDidChangeValue(() => {
      qp.activeItems = [chosen];
    });

    let result: PickerResult;
    qp.onDidAccept(() => {
      const item = qp.selectedItems[0] ?? qp.activeItems[0] ?? chosen;
      result = item.action ? { action: item.action } : { name: qp.value.trim(), color: item.color ?? opts.color };
      qp.hide();
    });
    qp.onDidHide(() => {
      qp.dispose();
      resolve(result);
    });
    qp.show();
  });
}
