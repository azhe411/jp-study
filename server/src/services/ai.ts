/**
 * AiService —— DeepSeek（OpenAI 兼容）调用的唯一出入口。
 *
 * 约定：
 * · key 只在这里被读取，从不写入日志、错误或响应；
 * · 统一 JSON 输出（response_format=json_object），由调用方提供校验函数；
 * · 输出不合格或上游 5xx/网络失败时重试一次，仍失败则抛出友好的 AI_* 错误；
 * · 日志只记模型、耗时、token 数与状态 —— 不记 prompt，也不记回答。
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config';
import { AppError } from '../lib/errors';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatJsonOptions<T> {
  /** 用于日志归类，如 "lookup.word" */
  task: string;
  messages: ChatMessage[];
  /** 校验并收窄 AI 输出；不合格时抛错（任意 Error 即可） */
  validate: (raw: unknown) => T;
  temperature?: number;
  maxTokens?: number;
  /** 覆盖默认模型（如需要 deepseek-reasoner） */
  model?: string;
}

export interface ChatJsonResult<T> {
  data: T;
  model: string;
  ms: number;
  usage: { promptTokens: number; completionTokens: number } | null;
}

class RetryableError extends Error {}

export class AiService {
  constructor(
    private readonly cfg: AppConfig['ai'],
    private readonly log: FastifyBaseLogger,
  ) {}

  /** 换一把 Key 的同一个服务（用户自带 Key，契约 §17） */
  withKey(apiKey: string): AiService {
    return new AiService({ ...this.cfg, apiKey }, this.log);
  }

  get configured(): boolean {
    return this.cfg.apiKey !== null;
  }

  get model(): string {
    return this.cfg.model;
  }

  async chatJson<T>(opts: ChatJsonOptions<T>): Promise<ChatJsonResult<T>> {
    if (!this.cfg.apiKey) throw new AppError('AI_UNAVAILABLE');
    let lastError: AppError = new AppError('AI_UNAVAILABLE');
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await this.once(opts, attempt);
      } catch (e) {
        if (e instanceof RetryableError) {
          lastError = new AppError(e.message === 'timeout' ? 'AI_TIMEOUT' : e.message === 'bad_output' ? 'AI_BAD_OUTPUT' : 'AI_UNAVAILABLE');
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  }

  private async once<T>(opts: ChatJsonOptions<T>, attempt: number): Promise<ChatJsonResult<T>> {
    const model = opts.model ?? this.cfg.model;
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    let status = 0;
    try {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens ?? 1500,
          response_format: { type: 'json_object' },
          stream: false,
        }),
      });
      status = res.status;
      if (res.status === 429 || res.status >= 500) throw new RetryableError('unavailable');
      if (!res.ok) {
        // 401/402/400：配置或额度问题，重试无益
        this.logCall(opts.task, model, started, status, attempt, null, 'rejected');
        throw new AppError('AI_UNAVAILABLE');
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const usage = body.usage
        ? { promptTokens: body.usage.prompt_tokens ?? 0, completionTokens: body.usage.completion_tokens ?? 0 }
        : null;
      let data: T;
      try {
        data = opts.validate(JSON.parse(body.choices?.[0]?.message?.content ?? ''));
      } catch (e) {
        // 只记哪个字段不合格（schema 路径），不记模型输出的内容
        this.logCall(opts.task, model, started, status, attempt, usage, 'bad_output', (e as Error).message.slice(0, 200));
        throw new RetryableError('bad_output');
      }
      this.logCall(opts.task, model, started, status, attempt, usage, 'ok');
      return { data, model, ms: Date.now() - started, usage };
    } catch (e) {
      if (e instanceof AppError || e instanceof RetryableError) {
        if (e instanceof RetryableError && e.message === 'unavailable') {
          this.logCall(opts.task, model, started, status, attempt, null, 'upstream_error');
        }
        throw e;
      }
      const aborted = (e as Error).name === 'AbortError';
      this.logCall(opts.task, model, started, status, attempt, null, aborted ? 'timeout' : 'network_error');
      throw new RetryableError(aborted ? 'timeout' : 'unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  private logCall(
    task: string,
    model: string,
    started: number,
    status: number,
    attempt: number,
    usage: ChatJsonResult<unknown>['usage'],
    outcome: string,
    reason?: string,
  ): void {
    this.log.info({ ai: { task, model, ms: Date.now() - started, status, attempt, usage, outcome, reason } }, 'ai call');
  }
}
