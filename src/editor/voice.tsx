import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isAudioStale, narrationHash, plainSpeechText, voiceFor } from '../video/narrationKey';
import type { Line, Project } from '../video/schema';
import { api, waitJob } from './api';
import { withBase } from './base';
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
  /**
   * 開いてから内容を変えたのに、音声がまだ古いセリフ。プレビューでは鳴らさない（変える前の言葉が聞こえないように）
   */
  outdated: Set<string>;
  /** 作る。'stale' は古いセリフ全部。でき上がって取り込むまで待ち、新しくできた音声（id → src）を返す */
  request: (ids: string[] | 'stale', opts?: { force?: boolean }) => Promise<Record<string, string>>;
  /** セリフの音声を1つ聴く（ほかの試聴と動画の再生は止める） */
  preview: (src: string, onEnd?: (finished: boolean) => void) => void;
};

/* ---------------- 試聴（セリフの音声を1つずつ聴く）。画面のどこから鳴らしても、同時には1つだけ ---------------- */

let previewEl: HTMLAudioElement | null = null;
let previewToken = 0;
export const stopPreview = () => {
  previewToken++;
  previewEl?.pause();
  previewEl = null;
};
/** projectId の音声ファイルを鳴らす。終わる・止められる・読めない時に onEnd（最後まで鳴った時だけ finished=true） */
export const playPreview = (projectId: string, src: string, onEnd?: (finished: boolean) => void) => {
  stopPreview();
  const me = previewToken;
  // ファイル名は作るたびに変わる。念のため、ブラウザに残った前の音声を使わないようにする
  const a = new Audio(withBase(`/files/${projectId}/${src}?v=${encodeURIComponent(src)}`));
  previewEl = a;
  let ended = false;
  const done = (finished: boolean) => {
    if (ended) return;
    ended = true;
    if (previewToken === me) previewEl = null;
    onEnd?.(finished);
  };
  a.onended = () => done(true);
  a.onerror = () => done(false);
  // 別の試聴を始めた・止めた時（最後まで鳴った時も ended より先に pause が来るので、ended で見分ける）
  a.onpause = () => done(a.ended);
  a.play().catch(() => done(false));
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
  pauseVideo,
}: {
  project: Project | null;
  engine: string;
  ready: boolean;
  flush: () => Promise<void>;
  update: Update;
  projectRef: React.RefObject<Project | null>;
  pauseVideo: () => void;
}): VoiceState => {
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<VoiceState['progress']>(null);
  const [failed, setFailed] = useState<Record<string, { hash: string; message: string }>>({});
  const busy = useRef(false);
  const queue = useRef<{ ids: string[] | 'stale'; done: (made: Record<string, string>) => void }[]>([]);
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
  // 開いてから変えたセリフ（開いた時点で古かったものは除く）
  const outdated = useMemo(() => {
    const out = new Set<string>();
    if (!ready || !project) return out;
    const base = baseline.current?.hashes;
    for (const id of stale) if (base?.get(id) !== hashOf(project, id)) out.add(id);
    return out;
  }, [ready, project, stale, hashOf]);
  const waiting = useMemo(() => {
    const out = new Set<string>();
    if (!auto) return out;
    for (const id of outdated) if (!running.has(id) && !isFailed(id)) out.add(id);
    return out;
  }, [auto, outdated, running, isFailed]);

  /**
   * でき上がった音声を取り込む。
   * 作ったジョブの結果（made）をそのまま使う。保存されたプロジェクトを読み直すと、その間に画面から保存した古い内容で
   * 上書きされていて、前の音声に戻ってしまうことがあるため（結果が無い失敗時だけ読み直す）。
   * 作っている間に内容を変えたセリフは取り込まない（また古い扱いのまま）
   */
  const merge = useCallback(
    async (ids: string[], snapshot: Map<string, string>, made: Record<string, Line['audio']> | null) => {
      const p = projectRef.current;
      if (!p) return {} as Record<string, string>;
      const byId = new Map<string, NonNullable<Line['audio']>>();
      if (made) {
        for (const [id, a] of Object.entries(made)) if (a) byId.set(id, a);
      } else {
        const fresh = await api.get(p.id);
        for (const l of fresh.scenes.flatMap((s) => s.lines)) if (l.audio) byId.set(l.id, l.audio);
      }
      /** 取り込む音声（頼んだセリフは、頼んだ時から内容が変わっていなければ、今の内容の音声として） */
      const pick = (draft: Project) => {
        const out = new Map<string, NonNullable<Line['audio']>>();
        for (const l of draft.scenes.flatMap((s) => s.lines)) {
          const a = byId.get(l.id);
          if (!a) continue;
          const now = narrationHash(l, voiceFor(l.speaker, draft.cast), engineRef.current);
          if (ids.includes(l.id)) {
            if (snapshot.get(l.id) === now) out.set(l.id, { ...a, hash: now });
          } else if (a.hash === now) out.set(l.id, a);
        }
        return out;
      };
      // 結果は、画面の最新の内容で先に決める（update の中は後で実行されるので、そこでは結果を返せない）
      const got: Record<string, string> = {};
      for (const [id, a] of pick(projectRef.current ?? p)) if (ids.includes(id)) got[id] = a.src;
      update(
        (draft) => {
          const take = pick(draft);
          for (const s of draft.scenes)
            for (const l of s.lines) {
              const a = take.get(l.id);
              if (a && l.audio?.src !== a.src) l.audio = a;
            }
        },
        { silent: true },
      );
      return got;
    },
    [projectRef, update],
  );

  const runOne = useCallback(
    async (ids: string[] | 'stale') => {
      // 直前の入力（ボタンを押す直前の書き換え）が画面のデータに入るのを待つ
      await new Promise((r) => setTimeout(r, 60));
      const p = projectRef.current;
      if (!p) return {};
      const list =
        ids === 'stale'
          ? p.scenes.flatMap((s) => s.lines).filter((l) => plainSpeechText(l).trim() && isAudioStale(l, p.cast, engineRef.current)).map((l) => l.id)
          : ids;
      if (!list.length) return {};
      setRunning(new Set(list));
      setProgress({ done: 0, total: list.length, message: '' });
      let error: string | null = null;
      let snapshot = new Map<string, string>();
      let made: Record<string, Line['audio']> | null = null;
      try {
        // 画面の編集を先に保存してから作る（サーバーは保存された内容で作る）
        await flush();
        const saved = projectRef.current ?? p;
        snapshot = new Map(list.map((id) => [id, hashOf(saved, id)]));
        let jobId: string | null = null;
        for (let i = 0; i < 60 && !jobId; i++) {
          const res = await fetch(`/api/projects/${p.id}/narration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // 頼んだセリフは必ず作る（サーバー側で「最新」と判断されて何も起きない、ということがないように）
            body: JSON.stringify({ lineIds: list, force: true }),
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
        const job = await waitJob(jobId, (j) => setProgress({ done: Math.round(j.progress * list.length), total: list.length, message: j.message }));
        const r = job.result as { audio?: Record<string, Line['audio']>; error?: string } | undefined;
        made = r?.audio ?? null;
        // 一部だけ作れなかった時は、作れた分を取り込んで、残りを失敗として出す
        if (r?.error) error = r.error;
      } catch (e) {
        error = (e as Error).message;
      }
      const got = await merge(list, snapshot, made).catch(() => ({}) as Record<string, string>);
      const now = projectRef.current;
      setFailed((cur) => {
        const next = { ...cur };
        for (const id of list) {
          if (got[id]) delete next[id];
          // 失敗した時だけ記録する（作っている間に書き換えたセリフは、次にまた作る）
          else if (error && now && hashOf(now, id) === snapshot.get(id)) next[id] = { hash: snapshot.get(id)!, message: error };
        }
        return next;
      });
      setRunning(new Set());
      setProgress(null);
      return got;
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
        job.done(await runOne(job.ids).catch(() => ({})));
      }
    } finally {
      busy.current = false;
    }
  }, [runOne]);

  const request = useCallback(
    (ids: string[] | 'stale', _opts: { force?: boolean } = {}) =>
      new Promise<Record<string, string>>((done) => {
        if (Array.isArray(ids)) setFailed((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => !ids.includes(k))));
        else setFailed({});
        queue.current.push({ ids, done });
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

  const preview = useCallback(
    (src: string, onEnd?: (finished: boolean) => void) => {
      const p = projectRef.current;
      if (!p) return;
      pauseVideo();
      playPreview(p.id, src, onEnd);
    },
    [projectRef, pauseVideo],
  );

  const errors = useMemo(() => Object.fromEntries(Object.entries(failed).filter(([id]) => isFailed(id)).map(([id, f]) => [id, f.message])), [failed, isFailed]);

  return { running, waiting, errors, stale, outdated, progress, auto, ready, request, preview };
};

