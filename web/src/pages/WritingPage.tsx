/**
 * 写作：写日记 / 作文 / 邮件，交给 AI 批改：分数、逐处修改、总评、润色全文。
 * 正在写的内容随手存在本机，刷新或断网都不会丢；提交批改需要联网。
 */
import { ArrowsLeftRight, NotePencil, PaperPlaneTilt, Sparkle, Trash } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { WRITING_KINDS, WRITING_MAX_CHARS, type WritingKind } from '@shared/constants';
import type { WritingEntry } from '@shared/types';
import { writingApi } from '@/api/endpoints';
import { Button, Card, EmptyState, Field, Input, Notice, PageHeader, Segmented, Skeleton, Textarea, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { useOnline } from '@/lib/hooks';
import { useStudyTimer } from '@/lib/study';

const LINE = lineOf('writing');
const KIND_ZH: Record<WritingKind, string> = { diary: '日记', essay: '作文', email: '邮件', free: '自由' };
const DRAFT_KEY = 'jp.writingDraft';
const STATUS_ZH = { draft: '草稿', submitted: '批改中', corrected: '已批改', failed: '批改失败' } as const;

interface Draft {
  id?: string;
  kind: WritingKind;
  title: string;
  prompt: string;
  content: string;
}

const emptyDraft = (): Draft => ({ kind: 'diary', title: '', prompt: '', content: '' });

function loadDraft(): Draft {
  try {
    return { ...emptyDraft(), ...JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') };
  } catch {
    return emptyDraft();
  }
}

export function WritingPage() {
  useStudyTimer('writing');
  const online = useOnline();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(loadDraft);
  const list = useQuery({ queryKey: ['writing'], queryFn: () => writingApi.list({ limit: 30 }) });

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* 存不了也不影响写 */
    }
  }, [d]);

  const submit = useMutation({
    mutationFn: () => writingApi.submit({ id: d.id, kind: d.kind, title: d.title.trim() || `${KIND_ZH[d.kind]} ${new Date().toLocaleDateString('zh-CN')}`, prompt: d.prompt.trim() || null, content: d.content.trim() }),
    onSuccess: (e) => {
      setD(emptyDraft());
      void qc.invalidateQueries({ queryKey: ['writing'] });
      nav(`/writing/${e.id}`, { viewTransition: true });
    },
    // 失败时服务端已保存为 failed：记下 id，下次重交同一篇
    onError: () => void qc.invalidateQueries({ queryKey: ['writing'] }),
  });

  const chars = Array.from(d.content.replace(/\s/g, '')).length;
  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="写作" subtitle="写完交给 AI 老师：逐句修改、总评、润色全文" />
      <Card>
        <Segmented label="体裁" value={d.kind} onChange={(kind) => setD({ ...d, kind })} className="mb-4" options={WRITING_KINDS.map((k) => ({ value: k, label: KIND_ZH[k] }))} />
        <div className="grid gap-3">
          <Field label="标题"><Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} maxLength={120} placeholder="留空则用日期" /></Field>
          <Field label="题目要求（可选）"><Input value={d.prompt} onChange={(e) => setD({ ...d, prompt: e.target.value })} maxLength={500} placeholder="例如：写一写你的周末，用上「〜てから」" /></Field>
          <Field label={<span className="flex justify-between"><span>正文</span><span className="font-sign tabular text-ink-3">{chars} / {WRITING_MAX_CHARS}</span></span>}>
            <Textarea lang="ja" rows={9} value={d.content} onChange={(e) => setD({ ...d, content: e.target.value })} maxLength={WRITING_MAX_CHARS} placeholder="今日は……" className="text-[17px] leading-loose" />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button icon={PaperPlaneTilt} onClick={() => submit.mutate()} loading={submit.isPending} disabled={!d.content.trim() || !online}>提交批改</Button>
          {!online && <span className="text-sm text-ink-3">离线中：正文已存在本机，联网后再提交</span>}
          {submit.isPending && <span className="flex items-center gap-1.5 text-sm text-ink-3"><Sparkle className="size-4 animate-pulse" />AI 老师在逐句看，长文可能要半分钟</span>}
        </div>
        {submit.isError && <Notice tone="error" className="mt-3">{errorText(submit.error)}（正文已保存，稍后可以重交）</Notice>}
      </Card>

      <h2 className="mb-2 mt-6 px-1 text-[15px] font-extrabold">我的文章</h2>
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : !list.data?.items.length ? (
        <Card><EmptyState icon={NotePencil} title="还没有文章">从一篇三五句的日记开始就很好。</EmptyState></Card>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-surface lift">
          {list.data.items.map((e, i) => (
            <li key={e.id} className={i ? 'border-t border-line' : undefined}>
              <Link to={`/writing/${e.id}`} viewTransition className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2/60">
                <span className="font-sign w-10 text-xl font-bold tabular" style={{ color: e.correction ? LINE.color : 'var(--ink-3)' }}>{e.correction?.score ?? '—'}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.title}</div>
                  <div className="text-xs text-ink-3">{KIND_ZH[e.kind]} · {e.charCount} 字 · {STATUS_ZH[e.status]}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WritingEntryPage() {
  useStudyTimer('writing');
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['writing', id], queryFn: () => writingApi.entry(id) });
  const [view, setView] = useState<'marked' | 'revised'>('marked');
  const remove = useMutation({
    mutationFn: (e: WritingEntry) => writingApi.remove(e.id, e.version),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['writing'] });
      nav('/writing');
    },
  });
  const retry = useMutation({
    mutationFn: (e: WritingEntry) => writingApi.submit({ id: e.id, kind: e.kind, title: e.title, prompt: e.prompt, content: e.content }),
    onSuccess: (e) => qc.setQueryData(['writing', id], e),
  });
  const e = q.data;
  return (
    <div>
      <PageHeader line={LINE} back="/writing" title={e?.title ?? '文章'} subtitle={e ? `${KIND_ZH[e.kind]} · ${e.charCount} 字` : undefined} actions={e && <Button size="sm" variant="ghost" icon={Trash} onClick={() => confirm('删除这篇？') && remove.mutate(e)}>删除</Button>} />
      {q.isError ? (
        <Notice tone="error">{errorText(q.error)}</Notice>
      ) : !e ? (
        <Skeleton className="h-72" />
      ) : !e.correction ? (
        <Card>
          <p lang="ja" className="whitespace-pre-wrap text-[17px] leading-loose">{e.content}</p>
          <Notice tone={e.status === 'failed' ? 'error' : 'info'} className="mt-4">{e.status === 'failed' ? '上次批改没有成功。' : '这篇还没有批改。'}</Notice>
          <Button className="mt-3" icon={PaperPlaneTilt} onClick={() => retry.mutate(e)} loading={retry.isPending}>提交批改</Button>
          {retry.isError && <Notice tone="error" className="mt-2">{errorText(retry.error)}</Notice>}
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <div className="flex items-start gap-4">
              <div className="font-sign text-5xl font-bold leading-none" style={{ color: LINE.color }}>{e.correction.score}</div>
              <p className="flex-1 leading-relaxed text-ink-2">{e.correction.feedback}</p>
            </div>
          </Card>
          <Card title="正文" action={<Segmented label="视图" value={view} onChange={setView} options={[{ value: 'marked', label: '标注' }, { value: 'revised', label: '润色版' }]} />}>
            {view === 'marked' ? <Marked text={e.content} corrections={e.correction.corrections} /> : <p lang="ja" className="whitespace-pre-wrap text-[17px] leading-loose">{e.correction.revisedText}</p>}
          </Card>
          {e.correction.corrections.length > 0 && (
            <Card title={`修改 ${e.correction.corrections.length} 处`}>
              <ol className="space-y-3">
                {e.correction.corrections.map((c, i) => (
                  <li key={i} className="rounded-xl bg-surface-2 px-3 py-2.5">
                    <div lang="ja" className="flex flex-wrap items-center gap-2">
                      <span className="text-danger line-through">{c.original}</span>
                      <ArrowsLeftRight className="size-3.5 text-ink-3" />
                      <span className="font-semibold text-ok">{c.corrected}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{c.explanationZh}</p>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/** 原文里把要改的片段划出来 */
function Marked({ text, corrections }: { text: string; corrections: Array<{ original: string; corrected: string }> }) {
  const parts: Array<{ t: string; fix?: string }> = [];
  let rest = text;
  for (const c of corrections) {
    const i = c.original ? rest.indexOf(c.original) : -1;
    if (i < 0) continue;
    parts.push({ t: rest.slice(0, i) }, { t: c.original, fix: c.corrected });
    rest = rest.slice(i + c.original.length);
  }
  parts.push({ t: rest });
  return (
    <p lang="ja" className="whitespace-pre-wrap text-[17px] leading-loose">
      {parts.map((p, i) =>
        p.fix ? (
          <mark key={i} title={`→ ${p.fix}`} className={cx('rounded bg-danger-soft px-0.5 text-danger underline decoration-wavy underline-offset-4')}>{p.t}</mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </p>
  );
}
