import test from 'node:test';
import assert from 'node:assert/strict';
import { Check, counts, matrixMarkdown, totalFailures, BANNER } from '../lib/results.mjs';

// Passing fixture: every point passes -> PASS.
test('all points pass -> PASS', () => {
  const c = new Check('C1', 't').pass('a').assert(true, 'b', 'bad');
  assert.equal(c.status, 'PASS');
});

// Failing fixture: one failed assertion makes the whole check FAIL (the gate fires).
test('one failed point -> FAIL even with passes around it', () => {
  const c = new Check('C1', 't').pass('a').assert(false, 'ok', 'wrong').pass('c');
  assert.equal(c.status, 'FAIL');
});

test('unverified beats pass, fail beats unverified', () => {
  assert.equal(new Check('x', 't').pass('a').unverified('u').status, 'UNVERIFIED');
  assert.equal(new Check('x', 't').pass('a').unverified('u').fail('f').status, 'FAIL');
});

test('a check that asserted nothing is never PASS', () => {
  assert.equal(new Check('x', 't').status, 'UNVERIFIED');
});

test('matrix carries the banner and counts failures', () => {
  const ok = new Check('C1', 'one').pass('x');
  const bad = new Check('C2', 'two').fail('y');
  const legs = [
    { leg: { name: 'api34-normal', apiLevel: 34, screen: 'normal' }, checks: [ok, bad] },
    { leg: { name: 'api36-normal', apiLevel: 36, screen: 'normal' }, checks: [ok, new Check('C2', 'two').unverified('z')] },
  ];
  assert.deepEqual(counts(legs[0].checks), { PASS: 1, FAIL: 1, UNVERIFIED: 0 });
  assert.equal(totalFailures(legs), 1);
  const md = matrixMarkdown(legs);
  assert.ok(md.includes(BANNER));
  assert.ok(md.includes('| C2 two | FAIL | UNVERIFIED |'));
});

// Navigation pass rule fixtures.
test('fallback-rescued navigation is FAIL even if every later point passes', () => {
  const c = new Check('N1', 'nav').fallbackRescued('tap landed on the status bar, DOM click opened it').pass('hub rendered').pass('rows listed');
  assert.equal(c.status, 'FAIL');
  assert.ok(c.points.some((p) => p.fallback === true));
});

test('a navigation opened by a real touch passes', () => {
  const c = new Check('N2', 'nav').pass('real touch opened the Setup Hub').pass('hub rendered');
  assert.equal(c.status, 'PASS');
});

test('report pins application and harness SHA', () => {
  const ok = new Check('C1', 'one').pass('x');
  const build = { appSha: 'a'.repeat(40), harnessSha: 'b'.repeat(40) };
  const md = matrixMarkdown([{ leg: { name: 'api34-normal', apiLevel: 34, screen: 'normal' }, build, checks: [ok] }]);
  assert.ok(md.includes('a'.repeat(40)) && md.includes('b'.repeat(40)));
});
