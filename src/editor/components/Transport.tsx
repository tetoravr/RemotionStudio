import type { PlayerRef } from '@remotion/player';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import React, { useRef, useState } from 'react';
import type { SceneTiming } from '../../video/timeline';
import { Ic } from '../icons';
import { clock } from '../sceneMeta';

/** 再生バー。シーンごとに区切ったシークバーで、どこに何があるかが分かる */
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
}> = ({ player, frame, total, fps, playing, muted, scenes, current, onScrub }) => {
  const track = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const seekAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    player.current?.seekTo(Math.min(total - 1, Math.round(t * (total - 1))));
  };
  const pct = total > 1 ? frame / (total - 1) : 0;

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
        {clock(frame / fps)} <span style={{ color: 'var(--text-3)' }}>/ {clock(total / fps)}</span>
      </span>
      <div
        className={`scrub ${scrubbing ? 'active' : ''}`}
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
        <div className="scrub-track" ref={track}>
          {scenes.map((st, i) => {
            const inside = Math.min(1, Math.max(0, (frame - st.start) / Math.max(1, st.duration)));
            return (
              <div key={st.scene.id + i} className={`scrub-seg ${i === current ? 'on' : ''}`} style={{ flex: st.duration }} title={`シーン${i + 1}`}>
                <div className="fill" style={{ width: `${inside * 100}%` }} />
              </div>
            );
          })}
          <div className="scrub-head" style={{ left: `${pct * 100}%` }} />
        </div>
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
