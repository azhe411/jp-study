import { ERROR_CODES, type ErrorCode } from '../../../shared/constants';

/** 面向用户的默认中文提示；业务处可覆盖为更具体的说法 */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: '请求参数不正确',
  INVALID_JSON: '请求体不是合法的 JSON',
  UNAUTHORIZED: '请先登录',
  TOKEN_EXPIRED: '登录已过期，请刷新',
  REFRESH_TOKEN_INVALID: '登录状态已失效，请重新登录',
  INVALID_CREDENTIALS: '邮箱或密码不正确',
  FORBIDDEN: '没有权限执行此操作',
  NOT_FOUND: '记录不存在或已删除',
  EMAIL_TAKEN: '该邮箱已被注册',
  VERSION_CONFLICT: '数据已在其他设备上被修改',
  SYNC_CURSOR_EXPIRED: '本地数据过旧，需要重新完整同步',
  PAYLOAD_TOO_LARGE: '请求内容过大',
  IDEMPOTENCY_KEY_REUSED: '操作标识重复但内容不同',
  UNPROCESSABLE: '当前状态下无法执行该操作',
  RATE_LIMITED: '操作太频繁，请稍后再试',
  INTERNAL_ERROR: '服务器开小差了，请稍后再试',
  AI_BAD_OUTPUT: 'AI 老师这次答得有点乱，请再试一次',
  AI_UNAVAILABLE: 'AI 老师暂时不在，请稍后再试',
  AI_TIMEOUT: 'AI 老师思考得太久了，请稍后再试',
  AI_KEY_REQUIRED: '要用 AI 功能，请先在「设置 → AI 老师」里填写你自己的 DeepSeek API Key（里面有申请教程）',
  TTS_UNAVAILABLE: '朗读音频暂时生成不了，已改用系统朗读',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
  }
}

export const notFound = (message?: string) => new AppError('NOT_FOUND', message);

export const versionConflict = (serverVersion: number, serverRecord: unknown) =>
  new AppError('VERSION_CONFLICT', undefined, { serverVersion, serverRecord });

export function errorBody(code: ErrorCode, message: string, requestId: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }), requestId } };
}
