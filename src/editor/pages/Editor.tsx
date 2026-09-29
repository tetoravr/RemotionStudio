import { Player, type PlayerRef } from '@remotion/player';
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AdVideo } from '../../video/AdVideo';
import { isAudioStale } from '../../video/narrationKey';
import { FORMATS, Project, type Scene, type SceneType } from '../../video/schema';
import { newScene, SCENE_TYPE_LABELS } from '../../video/templates';
import { computeTimeline } from '../../video/timeline';
import { api, waitJob, type Job } from '../api';
import { go, MetaContext } from '../App';
import { Progress, Seg } from '../components/Fields';
import { AudioPanel } from '../components/AudioPanel';
import { BrandPanel } from '../components/BrandPanel';
import { CastPanel } from '../components/CastPanel';
import { RenderDialog } from '../components/RenderDialog';
import { ReviseDialog } from '../components/ReviseDialog';
import { SceneInspector } from '../components/SceneInspector';

export type Update = (fn: (draft: Project) => void) => void;
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
  const playerRef = useRef<PlayerRef>(null);
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
      saving.current = api
        .save(p)
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
    (fn) => {
      setProject((prev) => {
        if (!prev) return prev;
        const draft = structuredClone(prev);
        fn(draft);
        const parsed = Project.safeParse(draft);
        const next = parsed.success ? parsed.data : draft;
        history.current.past.push(prev);
        if (history.current.past.length > 60) history.current.past.shift();
        history.current.future = [];
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
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
    () => (project ? project.scenes.reduce((a, s) => a + s.lines.filter((l) => isAudioStale(l, project.cast, meta.models.tts)).length, 0) : 0),
    [project, meta.models.tts],
  );

  const inputProps = useMemo(() => (project ? { project, assetBaseUrl: `/files/${project.id}/` } : null), [project]);

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
    const s = newScene(type, project.brand.name);
    // テンプレートの hero/buddy をこのプロジェクトのキャストに割り当てる
    const ids = project.cast.map((c) => c.id);
    const mapId = (tid: string) => (tid === 'buddy' ? (ids[1] ?? ids[0]) : ids[0]) ?? 'narrator';
    s.lines.forEach((l) => (l.speaker = mapId(l.speaker)));
    const seen = new Set<string>();
    s.characters = s.characters
      .map((c) => ({ ...c, id: mapId(c.id) }))
      .filter((c) => c.id !== 'narrator' && !seen.has(c.id) && seen.add(c.id));
    update((p) => {
      p.scenes.splice(sel + 1, 0, s);
    });
    setSelected(sel + 1);
    setAddMenu(false);
  };

  const currentScene = timeline.scenes.findIndex((st) => frame >= st.start && frame < st.start + st.duration);

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
          ←
        </button>
        <input className="title-input" value={project.title} onChange={(e) => update((p) => void (p.title = e.target.value))} />
        <span className="save-state">
          {saveState === 'saved' ? '✓ 保存済み' : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '編集中' : '⚠ 保存失敗'}
        </span>
        <button className="btn sm ghost" onClick={undo} title="元に戻す (Ctrl+Z)">
          ↶
        </button>
        <button className="btn sm ghost" onClick={redo} title="やり直す (Ctrl+Shift+Z)">
          ↷
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
          ✨ AIで修正
        </button>
        <button
          className="btn"
          disabled={!meta.openai || staleCount === 0 || !project.audio.narration}
          onClick={() => runJob('ナレーションを生成しています', `/api/projects/${project.id}/narration`)}
          title={staleCount ? '変更されたセリフの音声を作成します' : 'すべてのセリフに音声があります'}
        >
          🎙 ナレーション生成 {staleCount ? <span className="count">{staleCount}</span> : null}
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            await flush();
            setDialog('render');
          }}
        >
          ⬇ 書き出し
        </button>
      </div>

      <div className="workspace">
        <div className="sidebar">
          <div className="head">
            <strong style={{ flex: 1 }}>シーン</strong>
            <div style={{ position: 'relative' }}>
              <button className="btn sm" onClick={() => setAddMenu((v) => !v)}>
                ＋ 追加
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
              const stale = s.lines.some((l) => isAudioStale(l, project.cast, meta.models.tts));
              return (
                <div key={s.id} className={`scene-item ${i === sel ? 'on' : ''}`} onClick={() => selectScene(i)}>
                  <div className="num">{i + 1}</div>
                  <div className="meta">
                    <div className="type">
                      {SCENE_TYPE_LABELS[s.type].split('（')[0]}
                      <span className="dur">{st ? (st.duration / project.fps).toFixed(1) : '-'}s</span>
                      {stale && project.audio.narration ? <span className="audio-stale" title="音声が未生成">●</span> : null}
                    </div>
                    <div className="text">{sceneSummary(s, project.brand.name) || '（未入力）'}</div>
                  </div>
                  <div className="tools" onClick={(e) => e.stopPropagation()}>
                    <button title="上へ" onClick={() => moveScene(i, -1)}>
                      ▲
                    </button>
                    <button title="下へ" onClick={() => moveScene(i, 1)}>
                      ▼
                    </button>
                    <button
                      title="複製"
                      onClick={() =>
                        update((p) => {
                          const c = structuredClone(p.scenes[i]);
                          c.id = `s-${Math.random().toString(36).slice(2, 8)}`;
                          c.lines.forEach((l) => (l.id = `l-${Math.random().toString(36).slice(2, 8)}`));
                          p.scenes.splice(i + 1, 0, c);
                        })
                      }
                    >
                      ⧉
                    </button>
                    <button
                      title="削除"
                      onClick={() => {
                        if (project.scenes.length <= 1) return;
                        if (confirm(`シーン${i + 1}を削除しますか？`)) update((p) => void p.scenes.splice(i, 1));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="stage">
          <div className="player-wrap" ref={stageRef}>
            {size.w > 0 ? (
              <div className="player-box" style={{ width: size.w, height: size.h }}>
                <Player
                  ref={playerRef}
                  component={AdVideo}
                  inputProps={inputProps}
                  durationInFrames={timeline.total}
                  fps={project.fps}
                  compositionWidth={fmt.width}
                  compositionHeight={fmt.height}
                  style={{ width: size.w, height: size.h }}
                  controls
                  clickToPlay
                  numberOfSharedAudioTags={24}
                  spaceKeyToPlayOrPause={false}
                />
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
            {tab === 'scene' && selScene ? <SceneInspector project={project} index={sel} update={update} timing={timeline.scenes[sel]} /> : null}
            {tab === 'brand' ? <BrandPanel project={project} update={update} /> : null}
            {tab === 'cast' ? <CastPanel project={project} update={update} runJob={runJob} flush={flush} /> : null}
            {tab === 'audio' ? <AudioPanel project={project} update={update} runJob={runJob} /> : null}
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
      {dialog === 'render' ? <RenderDialog project={project} onClose={() => setDialog(null)} staleCount={staleCount} /> : null}
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
