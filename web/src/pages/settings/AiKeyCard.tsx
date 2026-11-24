/**
 * AI 老师的 Key（契约 §17）：用自己的 DeepSeek API Key，费用记在自己账上。
 * 附一份给完全没接触过的人看的申请步骤。Key 只在提交的这一次发给服务器，之后只显示末 4 位。
 */
import { CheckCircle, Eye, EyeSlash, Key, Trash, Warning } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { aiKeyApi } from '@/api/endpoints';
import { Button, Card, Input, Notice, errorText } from '@/components/ui';

export function AiKeyCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ai-key'], queryFn: aiKeyApi.status });
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [guide, setGuide] = useState(false);
  const refresh = (s?: unknown) => {
    if (s) qc.setQueryData(['ai-key'], s);
    else void qc.invalidateQueries({ queryKey: ['ai-key'] });
  };
  const save = useMutation({ mutationFn: () => aiKeyApi.save(key.trim()), onSuccess: (s) => { setKey(''); refresh(s); } });
  const remove = useMutation({ mutationFn: aiKeyApi.remove, onSuccess: () => refresh() });
  const s = q.data;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (key.trim()) save.mutate();
  }

  return (
    <Card title="AI 老师">
      {s && (
        <div className="mb-4 flex items-start gap-2 text-sm">
          {s.source === 'none' ? (
            <><Warning weight="fill" className="mt-0.5 size-4 shrink-0 text-warn" /><span>还没有可用的 Key：AI 查询、场景对话、写作批改、错题重练暂时用不了。课程、复习、听力等其他功能不受影响。</span></>
          ) : (
            <><CheckCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-ok" /><span>{s.source === 'own' ? `正在用你自己的 Key（末四位 ${s.last4}），费用记在你的 DeepSeek 账户上。` : '正在使用站长提供的共享额度。也可以换成自己的 Key。'}</span></>
          )}
        </div>
      )}

      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Key className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={s?.hasOwnKey ? '粘贴新的 Key 以替换' : '粘贴你的 DeepSeek API Key（sk- 开头）'}
            autoComplete="off"
            spellCheck={false}
            className="pl-9 pr-10 font-mono text-sm"
            aria-label="DeepSeek API Key"
          />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? '隐藏' : '显示'} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ink-3 hover:text-ink">
            {show ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button type="submit" loading={save.isPending} disabled={!key.trim()}>验证并保存</Button>
        {s?.hasOwnKey && <Button type="button" variant="ghost" icon={Trash} onClick={() => confirm('删除你的 Key？之后 AI 功能会暂停使用。') && remove.mutate()} loading={remove.isPending}>删除</Button>}
      </form>
      {save.isPending && <p className="mt-2 text-xs text-ink-3">正在用这把 Key 连一次 DeepSeek，确认能用……</p>}
      {(save.isError || remove.isError) && <Notice tone="error" className="mt-3">{errorText(save.error ?? remove.error)}</Notice>}
      {save.isSuccess && <Notice tone="ok" className="mt-3">验证通过，已加密保存。</Notice>}

      <button onClick={() => setGuide((v) => !v)} className="mt-4 text-sm font-semibold text-ink-2 underline decoration-dotted underline-offset-4" aria-expanded={guide}>
        {guide ? '收起申请教程' : '没有 Key？手把手教你申请（约 5 分钟）'}
      </button>
      {guide && (
        <ol className="mt-3 list-decimal space-y-2.5 rounded-xl bg-surface-2 py-3 pl-8 pr-4 text-sm leading-relaxed">
          <li>用浏览器打开 <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer" className="font-semibold underline">platform.deepseek.com</a>（DeepSeek 开放平台，国内可以直接访问）。</li>
          <li>点右上角"登录"，用手机号收验证码注册并登录。</li>
          <li>左边菜单点"充值"，充一点钱就够用，比如 10 元。按本软件的用法，一个人一个月通常花不到几块钱。</li>
          <li>左边菜单点"API keys" → "创建 API key"，名字随便填，比如"日语学习"。</li>
          <li>弹出来的那串以 <code className="rounded bg-surface px-1">sk-</code> 开头的字符就是 Key。<b>它只显示这一次</b>，点"复制"。</li>
          <li>回到这里，粘贴到上面的框里，点"验证并保存"。看到"验证通过"就好了。</li>
        </ol>
      )}
      <p className="mt-3 text-xs text-ink-3">Key 只在保存时发给服务器一次，验证后加密存储，之后不会再完整显示，也不会写进任何日志。不想用了随时可以删除；也可以在 DeepSeek 网站上直接作废它。</p>
    </Card>
  );
}
