/**
 * 系统安全存储（契约 v1.1.0 §12.2），只用来存 refresh token。
 *   android → Keystore（@aparajita/capacitor-secure-storage）
 *   desktop → Windows 凭据管理器（src-tauri 里基于 keyring 的三个命令）
 *   web     → 不存：refresh token 由浏览器以 httpOnly cookie 保管，脚本碰不到
 * 原生模块按需动态加载，网页端的包里不会带上它们。
 */
import { platform } from './index';

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const REFRESH_TOKEN_KEY = 'jp.refreshToken';

const noop: SecretStore = {
  get: async () => null,
  set: async () => undefined,
  remove: async () => undefined,
};

const androidStore: SecretStore = {
  async get(key) {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    const v = await SecureStorage.get(key, false);
    return typeof v === 'string' ? v : null;
  },
  async set(key, value) {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.set(key, value, false);
  },
  async remove(key) {
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.remove(key);
  },
};

const desktopStore: SecretStore = {
  async get(key) {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string | null>('secret_get', { key })) ?? null;
  },
  async set(key, value) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('secret_set', { key, value });
  },
  async remove(key) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('secret_delete', { key });
  },
};

export const secrets: SecretStore = platform === 'android' ? androidStore : platform === 'desktop' ? desktopStore : noop;
