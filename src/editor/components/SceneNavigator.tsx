import { Thumbnail } from '@remotion/player';
import { ArrowDown, ArrowUp, Copy, Ellipsis, Plus, Trash2, TriangleAlert } from 'lucide-react';
import React, { memo, useDeferredValue, useMemo, useState } from 'react';
import { AdVideo } from '../../video/AdVideo';
import { FORMATS, type Project, type SceneType } from '../../video/schema';
import { computeTimeline } from '../../video/timeline';
import { Ic } from '../icons';
import { SCENE_META, SCENE_ORDER, sceneSummary } from '../sceneMeta';
import { MenuItem, Popover } from './Fields';
import { withBase } from '../base';

type Props = {
  project: Project;
  selected: number;
  /** シーンごと: 音声が未作成／古いセリフがあるか */
  stale: boolean[];
  onSelect: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (i: number) => void;
  onDelete: (i: number) => void;
  onAdd: (type: SceneType) => void;
};

/** 映像の1コマ。入力のたびに全シーンを描き直さないよう、プロジェクトは遅延させて渡す */
const SceneThumb = memo<{ inputProps: Record<string, unknown>; frame: number; total: number; fps: number; cw: number; ch: number; w: number; h: number }>(
  ({ inputProps, frame, total, fps, cw, ch, w, h }) => (
    <Thumbnail
      component={AdVideo as unknown as React.FC<Record<string, unknown>>}
      inputProps={inputProps}
      compositionWidth={cw}
      compositionHeight={ch}
      frameToDisplay={frame}
      durationInFrames={total}
      fps={fps}
      style={{ width: w, height: h, display: 'block' }}
    />
  ),
);

export const SceneNavigator: React.FC<Props> = ({ project, selected, stale, onSelect, onMove, onDuplicate, onDelete, onAdd }) => {
  const deferred = useDeferredValue(project);
  const tl = useMemo(() => computeTimeline(deferred), [deferred]);
  const inputProps = useMemo(() => ({ project: deferred, assetBaseUrl: withBase(`/files/${deferred.id}/`) }), [deferred]);
  const fmt = FORMATS[deferred.format];
  // 縦長・正方形・横長で、同じくらいの大きさに見えるように（横長は文字の幅を残す）
  const ratio = fmt.width / fmt.height;
  const tw = ratio > 1.2 ? 76 : ratio > 0.8 ? 60 : 54;
  const th = Math.round(tw / ratio);
  const [drag, setDrag] = useState<{ from: number; over: number; after: boolean } | null>(null);

  return (
    <div className="navigator">
      <div className="nav-head">
        シーン
        <span className="spacer" />
        <span className="caption">{project.scenes.length}</span>
      </div>
      <div className="nav-list">
        {project.scenes.map((s, i) => {
          const st = tl.scenes[i];
          const meta = SCENE_META[s.type];
          const noShot = s.type === 'showcase' && (!s.screenshot || s.screenshot.startsWith('ui:'));
          const dropCls = drag && drag.over === i && drag.from !== i ? (drag.after ? 'drop-after' : 'drop-before') : '';
          return (
            <div
              key={s.id}
              className={`nav-item ${i === selected ? 'on' : ''} ${drag?.from === i ? 'dragging' : ''} ${dropCls}`}
              onClick={() => onSelect(i)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i));
                setDrag({ from: i, over: i, after: false });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                if (drag.over !== i || drag.after !== after) setDrag({ ...drag, over: i, after });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!drag) return;
                let to = drag.after ? drag.over + 1 : drag.over;
                if (drag.from < to) to -= 1;
                if (to !== drag.from) onMove(drag.from, to);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              title={sceneSummary(s, project.brand.name)}
            >
              <span className="nav-num">{i + 1}</span>
              <div className="nav-thumb" style={{ width: tw, height: th }}>
                {st ? (
                  <SceneThumb
                    inputProps={inputProps}
                    frame={Math.min(tl.total - 1, st.start + Math.round(st.duration * 0.62))}
                    total={tl.total}
                    fps={deferred.fps}
                    cw={fmt.width}
                    ch={fmt.height}
                    w={tw}
                    h={th}
                  />
                ) : null}
              </div>
              <div className="nav-meta">
                <div className="nav-title">{sceneSummary(s, project.brand.name) || meta.name}</div>
                <div className="nav-sub">
                  <Ic n={meta.icon} size={11} mr={0} />
                  {meta.name}
                  {st ? ` ・ ${(st.duration / deferred.fps).toFixed(1)}秒` : ''}
                  {stale[i] ? <span className="dot warn" title="音声がまだないセリフがあります" /> : null}
                  {noShot ? (
                    <span className="warn-text" title="スクリーンショットが未設定です">
                      <Ic n={TriangleAlert} size={11} mr={0} />
                    </span>
                  ) : null}
                </div>
              </div>
              <Popover
                align="right"
                button={({ open, toggle }) => (
                  <button type="button" className="icon-btn sm more" aria-expanded={open} onClick={toggle} title="シーンの操作">
                    <Ic n={Ellipsis} size={14} mr={0} />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem icon={Copy} onClick={() => (close(), onDuplicate(i))}>
                      複製
                    </MenuItem>
                    <MenuItem icon={ArrowUp} disabled={i === 0} onClick={() => (close(), onMove(i, i - 1))}>
                      上へ移動
                    </MenuItem>
                    <MenuItem icon={ArrowDown} disabled={i === project.scenes.length - 1} onClick={() => (close(), onMove(i, i + 1))}>
                      下へ移動
                    </MenuItem>
                    <div className="menu-sep" />
                    <MenuItem icon={Trash2} danger disabled={project.scenes.length <= 1} onClick={() => (close(), onDelete(i))}>
                      削除
                    </MenuItem>
                  </>
                )}
              </Popover>
            </div>
          );
        })}
      </div>
      <div className="nav-foot">
        <Popover
          width={264}
          button={({ toggle }) => (
            <button type="button" className="btn block" onClick={toggle}>
              <Ic n={Plus} size={14} mr={0} />
              シーンを追加
            </button>
          )}
        >
          {(close) => (
            <>
              {SCENE_ORDER.map((t) => (
                <MenuItem key={t} icon={SCENE_META[t].icon} sub={SCENE_META[t].desc} onClick={() => (close(), onAdd(t))}>
                  {SCENE_META[t].name}
                </MenuItem>
              ))}
            </>
          )}
        </Popover>
      </div>
    </div>
  );
};
