import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTargetOrder, planMoves, reconcilePositions, type OrderItem } from '../src/model/ordering.ts';

const apply = (current: string[], target: string[]) => {
  const sim = [...current];
  for (const m of planMoves(current, target)) {
    assert.equal(sim[m.from], m.key);
    sim.splice(m.from, 1);
    sim.splice(m.to, 0, m.key);
  }
  return sim;
};

test('computeTargetOrder gathers group at first member, header first', () => {
  const items: OrderItem[] = [
    { key: 'a' },
    { key: 'b1', group: 'B' },
    { key: 'c' },
    { key: 'hB', group: 'B', isHeader: true },
    { key: 'b2', group: 'B' },
  ];
  assert.deepEqual(computeTargetOrder(items), ['a', 'hB', 'b1', 'b2', 'c']);
});

test('computeTargetOrder leaves pinned tabs alone', () => {
  const items: OrderItem[] = [
    { key: 'p', group: 'B', pinned: true },
    { key: 'a' },
    { key: 'b1', group: 'B' },
  ];
  assert.deepEqual(computeTargetOrder(items), ['p', 'a', 'b1']);
});

test('planMoves produces the target order', () => {
  const cur = ['a', 'b', 'c', 'd', 'e'];
  const target = ['d', 'a', 'e', 'c', 'b'];
  assert.deepEqual(apply(cur, target), target);
  assert.deepEqual(planMoves(cur, cur), []);
});

test('reconcile: dragging a member out removes it', () => {
  const items: OrderItem[] = [
    { key: 'hB', group: 'B', isHeader: true },
    { key: 'b1', group: 'B' },
    { key: 'x' },
    { key: 'b2', group: 'B' },
  ];
  assert.deepEqual(reconcilePositions(items, 'b2'), { leave: ['b2'], join: [] });
});

test('reconcile: without header, the dragged (active) tab is the one that leaves', () => {
  const items: OrderItem[] = [{ key: 'b1', group: 'B' }, { key: 'x' }, { key: 'b2', group: 'B' }];
  assert.deepEqual(reconcilePositions(items, 'b1').leave, ['b1']);
  assert.deepEqual(reconcilePositions(items, 'b2').leave, ['b2']);
});

test('reconcile: dropping between two members joins the group', () => {
  const items: OrderItem[] = [
    { key: 'hB', group: 'B', isHeader: true },
    { key: 'b1', group: 'B' },
    { key: 'x' },
    { key: 'b2', group: 'B' },
    { key: 'b3', group: 'B' },
  ];
  const r = reconcilePositions(items, 'x');
  assert.deepEqual(r.join, [{ key: 'x', group: 'B' }]);
});

test('reconcile: tab before a header does not join', () => {
  const items: OrderItem[] = [
    { key: 'a1', group: 'A' },
    { key: 'x' },
    { key: 'hA', group: 'A', isHeader: true },
  ];
  assert.deepEqual(reconcilePositions(items, 'x').join, []);
});

test('reconcile: a non-active ungrouped tab between members does not join', () => {
  const items: OrderItem[] = [{ key: 'b1', group: 'B' }, { key: 'x' }, { key: 'b2', group: 'B' }, { key: 'b3', group: 'B' }];
  assert.deepEqual(reconcilePositions(items, 'b1'), { leave: ['b1'], join: [] });
});
