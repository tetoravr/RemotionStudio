import { Player, type PlayerRef } from '@remotion/player';
import {
  ChevronLeft, CircleAlert, Download, RectangleHorizontal, RectangleVertical, Redo2, Sparkles, Square, Undo2, X,
} from 'lucide-react';
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AdVideo } from '../../video/AdVideo';
import { applyTextTarget, readAdjust, sceneLayout, setSceneLayout, type TextTarget } from '../../video/edit/textEdit';
import { EditModeProvider, type EditMode } from '../../video/edit/Editable';
import { isAudioStale } from '../../video/narrationKey';
import { FORMATS, Project, type ElementAdjust, type Scene, type SceneType } from '../../video/schema';
import { newScene, remapCast } from '../../video/templates';
import { computeTimeline } from '../../video/timeline';
import { api, ttsFor, waitJob, type Job } from '../api';
import { go, MetaContext } from '../App';
import { AudioPanel } from '../components/AudioPanel';
import { BrandPanel } from '../components/BrandPanel';
import { CastPanel } from '../components/CastPanel';
import { LayerPanel } from '../components/LayerPanel';
import { stopPreview, useVoiceUpdater, VoiceContext } from '../voice';
import { carryAudio } from '../../video/narrationKey';
import { LinesPanel } from '../components/LinesPanel';
import { confirmDialog } from '../components/Dialogs';
import { Progress, Seg, Sheet } from '../components/Fields';
import { RenderDialog } from '../components/RenderDialog';
import { ReviseDialog } from '../components/ReviseDialog';
import { SceneInspector } from '../components/SceneInspector';
import { SceneNavigator } from '../components/SceneNavigator';
import { Transport } from '../components/Transport';
import { Ic } from '../icons';
import { withBase } from '../base';

export type Update = (fn: (draft: Project) => void, opts?: { silent?: boolean }) => void;
export type RunJob = (label: string, url: string, body?: unknown) => Promise<Job | null>;
type Tab = 'scene' | 'layers' | 'design' | 'cast' | 'sound';

/** コンテナにアスペクト比を保って収める */
const useFit = (ratio: number, padX = 40, padY = 54) => {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth - padX;
      const ch = el.clientHeight - padY;
      const w = Math.max(0, Math.min(cw, ch * ratio));
      setSize({ w, h: w / ratio });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, ratio, padX, padY]);
  return { ref: setEl, size };
};

/** シーンを複製する（セリフIDを振り直し、位置調整のキーも付け替える） */
const cloneScene = (src: Scene): Scene => {
  const c = structuredClone(src);
  c.id = `s-${Math.random().toString(36).slice(2, 8)}`;
  const ids = new Map<string, string>();
  c.lines.forEach((l) => {
    const next = `l-${Math.random().toString(36).slice(2, 8)}`;
    ids.set(l.id, next);
    l.id = next;
  });
  if (c.layouts) {
    for (const f of Object.keys(c.layouts) as (keyof typeof c.layouts)[]) {
      c.layouts[f] = Object.fromEntries(
        Object.entries(c.layouts[f] ?? {}).map(([k, v]) => {
          const m = /^(line|caption):(.+)$/.exec(k);
          return [m && ids.has(m[2]) ? `${m[1]}:${ids.get(m[2])}` : k, v];
        }),
      );
    }
  }
  return c;
};

export const Editor: React.FC<{ id: string }> = ({ id }) => {
  const meta = useContext(MetaContext)!;
  const [project, setProject] = useState<Project | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<Tab>('scene');
  const [job, setJob] = useState<{ label: string; job: Job | null } | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'render' | 'revise' | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [selectedEl, setSelectedEl] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);
  const projectRef = useRef<Project | null>(null);
  const playerRef = useRef<PlayerRef>(null);
  const editingRef = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const activeSceneRef = useRef<Scene | null>(null);
  const editApi = useRef<EditMode | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Project | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const history = useRef<{ past: Project[]; future: Project[] }>({ past: [], future: [] });
  // 一時停止中は、映像の要素を直接つかんで動かせる（モードの切り替えは不要）
  const editing = !playing;

  const reload = useCallback(async () => {
    const p = await api.get(id);
    setProject(p);
    return p;
  }, [id]);

  useEffect(() => {
    reload().catch((e) => setLoadErr(e.message));
  }, [reload]);

  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) {
      setSaveState('saving');
      // 保存は直列に（古い内容が新しい内容を上書きしないように）
      saving.current = saving.current
        .then(() => api.save(p))
        .then(() => setSaveState(pending.current ? 'dirty' : 'saved'))
        .catch(() => setSaveState('error'));
    }
    await saving.current;
  }, []);

  const schedule = useCallback(
    (p: Project) => {
      pending.current = p;
      setSaveState('dirty');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 700);
    },
    [flush],
  );

  const update: Update = useCallback(
    (fn, opts) => {
      setProject((prev) => {
        if (!prev) return prev;
        const draft = structuredClone(prev);
        fn(draft);
        const parsed = Project.safeParse(draft);
        const next = parsed.success ? parsed.data : draft;
        // ドラッグ中（silent）は履歴を積まない。操作の開始時に beginGesture で1回だけ積む
        if (!opts?.silent) {
          history.current.past.push(prev);
          if (history.current.past.length > 60) history.current.past.shift();
          history.current.future = [];
        }
        schedule(next);
        return next;
      });
    },
    [schedule],
  );

  // 元に戻しても、作り直した音声は前の音声に戻さない（内容に合う音声を引き継ぐ）
  const engineRef = useRef('');
  const withAudio = (p: Project) => carryAudio(p, [project!, ...history.current.past, ...history.current.future], engineRef.current);
  const undo = useCallback(() => {
    const popped = history.current.past.pop();
    if (!popped || !project) return;
    const prev = withAudio(popped);
    history.current.future.push(project);
    setProject(prev);
    schedule(prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, schedule]);
  const redo = useCallback(() => {
    const popped = history.current.future.pop();
    if (!popped || !project) return;
    const next = withAudio(popped);
    history.current.past.push(project);
    setProject(next);
    schedule(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, schedule]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const timeline = useMemo(() => (project ? computeTimeline(project) : null), [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT' || t?.isContentEditable) return;
      // 直接編集: 矢印で1px（Shiftで10px）、Delete で非表示、Esc で選択解除
      if (editingRef.current && selectedRef.current) {
        const sc = activeSceneRef.current;
        const sid = selectedRef.current;
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] as number[] | undefined;
        if (sc && d) {
          e.preventDefault();
          editApi.current?.beginGesture();
          const cur = readAdjust(sc, sid, projectRef.current?.format ?? 'vertical');
          editApi.current?.commit(sc.id, sid, { ...cur, dx: cur.dx + d[0], dy: cur.dy + d[1] }, true);
          return;
        }
        if (sc && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          editApi.current?.beginGesture();
          editApi.current?.commit(sc.id, sid, { ...readAdjust(sc, sid, projectRef.current?.format ?? 'vertical'), hidden: true }, true);
          setSelectedEl(null);
          return;
        }
        if (e.key === 'Escape') {
          setSelectedEl(null);
          return;
        }
      }
      // 何も選んでいない時の ← → はコマ送り（Shift で1秒）
      if (!selectedRef.current && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && playerRef.current) {
        e.preventDefault();
        const p = playerRef.current;
        p.pause();
        const stepF = e.shiftKey ? projectRef.current?.fps ?? 30 : 1;
        p.seekTo(Math.max(0, p.getCurrentFrame() + (e.key === 'ArrowLeft' ? -stepF : stepF)));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        playerRef.current?.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  useEffect(() => {
    const before = () => {
      if (pending.current) api.save(pending.current);
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);

  /** サーバー側でプロジェクトを書き換えるジョブ（保存→実行→再読み込み） */
  const runJob: RunJob = useCallback(
    async (label, url, body) => {
      setJobErr(null);
      await flush();
      setJob({ label, job: null });
      try {
        const { jobId } = await api.post(url, body);
        const done = await waitJob(jobId, (j) => setJob({ label, job: j }));
        const before = projectRef.current;
        await reload();
        if (before) {
          history.current.past.push(before);
          history.current.future = [];
        }
        setJob(null);
        return done;
      } catch (e) {
        setJob(null);
        setJobErr((e as Error).message);
        return null;
      }
    },
    [flush, reload],
  );

  const fmt = project ? FORMATS[project.format] : FORMATS.vertical;
  const { ref: stageRef, size } = useFit(fmt.width / fmt.height);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => {
      setPlaying(true);
      setSelectedEl(null);
      // セリフの試聴と重ならないように
      stopPreview();
    };
    const onPause = () => setPlaying(false);
    const onMute = (e: { detail: { isMuted: boolean } }) => setMuted(e.detail.isMuted);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('seeked', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.addEventListener('ended', onPause);
    p.addEventListener('mutechange', onMute);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('seeked', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
      p.removeEventListener('ended', onPause);
      p.removeEventListener('mutechange', onMute);
    };
  }, [project?.id, size.w > 0]);

  const tts = ttsFor(meta, project?.audio);
  engineRef.current = tts.engine;
  const pauseVideo = useCallback(() => playerRef.current?.pause(), []);
  // セリフの音声を裏で作り直す（自動・手動とも）
  const voice = useVoiceUpdater({ project, engine: tts.engine, ready: tts.ready, flush, update, projectRef, pauseVideo });
  const staleByScene = useMemo(
    () => (project ? project.scenes.map((s) => s.lines.filter((l) => isAudioStale(l, project.cast, tts.engine)).length) : []),
    [project, tts.engine],
  );
  const staleCount = staleByScene.reduce((a, b) => a + b, 0);
  /** 音声はあるが、今の声・台本と合っていないセリフ（このまま再生すると、シーンによって声が変わって聞こえる） */
  const outdatedCount = useMemo(
    () => (project ? project.scenes.reduce((n, s) => n + s.lines.filter((l) => l.audio && isAudioStale(l, project.cast, tts.engine)).length, 0) : 0),
    [project, tts.engine],
  );

  /** 実スクリーンショット未設定の画面紹介シーン（番号）。書き出し前に必須 */
  const missingShots = useMemo(
    () => (project ? project.scenes.flatMap((s, i) => (s.type === 'showcase' && (!s.screenshot || s.screenshot.startsWith('ui:')) ? [i + 1] : [])) : []),
    [project],
  );

  // 開いてから内容を変えて、まだ作り直していないセリフは、プレビューで前の音声を鳴らさない
  const mutedKey = [...voice.outdated].sort().join(',');
  const inputProps = useMemo(
    () => (project ? { project, assetBaseUrl: withBase(`/files/${project.id}/`), mutedLines: mutedKey ? mutedKey.split(',') : [] } : null),
    [project, mutedKey],
  );

  const curIdx = project && timeline ? timeline.scenes.findIndex((st) => frame >= st.start && frame < st.start + st.duration) : -1;
  const activeSceneId = editing && project && curIdx >= 0 ? project.scenes[curIdx]?.id ?? null : null;
  const compScale = size.w > 0 ? size.w / fmt.width : 1;
  // 再生中は毎フレームこのコンポーネントが描き直されるので、値を使い回す（作り直すと映像全体が再描画されて音がとぎれる）
  const editMode: EditMode = useMemo(
    () => ({
      enabled: editing,
      activeSceneId,
      compScale,
      canvas: { w: fmt.width, h: fmt.height },
      overlay: overlayEl,
      selectedId: selectedEl,
      select: setSelectedEl,
      beginGesture: () => {
        const cur = projectRef.current;
        if (!cur) return;
        history.current.past.push(cur);
        if (history.current.past.length > 60) history.current.past.shift();
        history.current.future = [];
      },
      commit: (sceneId, elId, adjust: ElementAdjust | null, silent) =>
        update(
          (p) => {
            const sc = p.scenes.find((x) => x.id === sceneId);
            if (!sc) return;
            // 今の画面の形（縦型・正方形・横型）の調整だけを書き換える
            const layout = { ...sceneLayout(sc, p.format) };
            if (adjust) layout[elId] = adjust;
            else delete layout[elId];
            setSceneLayout(sc, p.format, layout);
          },
          { silent: silent ?? false },
        ),
      commitText: (sceneId, target: TextTarget, value) =>
        update((p) => {
          if (target.type === 'brandName') {
            p.brand.name = value;
            return;
          }
          const sc = p.scenes.find((x) => x.id === sceneId);
          if (sc) applyTextTarget(sc, target, value);
        }),
      patchLine: (sceneId, lineId, patch, silent) =>
        update(
          (p) => {
            const line = p.scenes.find((x) => x.id === sceneId)?.lines.find((l) => l.id === lineId);
            if (line) Object.assign(line, patch);
          },
          { silent: silent ?? false },
        ),
      pause: () => playerRef.current?.pause(),
      getOrigin: () => {
        const r = boxRef.current?.getBoundingClientRect();
        return { left: r?.left ?? 0, top: r?.top ?? 0 };
      },
    }),
    [editing, activeSceneId, compScale, fmt.width, fmt.height, selectedEl, overlayEl, update],
  );

  // 別のシーンへ移ったら選択を外す（選んでいる間だけシーンを「全要素を出した状態」で止めるため）
  const lastScene = useRef<string | null>(null);
  useEffect(() => {
    if (activeSceneId && lastScene.current && activeSceneId !== lastScene.current) setSelectedEl(null);
    if (activeSceneId) lastScene.current = activeSceneId;
  }, [activeSceneId]);

  // 再生位置が動いたら、シーン一覧・セリフ・右の設定をそのシーンに合わせる（再生中もシーク中も）。
  // 編集で長さが変わっただけの時は選択を変えない（入力中に別のシーンへ切り替わらないように）
  const selectedIdx = useRef(0);
  selectedIdx.current = selected;
  useEffect(() => {
    // 毎フレーム呼ばれるので、変わった時だけ更新する（同じ値でも更新を積むと再生中に描き直しが連鎖する）
    if (curIdx >= 0 && curIdx !== selectedIdx.current) setSelected(curIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  /** 取り消しの記録を1つ積む（ドラッグなど、連続した操作の始まりに1回だけ） */
  const pushHistory = useCallback(() => {
    const cur = projectRef.current;
    if (!cur) return;
    history.current.past.push(cur);
    if (history.current.past.length > 60) history.current.past.shift();
    history.current.future = [];
  }, []);

  /**
   * 構成が変わった（追加・並べ替え・複製・削除・長さの変更）あと、そのシーンへ再生位置を移す。
   * 時間の並びが計算し直されてから動かす。edge=true はシーンの最後のコマ（長さを変えている時の見た目の確認用）
   */
  const pendingSeek = useRef<{ id: string; edge?: boolean } | null>(null);
  useEffect(() => {
    if (!timeline || !project) return;
    const player = playerRef.current;
    const want = pendingSeek.current;
    if (want) {
      const i = project.scenes.findIndex((x) => x.id === want.id);
      const st = timeline.scenes[i];
      if (!st) return;
      pendingSeek.current = null;
      setSelected(i);
      player?.seekTo(want.edge ? st.start + st.duration - 1 : st.start + Math.min(st.duration - 1, Math.round(st.duration * 0.62)));
      return;
    }
    // セリフの編集や取り消しで長さが変わっても、再生位置が選んでいるシーンからはみ出さないように
    if (!player || player.isPlaying()) return;
    const st = timeline.scenes[Math.min(selectedIdx.current, timeline.scenes.length - 1)];
    const f = player.getCurrentFrame();
    if (st && (f < st.start || f >= st.start + st.duration)) player.seekTo(Math.max(st.start, Math.min(st.start + st.duration - 1, f)));
  }, [timeline, project]);

  /** シーンの長さを変える（sec=null で自動に戻す） */
  const resizeFresh = useRef(false);
  const resizeScene = useCallback(
    (i: number, sec: number | null, phase: 'start' | 'move' | 'end') => {
      if (phase === 'start') {
        // 取り消しの記録は、実際に動かし始めた時に1回だけ積む（つまみを押しただけでは長さを固定しない）
        resizeFresh.current = true;
        return;
      }
      if (phase === 'end' && sec != null) {
        resizeFresh.current = false;
        return;
      }
      // 自動のままのシーンを「自動に戻す」は何もしない（取り消しの記録も積まない）
      if (sec == null && projectRef.current?.scenes[i]?.lengthSec == null) return;
      if (phase === 'move' && resizeFresh.current) {
        resizeFresh.current = false;
        pushHistory();
      }
      const id = projectRef.current?.scenes[i]?.id;
      if (id) pendingSeek.current = { id, edge: true };
      update(
        (p) => {
          const sc = p.scenes[i];
          if (!sc) return;
          if (sec == null) delete sc.lengthSec;
          else sc.lengthSec = Math.round(sec * 10) / 10;
        },
        // ドラッグ中は開始時に1回だけ履歴を積んでいるので、ここでは積まない（ダブルクリックでの「自動に戻す」は積む）
        { silent: sec != null },
      );
    },
    [pushHistory, update],
  );

  const selectElement = useCallback((elId: string) => {
    playerRef.current?.pause();
    setSelectedEl(elId);
  }, []);

  /** レイヤーから選ぶ。再生位置がそのシーンの外なら、シーンの中へ移してから選ぶ（選べるのは再生位置のシーンの要素だけ） */
  const selectLayer = useCallback(
    (elId: string) => {
      const p = projectRef.current;
      const st = timeline?.scenes[Math.min(selectedIdx.current, (timeline?.scenes.length ?? 1) - 1)];
      const player = playerRef.current;
      if (p && st && player) {
        const f = player.getCurrentFrame();
        if (f < st.start || f >= st.start + st.duration) player.seekTo(st.start + Math.min(st.duration - 1, Math.round(st.duration * 0.62)));
      }
      selectElement(elId);
    },
    [timeline, selectElement],
  );

  if (loadErr)
    return (
      <div className="home-main">
        <div className="error">{loadErr}</div>
      </div>
    );
  if (!project || !timeline || !inputProps)
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="spinner" />
      </div>
    );

  const sel = Math.min(selected, project.scenes.length - 1);

  const selectScene = (i: number) => {
    setSelected(i);
    // シーンごとの内容のタブ（シーン・レイヤー）はそのまま。ほかのタブからはシーンへ
    setTab((t) => (t === 'layers' ? t : 'scene'));
    setSelectedEl(null);
    const st = timeline.scenes[i];
    if (st) playerRef.current?.seekTo(st.start + Math.min(st.duration - 1, Math.round(st.duration * 0.62)));
  };

  const moveScene = (from: number, to: number) => {
    if (to < 0 || to >= project.scenes.length || from === to) return;
    pendingSeek.current = { id: project.scenes[from].id };
    update((p) => {
      const [s] = p.scenes.splice(from, 1);
      p.scenes.splice(to, 0, s);
    });
    setSelected(to);
  };

  const addScene = (type: SceneType) => {
    const s = remapCast(newScene(type, project.brand.name), project.cast.map((c) => c.id));
    pendingSeek.current = { id: s.id };
    update((p) => {
      p.scenes.splice(sel + 1, 0, s);
    });
    setSelected(sel + 1);
    setTab('scene');
  };

  const deleteScene = async (i: number) => {
    if (project.scenes.length <= 1) return;
    const ok = await confirmDialog({ title: `シーン${i + 1}を削除しますか？`, message: '⌘Z（Ctrl+Z）で元に戻せます。', ok: '削除', danger: true });
    if (!ok) return;
    const next = project.scenes[i - 1] ?? project.scenes[i + 1];
    if (next) pendingSeek.current = { id: next.id };
    update((p) => void p.scenes.splice(i, 1));
    setSelected((cur) => Math.max(0, cur >= i ? cur - 1 : cur));
  };

  activeSceneRef.current = editing && curIdx >= 0 ? project.scenes[curIdx] : null;
  editingRef.current = editing;
  selectedRef.current = selectedEl;
  editApi.current = editMode;

  const status =
    saveState === 'saved' ? '保存済み' : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '編集中' : '保存できませんでした';

  return (
    <VoiceContext.Provider value={voice}>
    <div className="editor">
      <header className="toolbar">
        <div className="tb-left">
          <button
            className="icon-btn"
            title="プロジェクト一覧へ"
            onClick={async () => {
              await flush();
              go('/');
            }}
          >
            <Ic n={ChevronLeft} size={20} mr={0} />
          </button>
          <img className="tb-logo" src={withBase('/brand/logo.png')} alt="Video Creator" title="Video Creator" />
          <div className="doc-title">
            <input value={project.title} onChange={(e) => update((p) => void (p.title = e.target.value))} aria-label="タイトル" />
            <span className="status" style={saveState === 'error' ? { color: 'var(--red)' } : undefined}>
              {saveState === 'error' ? <Ic n={CircleAlert} size={11} mr={0} /> : null}
              {status}
            </span>
          </div>
        </div>
        <Seg
          value={project.format}
          onChange={(v) => update((p) => void (p.format = v))}
          options={[
            { value: 'vertical', label: '縦', icon: RectangleVertical, title: '縦型 9:16（リール・ショート）' },
            { value: 'square', label: '正方形', icon: Square, title: '正方形 1:1（フィード）' },
            { value: 'horizontal', label: '横', icon: RectangleHorizontal, title: '横型 16:9（YouTube・Web）' },
          ]}
        />
        <div className="tb-right">
          <button className="icon-btn" onClick={undo} disabled={!history.current.past.length} title="取り消す（⌘Z）">
            <Ic n={Undo2} size={16} mr={0} />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!history.current.future.length} title="やり直す（⇧⌘Z）">
            <Ic n={Redo2} size={16} mr={0} />
          </button>
          <span className="tb-divider" />
          <button className="btn" disabled={!meta.openai} onClick={() => setDialog('revise')} title={meta.openai ? '台本の直し方を文章で伝えます' : 'OPENAI_API_KEY が未設定です'}>
            <Ic n={Sparkles} size={14} mr={0} />
            AIで直す
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              await flush();
              setDialog('render');
            }}
          >
            <Ic n={Download} size={14} mr={0} />
            書き出す
          </button>
        </div>
      </header>

      <div className="workspace">
        <SceneNavigator
          project={project}
          selected={sel}
          stale={project.audio.narration ? staleByScene.map((n) => n > 0) : project.scenes.map(() => false)}
          onSelect={selectScene}
          onMove={moveScene}
          onDuplicate={(i) => {
            const c = cloneScene(project.scenes[i]);
            pendingSeek.current = { id: c.id };
            update((p) => void p.scenes.splice(i + 1, 0, c));
            setSelected(i + 1);
          }}
          onDelete={deleteScene}
          onAdd={addScene}
        />

        <main className="stage">
          {project.audio.narration && (staleCount > 0 || !tts.ready || voice.running.size > 0) ? (
            <div className={`stage-banner ${voice.running.size || (voice.waiting.size && !Object.keys(voice.errors).length) ? 'solo' : ''}`}>
              {!tts.ready ? (
                <>
                  <span className="dot danger" />
                  <span>{tts.problem}</span>
                  <button className="btn sm plain" onClick={() => setTab('sound')}>
                    詳しく
                  </button>
                </>
              ) : voice.running.size ? (
                <>
                  <span className="spinner" style={{ width: 13, height: 13 }} />
                  <span>
                    {voice.running.size === 1 ? 'セリフの音声を作り直しています' : '音声を作っています'}
                    {voice.progress && voice.progress.total > 1 ? `（${voice.progress.done}/${voice.progress.total}）` : ''}
                  </span>
                </>
              ) : voice.waiting.size && voice.waiting.size === staleCount ? (
                <>
                  <span className="dot accent" />
                  <span>セリフの変更に合わせて、音声を作り直します</span>
                </>
              ) : (
                <>
                  <span className="dot warn" />
                  <span>
                    {Object.keys(voice.errors).length
                      ? `音声を作れなかったセリフがあります`
                      : outdatedCount
                        ? `内容が変わったセリフが ${staleCount} 件あります`
                        : `音声がまだないセリフが ${staleCount} 件あります`}
                  </span>
                  <button className="btn sm primary" onClick={() => void voice.request('stale')}>
                    音声を作り直す
                  </button>
                </>
              )}
            </div>
          ) : null}
          <div className="canvas-wrap" ref={stageRef}>
            {size.w > 0 ? (
              <div
                className="player-box"
                ref={boxRef}
                data-edit-canvas={editing ? 'on' : undefined}
                style={{ width: size.w, height: size.h }}
                onPointerDown={editing ? () => setSelectedEl(null) : undefined}
              >
                <EditModeProvider value={editing ? editMode : null}>
                  <Player
                    ref={playerRef}
                    component={AdVideo}
                    inputProps={inputProps}
                    durationInFrames={timeline.total}
                    fps={project.fps}
                    compositionWidth={fmt.width}
                    compositionHeight={fmt.height}
                    style={{ width: size.w, height: size.h }}
                    controls={false}
                    clickToPlay={!editing}
                    doubleClickToFullscreen={false}
                    numberOfSharedAudioTags={24}
                    spaceKeyToPlayOrPause={false}
                    acknowledgeRemotionLicense
                  />
                </EditModeProvider>
                <div ref={setOverlayEl} data-edit-overlay style={{ position: 'absolute', inset: 0, zIndex: 1000, pointerEvents: 'none' }} />
              </div>
            ) : null}
            {editing ? (
              <div className="stage-hint">{selectedEl ? 'ドラッグで移動・ダブルクリックで文字を編集・Esc で選択を解除' : 'クリックで選択・ダブルクリックで文字を編集'}</div>
            ) : null}
          </div>
        </main>

        <LinesPanel
          project={project}
          index={sel}
          timing={timeline.scenes[sel]}
          localFrame={curIdx === sel && timeline.scenes[sel] ? frame - timeline.scenes[sel].start : -1}
          update={update}
          runJob={runJob}
          onSeek={(f) => {
            const st = timeline.scenes[sel];
            if (st) playerRef.current?.seekTo(st.start + f);
          }}
        />

        <aside className="inspector">
          <div className="inspector-head">
            <Seg
              block
              value={tab}
              onChange={setTab}
              options={[
                { value: 'scene', label: 'シーン' },
                { value: 'layers', label: 'レイヤー' },
                { value: 'design', label: 'デザイン' },
                { value: 'cast', label: 'キャスト' },
                { value: 'sound', label: 'サウンド' },
              ]}
            />
          </div>
          <div className="inspector-body">
            {tab === 'scene' ? (
              <SceneInspector project={project} index={sel} update={update} timing={timeline.scenes[sel]} runJob={runJob} />
            ) : null}
            {tab === 'layers' ? (
              <LayerPanel project={project} index={sel} update={update} selectedId={selectedEl} onSelect={selectLayer} onDeselect={() => setSelectedEl(null)} />
            ) : null}
            {tab === 'design' ? <BrandPanel project={project} update={update} /> : null}
            {tab === 'cast' ? <CastPanel project={project} update={update} runJob={runJob} flush={flush} /> : null}
            {tab === 'sound' ? <AudioPanel project={project} update={update} runJob={runJob} onSelectScene={selectScene} /> : null}
          </div>
        </aside>
      </div>

      {/* 再生バーは画面の幅いっぱいに（シーンの長さを細かく変えられるように） */}
      <Transport
        player={playerRef}
        frame={frame}
        total={timeline.total}
        fps={project.fps}
        playing={playing}
        muted={muted}
        scenes={timeline.scenes}
        current={curIdx}
        onScrub={() => setSelectedEl(null)}
        onResize={resizeScene}
      />

      {job ? (
        <Sheet>
          <div className="hstack" style={{ gap: 12 }}>
            <div className="spinner" />
            <h3 style={{ margin: 0 }}>{job.label}</h3>
          </div>
          <div className="sheet-text" style={{ margin: '10px 0 0' }}>
            {job.job?.message ?? '準備しています'}
          </div>
          <Progress value={job.job?.progress ?? 0.02} />
          <div className="caption">終わると自動でプレビューに反映されます</div>
        </Sheet>
      ) : null}
      {jobErr ? (
        <div className="toast" role="alert">
          <span className="danger-text" style={{ display: 'inline-flex', marginTop: 2 }}>
            <Ic n={CircleAlert} size={16} mr={0} />
          </span>
          <span style={{ flex: 1 }}>{jobErr}</span>
          <button className="icon-btn sm" onClick={() => setJobErr(null)} title="閉じる">
            <Ic n={X} size={14} mr={0} />
          </button>
        </div>
      ) : null}
      {dialog === 'render' ? <RenderDialog project={project} onClose={() => setDialog(null)} staleCount={staleCount} missingShots={missingShots} /> : null}
      {dialog === 'revise' ? (
        <ReviseDialog
          onClose={() => setDialog(null)}
          onSubmit={async (instruction) => {
            setDialog(null);
            await runJob('AIが台本を直しています', `/api/projects/${project.id}/ai/revise`, { instruction });
          }}
        />
      ) : null}
    </div>
    </VoiceContext.Provider>
  );
};
