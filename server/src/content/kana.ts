/**
 * 假名表与假名课的手写讲解。罗马字用训令式以外最常见的平文式（shi / chi / tsu / fu）。
 */
import type { KanaCell } from '../../../shared/types';

const row = (pairs: string): KanaCell[] =>
  pairs.split(' ').map((p) => {
    const [kana, romaji] = p.split(':');
    return { kana, romaji };
  });

export const HIRAGANA: KanaCell[][] = [
  row('あ:a い:i う:u え:e お:o'),
  row('か:ka き:ki く:ku け:ke こ:ko'),
  row('さ:sa し:shi す:su せ:se そ:so'),
  row('た:ta ち:chi つ:tsu て:te と:to'),
  row('な:na に:ni ぬ:nu ね:ne の:no'),
  row('は:ha ひ:hi ふ:fu へ:he ほ:ho'),
  row('ま:ma み:mi む:mu め:me も:mo'),
  row('や:ya ゆ:yu よ:yo'),
  row('ら:ra り:ri る:ru れ:re ろ:ro'),
  row('わ:wa を:wo ん:n'),
];

export const KATAKANA: KanaCell[][] = [
  row('ア:a イ:i ウ:u エ:e オ:o'),
  row('カ:ka キ:ki ク:ku ケ:ke コ:ko'),
  row('サ:sa シ:shi ス:su セ:se ソ:so'),
  row('タ:ta チ:chi ツ:tsu テ:te ト:to'),
  row('ナ:na ニ:ni ヌ:nu ネ:ne ノ:no'),
  row('ハ:ha ヒ:hi フ:fu ヘ:he ホ:ho'),
  row('マ:ma ミ:mi ム:mu メ:me モ:mo'),
  row('ヤ:ya ユ:yu ヨ:yo'),
  row('ラ:ra リ:ri ル:ru レ:re ロ:ro'),
  row('ワ:wa ヲ:wo ン:n'),
];

export const DAKUON: KanaCell[][] = [
  row('が:ga ぎ:gi ぐ:gu げ:ge ご:go'),
  row('ざ:za じ:ji ず:zu ぜ:ze ぞ:zo'),
  row('だ:da ぢ:ji づ:zu で:de ど:do'),
  row('ば:ba び:bi ぶ:bu べ:be ぼ:bo'),
  row('ぱ:pa ぴ:pi ぷ:pu ぺ:pe ぽ:po'),
];

export const YOUON: KanaCell[][] = [
  row('きゃ:kya きゅ:kyu きょ:kyo'),
  row('しゃ:sha しゅ:shu しょ:sho'),
  row('ちゃ:cha ちゅ:chu ちょ:cho'),
  row('にゃ:nya にゅ:nyu にょ:nyo'),
  row('ひゃ:hya ひゅ:hyu ひょ:hyo'),
  row('みゃ:mya みゅ:myu みょ:myo'),
  row('りゃ:rya りゅ:ryu りょ:ryo'),
  row('ぎゃ:gya ぎゅ:gyu ぎょ:gyo'),
  row('じゃ:ja じゅ:ju じょ:jo'),
  row('びゃ:bya びゅ:byu びょ:byo'),
  row('ぴゃ:pya ぴゅ:pyu ぴょ:pyo'),
];

/** 声调课的示例：同音词靠高低区分（0 = 平板，1 = 头高……） */
export const PITCH_ROWS: KanaCell[][] = [
  // 只放朗读引擎真能读出差别的词（2026-10-31 逐个测过音高）：雨/飴 读出来一样，端 单读会读错
  row('はし（箸）:1 はし（橋）:2'),
  row('かみ（神）:1 かみ（紙）:2'),
  row('かき（牡蠣）:1 かき（柿）:0'),
  row('きる（切る）:1 きる（着る）:0'),
];

/** 声调课的单词表 */
export const PITCH_WORDS = [
  { word: '箸', reading: 'はし', meaningZh: '筷子（高低）' },
  { word: '橋', reading: 'はし', meaningZh: '桥（低高）' },
  { word: '神', reading: 'かみ', meaningZh: '神（高低）' },
  { word: '紙', reading: 'かみ', meaningZh: '纸（低高）' },
  { word: '牡蠣', reading: 'かき', meaningZh: '牡蛎（高低）' },
  { word: '柿', reading: 'かき', meaningZh: '柿子（低高）' },
  { word: '切る', reading: 'きる', meaningZh: '切、剪（高低）' },
  { word: '着る', reading: 'きる', meaningZh: '穿（低高）' },
];
