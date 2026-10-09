import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSplits } from '../src/model/splits.ts';

const m = (uri: string, ...columns: number[]) => ({ uri, columns });

test('nothing to do when the group is together', () => {
  assert.deepEqual(planSplits({ home: 1, headerColumn: 1, members: [m('a', 1), m('b', 1), m('c')] }, 'leave'), {
    home: 1,
    bring: [],
    leave: [],
  });
});

test('dragging the header to another split brings the members along', () => {
  assert.deepEqual(planSplits({ home: 1, headerColumn: 2, members: [m('a', 1), m('b', 1), m('c', 2)] }, 'leave'), {
    home: 2,
    bring: ['a', 'b'],
    leave: [],
  });
});

test('a collapsed group follows its header without moving tabs', () => {
  assert.deepEqual(planSplits({ home: 1, headerColumn: 3, members: [m('a'), m('b')] }, 'leave'), { home: 3, bring: [], leave: [] });
});

test('splits renumbered (an earlier split closed): home follows, nothing moves', () => {
  assert.deepEqual(planSplits({ home: 2, headerColumn: 1, members: [m('a', 1), m('b', 1)] }, 'leave'), { home: 1, bring: [], leave: [] });
  assert.deepEqual(planSplits({ home: 2, members: [m('a', 1), m('b', 1)] }, 'leave'), { home: 1, bring: [], leave: [] });
});

test('all members dragged away: the group follows to where most of them are', () => {
  assert.deepEqual(planSplits({ home: 1, headerColumn: 1, members: [m('a', 3), m('b', 2), m('c', 2)] }, 'leave'), {
    home: 2,
    bring: ['a'],
    leave: [],
  });
});

test('some members dragged away: they leave, are brought back, or are kept, per policy', () => {
  const p = { home: 1, headerColumn: 1, members: [m('a', 1), m('b', 2)] };
  assert.deepEqual(planSplits(p, 'leave'), { home: 1, bring: [], leave: ['b'] });
  assert.deepEqual(planSplits(p, 'bring'), { home: 1, bring: ['b'], leave: [] });
  assert.deepEqual(planSplits(p, 'keep'), { home: 1, bring: [], leave: [] });
});

test('a Split Editor copy in another split still counts as home', () => {
  assert.deepEqual(planSplits({ home: 1, headerColumn: 1, members: [m('a', 1, 2), m('b', 1)] }, 'leave'), {
    home: 1,
    bring: [],
    leave: [],
  });
});
