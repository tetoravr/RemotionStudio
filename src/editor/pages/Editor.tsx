import { confirmDialog } from '../components/Dialogs';
import { Plus } from 'lucide-react';
import { Player, type PlayerRef } from '@remotion/player';
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AdVideo } from '../../video/AdVideo';
import { isAudioStale } from '../../video/narrationKey';
import { applyTextTarget, type TextTarget } from '../../video/edit/textEdit';
import { EditModeProvider, type EditMode } from '../../video/edit/Editable';
import { FORMATS, Project, type ElementAdjust, type Scene, type SceneType } from '../../video/schema';
import { newScene, remapCast, SCENE_TYPE_LABELS } from '../../video/templates';
import { computeTimeline } from '../../video/timeline';
import { api, ttsFor, waitJob, type Job } from '../api';
import { go, MetaContext } from '../App';
import { Progress, Seg } from '../components/Fields';
import { AudioPanel } from '../components/AudioPanel';
import { BrandPanel } from '../components/BrandPanel';
import { CastPanel } from '../components/CastPanel';
import { RenderDialog } from '../components/RenderDialog';
import { ReviseDialog } from '../components/ReviseDialog';
import { SceneInspector } from '../components/SceneInspector';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Circle, Copy, Download, Mic, MousePointer2, Play, Redo2, Sparkles, TriangleAlert, Undo2, X } from 'lucide-react';
import { Ic } from '../icons';

export type Update = (fn: (draft: Project) => void, opts?: { silent?: boolean }) => void;
export type RunJob = (label: string, url: string, body?: unknown) => Promise<Job | null>;

const sceneSummary = (s: Scene, brand: string) => {
  switch (s.type) {
    case 'logo':
      return (s.logoText || brand).replace(/\n/g, ' ');
    case 'feature':
      return `${s.eyebrow} ${s.headline}`.replace(/\[\[|\]\]|\n/g, '');
    case 'showcase':
      return s.title.replace(/\[\[|\]\]|\n/g, '');
    case 'cta':
      return s.buttonText;
    default:
      return (s.headline || s.lines[0]?.text || '').replace(/\n/g, '');
  }
};

/** コンテナにアスペクト比を保って収める */
const useFit = (ratio: number) => {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth - 32;
      const ch = el.clientHeight - 32;
      const w = Math.max(0, Math.min(cw, ch * ratio));
      setSize({ w, h: w / ratio });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, ratio]);
  return { ref: setEl, size };
};

export const Editor: React.FC<{ id: string }> = ({ id }) => {
  const meta = useContext(MetaContext)!;
  const [project, setProject] = useState<Project | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<'scene' | 'brand' | 'cast' | 'audio'>('scene');
  const [job, setJob] = useState<{ label: string; job: Job | null } | null>(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'render' | 'revise' | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [frame, setFrame] = useState(0);
  const [editing, setEditing] = useState(false);
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

  const undo = useCallback(() => {
    const prev = history.current.past.pop();
    if (!prev || !project) return;
    history.current.future.push(project);
    setProject(prev);
    schedule(prev);
  }, [project, schedule]);
  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next || !project) return;
    history.current.past.push(project);
    setProject(next);
    schedule(next);
  }, [project, schedule]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // 直接調整: 矢印で1px（Shiftで10px）、Delete で非表示、Esc で選択解除
      if (editingRef.current && selectedRef.current) {
        const sc = activeSceneRef.current;
        const id = selectedRef.current;
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] as number[] | undefined;
        if (sc && d) {
          e.preventDefault();
          editApi.current?.beginGesture();
          const cur = sc.layout?.[id];
          editApi.current?.commit(sc.id, id, { scale: 1, rotate: 0, ...cur, dx: (cur?.dx ?? 0) + d[0], dy: (cur?.dy ?? 0) + d[1] }, true);
          return;
        }
        if (sc && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          editApi.current?.beginGesture();
          editApi.current?.commit(sc.id, id, { dx: 0, dy: 0, scale: 1, rotate: 0, ...sc.layout?.[id], hidden: true }, true);
          setSelectedEl(null);
          return;
        }
        if (e.key === 'Escape') setSelectedEl(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
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
        const before = project;
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
    [flush, reload, project],
  );

  const timeline = useMemo(() => (project ? computeTimeline(project) : null), [project]);
  const fmt = project ? FORMATS[project.format] : FORMATS.vertical;
  const { ref: stageRef, size } = useFit(fmt.width / fmt.height);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const on = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener('frameupdate', on);
    return () => p.removeEventListener('frameupdate', on);
  }, [project?.id, size.w]);

  const staleCount = useMemo(
    () => (project ? project.scenes.reduce((a, s) => a + s.lines.filter((l) => isAudioStale(l, project.cast, ttsFor(meta, project.audio.ttsProvider).engine)).length, 0) : 0),
    [project, meta],
  );

  /** 実スクリーンショット未設定の画面紹介シーン（番号）。書き出し前に必須 */
  const missingShots = useMemo(() => (project ? project.scenes.flatMap((s, i) => (s.type === 'showcase' && (!s.screenshot || s.screenshot.startsWith('ui:')) ? [i + 1] : [])) : []), [project]);

  const inputProps = useMemo(() => (project ? { project, assetBaseUrl: `/files/${project.id}/` } : null), [project]);

  const curIdx = project && timeline ? timeline.scenes.findIndex((st) => frame >= st.start && frame < st.start + st.duration) : -1;
  const activeSceneId = editing && project && curIdx >= 0 ? project.scenes[curIdx]?.id ?? null : null;
  const compScale = size.w > 0 ? size.w / fmt.width : 1;
  // 再生中は毎フレームこのコンポーネントが描き直されるので、値を使い回す（作り直すと映像全体が再描画されて音がとぎれる）
  const editMode: EditMode = useMemo(() => ({
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
    commit: (sceneId, id, adjust: ElementAdjust | null, silent) =>
      update((p) => {
        const sc = p.scenes.find((x) => x.id === sceneId);
        if (!sc) return;
        const layout = { ...(sc.layout ?? {}) };
        if (adjust) layout[id] = adjust;
        else delete layout[id];
        sc.layout = Object.keys(layout).length ? layout : undefined;
      }, { silent: silent ?? false }),
    commitText: (sceneId, target: TextTarget, value) =>
      update((p) => {
        if (target.type === 'brandName') {
          p.brand.name = value;
          return;
        }
        const sc = p.scenes.find((x) => x.id === sceneId);
        if (sc) applyTextTarget(sc, target, value);
      }),
    pause: () => playerRef.current?.pause(),
    getOrigin: () => {
      const r = boxRef.current?.getBoundingClientRect();
      return { left: r?.left ?? 0, top: r?.top ?? 0 };
    },
  }), [editing, activeSceneId, compScale, fmt.width, fmt.height, selectedEl, overlayEl, update]);

  if (loadErr) return <div className="home"><div className="error">{loadErr}</div></div>;
  if (!project || !timeline || !inputProps) return <div className="home muted">読み込み中…</div>;

  const sel = Math.min(selected, project.scenes.length - 1);
  const selScene = project.scenes[sel];

  const selectScene = (i: number) => {
    setSelected(i);
    setTab('scene');
    const st = timeline.scenes[i];
    if (st) playerRef.current?.seekTo(st.start + Math.min(st.duration - 1, 12));
  };

  const moveScene = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= project.scenes.length) return;
    update((p) => {
      [p.scenes[i], p.scenes[j]] = [p.scenes[j], p.scenes[i]];
    });
    setSelected(j);
  };

  const addScene = (type: SceneType) => {
    const s = remapCast(newScene(type, project.brand.name), project.cast.map((c) => c.id));
    update((p) => {
      p.scenes.splice(sel + 1, 0, s);
    });
    setSelected(sel + 1);
    setAddMenu(false);
  };

  const setMode = (on: boolean) => {
    setEditing(on);
    setSelectedEl(null);
    playerRef.current?.pause();
  };
  const currentScene = timeline.scenes.findIndex((st) => frame >= st.start && frame < st.start + st.duration);
  const activeScene = editing && currentScene >= 0 ? project.scenes[currentScene] : null;
  editingRef.current = editing;
  selectedRef.current = selectedEl;
  activeSceneRef.current = activeScene;

  editApi.current = editMode;

  return (
    <div className="editor">
      <div className="topbar">
        <button
          className="btn ghost"
          onClick={async () => {
            await flush();
            go('/');
          }}
        >
          <Ic n={ArrowLeft} mr={0} />
        </button>
        <input className="title-input" value={project.title} onChange={(e) => update((p) => void (p.title = e.target.value))} />
        <span className="save-state">
          {saveState === 'saved' ? <><Ic n={Check} />保存済み</> : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '編集中' : <><Ic n={TriangleAlert} />保存失敗</>}
        </span>
        <button className="btn sm ghost" onClick={undo} title="元に戻す (Ctrl+Z)">
          <Ic n={Undo2} mr={0} />
        </button>
        <button className="btn sm ghost" onClick={redo} title="やり直す (Ctrl+Shift+Z)">
          <Ic n={Redo2} mr={0} />
        </button>
        <div className="spacer" />
        <Seg
          value={project.format}
          onChange={(v) => update((p) => void (p.format = v))}
          options={[
            { value: 'vertical', label: '9:16' },
            { value: 'square', label: '1:1' },
            { value: 'horizontal', label: '16:9' },
          ]}
        />
        <span className="faint">{(timeline.total / project.fps).toFixed(1)}秒</span>
        <button className="btn" disabled={!meta.openai} onClick={() => setDialog('revise')} title="AIに修正を指示">
          <Ic n={Sparkles} />AIで修正
        </button>
        <button
          className="btn"
          disabled={!ttsFor(meta, project.audio.ttsProvider).ready || staleCount === 0 || !project.audio.narration}
          onClick={() => runJob('ナレーションを生成しています', `/api/projects/${project.id}/narration`)}
          title={!ttsFor(meta, project.audio.ttsProvider).ready ? '音声エンジンが使えません（「音・設定」タブを確認）' : staleCount ? '変更されたセリフの音声を作成します' : 'すべてのセリフに音声があります'}
        >
          <Ic n={Mic} />ナレーション生成 {staleCount ? <span className="count">{staleCount}</span> : null}
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            await flush();
            setDialog('render');
          }}
        >
          <Ic n={Download} />書き出し
        </button>
      </div>

      <div className="workspace">
        <div className="sidebar">
          <div className="head">
            <strong style={{ flex: 1 }}>シーン</strong>
            <div style={{ position: 'relative' }}>
              <button className="btn sm" onClick={() => setAddMenu((v) => !v)}>
                <Ic n={Plus} />追加
              </button>
              {addMenu ? (
                <div className="menu" style={{ right: 0, top: 30 }}>
                  {(Object.keys(SCENE_TYPE_LABELS) as SceneType[]).map((t) => (
                    <button key={t} onClick={() => addScene(t)}>
                      {SCENE_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="scene-list">
            {project.scenes.map((s, i) => {
              const st = timeline.scenes[i];
              const stale = s.lines.some((l) => isAudioStale(l, project.cast, ttsFor(meta, project.audio.ttsProvider).engine));
              return (
                <div key={s.id} className={`scene-item ${i === sel ? 'on' : ''}`} onClick={() => selectScene(i)}>
                  <div className="num">{i + 1}</div>
                  <div className="meta">
                    <div className="type">
                      {SCENE_TYPE_LABELS[s.type].split('（')[0]}
                      <span className="dur">{st ? (st.duration / project.fps).toFixed(1) : '-'}s</span>
                      {stale && project.audio.narration ? <span className="audio-stale" title="音声が未生成"><Ic n={Circle} size={8} mr={0} /></span> : null}
                      {s.type === 'showcase' && (!s.screenshot || s.screenshot.startsWith('ui:')) ? <span className="audio-stale" title="スクリーンショット未設定"><Ic n={TriangleAlert} size={12} />画面未設定</span> : null}
                    </div>
                    <div className="text">{sceneSummary(s, project.brand.name) || '（未入力）'}</div>
                  </div>
                  <div className="tools" onClick={(e) => e.stopPropagation()}>
                    <button title="上へ" onClick={() => moveScene(i, -1)}>
                      <Ic n={ChevronUp} mr={0} />
                    </button>
                    <button title="下へ" onClick={() => moveScene(i, 1)}>
                      <Ic n={ChevronDown} mr={0} />
                    </button>
                    <button
                      title="複製"
                      onClick={() =>
                        update((p) => {
                          const c = structuredClone(p.scenes[i]);
                          c.id = `s-${Math.random().toString(36).slice(2, 8)}`;
                          const ids = new Map<string, string>();
                          c.lines.forEach((l) => {
                            const next = `l-${Math.random().toString(36).slice(2, 8)}`;
                            ids.set(l.id, next);
                            l.id = next;
                          });
                          // 位置調整はセリフIDで保存しているので、新しいIDに付け替える
                          if (c.layout) {
                            c.layout = Object.fromEntries(
                              Object.entries(c.layout).map(([k, v]) => {
                                const m = /^(line|caption):(.+)$/.exec(k);
                                return [m && ids.has(m[2]) ? `${m[1]}:${ids.get(m[2])}` : k, v];
                              }),
                            );
                          }
                          p.scenes.splice(i + 1, 0, c);
                        })
                      }
                    >
                      <Ic n={Copy} mr={0} />
                    </button>
                    <button
                      title="削除"
                      onClick={() => {
                        if (project.scenes.length <= 1) return;
                        confirmDialog({ title: `シーン${i + 1}を削除しますか？`, message: '「元に戻す」（Ctrl+Z）で戻せます。', ok: '削除する', danger: true }).then(
                          (ok) => ok && update((p) => void p.scenes.splice(i, 1)),
                        );
                      }}
                    >
                      <Ic n={X} mr={0} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`stage ${editing ? 'editing' : ''}`}>
          <div className={`modebar ${editing ? 'edit' : ''}`}>
            <div className="mode-seg" role="tablist">
              <button className={!editing ? 'on' : ''} onClick={() => setMode(false)} title="再生して仕上がりを確認します">
                <Ic n={Play} size={13} />
                プレビュー
              </button>
              <button className={editing ? 'on' : ''} onClick={() => setMode(true)} title="映像の要素を直接ドラッグして配置を調整します">
                <Ic n={MousePointer2} size={13} />
                直接調整
              </button>
            </div>
            <div className="spacer" />
            {editing ? (
              <button className="btn sm" onClick={() => setMode(false)}>
                プレビューに戻る
              </button>
            ) : null}
          </div>
          <div className="player-wrap" ref={stageRef}>
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
                  controls={!editing}
                  clickToPlay={!editing}
                  numberOfSharedAudioTags={24}
                  spaceKeyToPlayOrPause={false}
                />
                </EditModeProvider>
                <div ref={setOverlayEl} data-edit-overlay style={{ position: 'absolute', inset: 0, zIndex: 1000, pointerEvents: 'none' }} />
              </div>
            ) : null}
          </div>
          <div className="timeline">
            {timeline.scenes.map((st, i) => (
              <div
                key={st.scene.id + i}
                className={`blk ${i === sel ? 'on' : ''}`}
                style={{ flex: st.duration }}
                onClick={() => selectScene(i)}
                title={sceneSummary(st.scene, project.brand.name)}
              >
                {i + 1}. {SCENE_TYPE_LABELS[st.scene.type].split('（')[0]}
              </div>
            ))}
            <div className="head" style={{ left: `calc(14px + (100% - 28px) * ${frame / Math.max(1, timeline.total)})`, opacity: currentScene >= 0 ? 1 : 0 }} />
          </div>
        </div>

        <div className="inspector">
          <div className="tabs">
            {(
              [
                ['scene', `シーン ${sel + 1}`],
                ['brand', 'ブランド'],
                ['cast', 'キャラ・声'],
                ['audio', '音・設定'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="scroll">
            {tab === 'scene' && selScene ? <SceneInspector project={project} index={sel} update={update} timing={timeline.scenes[sel]} runJob={runJob} onSelectElement={(id) => { setEditing(true); setSelectedEl(id); playerRef.current?.pause(); }} /> : null}
            {tab === 'brand' ? <BrandPanel project={project} update={update} /> : null}
            {tab === 'cast' ? <CastPanel project={project} update={update} runJob={runJob} flush={flush} /> : null}
            {tab === 'audio' ? <AudioPanel project={project} update={update} runJob={runJob} onSelectScene={selectScene} /> : null}
          </div>
        </div>
      </div>

      {job ? (
        <div className="modal-bg">
          <div className="modal">
            <h3>{job.label}</h3>
            <div className="muted">{job.job?.message ?? '開始しています'}</div>
            <Progress value={job.job?.progress ?? 0.02} />
            <div className="faint">完了すると自動でプレビューに反映されます。</div>
          </div>
        </div>
      ) : null}
      {jobErr ? (
        <div className="toast" onClick={() => setJobErr(null)} style={{ color: 'var(--danger)', cursor: 'pointer', whiteSpace: 'pre-wrap', maxWidth: '80vw' }}>
          {jobErr}（クリックで閉じる）
        </div>
      ) : null}
      {dialog === 'render' ? <RenderDialog project={project} onClose={() => setDialog(null)} staleCount={staleCount} missingShots={missingShots} /> : null}
      {dialog === 'revise' ? (
        <ReviseDialog
          onClose={() => setDialog(null)}
          onSubmit={async (instruction) => {
            setDialog(null);
            await runJob('AIが台本を修正しています', `/api/projects/${project.id}/ai/revise`, { instruction });
          }}
        />
      ) : null}
    </div>
  );
};
