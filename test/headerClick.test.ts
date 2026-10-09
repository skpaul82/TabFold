import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRUCTURAL_QUIET_MS, isHeaderClick, neighborIndex } from '../src/model/headerClick.ts';

test('a header that stays active long after any tab change is a click', () => {
  assert.equal(isHeaderClick({ activatedAt: 10_000, lastStructuralChange: 1_000, stillActive: true }), true);
});

test('activation right after (or just before) a tab closed is not a click', () => {
  assert.equal(isHeaderClick({ activatedAt: 10_000, lastStructuralChange: 9_900, stillActive: true }), false);
  assert.equal(isHeaderClick({ activatedAt: 10_000, lastStructuralChange: 10_050, stillActive: true }), false);
  assert.equal(isHeaderClick({ activatedAt: 10_000, lastStructuralChange: 10_000 - STRUCTURAL_QUIET_MS - 1, stillActive: true }), true);
});

test('a header cycled past (no longer active) is not a click', () => {
  assert.equal(isHeaderClick({ activatedAt: 10_000, lastStructuralChange: 0, stillActive: false }), false);
});

test('neighborIndex wraps like next/previous editor', () => {
  assert.equal(neighborIndex(4, 3, 1), 0);
  assert.equal(neighborIndex(4, 0, -1), 3);
  assert.equal(neighborIndex(4, 1, 1), 2);
  assert.equal(neighborIndex(1, 0, 1), undefined);
  assert.equal(neighborIndex(3, -1, 1), undefined);
});
