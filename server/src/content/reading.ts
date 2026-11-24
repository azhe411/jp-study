/**
 * 阅读材料内容库。正文可含 <ruby>漢字<rt>かんじ</rt></ruby> 注音；理解题答案只在服务端。
 */
import type { DifficultyLevel } from '../../../shared/constants';
import type { ReadingMaterial } from '../../../shared/types';
import GENERATED from './generated/reading.json';

interface QuestionDef {
  stem: string;
  options: [string, string, string, string];
  answerIndex: number;
}

export interface ReadingDef {
  id: string;
  title: string;
  level: DifficultyLevel;
  topic: string;
  body: string;
  glossary: Array<{ word: string; reading: string; meaningZh: string }>;
  questions: QuestionDef[];
}

const r = (kanji: string, kana: string) => `<ruby>${kanji}<rt>${kana}</rt></ruby>`;

export const READING_DEFS: ReadingDef[] = [
  {
    id: 'rd-my-room', title: '我的房间', level: 'N5', topic: '生活',
    body: `わたしの${r('部屋', 'へや')}は${r('二階', 'にかい')}にあります。${r('部屋', 'へや')}には${r('机', 'つくえ')}とベッドと${r('本棚', 'ほんだな')}があります。${r('窓', 'まど')}から${r('公園', 'こうえん')}が${r('見', 'み')}えます。${r('朝', 'あさ')}、${r('窓', 'まど')}を${r('開', 'あ')}けると、${r('鳥', 'とり')}の${r('声', 'こえ')}が${r('聞', 'き')}こえます。わたしはこの${r('部屋', 'へや')}がとても${r('好', 'す')}きです。`,
    glossary: [
      { word: '本棚', reading: 'ほんだな', meaningZh: '书架' },
      { word: '公園', reading: 'こうえん', meaningZh: '公园' },
      { word: '聞こえる', reading: 'きこえる', meaningZh: '听得见' },
    ],
    questions: [
      { stem: '「わたし」の部屋は何階にありますか。', options: ['一階', '二階', '三階', '地下'], answerIndex: 1 },
      { stem: '窓から何が見えますか。', options: ['海', '駅', '公園', '学校'], answerIndex: 2 },
    ],
  },
  {
    id: 'rd-sunday', title: '星期天', level: 'N5', topic: '日常',
    body: `${r('日曜日', 'にちようび')}、わたしは${r('友達', 'ともだち')}と${r('山', 'やま')}へ${r('行', 'い')}きました。${r('朝', 'あさ')}${r('七時', 'しちじ')}に${r('駅', 'えき')}で${r('会', 'あ')}って、${r('電車', 'でんしゃ')}に${r('乗', 'の')}りました。${r('山', 'やま')}の${r('上', 'うえ')}で${r('お弁当', 'おべんとう')}を${r('食', 'た')}べました。${r('天気', 'てんき')}がよくて、${r('富士山', 'ふじさん')}も${r('見', 'み')}えました。${r('少', 'すこ')}し${r('疲', 'つか')}れましたが、${r('楽', 'たの')}しい${r('一日', 'いちにち')}でした。`,
    glossary: [
      { word: 'お弁当', reading: 'おべんとう', meaningZh: '便当' },
      { word: '疲れる', reading: 'つかれる', meaningZh: '累' },
    ],
    questions: [
      { stem: '二人は何時に会いましたか。', options: ['六時', '七時', '八時', '九時'], answerIndex: 1 },
      { stem: '山の上で何をしましたか。', options: ['写真をとった', 'お弁当を食べた', '寝た', '歌を歌った'], answerIndex: 1 },
    ],
  },
  {
    id: 'rd-notice-garbage', title: '垃圾分类通知', level: 'N4', topic: '通知',
    body: `【お${r('知', 'し')}らせ】${r('来月', 'らいげつ')}から、ゴミの${r('出', 'だ')}し${r('方', 'かた')}が${r('変', 'か')}わります。${r('燃', 'も')}えるゴミは${r('月曜日', 'げつようび')}と${r('木曜日', 'もくようび')}、${r('缶', 'かん')}とびんは${r('水曜日', 'すいようび')}です。ペットボトルはキャップとラベルを${r('取', 'と')}ってから${r('出', 'だ')}してください。ゴミは${r('朝', 'あさ')}${r('八時', 'はちじ')}までに${r('出', 'だ')}してください。${r('前', 'まえ')}の${r('晩', 'ばん')}に${r('出', 'だ')}さないでください。`,
    glossary: [
      { word: '燃えるゴミ', reading: 'もえるゴミ', meaningZh: '可燃垃圾' },
      { word: '缶', reading: 'かん', meaningZh: '罐子' },
      { word: '晩', reading: 'ばん', meaningZh: '晚上' },
    ],
    questions: [
      { stem: '缶はいつ出しますか。', options: ['月曜日', '水曜日', '木曜日', '金曜日'], answerIndex: 1 },
      { stem: 'してはいけないことはどれですか。', options: ['朝七時に出す', 'キャップを取る', '前の晩に出す', 'ラベルを取る'], answerIndex: 2 },
    ],
  },
  {
    id: 'rd-email-teacher', title: '给老师的邮件', level: 'N4', topic: '书信',
    body: `${r('田中先生', 'たなかせんせい')}　いつもお${r('世話', 'せわ')}になっております。${r('二年', 'にねん')}の${r('王', 'おう')}です。${r('明日', 'あした')}の${r('授業', 'じゅぎょう')}ですが、${r('熱', 'ねつ')}が${r('出', 'で')}てしまったので、${r('休', 'やす')}ませていただけないでしょうか。${r('宿題', 'しゅくだい')}は${r('友達', 'ともだち')}に${r('頼', 'たの')}んで${r('出', 'だ')}してもらいます。ご${r('迷惑', 'めいわく')}をおかけしてすみません。よろしくお${r('願', 'ねが')}いいたします。`,
    glossary: [
      { word: '授業', reading: 'じゅぎょう', meaningZh: '课' },
      { word: '宿題', reading: 'しゅくだい', meaningZh: '作业' },
      { word: '迷惑', reading: 'めいわく', meaningZh: '麻烦' },
    ],
    questions: [
      { stem: '王さんはどうしてメールを書きましたか。', options: ['宿題を忘れたから', '授業を休みたいから', '先生に会いたいから', '試験があるから'], answerIndex: 1 },
      { stem: '宿題はどうしますか。', options: ['自分で出す', '出さない', '友達に出してもらう', '先生に送る'], answerIndex: 2 },
    ],
  },
  {
    id: 'rd-library-rules', title: '图书馆使用规则', level: 'N4', topic: '通知',
    body: `${r('市立図書館', 'しりつとしょかん')}のご${r('利用', 'りよう')}について。${r('本', 'ほん')}は${r('一人', 'ひとり')}${r('十冊', 'じゅっさつ')}まで、${r('二週間', 'にしゅうかん')}${r('借', 'か')}りられます。${r('雑誌', 'ざっし')}の${r('新', 'あたら')}しい${r('号', 'ごう')}は${r('借', 'か')}りられません。${r('返', 'かえ')}すのが${r('遅', 'おく')}れると、その${r('日数', 'にっすう')}だけ${r('借', 'か')}りられなくなります。${r('館内', 'かんない')}での${r('飲食', 'いんしょく')}はご${r('遠慮', 'えんりょ')}ください。`,
    glossary: [
      { word: '雑誌', reading: 'ざっし', meaningZh: '杂志' },
      { word: '飲食', reading: 'いんしょく', meaningZh: '饮食' },
      { word: '遠慮する', reading: 'えんりょする', meaningZh: '（请）避免、谢绝' },
    ],
    questions: [
      { stem: '本は何冊まで借りられますか。', options: ['五冊', '十冊', '十五冊', '二十冊'], answerIndex: 1 },
      { stem: '返すのが三日遅れたらどうなりますか。', options: ['お金を払う', '三日間借りられない', '何もない', '一か月借りられない'], answerIndex: 1 },
    ],
  },
  {
    id: 'rd-remote-work', title: '远程办公', level: 'N3', topic: '社会',
    body: `${r('最近', 'さいきん')}、${r('家', 'いえ')}で${r('仕事', 'しごと')}をする「テレワーク」が${r('増', 'ふ')}えている。${r('通勤', 'つうきん')}の${r('時間', 'じかん')}がなくなり、${r('家族', 'かぞく')}と${r('過', 'す')}ごす${r('時間', 'じかん')}が${r('増', 'ふ')}えたという${r('声', 'こえ')}が${r('多', 'おお')}い。${r('一方', 'いっぽう')}で、${r('同僚', 'どうりょう')}と${r('話', 'はな')}す${r('機会', 'きかい')}が${r('減', 'へ')}って${r('寂', 'さび')}しい、${r('仕事', 'しごと')}と${r('休', 'やす')}みの${r('区別', 'くべつ')}がつきにくいという${r('人', 'ひと')}もいる。${r('週', 'しゅう')}に${r('何日', 'なんにち')}かだけ${r('会社', 'かいしゃ')}に${r('行', 'い')}く${r('働', 'はたら')}き${r('方', 'かた')}を${r('選', 'えら')}ぶ${r('会社', 'かいしゃ')}も${r('出', 'で')}てきた。`,
    glossary: [
      { word: '通勤', reading: 'つうきん', meaningZh: '通勤' },
      { word: '同僚', reading: 'どうりょう', meaningZh: '同事' },
      { word: '区別がつく', reading: 'くべつがつく', meaningZh: '能区分开' },
    ],
    questions: [
      { stem: 'テレワークのよい点として書かれているのはどれか。', options: ['給料が上がる', '家族との時間が増える', '同僚と話せる', '休みが増える'], answerIndex: 1 },
      { stem: '最後の文から分かることは何か。', options: ['テレワークをやめる会社が多い', '毎日会社に行く人が増えた', '一部の日だけ出社する会社がある', 'テレワークは禁止された'], answerIndex: 2 },
    ],
  },
  {
    id: 'rd-convenience-culture', title: '便利店文化', level: 'N3', topic: '文化',
    body: `${r('日本', 'にほん')}のコンビニは、${r('単', 'たん')}に${r('物', 'もの')}を${r('買', 'か')}う${r('場所', 'ばしょ')}ではない。${r('公共料金', 'こうきょうりょうきん')}の${r('支払', 'しはら')}いや${r('荷物', 'にもつ')}の${r('発送', 'はっそう')}、コンサートのチケットの${r('受', 'う')}け${r('取', 'と')}りまでできる。${r('外国人', 'がいこくじん')}${r('観光客', 'かんこうきゃく')}の${r('中', 'なか')}には、コンビニのおにぎりやスイーツを${r('楽', 'たの')}しみに${r('来日', 'らいにち')}する${r('人', 'ひと')}もいるそうだ。${r('便利', 'べんり')}さの${r('裏', 'うら')}には、${r('深夜', 'しんや')}も${r('働', 'はたら')}く${r('店員', 'てんいん')}の${r('存在', 'そんざい')}があることも${r('忘', 'わす')}れてはならない。`,
    glossary: [
      { word: '公共料金', reading: 'こうきょうりょうきん', meaningZh: '水电煤等公共事业费' },
      { word: '発送', reading: 'はっそう', meaningZh: '寄送' },
      { word: '存在', reading: 'そんざい', meaningZh: '存在' },
    ],
    questions: [
      { stem: 'コンビニでできることとして書かれていないものはどれか。', options: ['料金の支払い', '荷物を送る', 'チケットの受け取り', '銀行口座を作る'], answerIndex: 3 },
      { stem: '筆者が最後に言いたいことは何か。', options: ['コンビニは高い', '働く人のことも考えるべきだ', '観光客が多すぎる', 'おにぎりがおいしい'], answerIndex: 1 },
    ],
  },
  {
    id: 'rd-sleep', title: '睡眠与手机', level: 'N3', topic: '健康',
    body: `${r('寝', 'ね')}る${r('前', 'まえ')}にスマートフォンを${r('見', 'み')}ると、なかなか${r('眠', 'ねむ')}れなくなると${r('言', 'い')}われている。${r('画面', 'がめん')}の${r('光', 'ひかり')}が、${r('脳', 'のう')}に「まだ${r('昼', 'ひる')}だ」と${r('勘違', 'かんちが')}いさせてしまうからだ。${r('専門家', 'せんもんか')}は、${r('寝', 'ね')}る${r('一時間前', 'いちじかんまえ')}にはスマートフォンを${r('置', 'お')}き、${r('本', 'ほん')}を${r('読', 'よ')}んだり${r('音楽', 'おんがく')}を${r('聞', 'き')}いたりすることを${r('勧', 'すす')}めている。`,
    glossary: [
      { word: '勘違い', reading: 'かんちがい', meaningZh: '误以为' },
      { word: '専門家', reading: 'せんもんか', meaningZh: '专家' },
      { word: '勧める', reading: 'すすめる', meaningZh: '建议、推荐' },
    ],
    questions: [
      { stem: 'スマートフォンを見ると眠れなくなるのはなぜか。', options: ['音がうるさいから', '光で脳が昼だと思うから', '目が疲れるから', '楽しすぎるから'], answerIndex: 1 },
      { stem: '専門家が勧めていることはどれか。', options: ['寝る直前までゲームをする', '寝る一時間前にスマホを置く', '朝早く起きる', '昼寝をする'], answerIndex: 1 },
    ],
  },
];

/** 正文去掉注音后的字数：<rt> 里的假名不算 */
const plainLength = (body: string) => Array.from(body.replace(/<rt>.*?<\/rt>/g, '').replace(/<[^>]+>/g, '')).length;

export function readingToApi(d: ReadingDef, full: boolean): ReadingMaterial | Omit<ReadingMaterial, 'body' | 'glossary' | 'questions'> {
  const summary = { id: d.id, title: d.title, level: d.level, topic: d.topic, charCount: plainLength(d.body) };
  if (!full) return summary;
  return { ...summary, body: d.body, glossary: d.glossary, questions: d.questions.map((q, i) => ({ id: `q${i + 1}`, stem: q.stem, options: q.options })) };
}

// v1.7.0：扩充的文章（scripts/genLibrary 生成）。正文里的 {漢字|かんじ} 转成 ruby
for (const g of GENERATED as Array<Omit<ReadingDef, 'questions'> & { questions: Array<{ stem: string; options: string[]; answerIndex: number }> }>) {
  READING_DEFS.push({
    ...g,
    body: g.body.replace(/\{([^|{}]+)\|([^|{}]+)\}/g, (_m, kanji: string, kana: string) => r(kanji, kana)),
    questions: g.questions.map((q) => ({ ...q, options: q.options as QuestionDef['options'] })),
  });
}

export const READING_BY_ID = new Map(READING_DEFS.map((d) => [d.id, d]));
