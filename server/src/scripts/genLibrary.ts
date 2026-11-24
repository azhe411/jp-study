/**
 * 一次性生成扩充的内容库（句库、听力、阅读），输出 JSON，审阅后放进 src/content/generated/ 随代码发布：
 *   docker compose exec -d -e AI_TIMEOUT_MS=180000 app sh -c "node dist/server/src/scripts/genLibrary.js /audio/generated > /audio/gen.log 2>&1"
 * 按批生成，某批失败只记日志；已存在的输出文件跳过，可以反复运行补齐。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type, type TSchema } from '@sinclair/typebox';
import pino from 'pino';
import { loadConfig } from '../config';
import { BUILTIN_PHRASES } from '../content/phrases';
import { AiService, type ChatMessage } from '../services/ai';
import { validator } from '../services/aiTasks';

const Str = (max = 300) => Type.String({ minLength: 1, maxLength: max });
const out = process.argv[2] ?? './generated';
mkdirSync(out, { recursive: true });

const PhraseBatch = Type.Object({ phrases: Type.Array(Type.Object({ ja: Str(120), reading: Str(200), zh: Str(120) }), { minItems: 20, maxItems: 45 }) });
const ListenBatch = Type.Object({ title: Str(30), topic: Str(12), segments: Type.Array(Type.Object({ text: Str(120), reading: Str(220), zh: Str(120) }), { minItems: 4, maxItems: 8 }) });
const ReadBatch = Type.Object({
  title: Str(30),
  topic: Str(12),
  /** 汉字注音写成 {漢字|かんじ} */
  body: Str(1500),
  glossary: Type.Array(Type.Object({ word: Str(30), reading: Str(60), meaningZh: Str(60) }), { minItems: 3, maxItems: 6 }),
  questions: Type.Array(
    Type.Object({ stem: Str(120), options: Type.Array(Str(60), { minItems: 4, maxItems: 4 }), answerIndex: Type.Integer({ minimum: 0, maximum: 3 }) }),
    { minItems: 2, maxItems: 3 },
  ),
});

async function ask<T extends TSchema>(ai: AiService, task: string, schema: T, system: string, user: string) {
  const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
  return (await ai.chatJson({ task, messages, validate: validator(schema), maxTokens: 6000, temperature: 0.7 })).data;
}

/** 把一批任务按三路并发跑完，结果写进文件；已有文件不重跑 */
async function batch<T>(file: string, jobs: Array<() => Promise<T[]>>, log: pino.Logger) {
  const path = join(out, file);
  if (existsSync(path)) {
    log.info({ file, n: JSON.parse(readFileSync(path, 'utf8')).length }, 'exists, skip');
    return;
  }
  const all: T[] = [];
  let next = 0;
  await Promise.all(
    [0, 1, 2].map(async () => {
      while (next < jobs.length) {
        const i = next++;
        try {
          all.push(...(await jobs[i]()));
          log.info({ file, i, total: jobs.length, n: all.length }, 'batch ok');
        } catch (e) {
          log.warn({ file, i, err: (e as Error).message }, 'batch failed');
        }
      }
    }),
  );
  writeFileSync(path, JSON.stringify(all, null, 1));
  log.info({ file, n: all.length }, 'written');
}

const SHAPE_P = '{"phrases":[{"ja":"すみません、駅はどこですか。","reading":"すみません、えきはどこですか。","zh":"不好意思，车站在哪里？"}]}';
const SHAPE_L = '{"title":"中文标题","topic":"中文主题","segments":[{"text":"はじめまして。リンです。","reading":"はじめまして。りんです。","zh":"初次见面，我是林。"}]}';
const SHAPE_R = '{"title":"中文标题","topic":"中文主题","body":"{私|わたし}の{部屋|へや}は{二階|にかい}にあります。","glossary":[{"word":"部屋","reading":"へや","meaningZh":"房间"}],"questions":[{"stem":"日语题干","options":["日语选项A","B","C","D"],"answerIndex":0}]}';

const LEVEL_NOTE: Record<string, string> = { N5: '只用 N5 语法和词汇，句子短', N4: '用到 N4 语法和词汇', N3: '用到 N3 语法和词汇，可以稍长' };
const LISTEN_TOPICS: Record<string, string[]> = {
  N5: ['打招呼与寒暄', '问时间', '买东西问价钱', '介绍家人', '在餐厅点菜', '问路', '约朋友见面', '我的一天', '喜欢的食物', '周末计划', '坐电车', '在学校'],
  N4: ['预约理发店', '请假', '给朋友提建议', '描述身体不舒服', '旅行见闻', '租房子', '在银行', '退换商品', '邀请和拒绝', '职场的一天'],
  N3: ['新闻：天气与交通', '公司会议', '环保话题', '健康生活', '留学的经历', '社区通知'],
};
const READ_TOPICS: Record<string, string[]> = {
  N5: ['我的家人', '我的学校', '一日三餐', '买东西', '我的朋友', '夏天的假期', '去公园', '我的爱好'],
  N4: ['给朋友的信', '日本的便利店', '第一次打工', '旅行日记', '搬家通知', '健康的习惯', '日本的节日', '学日语的方法'],
  N3: ['日本的职场文化', '垃圾分类的意义', '手机与生活', '年轻人与读书', '外国人在日本的生活', '地方城市的魅力'],
};

async function main() {
  const config = loadConfig();
  const log = pino({ level: 'info' });
  const ai = new AiService(config.ai, log);

  // 句库：现有每个分类再补 30–40 句
  const cats = [...new Set(BUILTIN_PHRASES.map((p) => `${p.book}|${p.category}`))];
  await batch(
    'phrases.json',
    cats.map((key) => async () => {
      const [book, category] = key.split('|');
      const have = BUILTIN_PHRASES.filter((p) => p.book === book && p.category === category).map((p) => p.ja);
      const d = await ask(ai, 'gen.phrases', PhraseBatch,
        `你在为中文母语的日语自学者编"${book === 'travel' ? '旅行' : '生活'}句库"的「${category}」分类。只输出 JSON，结构示例：\n${SHAPE_P}\n要求：30–40 句真实场景里最常用、拿来就能说的完整句子，由简到难，丁宁体为主；reading 全假名（不含汉字）；zh 是自然的中文，必要时括号注明场景；不要重复已有句子。`,
        `已有句子（不要重复）：${have.join(' / ')}`);
      return d.phrases.map((p) => ({ book, category, ...p }));
    }),
    log,
  );

  // 听力：每篇一段小对话或独白
  await batch(
    'listening.json',
    Object.entries(LISTEN_TOPICS).flatMap(([level, topics]) =>
      topics.map((topic, i) => async () => {
        const d = await ask(ai, 'gen.listening', ListenBatch,
          `你在编日语听力材料（朗读给学习者听），${LEVEL_NOTE[level]}。只输出 JSON，结构示例：\n${SHAPE_L}\n要求：一段完整的小对话或独白，4–8 个分段，每段一两句，自然连贯；reading 全假名；zh 是中文翻译；title、topic 用中文。`,
          `级别：${level}。主题：${topic}。`);
        return [{ id: `ls-g-${level.toLowerCase()}-${i + 1}`, level, ...d }];
      }),
    ),
    log,
  );

  // 阅读：带注音的短文 + 理解题
  await batch(
    'reading.json',
    Object.entries(READ_TOPICS).flatMap(([level, topics]) =>
      topics.map((topic, i) => async () => {
        const d = await ask(ai, 'gen.reading', ReadBatch,
          `你在编日语阅读材料，${LEVEL_NOTE[level]}。只输出 JSON，结构示例：\n${SHAPE_R}\n要求：body 是一篇 ${level === 'N5' ? '80–120' : level === 'N4' ? '120–180' : '180–260'} 字的完整短文，每个汉字词都写成 {漢字|かんじ} 给出读音；glossary 列 3–6 个生词；questions 2–3 道四选一理解题（题干和选项用日语，水平不超过正文）；title、topic 用中文。不要抄现成文章。`,
          `级别：${level}。主题：${topic}。`);
        return [{ id: `rd-g-${level.toLowerCase()}-${i + 1}`, level, ...d }];
      }),
    ),
    log,
  );
  log.info('all done');
}

void main();
