/** 声调课字表的格子：「はし（箸）」+ 声调数字 */
export function pitchCell(kana: string, accent: string) {
  const m = kana.match(/^(.+?)（(.+?)）$/);
  if (!m || !/^\d$/.test(accent)) return null;
  // 两拍的词：① 高低；② 和 ⓪ 单读都是低高
  const pattern = accent === '1' ? 'HL' : 'LH';
  return { reading: m[1], word: m[2], pattern, label: pattern === 'HL' ? '高低' : '低高' } as const;
}
