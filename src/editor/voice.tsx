import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isAudioStale, narrationHash, plainSpeechText, voiceFor } from '../video/narrationKey';
import type { Project } from '../video/schema';
import { api, waitJob } from './api';
import type { Update } from './pages/Editor';

/**
 * セリフの音声を、裏で作り直す仕組み。
 * セリフを変えると、そのセリフの音声は古くなる。自動（audio.autoVoice）なら入力が落ち着いてから、そのセリフだけを作り直す。
 * 作っている間も編集できる（画面を止めない）。でき上がった音声は、その間の編集を壊さないよう、音声だけを取り込む。
 */
export type VoiceState = {
  /** 作成中のセリフ */
  running: Set<string>;
  /** 自動で作り直すのを待っているセリフ（入力が落ち着くのを待っている） */
  waiting: Set<string>;
  /** 作れなかったセリフ（id → 理由）。同じ内容のままなら、自動ではもう作らない */
  errors: Record<string, string>;
  /** 音声が古い／無いセリフ */
  stale: Set<string>;
  progress: { done: number; total: number; message: string } | null;
  auto: boolean;
  ready: boolean;
  /** 作る。'stale' は古いセリフ全部。force は最新でも作り直す。でき上がって取り込むまで待つ */
  request: (ids: string[] | 'stale', opts?: { force?: boolean }) => Promise<void>;
  /** 今の音声（作り直した直後に聴く用） */
  audioOf: (lineId: string) => string | null;
};

export const VoiceContext = createContext<VoiceState | null>(null);
export const useVoice = () => useContext(VoiceContext);

/** 入力が止まってから自動で作り始めるまで */
const SETTLE_MS = 1500;

export const useVoiceUpdater = ({
  project,
  engine,
  ready,
  flush,
  update,
  projectRef,
}: {
  project: Project | null;
  engine: string;
  ready: boolean;
  flush: () => Promise<void>;
  update: Update;
  projectRef: React.RefObject<Project | null>;
}): VoiceState => {
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<VoiceState['progress']>(null);
  const [failed, setFailed] = useState<Record<string, { hash: string; message: string }>>({});
  const busy = useRef(false);
  const queue = useRef<{ ids: string[] | 'stale'; force: boolean; done: () => void }[]>([]);
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const hashOf = useCallback((p: Project, lineId: string) => {
    const l = p.scenes.flatMap((s) => s.lines).find((x) => x.id === lineId);
    return l ? narrationHash(l, voiceFor(l.speaker, p.cast), engineRef.current) : '';
  }, []);

  const stale = useMemo(() => {
    const out = new Set<string>();
    if (!project) return out;
    for (const s of project.scenes) for (const l of s.lines) if (plainSpeechText(l).trim() && isAudioStale(l, project.cast, engine)) out.add(l.id);
    return out;
  }, [project, engine]);

  const auto = Boolean(project?.audio.narration && project.audio.autoVoice);
  const isFailed = useCallback((id: string) => Boolean(project && failed[id] && failed[id].hash === hashOf(project, id)), [project, failed, hashOf]);

  // 開いた時点ですでに古かったセリフ（以前のエンジンで作った音声など）は、自動では作らない（まとめて作るかはバナーで選ぶ）。
  // 開いてから変えたセリフだけを自動で作り直す
  const baseline = useRef<{ id: string; hashes: Map<string, string> } | null>(null);
  if (project && ready && baseline.current?.id !== project.id) {
    baseline.current = { id: project.id, hashes: new Map([...stale].map((id) => [id, hashOf(project, id)])) };
  }
  const waiting = useMemo(() => {
    const out = new Set<string>();
    if (!auto || !ready || !project) return out;
    const base = baseline.current?.hashes;
    for (const id of stale) if (!running.has(id) && !isFailed(id) && base?.get(id) !== hashOf(project, id)) out.add(id);
    return out;
  }, [auto, ready, project, stale, running, isFailed, hashOf]);

  /** サーバーで作った音声のうち、今の内容と合うものだけを取り込む（作っている間に変えたセリフは、また古い扱いのまま） */
  const merge = useCallback(
    async (ids: string[]) => {
      const p = projectRef.current;
      if (!p) return [] as string[];
      const fresh = await api.get(p.id);
      const byId = new Map(fresh.scenes.flatMap((s) => s.lines).map((l) => [l.id, l.audio] as const));
      const got: string[] = [];
      update(
        (draft) => {
          for (const s of draft.scenes)
            for (const l of s.lines) {
              const a = byId.get(l.id);
              if (!a || (l.audio && l.audio.src === a.src)) continue;
              if (a.hash !== narrationHash(l, voiceFor(l.speaker, draft.cast), engineRef.current)) continue;
              l.audio = a;
              if (ids.includes(l.id)) got.push(l.id);
            }
        },
        { silent: true },
      );
      return got;
    },
    [projectRef, update],
  );

  const runOne = useCallback(
    async (ids: string[] | 'stale', force: boolean) => {
      const p = projectRef.current;
      if (!p) return;
      const list =
        ids === 'stale'
          ? p.scenes.flatMap((s) => s.lines).filter((l) => plainSpeechText(l).trim() && isAudioStale(l, p.cast, engineRef.current)).map((l) => l.id)
          : ids;
      if (!list.length) return;
      setRunning(new Set(list));
      setProgress({ done: 0, total: list.length, message: '' });
      let error: string | null = null;
      try {
        // 画面の編集を先に保存してから作る（サーバーは保存された内容で作る）
        await flush();
        let jobId: string | null = null;
        for (let i = 0; i < 60 && !jobId; i++) {
          const res = await fetch(`/api/projects/${p.id}/narration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineIds: list, force }),
          });
          const body = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
          if (res.status === 409) {
            // ほかの音声づくり（書き出し前のまとめて作成など）が終わるのを待つ
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          if (!res.ok || !body.jobId) throw new Error(body.error || `HTTP ${res.status}`);
          jobId = body.jobId;
        }
        if (!jobId) throw new Error('ほかの音声づくりが終わりませんでした');
        await waitJob(jobId, (j) => setProgress({ done: Math.round(j.progress * list.length), total: list.length, message: j.message }));
      } catch (e) {
        error = (e as Error).message;
      }
      const got = await merge(list).catch(() => [] as string[]);
      const now = projectRef.current;
      setFailed((cur) => {
        const next = { ...cur };
        for (const id of list) {
          if (got.includes(id)) delete next[id];
          else if (error && now) next[id] = { hash: hashOf(now, id), message: error };
        }
        return next;
      });
      setRunning(new Set());
      setProgress(null);
    },
    [projectRef, flush, merge, hashOf],
  );

  /** 1つずつ順番に（サーバーは同じ動画の音声づくりを同時に1つしか受け付けない） */
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const job = queue.current.shift()!;
        await runOne(job.ids, job.force);
        job.done();
      }
    } finally {
      busy.current = false;
    }
  }, [runOne]);

  const request = useCallback(
    (ids: string[] | 'stale', opts: { force?: boolean } = {}) =>
      new Promise<void>((done) => {
        if (Array.isArray(ids)) setFailed((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => !ids.includes(k))));
        else setFailed({});
        queue.current.push({ ids, force: Boolean(opts.force), done });
        void pump();
      }),
    [pump],
  );

  // 自動: 入力が落ち着いたら、古くなったセリフを作り直す
  const waitingKey = [...waiting].sort().join(',');
  useEffect(() => {
    if (!waitingKey || running.size) return;
    const t = setTimeout(() => void request(waitingKey.split(',')), SETTLE_MS);
    return () => clearTimeout(t);
  }, [waitingKey, running.size, request]);

  const audioOf = useCallback(
    (lineId: string) => projectRef.current?.scenes.flatMap((s) => s.lines).find((l) => l.id === lineId)?.audio?.src ?? null,
    [projectRef],
  );

  const errors = useMemo(() => Object.fromEntries(Object.entries(failed).filter(([id]) => isFailed(id)).map(([id, f]) => [id, f.message])), [failed, isFailed]);

  return { running, waiting, errors, stale, progress, auto, ready, request, audioOf };
};
