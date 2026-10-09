const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const labels = () => vscode.window.tabGroups.activeTabGroup.tabs.map((t) => t.label);
const file = (n) => vscode.Uri.file(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, `${n}.txt`));

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✔ ${name}`);
  } catch (e) {
    console.log(`  ✖ ${name}\n    tabs: ${JSON.stringify(labels())}`);
    throw e;
  }
}

exports.run = async function () {
  try {
    await suite();
  } catch (e) {
    console.log(`  ✖ suite error: ${e?.stack ?? e}`);
    throw e;
  }
};

async function suite() {
  const ext = vscode.extensions.getExtension('skpaul82.tabfold');
  const { store, controller } = await ext.activate();
  await sleep(2500); // past the header-click startup guard

  for (const n of ['a', 'b', 'c', 'd']) await vscode.window.showTextDocument(file(n), { preview: false });

  let g;
  await step('grouping non-adjacent tabs makes them contiguous with a header tab', async () => {
    g = controller.createGroup([file('a').toString(), file('d').toString()], { name: 'API', color: 'blue' });
    await sleep(1500);
    assert.deepEqual(labels(), ['▾ API', 'a.txt', 'd.txt', 'b.txt', 'c.txt']);
  });

  await step('collapse closes member tabs and marks the header', async () => {
    await controller.collapse(g.id);
    await sleep(800);
    assert.deepEqual(labels(), ['▸ API (2)', 'b.txt', 'c.txt']);
    assert.equal(store.get(g.id).collapsed, true);
  });

  await step('expand reopens members in order', async () => {
    await controller.expand(g.id);
    await sleep(1000);
    assert.deepEqual(labels(), ['▾ API', 'a.txt', 'd.txt', 'b.txt', 'c.txt']);
  });

  await step('clicking the header tab toggles the group', async () => {
    await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', 0);
    await sleep(1500);
    assert.equal(store.get(g.id).collapsed, true);
    assert.deepEqual(labels(), ['▸ API (2)', 'b.txt', 'c.txt']);
    await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', 0);
    await sleep(1500);
    assert.equal(store.get(g.id).collapsed, false);
  });

  await step('header activated right after a tab closes is not a click; focus leaves the header', async () => {
    const c = vscode.window.tabGroups.activeTabGroup.tabs.find((t) => t.label === 'c.txt');
    await vscode.window.tabGroups.close(c);
    await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', 0); // VS Code falling back onto the header
    await sleep(1200);
    assert.equal(store.get(g.id).collapsed, false);
    assert.notEqual(vscode.window.tabGroups.activeTabGroup.activeTab.label, '▾ API');
  });

  await step('a real click still toggles after a suppressed activation', async () => {
    await sleep(600);
    await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', 0);
    await sleep(1500);
    assert.equal(store.get(g.id).collapsed, true);
    await controller.expand(g.id);
    await sleep(1000);
    assert.deepEqual(labels(), ['▾ API', 'a.txt', 'd.txt', 'b.txt']);
  });

  await step('next-editor skips the header tab without toggling', async () => {
    await vscode.window.showTextDocument(file('b'), { preview: false }); // last tab; next wraps to the header
    await sleep(300);
    await vscode.commands.executeCommand('tabGroups.nextEditorSkipHeader');
    await sleep(800);
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.label, 'a.txt');
    assert.equal(store.get(g.id).collapsed, false);
  });

  await step('dragging a member out of the block removes it from the group', async () => {
    await vscode.window.showTextDocument(file('d'), { preview: false });
    await vscode.commands.executeCommand('moveActiveEditor', { to: 'last', by: 'tab' });
    await sleep(1200);
    assert.deepEqual(store.get(g.id).members, [file('a').toString()]);
  });

  await step('dropping a tab between two members adds it to the group', async () => {
    store.addMembers(g.id, [file('b').toString()]);
    await sleep(1200);
    assert.deepEqual(labels().slice(0, 3), ['▾ API', 'a.txt', 'b.txt']);
    await vscode.window.showTextDocument(file('c'), { preview: false });
    await vscode.commands.executeCommand('moveActiveEditor', { to: 'position', by: 'tab', value: 3 });
    await sleep(1200);
    assert.ok(store.get(g.id).members.includes(file('c').toString()), JSON.stringify(store.get(g.id).members));
  });

  await step('closing the last member tab deletes the group and its header', async () => {
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((eg) => eg.tabs).filter((t) => t.input?.uri && store.groupOf(t.input.uri.toString())));
    await sleep(1200);
    assert.equal(store.all().length, 0);
    assert.ok(!labels().some((l) => l.startsWith('▾')), JSON.stringify(labels()));
  });
  await step('groups stay together in a background split, and focus stays put', async () => {
    for (const n of ['e', 'f', 'g']) await vscode.window.showTextDocument(file(n), { viewColumn: vscode.ViewColumn.Two, preview: false });
    await vscode.window.showTextDocument(file('b'), { viewColumn: vscode.ViewColumn.One, preview: false });
    await sleep(800);
    const g2 = controller.createGroup([file('e').toString(), file('g').toString()], { name: 'Docs', color: 'green' });
    await sleep(2500);
    const split2 = vscode.window.tabGroups.all.find((x) => x.viewColumn === vscode.ViewColumn.Two);
    assert.deepEqual(split2.tabs.map((t) => t.label), ['▾ Docs', 'e.txt', 'g.txt', 'f.txt']);
    assert.equal(split2.activeTab.label, 'g.txt', 'split 2 keeps showing the editor it showed');
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.One, 'focus stays in split 1');
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.label, 'b.txt');
    assert.equal(store.get(g2.id).members.length, 2);
  });

  const split2Labels = () => vscode.window.tabGroups.all.find((x) => x.viewColumn === vscode.ViewColumn.Two).tabs.map((t) => t.label);
  const docs = () => store.all().find((x) => x.name === 'Docs');

  await step('undo after ungroup brings the group back', async () => {
    const undo = controller.ungroup(docs().id);
    await sleep(1200);
    assert.equal(docs(), undefined);
    assert.ok(!split2Labels().includes('▾ Docs'), JSON.stringify(split2Labels()));
    await undo();
    await sleep(1500);
    assert.deepEqual(docs().members, [file('e').toString(), file('g').toString()]);
    assert.deepEqual(split2Labels(), ['▾ Docs', 'e.txt', 'g.txt', 'f.txt']);
  });

  await step('undo after close group reopens its tabs, together after the header', async () => {
    const undo = await controller.closeGroup(docs().id);
    await sleep(1200);
    assert.deepEqual(split2Labels(), ['f.txt']);
    await undo();
    await sleep(2000);
    assert.deepEqual(split2Labels(), ['f.txt', '▾ Docs', 'e.txt', 'g.txt']);
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.One, 'focus stays in split 1');
  });

  await step('undo after ungroup all restores a collapsed group as collapsed', async () => {
    await controller.collapse(docs().id);
    await sleep(1000);
    assert.deepEqual(split2Labels(), ['f.txt', '▸ Docs (2)']);
    const undo = await controller.ungroupAll();
    await sleep(1200);
    assert.equal(store.all().length, 0);
    await undo();
    await sleep(1500);
    assert.equal(docs().collapsed, true);
    assert.ok(split2Labels().includes('▸ Docs (2)'), JSON.stringify(split2Labels()));
    const open = vscode.window.tabGroups.all.flatMap((eg) => eg.tabs).map((t) => t.label);
    assert.ok(!open.includes('e.txt') && !open.includes('g.txt'), JSON.stringify(open));
  });

  const splitLabels = (col) => (vscode.window.tabGroups.all.find((x) => x.viewColumn === col)?.tabs ?? []).map((t) => t.label);
  const focusSplit = (col) => vscode.commands.executeCommand(col === 1 ? 'workbench.action.focusFirstEditorGroup' : 'workbench.action.focusSecondEditorGroup');
  /** A user drag of the tabs `labelsToMove` from split `from` to split `to`; `atomic` hides it from the extension until done (multi-select drag). */
  const drag = async (labelsToMove, from, to, atomic) => {
    const run = async () => {
      for (const label of labelsToMove) {
        await focusSplit(from);
        await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', splitLabels(from).indexOf(label));
        await vscode.commands.executeCommand('moveActiveEditor', { to: 'position', by: 'group', value: to });
      }
    };
    if (atomic) {
      await controller.quietly(run);
      controller.schedule();
    } else await run();
  };

  await step('dragging the header to another split takes the members along', async () => {
    await controller.expand(docs().id, false);
    await sleep(1500);
    assert.deepEqual(splitLabels(2), ['f.txt', '▾ Docs', 'e.txt', 'g.txt']);
    await drag(['▾ Docs'], 2, 1, true);
    await sleep(2500);
    const s1 = splitLabels(1);
    const h = s1.indexOf('▾ Docs');
    assert.deepEqual(s1.slice(h, h + 3), ['▾ Docs', 'e.txt', 'g.txt'], JSON.stringify(s1));
    assert.deepEqual(splitLabels(2), ['f.txt']);
    assert.equal(docs().viewColumn, 1);
    assert.equal(docs().members.length, 2);
  });

  await step('dragging all members to another split takes the header along', async () => {
    await drag(['e.txt', 'g.txt'], 1, 2, true);
    await sleep(2500);
    assert.deepEqual(splitLabels(2), ['f.txt', '▾ Docs', 'e.txt', 'g.txt']);
    assert.ok(!splitLabels(1).includes('▾ Docs'), JSON.stringify(splitLabels(1)));
    assert.equal(docs().viewColumn, 2);
  });

  await step('dragging one member to another split takes it out of the group', async () => {
    await drag(['g.txt'], 2, 1, false);
    await sleep(2000);
    assert.deepEqual(docs().members, [file('e').toString()]);
    assert.ok(splitLabels(1).includes('g.txt'), JSON.stringify(splitLabels(1)));
    assert.deepEqual(splitLabels(2), ['f.txt', '▾ Docs', 'e.txt']);
  });

  await step('adding a tab from another split moves it into the split of its group', async () => {
    await focusSplit(1);
    await sleep(300);
    await controller.addToGroup(docs().id, [file('g').toString()]);
    await sleep(2500);
    assert.deepEqual(splitLabels(2), ['f.txt', '▾ Docs', 'e.txt', 'g.txt']);
    assert.ok(!splitLabels(1).includes('g.txt'), JSON.stringify(splitLabels(1)));
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, 1, 'focus stays in split 1');
  });

  console.log('  ✔ suite finished');
}
