/**
 * 场景对话：场景表（9 类 × 8 个，带掌握情况）→ 对话页（AI 扮演角色 + 每句批改 + 结束打分）。
 */
import { ArrowUp, ChatsCircle, CheckCircle, Flag, Lightbulb, Medal, Translate } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SCENARIO_CATEGORIES, SCENARIO_CATEGORY_LABELS, SCENARIO_MASTERY_SCORE, type ScenarioCategory } from '@shared/constants';
import type { Conversation, Message, Scenario } from '@shared/types';
import { talkApi } from '@/api/endpoints';
import { Button, Card, EmptyState, Notice, PageHeader, Skeleton, Textarea, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { JaText, SpeakButton, useSettingsData, useStudyTimer } from '@/lib/study';

const LINE = lineOf('scenario');
const REGISTER_ZH = { plain: '普通体', polite: '丁宁体', keigo: '敬语' } as const;

export function TalkPage() {
  useStudyTimer('scenario');
  const [cat, setCat] = useState<ScenarioCategory>('travel');
  const nav = useNavigate();
  const scenarios = useQuery({ queryKey: ['scenarios'], queryFn: () => talkApi.scenarios() });
  const recent = useQuery({ queryKey: ['conversations', 'active'], queryFn: () => talkApi.conversations({ status: 'active', limit: 5 }) });
  const start = useMutation({ mutationFn: (s: Scenario) => talkApi.start(s.id), onSuccess: (r) => nav(`/talk/${r.conversation.id}`, { viewTransition: true }) });
  const list = scenarios.data?.items.filter((s) => s.category === cat) ?? [];
  // 从课程页来（?scenario=lesson:n5-07）：顶部放这一课的专属对话
  const [params] = useSearchParams();
  const lessonScenarioId = params.get('scenario')?.startsWith('lesson:') ? params.get('scenario')! : null;
  const lessonScenario = useQuery({ queryKey: ['scenario', lessonScenarioId], queryFn: () => talkApi.scenario(lessonScenarioId!), enabled: !!lessonScenarioId });
  const mastered = (c: ScenarioCategory) => scenarios.data?.items.filter((s) => s.category === c && s.progress.mastered).length ?? 0;

  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="场景对话" subtitle={`和 AI 角色扮演，每句都有批改；结束时综合分 ≥ ${SCENARIO_MASTERY_SCORE} 算掌握`} />

      {lessonScenario.data && (
        <Card title={lessonScenario.data.title} className="mb-5">
          <p className="text-sm text-ink-2">{lessonScenario.data.description}</p>
          <ul className="mt-2 space-y-1 text-sm text-ink-2">
            {lessonScenario.data.goals.map((g) => <li key={g}>· {g}</li>)}
          </ul>
          <Button className="mt-4" onClick={() => start.mutate(lessonScenario.data!)} loading={start.isPending && start.variables?.id === lessonScenario.data.id}>开始本课对话</Button>
        </Card>
      )}
      {lessonScenario.isError && <Notice tone="error" className="mb-5">{errorText(lessonScenario.error)}</Notice>}

      {!!recent.data?.items.length && (
        <Card title="继续上次的对话" className="mb-5">
          <ul className="divide-y divide-line">
            {recent.data.items.map((c) => (
              <li key={c.id}>
                <Link to={`/talk/${c.id}`} viewTransition className="flex min-h-12 items-center gap-3 py-2 text-sm hover:text-ink">
                  <ChatsCircle weight="duotone" className="size-5" style={{ color: LINE.color }} />
                  <span className="flex-1 font-semibold">{c.title}</span>
                  <span className="text-xs text-ink-3">{c.messageCount} 句</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="场景类别">
        {SCENARIO_CATEGORIES.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={cat === c}
            onClick={() => setCat(c)}
            className={cx('flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition', cat === c ? 'bg-ink text-ground' : 'bg-surface text-ink-2 ring-1 ring-line hover:text-ink')}
          >
            {SCENARIO_CATEGORY_LABELS[c]}
            {mastered(c) > 0 && <span className="font-sign text-[11px] opacity-70">{mastered(c)}/8</span>}
          </button>
        ))}
      </div>

      {scenarios.isError ? (
        <Notice tone="error">{errorText(scenarios.error)}</Notice>
      ) : !scenarios.data ? (
        <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2">
          {list.map((s) => (
            <li key={s.id} className="flex flex-col rounded-2xl bg-surface p-4 lift">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold">{s.title}</h3>
                  <p lang="ja" className="text-sm text-ink-3">{s.titleJa}</p>
                </div>
                {s.progress.mastered ? (
                  <Medal weight="fill" className="size-6 shrink-0" style={{ color: LINE.color }} aria-label="已掌握" />
                ) : s.progress.bestScore !== null ? (
                  <span className="font-sign text-lg font-bold text-ink-3" title="最高分">{s.progress.bestScore}</span>
                ) : null}
              </div>
              <p className="mt-2 flex-1 text-sm text-ink-2">{s.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold text-ink-3">
                <span className="rounded-md bg-surface-2 px-2 py-0.5">{s.level}</span>
                <span className="rounded-md bg-surface-2 px-2 py-0.5">{REGISTER_ZH[s.register]}</span>
                <span className="rounded-md bg-surface-2 px-2 py-0.5">你是{s.userRole}</span>
              </div>
              <Button size="sm" className="mt-4 self-start" onClick={() => start.mutate(s)} loading={start.isPending && start.variables?.id === s.id}>
                开始对话
              </Button>
            </li>
          ))}
        </ul>
      )}
      {start.isError && <Notice tone="error" className="mt-3">{errorText(start.error)}</Notice>}
    </div>
  );
}

/* ───────────── 对话页 ───────────── */

export function ConversationPage() {
  useStudyTimer('scenario');
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => talkApi.conversation(id) });
  const msgs = useQuery({ queryKey: ['messages', id], queryFn: () => talkApi.messages(id) });
  const scenario = useQuery({ queryKey: ['scenario', conv.data?.scenarioId], queryFn: () => talkApi.scenario(conv.data!.scenarioId), enabled: !!conv.data });
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: (content: string) => talkApi.send(id, content),
    onSuccess: (r) => {
      qc.setQueryData(['messages', id], (old: { items: Message[]; nextCursor: string | null } | undefined) => ({
        items: [...(old?.items ?? []), r.userMessage, r.assistantMessage],
        nextCursor: null,
      }));
      qc.setQueryData(['conversation', id], r.conversation);
      setText('');
    },
  });
  const finish = useMutation({
    mutationFn: (c: Conversation) => talkApi.finish(c.id, c.version),
    onSuccess: (c) => {
      qc.setQueryData(['conversation', id], c);
      void qc.invalidateQueries({ queryKey: ['scenarios'] });
    },
  });

  const items = msgs.data?.items ?? [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items.length, send.isPending]);

  const c = conv.data;
  const s = scenario.data;
  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (t && !send.isPending) send.mutate(t);
  }

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <PageHeader
        back="/talk"
        line={LINE}
        title={c?.title ?? '对话'}
        subtitle={s ? `${s.aiRole} ↔ 你（${s.userRole}）· ${REGISTER_ZH[c?.register ?? s.register]}` : undefined}
        actions={c?.status === 'active' && <Button size="sm" variant="outline" icon={Flag} onClick={() => finish.mutate(c)} loading={finish.isPending}>结束并打分</Button>}
      />

      {s && c?.status === 'active' && (
        <details className="mb-4 rounded-2xl bg-surface px-4 py-3 text-sm lift">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Lightbulb weight="duotone" className="size-4" style={{ color: LINE.color }} />这一场的目标和可用表达</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">{s.goals.map((g) => <li key={g}>{g}</li>)}</ul>
          <div className="mt-2 flex flex-wrap gap-1.5">{s.keyPhrases.map((p) => <span key={p} lang="ja" className="rounded-md bg-surface-2 px-2 py-0.5">{p}</span>)}</div>
        </details>
      )}

      {c?.status === 'finished' && (
        <Card className="mb-4">
          <div className="flex items-center gap-4">
            <div className="font-sign text-5xl font-bold" style={{ color: (c.score ?? 0) >= SCENARIO_MASTERY_SCORE ? 'var(--ok)' : LINE.color }}>{c.score}</div>
            <div className="text-sm">
              <div className="font-bold">{(c.score ?? 0) >= SCENARIO_MASTERY_SCORE ? '这个场景已经掌握了' : '再练一次就能掌握'}</div>
              <p className="mt-1 leading-relaxed text-ink-2">{c.summary}</p>
            </div>
          </div>
        </Card>
      )}

      <div className="flex-1 space-y-4">
        {msgs.isPending && <Skeleton className="h-20 w-2/3" />}
        {items.map((m) => <Bubble key={m.id} m={m} />)}
        {send.isPending && (
          <>
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-go-soft px-4 py-2.5 opacity-70" lang="ja">{send.variables}</div>
            <div className="flex gap-1.5 px-2 py-3" aria-label="对方正在输入">{[0, 1, 2].map((i) => <span key={i} className="size-2 animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${i * 120}ms` }} />)}</div>
          </>
        )}
        <div ref={endRef} />
      </div>

      {(send.isError || finish.isError) && <Notice tone="error" className="mt-3">{errorText(send.error ?? finish.error)}</Notice>}

      {c?.status === 'active' ? (
        <form onSubmit={submit} className="sticky bottom-[calc(4.5rem+var(--sab))] mt-4 flex items-end gap-2 rounded-2xl bg-surface p-2 lift md:bottom-4">
          <Textarea
            lang="ja"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
            }}
            placeholder="用日语回答（Enter 发送，Shift+Enter 换行）"
            maxLength={500}
            className="min-h-11 resize-none ring-0 hover:ring-0 focus:ring-0"
            aria-label="你的回答"
          />
          <button type="submit" aria-label="发送" disabled={!text.trim() || send.isPending} className="grid size-11 shrink-0 place-items-center rounded-xl bg-go text-go-ink transition active:scale-95 disabled:opacity-40">
            <ArrowUp weight="bold" className="size-5" />
          </button>
        </form>
      ) : c?.status === 'finished' ? (
        <div className="mt-4 text-center"><Link to="/talk" className="text-sm font-semibold text-ink-2 underline">回到场景列表</Link></div>
      ) : null}
      {!msgs.isPending && !items.length && <EmptyState icon={ChatsCircle} title="对话加载中断了">返回列表重新开始一次吧。</EmptyState>}
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const settings = useSettingsData();
  const [showZh, setShowZh] = useState(false);
  if (m.role === 'user') {
    const f = m.feedback;
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div lang="ja" className="max-w-[85%] rounded-2xl rounded-br-md bg-go-soft px-4 py-2.5 text-[15px]">{m.content}</div>
        {f && (
          <div className="max-w-[85%] rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-line">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink-3">
              <span className="font-sign text-base font-bold text-ink">{f.score}</span>
              {f.corrections.length === 0 ? <span className="flex items-center gap-1 text-ok"><CheckCircle weight="fill" className="size-3.5" />这句没问题</span> : <span>{f.corrections.length} 处可以改</span>}
            </div>
            {f.corrections.map((x, i) => (
              <div key={i} className="mt-1.5">
                <span lang="ja" className="text-danger line-through">{x.original}</span> → <span lang="ja" className="font-semibold text-ok">{x.corrected}</span>
                <div className="text-xs text-ink-3">{x.explanationZh}</div>
              </div>
            ))}
            {f.naturalAlternative && <div className="mt-1.5 text-xs text-ink-2">更自然：<span lang="ja" className="font-semibold">{f.naturalAlternative}</span></div>}
            {f.registerNote && <div className="mt-1 text-xs text-warn">{f.registerNote}</div>}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 lift">
        <JaText text={m.content} reading={m.reading} mode={settings?.furiganaMode} className="text-[15px] leading-relaxed" />
        {showZh && m.translationZh && <div className="mt-1 text-sm text-ink-3">{m.translationZh}</div>}
      </div>
      <div className="flex flex-col gap-1">
        <SpeakButton text={m.content} className="size-9" />
        {m.translationZh && (
          <button onClick={() => setShowZh((v) => !v)} aria-label="显示中文" className={cx('grid size-9 place-items-center rounded-full', showZh ? 'bg-ink text-ground' : 'bg-surface-2 text-ink-2')}>
            <Translate className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
