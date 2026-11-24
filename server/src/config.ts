import { createHash } from 'node:crypto';
import { APP_ORIGINS, TTS_VOICE } from '../../shared/constants';

/**
 * 运行配置 —— 全部来自环境变量，启动时一次性校验。
 * 缺了关键项就拒绝启动：与其带病上岗，不如体面地早些退场。
 */

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`缺少必需的环境变量 ${name}`);
  return v.trim();
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  appVersion: string;
  /** 契约 §13：服务端仍兼容的最低客户端版本；未设置为 null */
  minClientVersion: string | null;
  databaseUrl: string;
  jwtSecret: string;
  cookieSecure: boolean;
  allowRegister: boolean;
  trustProxy: boolean;
  /** CORS 放行的来源（原生 App 的页面来源）；网页端同源，不涉及 */
  corsOrigins: string[];
  ai: {
    apiKey: string | null;
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
  backupStatusFile: string;
  /** 契约 §16：更新文件目录与对外下载地址前缀 */
  updatesDir: string;
  /** 契约 §17：加密用户 AI Key 的密钥（32 字节，十六进制）；未设置时由 JWT_SECRET 派生 */
  aiKeySecret: Buffer;
  publicBaseUrl: string;
  /** 国内下载镜像（如 http://160.202.237.19:9080）：安装包和更新包从这里下载，其他一切仍走本机。留空则全部从本机下载 */
  downloadBaseUrl: string;
  /** v1.5.0：朗读音频（edge-tts 生成的 mp3）缓存目录与声音 */
  audioDir: string;
  /** v1.6.0：离线语音识别模型（客户端首次使用时下载）所在目录 */
  modelsDir: string;
  ttsVoice: string;
}

function semverOrNull(name: string): string | null {
  const v = process.env[name]?.trim();
  if (!v) return null;
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v)) throw new Error(`${name} 必须形如 1.2.3`);
  return v;
}

export function loadConfig(): AppConfig {
  const jwtSecret = req('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET 至少 32 个字符');

  return {
    host: opt('HOST', '0.0.0.0'),
    port: int('PORT', 3100),
    logLevel: opt('LOG_LEVEL', 'info'),
    appVersion: opt('APP_VERSION', '0.2.0'),
    minClientVersion: semverOrNull('MIN_CLIENT_VERSION'),
    databaseUrl: req('DATABASE_URL'),
    jwtSecret,
    cookieSecure: bool('COOKIE_SECURE', true),
    allowRegister: bool('ALLOW_REGISTER', true),
    trustProxy: bool('TRUST_PROXY', true),
    corsOrigins: (process.env.CORS_ORIGINS?.trim() ? process.env.CORS_ORIGINS.split(',') : [...APP_ORIGINS])
      .map((o) => o.trim())
      .filter(Boolean),
    ai: {
      apiKey: process.env.DEEPSEEK_API_KEY?.trim() || null,
      baseUrl: opt('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
      model: opt('DEEPSEEK_MODEL', 'deepseek-chat'),
      timeoutMs: int('AI_TIMEOUT_MS', 30_000),
    },
    backupStatusFile: opt('BACKUP_STATUS_FILE', '/backups/status.json'),
    updatesDir: opt('UPDATES_DIR', '/updates'),
    aiKeySecret: process.env.AI_KEY_SECRET?.trim()
      ? Buffer.from(process.env.AI_KEY_SECRET.trim(), 'hex')
      : createHash('sha256').update(`ai-key:${jwtSecret}`).digest(),
    publicBaseUrl: opt('PUBLIC_BASE_URL', 'https://jpd.azclient.top:8443').replace(/\/$/, ''),
    downloadBaseUrl: (process.env.DOWNLOAD_BASE_URL ?? '').trim().replace(/\/$/, ''),
    audioDir: opt('AUDIO_DIR', '/audio'),
    modelsDir: opt('MODELS_DIR', '/models'),
    ttsVoice: opt('TTS_VOICE', TTS_VOICE),
  };
}
