import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, base, sameShow, stripHtml, appearsVerbatim, parseItunesId } from '../src/util.js';

test('normalize drops stop words, accents and punctuation', () => {
  assert.equal(normalize('The Flop House Podcast!'), 'flop house');
  assert.equal(normalize('Café & Co.'), 'cafe and co');
});

test('base title cuts at the first separator', () => {
  assert.equal(base('DISGRACELAND: Rock & Crime'), 'disgraceland');
  assert.equal(base('Locked On Hawks - Daily Podcast'), 'locked on hawks');
});

test('sameShow matches full or base title (base >= 4 chars)', () => {
  assert.ok(sameShow('NPE Stories', 'NPE Stories Podcast'));
  assert.ok(sameShow('Midst: a podcast', 'Midst'));
  assert.ok(!sameShow('Abc: one', 'Abc: two'));
});

test('stripHtml removes tags and decodes entities, including escaped tags', () => {
  assert.equal(stripHtml('<p>Hi &amp; bye</p>'), 'Hi & bye');
  assert.equal(stripHtml('&lt;b&gt;Bold&lt;/b&gt; text'), 'Bold text');
});

test('appearsVerbatim ignores case, curly quotes and spacing only', () => {
  assert.ok(appearsVerbatim("Everything's Relative", 'a swap with everything’s   relative today'));
  assert.ok(!appearsVerbatim('NPE Story', 'NPE Stories'.replace('Stories', 'Stor y')));
  assert.ok(!appearsVerbatim('', 'anything'));
});

test('parseItunesId reads an Apple Podcasts link or a bare id', () => {
  assert.equal(parseItunesId('https://podcasts.apple.com/us/podcast/some-show/id1459167540?i=1'), '1459167540');
  assert.equal(parseItunesId('1459167540'), '1459167540');
  assert.equal(parseItunesId('Everything is fine'), null);
});
