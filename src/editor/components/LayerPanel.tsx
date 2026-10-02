import { BringToFront, Captions, ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Image, MessageCircle, RotateCcw, SendToBack, Sparkles, Type, User, type LucideIcon } from 'lucide-react';
import React, { useState } from 'react';
import { layerOrder, layoutLabel, moveLayer, normalizeAdjust, readAdjust, sceneLayout, setLayerOrder, setSceneLayout } from '../../video/edit/textEdit';
import { FORMATS, type ElementAdjust, type Project, type Scene } from '../../video/schema';
import { Ic } from '../icons';
import type { Update } from '../pages/Editor';
import { SCENE_META } from '../sceneMeta';
import { Cell, Num, Section } from './Fields';
import { Avatar } from './pickers';

/** 要素の種類ごとのアイコン */
const kindIcon = (id: string): LucideIcon => {
  if (id.startsWith('line:')) return MessageCircle;
  if (id.startsWith('caption:')) return Captions;
  if (['visual', 'screen', 'prop'].includes(id)) return Image;
  if (['fx', 'confetti', 'decor', 'ticker'].includes(id)) return Sparkles;
  if (id.startsWith('char:')) return User;
  return Type;
};

/** レイヤーの名前（キャラはキャストの名前） */
const layerName = (id: string, scene: Scene, project: Project) => {
  if (id.startsWith('char:')) {
    const p = scene.characters[Number(id.slice(5))];
    return project.cast.find((c) => c.id === p?.id)?.name ?? layoutLabel(id, scene);
  }
  return layoutLabel(id, scene);
};

const isMoved = (a: ElementAdjust) => Math.abs(a.dx) >= 0.5 || Math.abs(a.dy) >= 0.5 || Math.abs(a.scale - 1) >= 0.005 || Math.abs(a.rotate) >= 0.05;

/**
 * シーンのレイヤー（映像の要素の一覧）。上ほど手前。
 * 選ぶと映像の上でも選ばれ、位置・大きさ・回転を数値で変えられる。ドラッグで重なり順、目のアイコンで表示・非表示。
 * 調整は画面の形（縦型・正方形・横型）ごとに別々に保存される
 */
export const LayerPanel: React.FC<{
  project: Project;
  index: number;
  update: Update;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}> = ({ project, index, update, selectedId, onSelect, onDeselect }) => {
  const scene = project.scenes[index];
  const [drag, setDrag] = useState<{ id: string; over: string | null; after: boolean } | null>(null);
  if (!scene) return null;
  const format = project.format;
  const opts = { subtitles: project.subtitles };
  // 上ほど手前（一般的なレイヤーの並び）
  const rows = layerOrder(scene, format, opts).reverse();
  const sel = selectedId && rows.includes(selectedId) ? selectedId : null;
  const adj = sel ? readAdjust(scene, sel, format) : null;
  const adjusted = Object.values(sceneLayout(scene, format)).filter((a) => a.hidden || a.align || isMoved({ dx: a.dx ?? 0, dy: a.dy ?? 0, scale: a.scale ?? 1, rotate: a.rotate ?? 0 }) || a.tail).length;

  const setAdjust = (id: string, fn: (a: ElementAdjust) => ElementAdjust) =>
    update((p) => {
      const sc = p.scenes[index];
      const map = { ...sceneLayout(sc, p.format) };
      const next = normalizeAdjust(fn(readAdjust(sc, id, p.format)));
      if (next) map[id] = next;
      else delete map[id];
      setSceneLayout(sc, p.format, map);
    });
  const move = (id: string, to: 'front' | 'back' | number) => update((p) => moveLayer(p.scenes[index], p.format, id, to, opts));
  const drop = () => {
    if (!drag?.over || drag.over === drag.id) return setDrag(null);
    const next = rows.filter((r) => r !== drag.id);
    const at = next.indexOf(drag.over) + (drag.after ? 1 : 0);
    next.splice(at, 0, drag.id);
    // 表示は手前が上なので、保存する時は奥→手前に戻す
    update((p) => setLayerOrder(p.scenes[index], p.format, [...next].reverse()));
    setDrag(null);
  };
  const pos = rows.indexOf(sel ?? '');

  return (
    <div>
      <div className="insp-title">
        <span className="insp-icon">
          <Ic n={SCENE_META[scene.type].icon} size={16} mr={0} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t">レイヤー</div>
          <div className="s">
            シーン{index + 1} ・ {SCENE_META[scene.type].name} ・ {FORMATS[format].label.split('（')[0]}の配置
          </div>
        </div>
      </div>

      <Section title="重なり順" right={<span className="caption">上ほど手前</span>} footer="ドラッグで重なり順を変えられます。選ぶと映像の上でも選ばれ、そのままドラッグで動かせます">
        <div className="group layer-list" onDragLeave={(e) => e.currentTarget === e.target && setDrag((d) => (d ? { ...d, over: null } : d))}>
          {rows.map((id) => {
            const a = readAdjust(scene, id, format);
            const char = id.startsWith('char:') ? project.cast.find((c) => c.id === scene.characters[Number(id.slice(5))]?.id) : undefined;
            const dropCls = drag && drag.over === id && drag.id !== id ? (drag.after ? 'drop-after' : 'drop-before') : '';
            return (
              <div
                key={id}
                className={`layer-row ${sel === id ? 'on' : ''} ${a.hidden ? 'hidden' : ''} ${drag?.id === id ? 'dragging' : ''} ${dropCls}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', id);
                  setDrag({ id, over: null, after: false });
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > r.top + r.height / 2;
                  if (drag.over !== id || drag.after !== after) setDrag({ ...drag, over: id, after });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop();
                }}
                onDragEnd={() => setDrag(null)}
                onClick={() => (a.hidden ? undefined : sel === id ? onDeselect() : onSelect(id))}
                title={a.hidden ? '非表示です（目のアイコンで表示）' : 'クリックで選ぶ（映像の上でも選ばれます）'}
              >
                <span className="layer-grip">
                  <Ic n={GripVertical} size={13} mr={0} />
                </span>
                {char ? <Avatar project={project} id={char.id} size={22} /> : (
                  <span className="layer-icon">
                    <Ic n={kindIcon(id)} size={13} mr={0} />
                  </span>
                )}
                <span className="layer-name">{layerName(id, scene, project)}</span>
                {isMoved(a) ? <span className="layer-dot" title="位置・大きさ・回転を調整しています" /> : null}
                <button
                  type="button"
                  className="icon-btn sm layer-eye"
                  title={a.hidden ? '表示する' : '隠す'}
                  aria-label={a.hidden ? '表示する' : '隠す'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!a.hidden && sel === id) onDeselect();
                    setAdjust(id, (cur) => ({ ...cur, hidden: cur.hidden ? undefined : true }));
                  }}
                >
                  <Ic n={a.hidden ? EyeOff : Eye} size={14} mr={0} />
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      {sel && adj ? (
        <Section title={`「${layerName(sel, scene, project)}」`} footer="位置はコンポジションのピクセル（縦型は幅1080）。矢印キーで1px、Shift+矢印で10pxずつ動かせます">
          <div className="group">
            <Cell label="位置">
              <div className="layer-xy">
                <label>
                  X
                  <Num value={Math.round(adj.dx)} step={5} onChange={(v) => setAdjust(sel, (a) => ({ ...a, dx: v }))} />
                </label>
                <label>
                  Y
                  <Num value={Math.round(adj.dy)} step={5} onChange={(v) => setAdjust(sel, (a) => ({ ...a, dy: v }))} />
                </label>
              </div>
            </Cell>
            <Cell label="大きさ">
              <div className="layer-unit">
                <Num value={Math.round(adj.scale * 100)} step={5} min={10} max={600} onChange={(v) => setAdjust(sel, (a) => ({ ...a, scale: Math.min(6, Math.max(0.1, v / 100)) }))} />
                <span>%</span>
              </div>
            </Cell>
            <Cell label="回転">
              <div className="layer-unit">
                <Num value={Math.round(adj.rotate)} step={5} min={-180} max={180} onChange={(v) => setAdjust(sel, (a) => ({ ...a, rotate: v }))} />
                <span>°</span>
              </div>
            </Cell>
            <Cell label="重なり">
              <div className="layer-order-btns">
                <button type="button" className="icon-btn" disabled={pos <= 0} onClick={() => move(sel, 'front')} title="最前面へ">
                  <Ic n={BringToFront} size={15} mr={0} />
                </button>
                <button type="button" className="icon-btn" disabled={pos <= 0} onClick={() => move(sel, 1)} title="ひとつ手前へ">
                  <Ic n={ChevronUp} size={15} mr={0} />
                </button>
                <button type="button" className="icon-btn" disabled={pos >= rows.length - 1} onClick={() => move(sel, -1)} title="ひとつ奥へ">
                  <Ic n={ChevronDown} size={15} mr={0} />
                </button>
                <button type="button" className="icon-btn" disabled={pos >= rows.length - 1} onClick={() => move(sel, 'back')} title="最背面へ">
                  <Ic n={SendToBack} size={15} mr={0} />
                </button>
              </div>
            </Cell>
            <Cell>
              <button type="button" className="btn sm" disabled={!isMoved(adj)} onClick={() => setAdjust(sel, (a) => ({ ...a, dx: 0, dy: 0, scale: 1, rotate: 0, px: undefined, py: undefined }))}>
                <Ic n={RotateCcw} size={12} mr={0} />
                位置・大きさ・回転を戻す
              </button>
            </Cell>
          </div>
        </Section>
      ) : (
        <div className="hint" style={{ margin: '14px 4px 0' }}>
          レイヤーを選ぶと、位置・大きさ・回転を数値で変えられます。
        </div>
      )}

      {adjusted || Object.values(sceneLayout(scene, format)).some((a) => a.z != null) ? (
        <button
          className="btn sm plain"
          style={{ marginTop: 14 }}
          onClick={() => {
            onDeselect();
            update((p) => setSceneLayout(p.scenes[index], p.format, {}));
          }}
        >
          このシーンの調整と重なり順をすべて戻す
        </button>
      ) : null}
    </div>
  );
};
