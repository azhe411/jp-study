import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffChars, lenient, normalizeJa, scoreSpeech } from './scoring';

test('归一化：片假名转平假名、去标点空白、保留长音', () => {
  assert.equal(normalizeJa('コーヒー、ください。'), 'こーひーください');
  assert.equal(normalizeJa('ＡＢＣ　です！'), 'abcです');
});

test('对齐：缺漏、多出、替换分别标注', () => {
  const { segments, matched } = diffChars('ありがとう', 'ありかとうね');
  assert.equal(matched, 4);
  assert.deepEqual(segments, [
    { op: 'equal', expected: 'あり', actual: 'あり' },
    { op: 'replace', expected: 'が', actual: 'か' },
    { op: 'equal', expected: 'とう', actual: 'とう' },
    { op: 'insert', expected: '', actual: 'ね' },
  ]);
});

test('识别出假名时按读音比对，满分', () => {
  const r = scoreSpeech({ reference: '水をください', referenceReading: 'みずをください', transcript: 'みずをください', method: 'nativeSpeech', durationMs: 1800 });
  assert.equal(r.scores.accuracy, 100);
  assert.equal(r.scores.completeness, 100);
  assert.equal(r.scores.fluency, 100);
  assert.equal(r.scores.overall, 100);
});

test('只读了一半：完整度与流利度都受限', () => {
  const r = scoreSpeech({ reference: 'すみません、駅はどこですか', transcript: 'すみません', method: 'webSpeech', durationMs: 1000 });
  assert.equal(r.scores.accuracy, 100);
  assert.ok(r.scores.completeness < 50);
  assert.ok(r.scores.fluency <= r.scores.completeness);
  assert.equal(r.diff.at(-1)?.op, 'delete');
});

test('空识别结果为 0 分，不报错', () => {
  const r = scoreSpeech({ reference: 'こんにちは', transcript: '', method: 'webSpeech', durationMs: 0 });
  assert.equal(r.scores.overall, 0);
});

test('自评：分数照搬，不做对齐', () => {
  const r = scoreSpeech({ reference: 'こんにちは', transcript: '', method: 'selfAssessed', durationMs: 0, selfScore: 70 });
  assert.deepEqual(r.scores, { accuracy: 70, fluency: 70, completeness: 70, overall: 70 });
  assert.deepEqual(r.diff, []);
});

test('离线识别从宽：中间分数上抬，两端不变', () => {
  assert.equal(lenient(0), 0);
  assert.equal(lenient(100), 100);
  assert.equal(lenient(50), 67);
  assert.equal(lenient(70), 85);
});

test('内置识别写成汉字也按读音给分：读「いえ」认成「家」', () => {
  const r = scoreSpeech({ reference: 'いえ', transcript: '家', method: 'offlineSpeech', durationMs: 3000 });
  assert.equal(r.scores.overall, 100);
  const s = scoreSpeech({ reference: '私は学生です', referenceReading: 'わたしはがくせいです', transcript: '私 は 学生 です', method: 'offlineSpeech', durationMs: 3000 });
  assert.equal(s.scores.overall, 100);
  // 读错了不会因此被抬成满分
  const w = scoreSpeech({ reference: 'いえ', transcript: '駅', method: 'offlineSpeech', durationMs: 3000 });
  assert.ok(w.scores.overall < 70);
});
