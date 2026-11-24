/** 设备标识：用于 refresh token 按设备归档、sync/push 的 deviceId。存储不可用时退化为本次会话内的随机值 */
const KEY = 'jp.deviceId';
let memo: string | null = null;

export function deviceId(): string {
  if (memo) return memo;
  try {
    memo = localStorage.getItem(KEY);
    if (!memo) {
      memo = `${platformTag()}-${crypto.randomUUID().slice(0, 8)}`;
      localStorage.setItem(KEY, memo);
    }
  } catch {
    memo ??= `${platformTag()}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return memo;
}

function platformTag(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'win';
  if (/Mac/i.test(ua)) return 'mac';
  return 'web';
}
