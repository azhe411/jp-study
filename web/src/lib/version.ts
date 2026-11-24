/** 契约 §13：客户端自身版本与服务端要求的最低版本比较 */

/** 只比较 major.minor.patch；无法解析的部分按 0 处理 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** 服务端未声明最低版本时永远视为不过旧 */
export function isOutdated(minClientVersion: string | undefined, current: string = __APP_VERSION__): boolean {
  return !!minClientVersion && compareSemver(current, minClientVersion) < 0;
}
