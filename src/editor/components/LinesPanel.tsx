import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Ellipsis, Play, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { normalizeAdjust, readAdjust, sceneLayout, setSceneLayout } from '../../video/edit/textEdit';
import { isAudioStale } from '../../video/narrationKey';
import type { Line, Project } from '../../video/schema';
import type { SceneTiming } from '../../video/timeline';
import { ttsFor } from '../api';
import { MetaContext } from '../App';
import { useVoice } from '../voice';
import { Ic } from '../icons';
import type { RunJob, Update } from '../pages/Editor';
import { SCENE_META } from '../sceneMeta';
import { Field, MenuItem, Popover, Seg, Text } from './Fields';
import { EmojiPicker, POSE_LABELS, PosePicker, SpeakerPicker, TagPicker } from './pickers';
import { withBase } from '../base';

const STYLE_LABELS: Record<Line['style'], string> = { bubble: '吹き出し', 'bubble-accent': '強調', caption: '字幕', none: '声のみ' };
const rid = () => Math.random().toString(36).slice(2, 8);

/**
 * いま再生位置にあるシーンのセリフを、いつも表示しておくパネル。
 * 再生中は話しているセリフを強調し、セリフを押すとその位置へ移動する。
 */
export const LinesPanel: React.FC<{
  project: Project;
  index: number;
  timing?: SceneTiming;
  /** シーン先頭からのフレーム（再生位置がこのシーンの外なら -1） */
  localFrame: number;
  update: Update;
  runJob: RunJob;
  onSeek: (sceneFrame: number) => void;
}> = ({ project, index, timing, localFrame, update, runJob, onSeek }) => {
  const scene = project.scenes[index];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const play = (src: string) => {
    audioRef.current?.pause();
    audioRef.current = new Audio(withBase(`/files/${project.id}/${src}?t=${Date.now()}`));
    audioRef.current.play();
  };
  const activeId = timing?.lines.find((lt) => localFrame >= lt.start && localFrame < lt.end)?.line.id ?? null;

  // 話しているセリフが見えるように、一覧をスクロールする
  useEffect(() => {
    if (!activeId) return;
    listRef.current?.querySelector(`[data-line="${activeId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  if (!scene) return <aside className="lines-panel" />;
  const m = SCENE_META[scene.type];
  return (
    <aside className="lines-panel">
      <div className="lines-head">
        <div className="lines-title">セリフ</div>
        <div className="caption">
          シーン{index + 1} ・ {m.name} ・ {scene.lines.length}件
        </div>
      </div>
      <div className="lines-body" ref={listRef}>
        {scene.lines.length ? (
          <div className="lines-list">
            {scene.lines.map((l, li) => (
              <LineCard
                key={l.id}
                project={project}
                index={index}
                li={li}
                line={l}
                timing={timing?.lines[li]}
                active={l.id === activeId}
                update={update}
                runJob={runJob}
                play={play}
                onSeek={onSeek}
              />
            ))}
          </div>
        ) : (
          <div className="lines-empty">
            このシーンにはセリフがありません
          </div>
        )}
        <button
          className="btn block"
          style={{ marginTop: 10 }}
          onClick={() =>
            update((p) => void p.scenes[index].lines.push({ id: `l-${rid()}`, speaker: project.cast[0]?.id ?? 'narrator', text: '', style: 'bubble' }))
          }
        >
          <Ic n={Plus} size={14} mr={0} />
          セリフを追加
        </button>
      </div>
    </aside>
  );
};

const LineCard: React.FC<{
  project: Project;
  index: number;
  li: number;
  line: Line;
  timing?: { start: number; end: number };
  active: boolean;
  update: Update;
  runJob: RunJob;
  play: (src: string) => void;
  onSeek: (sceneFrame: number) => void;
}> = ({ project, index, li, line: l, timing, active, update, runJob, play, onSeek }) => {
  const meta = useContext(MetaContext)!;
  // 詳細は最初から開いておく（閉じることもできる）
  const [open, setOpen] = useState(true);
  const scene = project.scenes[index];
  const tts = ttsFor(meta, project.audio);
  const narration = project.audio.narration;
  const stale = isAudioStale(l, project.cast, tts.engine);
  const setLine = (patch: Partial<Line>) => update((p) => void Object.assign(p.scenes[index].lines[li], patch));
  const isCast = project.cast.some((c) => c.id === l.speaker);
  const bubble = l.style === 'bubble' || l.style === 'bubble-accent';
  const voice = useVoice();
  /** このセリフの音声を作り直して、すぐ聴く（最新の音声でも作り直す） */
  const redo = async () => {
    if (!voice) return;
    await voice.request([l.id], { force: !stale });
    const src = voice.audioOf(l.id);
    if (src) play(src);
  };
  const move = (d: number) =>
    update((p) => {
      const a = p.scenes[index].lines;
      const j = li + d;
      if (j < 0 || j >= a.length) return;
      [a[j], a[li]] = [a[li], a[j]];
    });

  // しっぽは画面の形（縦型・正方形・横型）ごとに持つ
  const tailKey = `line:${l.id}`;
  const tail = readAdjust(scene, tailKey, project.format).tail;
  const setTail = (t: { dx: number; dy: number; hidden?: boolean } | undefined) =>
    update((p) => {
      const sc = p.scenes[index];
      const map = { ...sceneLayout(sc, p.format) };
      const next = normalizeAdjust({ ...readAdjust(sc, tailKey, p.format), tail: t });
      if (next) map[tailKey] = next;
      else delete map[tailKey];
      setSceneLayout(sc, p.format, map);
    });
  const fps = project.fps;

  return (
    <div className={`line-card ${active ? 'speaking' : ''}`} data-line={l.id}>
      <div className="line-main">
        <SpeakerPicker project={project} value={l.speaker} onChange={(v) => setLine({ speaker: v })} />
        <Text bare multiline rows={1} value={l.text} onChange={(v) => setLine({ text: v })} placeholder="セリフを入力" />
        <div className="line-tools">
          {narration && l.audio ? (
            <button className="icon-btn sm" onClick={() => play(l.audio!.src)} title={stale ? '前の音声を再生（今の内容とは違います）' : '音声を再生'}>
              <Ic n={Play} size={13} mr={0} />
            </button>
          ) : null}
          <Popover
            align="right"
            button={({ open: o, toggle }) => (
              <button className="icon-btn sm" aria-expanded={o} onClick={toggle} title="セリフの操作">
                <Ic n={Ellipsis} size={14} mr={0} />
              </button>
            )}
          >
            {(close) => (
              <>
                {narration ? (
                  <MenuItem icon={RefreshCw} disabled={!tts.ready || !(l.text.trim() || l.speak?.trim())} onClick={() => (close(), redo())}>
                    {l.audio ? '音声を作り直して聴く' : '音声を作って聴く'}
                  </MenuItem>
                ) : null}
                <MenuItem icon={ArrowUp} disabled={li === 0} onClick={() => (close(), move(-1))}>
                  上へ移動
                </MenuItem>
                <MenuItem icon={ArrowDown} disabled={li === scene.lines.length - 1} onClick={() => (close(), move(1))}>
                  下へ移動
                </MenuItem>
                <div className="menu-sep" />
                <MenuItem icon={Trash2} danger onClick={() => (close(), update((p) => void p.scenes[index].lines.splice(li, 1)))}>
                  削除
                </MenuItem>
              </>
            )}
          </Popover>
        </div>
      </div>
      <div className="line-meta">
        {timing ? (
          <button type="button" className="line-time" onClick={() => onSeek(timing.start)} title="このセリフの位置へ移動">
            {(timing.start / fps).toFixed(1)}秒〜
          </button>
        ) : null}
        {narration ? <VoiceStatus line={l} stale={stale} onRedo={redo} /> : null}
        <span className="spacer" />
        <button type="button" className="line-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? '閉じる' : '詳細'}
          <Ic n={open ? ChevronDown : ChevronRight} size={13} mr={0} />
        </button>
      </div>
      {open ? (
        <div className="line-detail">
          <Field label="表示">
            <Seg
              block
              value={l.style}
              onChange={(v) => setLine({ style: v })}
              options={(['bubble', 'bubble-accent', 'caption', 'none'] as const).map((v) => ({ value: v, label: STYLE_LABELS[v] }))}
            />
          </Field>
          {isCast ? (
            <Field label="表情">
              <div className="hstack">
                <PosePicker project={project} castId={l.speaker} value={l.pose} inherit onChange={(v) => setLine({ pose: v })} />
                {l.pose ? <span className="caption">このセリフから「{POSE_LABELS[l.pose]}」</span> : null}
              </div>
            </Field>
          ) : null}
          {tts.provider === 'elevenlabs' ? (
            <Field label="声の調子" hint="タグがセリフの前に付き、その気持ち・話し方で読まれます。選ばない時は演技指示から自動で付きます">
              <TagPicker line={l} onChange={(tags) => setLine({ tags })} />
              <div style={{ marginTop: 6 }}>
                <Text value={l.delivery} onChange={(v) => setLine({ delivery: v || undefined })} placeholder="演技指示（例: 驚いて・自信たっぷりに）" />
              </div>
            </Field>
          ) : (
            <Field label="声の調子">
              <div className="hstack">
                <EmojiPicker value={l.emoji} onChange={(v) => setLine({ emoji: v })} />
                <Text value={l.delivery} onChange={(v) => setLine({ delivery: v || undefined })} placeholder="演技の指示（例: 驚いて）" />
              </div>
            </Field>
          )}
          <Field
            label="読み方"
            hint={
              tts.provider === 'elevenlabs'
                ? '英字のブランド名などを読み間違える時だけ、その語をカタカナに（句読点は残す）。[laughs] のように文の途中にタグも書けます'
                : '英字のブランド名などを読み間違える時だけ、その語をカタカナに（句読点は残す）'
            }
          >
            <div className="hstack">
              <Text value={l.speak} onChange={(v) => setLine({ speak: v || undefined })} placeholder={tts.provider === 'elevenlabs' ? '空ならセリフどおりに読みます' : '例: だったら、スシトップ オーシーアール！'} />
              {l.speak ? (
                <button type="button" className="btn sm plain" onClick={() => setLine({ speak: undefined })} title="読み方の指定を外して、セリフどおりに読む">
                  外す
                </button>
              ) : null}
            </div>
          </Field>
          {bubble ? (
            <Field label="吹き出しのしっぽ" hint="位置は映像の上で吹き出しを選び、先端の点をドラッグして変えられます">
              <div className="hstack">
                <Seg
                  value={tail?.hidden ? 'off' : 'on'}
                  onChange={(v) => setTail({ dx: tail?.dx ?? 0, dy: tail?.dy ?? 0, hidden: v === 'off' ? true : undefined })}
                  options={[
                    { value: 'on', label: 'あり' },
                    { value: 'off', label: 'なし' },
                  ]}
                />
                <button className="btn sm plain" disabled={!tail} onClick={() => setTail(undefined)}>
                  位置を戻す
                </button>
              </div>
            </Field>
          ) : null}
          <Field label="セリフのあとの間">
            <div className="hstack">
              <Seg
                value={String(l.pauseAfterSec ?? 0)}
                onChange={(v) => setLine({ pauseAfterSec: Number(v) || undefined })}
                options={['0', '0.3', '0.6', '1'].map((v) => ({ value: v, label: v === '0' ? 'なし' : `${v}秒` }))}
              />
            </div>
          </Field>
        </div>
      ) : null}
    </div>
  );
};

/** セリフの音声の状態。作成中・作り直し待ち・失敗・読み違いかも を、ひと目で分かるように出す */
const VoiceStatus: React.FC<{ line: Line; stale: boolean; onRedo: () => void }> = ({ line: l, stale, onRedo }) => {
  const voice = useVoice();
  if (!voice) return null;
  if (voice.running.has(l.id))
    return (
      <span className="voice-chip busy">
        <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
        音声を作成中
      </span>
    );
  const err = voice.errors[l.id];
  if (err)
    return (
      <button type="button" className="voice-chip error" title={err} onClick={onRedo} disabled={!voice.ready}>
        <Ic n={RefreshCw} size={11} mr={0} />
        作れませんでした・もう一度
      </button>
    );
  if (stale) {
    if (voice.waiting.has(l.id))
      return (
        <button type="button" className="voice-chip wait" onClick={onRedo} title="入力が落ち着いたら自動で作り直します（押すとすぐ作ります）">
          <Ic n={RefreshCw} size={11} mr={0} />
          まもなく音声を更新
        </button>
      );
    return (
      <button type="button" className="voice-chip action" onClick={onRedo} disabled={!voice.ready} title="今のセリフで音声を作り直します">
        <Ic n={RefreshCw} size={11} mr={0} />
        {l.audio ? '音声を作り直す' : '音声を作る'}
      </button>
    );
  }
  if (l.audio?.check && !l.audio.check.ok)
    return (
      <button
        type="button"
        className="voice-chip warn"
        onClick={onRedo}
        disabled={!voice.ready}
        title={`聞こえた文: ${l.audio.check.heard || '（無音）'}${l.audio.check.reason ? `\n${l.audio.check.reason}` : ''}\n押すと作り直します`}
      >
        <Ic n={TriangleAlert} size={11} mr={0} />
        読み違いかも・作り直す
      </button>
    );
  return l.audio ? <span className="caption">{l.audio.durationSec.toFixed(1)}秒</span> : null;
};
