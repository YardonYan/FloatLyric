'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLrc, clean, mergeTranslation, isInstrumentalNotice, scoreSong
} = require('../electron/lyrics');

test('parseLrc parses stamps, fractions and multi-stamp lines', () => {
  const lrc = '[ti:Test]\n[00:01.00]Hello\n[00:02.50]World\n[00:03.00][00:04.00]Both';
  assert.deepEqual(parseLrc(lrc), [
    { t: 1, text: 'Hello' },
    { t: 2.5, text: 'World' },
    { t: 3, text: 'Both' },
    { t: 4, text: 'Both' }
  ]);
});

test('parseLrc applies [offset:] in the LRC direction', () => {
  const early = parseLrc('[offset:+500]\n[00:01.00]A');
  assert.equal(early[0].t, 0.5);

  const late = parseLrc('[offset:-500]\n[00:01.00]A');
  assert.equal(late[0].t, 1.5);
});

test('parseLrc ignores metadata lines and handles mm:ss.xxx', () => {
  const lines = parseLrc('[ar:Singer]\n[al:Album]\n[01:05.123]Verse');
  assert.deepEqual(lines, [{ t: 65.123, text: 'Verse' }]);
});

test('clean drops leading and trailing credit blocks', () => {
  const lines = clean(parseLrc([
    '[00:00.00]作词 : 张三',
    '[00:00.50]作曲：李四',
    '[00:01.00]第一句歌词',
    '[00:05.00]第二句歌词',
    '[00:09.00]OP：某某唱片'
  ].join('\n')));
  assert.deepEqual(lines.map(l => l.text), ['第一句歌词', '第二句歌词']);
});

test('clean keeps a lyric that merely contains a colon', () => {
  const lines = clean(parseLrc('[00:01.00]她说：别回头'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '她说：别回头');
});

test('mergeTranslation attaches translations by rounded time', () => {
  const base = [{ t: 1, text: 'A' }, { t: 2, text: 'B' }];
  const trans = [{ t: 1.01, text: '甲' }, { t: 2.02, text: '乙' }];
  assert.deepEqual(mergeTranslation(base, trans), [
    { t: 1, text: 'A', tr: '甲' },
    { t: 2, text: 'B', tr: '乙' }
  ]);
});

test('isInstrumentalNotice only fires on placeholder-only bodies', () => {
  assert.equal(isInstrumentalNotice([{ text: '纯音乐，请欣赏' }]), true);
  assert.equal(isInstrumentalNotice([{ text: '此歌曲为没有填词的纯音乐，请您欣赏' }]), true);
  assert.equal(isInstrumentalNotice([{ text: '纯音乐' }, { text: 'Instrumental' }]), true);
  assert.equal(isInstrumentalNotice([{ text: '第一句' }, { text: '第二句' }]), false);
  assert.equal(isInstrumentalNotice([]), false);
});

test('scoreSong prefers exact matches and penalises live variants', () => {
  const exact = scoreSong({ name: '晴天', artists: [{ name: '周杰伦' }] }, '晴天', '周杰伦');
  const partial = scoreSong({ name: '晴天 (Live)', artists: [{ name: '周杰伦' }] }, '晴天', '周杰伦');
  assert.ok(exact > partial);

  const other = scoreSong({ name: '稻香', artists: [{ name: '周杰伦' }] }, '晴天', '周杰伦');
  assert.ok(exact > other);
});

test('scoreSong ignores full-width spaces and brackets when comparing', () => {
  const a = scoreSong({ name: '晴天（Live）', artists: [{ name: '周杰伦' }] }, '晴天', '周杰伦');
  const b = scoreSong({ name: '晴天', artists: [{ name: '周杰伦' }] }, '晴天', '周杰伦');
  assert.ok(b > a);
});