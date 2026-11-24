/**
 * 朗读 / 影子跟读：贴一段日文（或从"已学过的内容"里挑），看文朗读，或先听再紧跟着读。逐字标出漏读、多读、读错。
 * 练习材料按学习阶段给（v1.6.0）：五十音阶段只给由已学假名组成的词；之后给已学过的课里的例句，不超纲。
 */
import { Microphone, Play } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { SpeakingMode } from '@shared/constants';
import type { SpeakingAttempt } from '@shared/types';
import { speakingApi } from '@/api/endpoints';
import { DiffView, Recorder, ScoreBars, type Take } from '@/components/practice';
import { Button, Card, EmptyState, Field, Notice, PageHeader, Segmented, Textarea, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { kanaWordsFor } from '@/lib/kanaWords';
import { JaText, useSettingsData, useStage, useStudyTimer } from '@/lib/study';
import { warmRecognizer } from '@/platform/recognizer';
import { speech } from '@/platform/speech';

const LINE = lineOf('speaking');


export function SpeakingPage() {
  useStudyTimer('speaking');
  useEffect(warmRecognizer, []);
  const settings = useSettingsData();
  const qc = useQueryClient();
  const [mode, setMode] = useState<SpeakingMode>('reading');
  const stage = useStage();
  // 练习材料：五十音阶段 = 已学假名能拼出的词；之后 = 已学课里的例句
  const samples = useMemo(() => {
    if (!stage) return [];
    if (stage.stage === 'kana') return kanaWordsFor(stage.knownKana).map((e) => ({ ...e, from: '' }));
    return stage.sentences.map((e) => ({ ja: e.ja, reading: e.reading, zh: e.zh, from: e.lessonTitle }));
  }, [stage]);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<(typeof samples)[number] | null>(null);
  useEffect(() => {
    if (!text && samples[0]) {
      setText(samples[0].ja);
      setPicked(samples[0]);
    }
  }, [samples, text]);
  const [last, setLast] = useState<SpeakingAttempt | null>(null);
  const history = useQuery({ queryKey: ['speaking'], queryFn: () => speakingApi.list({ limit: 10 }) });
  const submit = useMutation({
    mutationFn: (t: Take) => speakingApi.create({ mode, sourceType: 'custom', referenceText: text.trim(), referenceReading: picked?.ja === text ? picked.reading : null, ...t }),
    onSuccess: (a) => {
      setLast(a);
      void qc.invalidateQueries({ queryKey: ['speaking'] });
    },
  });

  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="朗读跟读" subtitle="看文朗读练准确，影子跟读练语速和语调" />
      <Card>
        <Segmented
          label="模式"
          value={mode}
          onChange={setMode}
          className="mb-4"
          options={[{ value: 'reading', label: '看文朗读' }, { value: 'shadowing', label: '影子跟读' }]}
        />
        {samples.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-sm font-semibold text-ink-2">{stage?.stage === 'kana' ? '用您已经学过的假名能读的词：' : '从您学过的课里挑一句：'}</p>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {samples.map((s, i) => (
                <button
                  key={i}
                  lang="ja"
                  onClick={() => { setText(s.ja); setPicked(s); }}
                  className={`min-h-9 rounded-full px-3 text-sm ${text === s.ja ? 'bg-ink text-ground' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
                  title={s.from ? `${s.from}：${s.zh}` : s.zh}
                >
                  {s.ja.length > 14 ? `${s.ja.slice(0, 14)}…` : s.ja}
                </button>
              ))}
            </div>
          </div>
        )}
        {picked && picked.ja === text && (
          <div className="mb-3 rounded-xl bg-surface-2 px-4 py-3">
            <JaText text={picked.ja} reading={picked.reading} mode="always" className="text-2xl font-bold" />
            <p className="text-sm text-ink-3">{picked.zh}{picked.from && ` · ${picked.from}`}</p>
          </div>
        )}
        <Field label="要读的文本" hint={mode === 'shadowing' ? '先点"播放"，听着同时跟读；熟练后可以不看文本' : '也可以粘贴任何日文自己练'}>
          <Textarea lang="ja" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} className="text-lg" />
        </Field>
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
          <Button variant="secondary" icon={Play} onClick={() => void speech.speak(text, { rate: settings?.speechRate ?? 1, voiceName: settings?.ttsVoice ?? null })} disabled={!text.trim()}>
            播放原声
          </Button>
        </div>
        <div className="mt-4">
          <Recorder onTake={(t) => submit.mutate(t)} busy={submit.isPending} disabled={!text.trim()} />
        </div>
        {submit.isError && <Notice tone="error" className="mt-3">{errorText(submit.error)}</Notice>}
        {last && (
          <div className="mt-5 space-y-3 rounded-xl bg-surface-2 p-4">
            <ScoreBars scores={last.scores} color={LINE.color} />
            {last.transcript && <DiffView diff={last.diff} />}
          </div>
        )}
      </Card>

      <h2 className="mb-2 mt-6 px-1 text-[15px] font-extrabold">最近的练习</h2>
      {history.data?.items.length ? (
        <ul className="space-y-2">
          {history.data.items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 lift">
              <span className="font-sign w-10 text-2xl font-bold tabular" style={{ color: LINE.color }}>{a.scores.overall}</span>
              <div className="min-w-0 flex-1">
                <p lang="ja" className="truncate text-sm font-semibold">{a.referenceText}</p>
                <p className="text-xs text-ink-3">{a.mode === 'shadowing' ? '影子跟读' : '看文朗读'} · {new Date(a.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Card><EmptyState icon={Microphone} title="还没有练习记录">读一遍，分数和逐字对比会出现在这里。</EmptyState></Card>
      )}
    </div>
  );
}
