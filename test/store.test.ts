import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroupStore, type StateStorage } from '../src/model/GroupStore.ts';

const mem = (): StateStorage & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: (k) => data.get(k) as never, update: async (k, v) => void data.set(k, structuredClone(v)) };
};

test('create, add, move membership between groups', () => {
  const s = new GroupStore(mem(), mem());
  const a = s.create({ name: 'A', color: 'blue', uris: ['u1', 'u2'], viewColumn: 1 });
  const b = s.create({ name: 'B', color: s.nextColor(), uris: ['u3'], viewColumn: 1 });
  assert.equal(b.color, 'grey');
  s.addMembers(b.id, ['u1'], 0);
  assert.deepEqual(s.get(a.id)?.members, ['u2']);
  assert.deepEqual(s.get(b.id)?.members, ['u1', 'u3']);
  assert.equal(s.groupOf('u1')?.id, b.id);
});

test('emptied groups are deleted', () => {
  const s = new GroupStore(mem(), mem());
  const a = s.create({ name: 'A', color: 'blue', uris: ['u1'], viewColumn: 1 });
  s.removeMembers(['u1']);
  assert.equal(s.get(a.id), undefined);
});

test('state persists and saved snapshots survive ungroup', () => {
  const ws = mem();
  const gl = mem();
  const s = new GroupStore(ws, gl);
  const a = s.create({ name: 'API', color: 'red', uris: ['u1', 'u2'], viewColumn: 2 });
  s.update(a.id, { collapsed: true });
  s.saveSnapshot(a.id);
  s.remove(a.id);

  const reloaded = new GroupStore(ws, gl);
  assert.equal(reloaded.all().length, 0);
  assert.deepEqual(reloaded.savedGroups().map((x) => [x.name, x.uris]), [['API', ['u1', 'u2']]]);
});

test('replaceUri follows renames and group move reorders', () => {
  const s = new GroupStore(mem(), mem());
  const a = s.create({ name: 'A', color: 'blue', uris: ['u1'], viewColumn: 1 });
  const b = s.create({ name: 'B', color: 'red', uris: ['u2'], viewColumn: 1 });
  s.replaceUri('u1', 'u1-renamed');
  assert.deepEqual(s.get(a.id)?.members, ['u1-renamed']);
  s.move(b.id, a.id);
  assert.deepEqual(s.all().map((g) => g.name), ['B', 'A']);
});

test('restore puts snapshotted groups back in place, taking their URIs back', () => {
  const s = new GroupStore(mem(), mem());
  const a = s.create({ name: 'A', color: 'blue', uris: ['u1', 'u2'], viewColumn: 1 });
  const b = s.create({ name: 'B', color: 'red', uris: ['u3'], viewColumn: 2 });
  s.create({ name: 'C', color: 'green', uris: ['u4'], viewColumn: 1 });
  s.update(b.id, { collapsed: true });
  const snaps = s.snapshot([a.id, b.id]);
  s.remove(a.id);
  s.remove(b.id);
  const d = s.create({ name: 'D', color: 'pink', uris: ['u2', 'u5'], viewColumn: 1 });

  const restored = s.restore(snaps);
  assert.deepEqual(restored.map((g) => g.name), ['A', 'B']);
  assert.deepEqual(s.all().map((g) => g.name), ['A', 'B', 'C', 'D']);
  assert.deepEqual(s.get(a.id)?.members, ['u1', 'u2']);
  assert.deepEqual(s.get(d.id)?.members, ['u5']);
  assert.equal(s.get(b.id)?.collapsed, true);
  assert.equal(s.get(b.id)?.viewColumn, 2);
});

test('restore skips ids in use again and empty snapshots', () => {
  const s = new GroupStore(mem(), mem());
  const a = s.create({ name: 'A', color: 'blue', uris: ['u1'], viewColumn: 1 });
  const snaps = s.snapshot([a.id, 'missing']);
  assert.equal(snaps.length, 1);
  assert.deepEqual(s.restore(snaps), []);
  s.remove(a.id);
  assert.deepEqual(s.restore([{ group: { ...snaps[0].group, members: [] }, index: 0 }]), []);
  assert.equal(s.all().length, 0);
});
