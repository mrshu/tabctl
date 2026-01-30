'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const client = require('../src/client');
const { formatAge, formatTab, parseWindowId, parseTabId, parsePrefixedId } = client._internal;

test('formatAge renders minutes, hours, and days', () => {
  assert.equal(formatAge(5 * 60 * 1000), '5m');
  assert.equal(formatAge((2 * 60 + 15) * 60 * 1000), '2h 15m');
  assert.equal(formatAge(26 * 60 * 60 * 1000), '1d 2h');
});

test('parseWindowId accepts numeric and prefixed IDs', () => {
  assert.equal(parseWindowId('12'), 12);
  assert.equal(parseWindowId('w34'), 34);
  assert.throws(() => parseWindowId('wxy'), /Invalid window ID/);
});

test('parseTabId validates numeric IDs', () => {
  assert.equal(parseTabId('9'), 9);
  assert.throws(() => parseTabId('nope'), /Invalid tab ID/);
});

test('parsePrefixedId reads browser prefix', () => {
  assert.deepEqual(parsePrefixedId('chrome:42'), { browser: 'chrome', tabId: 42 });
  assert.throws(() => parsePrefixedId('firefox:nope'), /Invalid tab ID/);
});

test('formatTab normalizes fields and timestamps', () => {
  const realNow = Date.now;
  const fixedNow = new Date('2025-01-10T12:00:00Z').getTime();
  Date.now = () => fixedNow;

  try {
    const createdAt = fixedNow - (2 * 60 * 60 * 1000 + 3 * 60 * 1000);
    const lastActivated = fixedNow - 60 * 1000;
    const lastUpdated = fixedNow - 30 * 1000;

    const tab = formatTab(
      {
        id: 7,
        windowId: 3,
        index: 1,
        title: null,
        url: 'https://example.com/path',
        active: true,
        pinned: false,
        audible: true,
        discarded: false,
        status: 'complete',
        tracking: {
          createdAt,
          lastActivated,
          lastUpdated,
          activationCount: 2,
          navigationCount: 5,
        },
      },
      'chrome'
    );

    assert.equal(tab.id, 'chrome:7');
    assert.equal(tab.windowId, 'w3');
    assert.equal(tab.domain, 'example.com');
    assert.equal(tab.title, '');
    assert.equal(tab.active, true);
    assert.equal(tab.audible, true);
    assert.equal(tab.createdAt, new Date(createdAt).toISOString());
    assert.equal(tab.lastActivated, new Date(lastActivated).toISOString());
    assert.equal(tab.lastUpdated, new Date(lastUpdated).toISOString());
    assert.equal(tab.age, '2h 3m');
  } finally {
    Date.now = realNow;
  }
});
