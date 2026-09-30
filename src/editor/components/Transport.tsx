import type { PlayerRef } from '@remotion/player';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import React, { useLayoutEffect, useRef, useState } from 'react';
import type { SceneTiming } from '../../video/timeline';
import { Ic } from '../icons';
import { clock, SCENE_META } from '../sceneMeta';

type Resize = { i: number; startX: number; startSec: number; minSec: number; pxPerSec: number; sec: number };

/**
 * 再生バー。シークバーがそのままシーンの並び（タイムライン）になっていて、
 * 各シーンの右端をドラッグすると、そのシーンの長さを伸び縮みできる。
 */
export const Transport: React.FC<{
  player: React.RefObject<PlayerRef | null>;
  frame: number;
  total: number;
  fps: number;
  playing: boolean;
  muted: boolean;
  scenes: SceneTiming[];
  current: number;
  /** シークバーを触った時（映像の要素の選択を外すのに使う） */
  onScrub?: () => void;
  /** シーンの長さを変える。start=ドラッグ開始（取り消しの記録用）、sec=null は自動に戻す */
  onResize: (i: number, sec: number | null, phase: 'start' | 'move' | 'end') => void;
}> = ({ player, frame, total, fps, playing, muted, scenes, current, onScrub, onResize }) => {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [resize, setResize] = useState<Resize | null>(null);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 長さを変えている間は、1秒あたりの幅を固定する（全体の長さが変わっても、つまみが指から離れないように）
  const totalSec = total / fps;
  const pxPerSec = resize ? resize.pxPerSec : width / Math.max(0.1, totalSec);

  const seekAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    const sec = Math.max(0, (clientX - r.left) / pxPerSec);
    player.current?.seekTo(Math.min(total - 1, Math.round(sec * fps)));
  };

  const startResize = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    player.current?.pause();
    const st = scenes[i];
    const sec = st.duration / fps;
    setResize({ i, startX: e.clientX, startSec: sec, minSec: st.minSec, pxPerSec, sec });
    onResize(i, sec, 'start');
  };
  const moveResize = (e: React.PointerEvent) => {
    if (!resize) return;
    const sec = Math.min(60, Math.max(resize.minSec, resize.startSec + (e.clientX - resize.startX) / resize.pxPerSec));
    const rounded = Math.round(sec * 10) / 10;
    if (rounded === resize.sec) return;
    setResize({ ...resize, sec: rounded });
    onResize(resize.i, rounded, 'move');
  };
  const endResize = () => {
    if (!resize) return;
    onResize(resize.i, resize.sec, 'end');
    setResize(null);
  };

  const headX = (frame / fps) * pxPerSec;

  return (
    <div className="transport">
      <button
        type="button"
        className="icon-btn play"
        onClick={() => player.current?.toggle()}
        title={playing ? '一時停止（スペース）' : '再生（スペース）'}
        aria-label={playing ? '一時停止' : '再生'}
      >
        <Ic n={playing ? Pause : Play} size={15} mr={0} stroke={2.4} />
      </button>
      <span className="timecode">
        {clock(frame / fps)}
        <span style={{ color: 'var(--text-3)' }}> / {clock(totalSec)}</span>
      </span>
      <div
        className={`tl ${scrubbing ? 'scrubbing' : ''} ${resize ? 'resizing' : ''}`}
        ref={track}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          player.current?.pause();
          onScrub?.();
          setScrubbing(true);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => scrubbing && seekAt(e.clientX)}
        onPointerUp={() => setScrubbing(false)}
        onPointerCancel={() => setScrubbing(false)}
      >
        {scenes.map((st, i) => {
          const sec = st.duration / fps;
          const meta = SCENE_META[st.scene.type];
          const w = sec * pxPerSec;
          return (
            <div
              key={st.scene.id + i}
              className={`tl-clip ${i === current ? 'on' : ''} ${st.fixed ? 'fixed' : ''}`}
              style={{ width: Math.max(4, w - 2) }}
              title={`シーン${i + 1}・${meta.name}・${sec.toFixed(1)}秒${st.fixed ? '（長さを指定）' : '（自動）'}`}
            >
              {w > 34 ? (
                <span className="tl-label">
                  <b>{i + 1}</b>
                  {w > 88 ? <span>{meta.name}</span> : null}
                </span>
              ) : null}
              {w > 60 ? <span className="tl-dur">{sec.toFixed(1)}s</span> : null}
              <div
                className="tl-handle"
                title="ドラッグで長さを変える（ダブルクリックで自動に戻す）"
                onPointerDown={(e) => startResize(e, i)}
                onPointerMove={moveResize}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onResize(i, null, 'end');
                }}
              />
              {resize?.i === i ? <span className="tl-bubble">{(scenes[i].duration / fps).toFixed(1)}秒</span> : null}
            </div>
          );
        })}
        <div className="tl-head" style={{ transform: `translateX(${headX}px)` }} />
      </div>
      <button
        type="button"
        className="icon-btn"
        onClick={() => (muted ? player.current?.unmute() : player.current?.mute())}
        title={muted ? 'ミュートを解除' : 'ミュート'}
      >
        <Ic n={muted ? VolumeX : Volume2} size={16} mr={0} />
      </button>
      <button type="button" className="icon-btn" onClick={() => player.current?.requestFullscreen()} title="全画面で再生">
        <Ic n={Maximize} size={15} mr={0} />
      </button>
    </div>
  );
};
