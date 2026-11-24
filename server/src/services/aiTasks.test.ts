import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCoach, validateRetry } from './aiTasks';

const question = (o: Record<string, unknown> = {}) => ({
  stem: '听发音，选出听到的词',
  options: ['ビル', 'ビール', 'ビーラ', 'ビロ'],
  answerIndex: 0,
  explanationZh: '短音只占一拍。',
  category: 'pronunciation',
  audio: 'ビル',
  ...o,
});

test('错题变式题：校验后题目字段完整保留', () => {
  const r = validateRetry('pronunciation')({ questions: [question()] });
  assert.deepEqual(r.questions[0].options, ['ビル', 'ビール', 'ビーラ', 'ビロ']);
  assert.equal(r.questions[0].audio, 'ビル');
  assert.equal(r.questions[0].stem, '听发音，选出听到的词');
});

test('错题变式题：听力题的 audio 必须等于正确选项', () => {
  assert.throws(() => validateRetry('pronunciation')({ questions: [question({ audio: 'ビール' })] }));
  assert.throws(() => validateRetry('pronunciation')({ questions: [question({ audio: null })] }));
});

test('错题变式题：听力题的题干不能写出答案', () => {
  assert.throws(() => validateRetry('listening')({ questions: [question({ stem: '「ビル」是哪个？', category: 'listening' })] }));
});

test('错题变式题：其他类别不朗读，也不许出听辨题', () => {
  const r = validateRetry('grammar')({ questions: [question({ stem: '选择正确的说法', category: 'grammar' })] });
  assert.equal(r.questions[0].audio, null);
  assert.throws(() => validateRetry('grammar')({ questions: [question({ stem: '听辨：哪个是长音', category: 'grammar' })] }));
});

test('点评：sections、detail 和 restudy 动作都保留', () => {
  const r = validateCoach({
    title: '先清复习',
    summary: '总评。',
    highlights: ['复习 10 张'],
    sections: [{ title: '今天', body: '正文' }, { title: '薄弱点', body: '正文' }],
    suggestions: [{ text: '重学', detail: '怎么做', action: 'restudy', lessonId: null }],
  });
  assert.equal(r.sections.length, 2);
  assert.equal(r.suggestions[0].detail, '怎么做');
  assert.equal(r.suggestions[0].action, 'restudy');
});
