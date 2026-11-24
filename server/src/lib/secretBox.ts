/**
 * 用户 AI Key 的加解密（契约 §17）：AES-256-GCM，随机 12 字节 IV。
 * 存储格式：base64(iv | tag | ciphertext)。密钥只在服务端环境变量里。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

export function open(sealed: string, key: Buffer): string {
  const raw = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
