import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Minus, Plus, RotateCcw, RotateCw, Scaling, Trash2, type LucideIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { ElementAdjust } from '../schema';
import { useScene } from '../SceneContext';
import { useTheme } from '../theme';
import { adjustTransform, isIdentity, layoutLabel, MAX_SCALE, MIN_SCALE, normalizeAdjust, readAdjust, sceneLayout, type TextTarget } from './textEdit';

/**
 * 直接調整モード（エディターのプレビューだけで有効）。
 * 書き出しやスタジオには Provider が無いので、保存された調整（移動・拡大縮小・回転・非表示）だけが反映される。
 */
export type EditMode = {
  enabled: boolean;
  /** いま調整できるシーン（再生位置のシーン） */
  activeSceneId: string | null;
  /** 画面上の表示幅 / コンポジション幅 */
  compScale: number;
  /** コンポジションの大きさ（ハンドルを画面内に収めるのに使う） */
  canvas: { w: number; h: number };
  selectedId: string | null;
  select: (id: string | null) => void;
  /** ドラッグなど1回の操作の開始。履歴はここで1回だけ積む */
  beginGesture: () => void;
  /** adjust=null は調整の削除。silent=true は履歴を積まない（ドラッグ中） */
  commit: (sceneId: string, id: string, adjust: ElementAdjust | null, silent?: boolean) => void;
  commitText: (sceneId: string, target: TextTarget, value: string) => void;
  /** セリフの設定を書き換える（吹き出しのしっぽなど）。silent=true は履歴を積まない（ドラッグ中） */
  patchLine: (sceneId: string, lineId: string, patch: Record<string, unknown>, silent?: boolean) => void;
  pause: () => void;
  /** プレビュー領域（コンポジション左上）の画面座標 */
  getOrigin: () => { left: number; top: number };
  /** 操作ハンドルの描画先。映像の重なり順に関係なく、常に最前面に出す */
  overlay: HTMLElement | null;
};

const EditContext = createContext<EditMode | null>(null);
export const EditModeProvider = EditContext.Provider;
export const useEditMode = () => useContext(EditContext);

/** 選択・操作ハンドルの色（エディターのアクセントカラーと同じ青） */
const ACCENT = '#0a84ff';

type Box = { x: number; y: number; w: number; h: number };
type InlineText = Box & {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  textAlign: string;
  fontFeatureSettings: string;
};

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

/**
 * シーン内の1要素。保存された調整を常に適用し、直接調整モードでは選択・ドラッグ・拡大縮小・回転・削除・文字の書き換えを受け付ける。
 * layer: シーン全体に重ねる座標系（絶対配置の要素）。flow: 通常フローの要素（要素自身が枠になる）
 */
export const Editable: React.FC<{
  id: string;
  mode?: 'layer' | 'flow';
  /** layer の重なり順（元の要素の zIndex に合わせる） */
  z?: number;
  text?: { target: TextTarget; value: string };
  /** 操作ボタンの列を出す位置（吹き出しは、しっぽの先端のハンドルと重ならない側に出す） */
  barAt?: 'top' | 'bottom';
  children: React.ReactNode;
}> = ({ id, mode = 'layer', z, text, barAt = 'bottom', children }) => {
  const edit = useEditMode();
  const { timing } = useScene();
  const scene = timing.scene;
  // 調整は画面の形（縦型・正方形・横型）ごとに別々に持つ
  const { layout: themeLayout } = useTheme();
  const format = themeLayout.format;
  const adj = readAdjust(scene, id, format);
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  /** 文字をその場で書き換える時の、元の文字の位置と書体（元の見た目のまま入力できるように） */
  const [inline, setInline] = useState<InlineText | null>(null);
  const active = Boolean(edit?.enabled && edit.activeSceneId === scene.id);
  const selected = active && edit?.selectedId === id;
  const cs = Math.max(0.05, edit?.compScale || 1);

  // 選択中の要素の枠を測る。調整を一瞬外して、元の位置での見た目の範囲を取る
  useLayoutEffect(() => {
    if (!selected || !edit) return;
    const el = rootRef.current;
    if (!el) return;
    const prev = el.style.transform;
    el.style.transform = 'none';
    const origin = edit.getOrigin();
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    // layer は中身の要素の範囲、flow は要素自身の範囲
    const targets = mode === 'layer' ? Array.from(el.children) : [el];
    for (const child of targets) {
      if (!(child instanceof Element) || child.hasAttribute('data-edit-ui') || child.hasAttribute('data-edit-frame')) continue;
      const rc = child.getBoundingClientRect();
      if (rc.width < 1 && rc.height < 1) continue;
      l = Math.min(l, rc.left);
      t = Math.min(t, rc.top);
      r = Math.max(r, rc.right);
      b = Math.max(b, rc.bottom);
    }
    el.style.transform = prev;
    const next = l === Infinity ? null : { x: (l - origin.left) / cs, y: (t - origin.top) / cs, w: (r - l) / cs, h: (b - t) / cs };
    if (!sameBox(box, next)) setBox(next);
  });

  if (adj.hidden) return null;

  const transform = adjustTransform(adj);
  const changed = Boolean(transform);
  const pivot = box ? (mode === 'layer' ? { x: adj.px ?? box.x + box.w / 2, y: adj.py ?? box.y + box.h / 2 } : { x: box.x + box.w / 2, y: box.y + box.h / 2 }) : null;
  const origin = mode === 'layer' ? (adj.px != null && adj.py != null ? `${adj.px}px ${adj.py}px` : pivot ? `${pivot.x}px ${pivot.y}px` : '50% 50%') : '50% 50%';

  // 重なり順: 直接調整で触った要素は、元の順より手前（最後に触ったものが一番手前）
  const zIndex = adj.z != null ? 1000 + adj.z : z;

  if (!active && !changed && !adj.align && zIndex == null) return <>{children}</>;

  /** このシーンで一番手前になる z（すでに一番手前ならそのまま） */
  const frontZ = () => {
    const others = Object.entries(sceneLayout(scene, format))
      .filter(([k]) => k !== id)
      .map(([, a]) => a.z ?? -1);
    const top = Math.max(-1, ...others);
    return adj.z != null && adj.z > top ? adj.z : top + 1;
  };

  const put = (next: ElementAdjust, silent: boolean) => {
    next = { ...next, z: frontZ() };
    const withPivot = mode === 'layer' && pivot ? { ...next, px: next.px ?? pivot.x, py: next.py ?? pivot.y } : next;
    edit?.commit(scene.id, id, normalizeAdjust(withPivot), silent);
  };

  /** ドラッグ系の共通処理 */
  const gesture = (e: React.PointerEvent, onMove: (ev: PointerEvent) => void) => {
    if (!edit) return;
    e.stopPropagation();
    e.preventDefault();
    edit.pause();
    edit.select(id);
    edit.beginGesture();
    // 触った時点で手前に出す（動かさずにクリックしただけでも）
    if (adj.z == null || adj.z !== frontZ()) put(adj, true);
    const move = (ev: PointerEvent) => {
      // ボタンが離れているのに pointerup を取りこぼした場合は、ここで操作を終える
      if (ev.buttons === 0) up();
      else onMove(ev);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** 拡大縮小・回転の中心（画面座標） */
  const pivotScreen = () => {
    if (mode === 'layer' && pivot && edit) {
      const o = edit.getOrigin();
      return { x: o.left + (pivot.x + adj.dx) * cs, y: o.top + (pivot.y + adj.dy) * cs };
    }
    const rc = rootRef.current!.getBoundingClientRect();
    return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 };
  };

  const onBodyDown = (e: React.PointerEvent) => {
    if (!active || !edit || draft !== null) return;
    if ((e.target as Element).closest('[data-edit-ui]')) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const base = adj;
    gesture(e, (ev) => put({ ...base, dx: base.dx + (ev.clientX - sx) / cs, dy: base.dy + (ev.clientY - sy) / cs }, true));
  };

  const onScaleDown = (e: React.PointerEvent) => {
    const c = pivotScreen();
    const start = Math.max(8, Math.hypot(e.clientX - c.x, e.clientY - c.y));
    const base = adj;
    gesture(e, (ev) => {
      const k = Math.hypot(ev.clientX - c.x, ev.clientY - c.y) / start;
      put({ ...base, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, base.scale * k)) }, true);
    });
  };

  const onRotateDown = (e: React.PointerEvent) => {
    const c = pivotScreen();
    const a0 = Math.atan2(e.clientY - c.y, e.clientX - c.x);
    const base = adj;
    gesture(e, (ev) => {
      let rot = base.rotate + ((Math.atan2(ev.clientY - c.y, ev.clientX - c.x) - a0) * 180) / Math.PI;
      if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
      put({ ...base, rotate: rot }, true);
    });
  };

  const line = Math.max(2, 2 / cs);
  const frameStyle: React.CSSProperties = { position: 'absolute', left: box?.x ?? 0, top: box?.y ?? 0, width: box?.w ?? 0, height: box?.h ?? 0 };

  const nudge = (f: (a: ElementAdjust) => ElementAdjust) => {
    edit?.beginGesture();
    put(f(adj), true);
  };

  /** 操作ハンドル。映像の外（プレビュー最前面）に、画面の座標で描く */
  function renderUi() {
    const b = box!;
    const P = pivot!;
    const ow = (edit?.canvas.w ?? 1080) * cs;
    const oh = (edit?.canvas.h ?? 1920) * cs;
    const th = (adj.rotate * Math.PI) / 180;
    const co = Math.cos(th);
    const si = Math.sin(th);
    const T = (x: number, y: number) => {
      const vx = (x - P.x) * adj.scale;
      const vy = (y - P.y) * adj.scale;
      return { x: (P.x + vx * co - vy * si + adj.dx) * cs, y: (P.y + vx * si + vy * co + adj.dy) * cs };
    };
    const cx = b.x + b.w / 2;
    const corners = [T(b.x, b.y), T(b.x + b.w, b.y), T(b.x + b.w, b.y + b.h), T(b.x, b.y + b.h)];
    const tc = T(cx, b.y);
    const bc = T(cx, b.y + b.h);
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const UI = 20;
    const BTN = 28;
    const nBtn = 4 + (text ? 3 : 0);
    const barHalf = (nBtn * BTN + (nBtn - 1) * 2 + 8) / 2;
    const rot = { x: clamp(tc.x + Math.sin(th) * 30, UI / 2, ow - UI / 2), y: clamp(tc.y - Math.cos(th) * 30, UI / 2, oh - UI / 2) };
    const sc = { x: clamp(corners[2].x, UI / 2, ow - UI / 2), y: clamp(corners[2].y, UI / 2, oh - UI / 2) };
    const topY = Math.min(...corners.map((c) => c.y));
    const bar = { x: clamp(barAt === 'top' ? tc.x : bc.x, barHalf + 4, Math.max(barHalf + 4, ow - barHalf - 4)), y: barAt === 'top' ? clamp(topY - 80, 4, oh - 40) : clamp(bc.y + 12, 4, oh - 40) };
    const at = (p: { x: number; y: number }): React.CSSProperties => ({ left: p.x, top: p.y, transform: 'translate(-50%, -50%)' });
    return (
      <div data-edit-frame style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <svg width={ow} height={oh} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          <polygon points={corners.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" stroke={ACCENT} strokeWidth={2} />
          <line x1={tc.x} y1={tc.y} x2={rot.x} y2={rot.y} stroke={ACCENT} strokeWidth={2} />
        </svg>
        {draft === null ? (
          <>
            <div data-edit-ui title="ドラッグで回転（Shiftで15度ずつ）" onPointerDown={onRotateDown} style={{ ...handle(UI), ...at(rot), borderRadius: '50%', cursor: 'grab' }}>
              <RotateCw size={11} strokeWidth={2.6} />
            </div>
            <div data-edit-ui title="ドラッグで拡大縮小" onPointerDown={onScaleDown} style={{ ...handle(UI), ...at(sc), borderRadius: 5, cursor: 'nwse-resize' }}>
              <Scaling size={11} strokeWidth={2.6} />
            </div>
            <div
              data-edit-frame
              style={{
                position: 'absolute',
                left: bar.x,
                top: bar.y,
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: 2,
                padding: 4,
                borderRadius: 11,
                background: 'rgba(28,28,30,0.86)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
                pointerEvents: 'none',
              }}
            >
              <Chip ui={BTN} title="縮小" onClick={() => nudge((a) => ({ ...a, scale: a.scale / 1.08 }))}>
                <Minus size={15} strokeWidth={2} />
              </Chip>
              <Chip ui={BTN} title="拡大" onClick={() => nudge((a) => ({ ...a, scale: a.scale * 1.08 }))}>
                <Plus size={15} strokeWidth={2} />
              </Chip>
              <Chip ui={BTN} title="位置・大きさ・回転を元に戻す" onClick={() => nudge((a) => ({ ...a, dx: 0, dy: 0, scale: 1, rotate: 0 }))}>
                <RotateCcw size={14} strokeWidth={2} />
              </Chip>
              {text
                ? (
                    [
                      ['left', AlignLeft, '左揃え'],
                      ['center', AlignCenter, '中央揃え'],
                      ['right', AlignRight, '右揃え'],
                    ] as const
                  ).map(([v, Icon, label]) => (
                    <Chip key={v} ui={BTN} active={adj.align === v} title={label} onClick={() => nudge((a) => ({ ...a, align: a.align === v ? undefined : v }))}>
                      <Icon size={15} strokeWidth={2} />
                    </Chip>
                  ))
                : null}
              <Chip ui={BTN} danger title={`${layoutLabel(id, scene)}を隠す（「要素の表示と位置」で戻せます）`} onClick={() => nudge((a) => ({ ...a, hidden: true }))}>
                <Trash2 size={15} strokeWidth={2} />
              </Chip>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  /** 元の文字の位置・書体を測って、その上に同じ見た目の入力欄を重ねる */
  const beginEdit = () => {
    if (!rootRef.current || !text || !edit) return;
    // まだ何も選んでいなければ、選ぶとシーンが「全要素を出した状態」で止まって位置が変わるので、描き直してから測る
    const settled = Boolean(edit.selectedId);
    edit.pause();
    edit.select(id);
    if (adj.z == null || adj.z !== frontZ()) {
      edit.beginGesture();
      put(adj, true);
    }
    if (settled) startInline();
    else requestAnimationFrame(() => requestAnimationFrame(startInline));
  };

  const startInline = () => {
    const el = rootRef.current;
    if (!el || !text || !edit) return;
    const prev = el.style.transform;
    el.style.transform = 'none';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    let cssOf: CSSStyleDeclaration | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!n.textContent?.trim() || !parent || parent.closest('[data-edit-ui],[data-edit-frame]')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rc = range.getBoundingClientRect();
      if (rc.width < 1 || rc.height < 1) continue;
      l = Math.min(l, rc.left);
      t = Math.min(t, rc.top);
      r = Math.max(r, rc.right);
      b = Math.max(b, rc.bottom);
      cssOf = getComputedStyle(parent); // 最後（最前面）の文字層の書体を使う
    }
    const base = mode === 'layer' ? edit.getOrigin() : el.getBoundingClientRect();
    const info: InlineText | null =
      cssOf && l !== Infinity
        ? {
            x: (l - base.left) / cs,
            y: (t - base.top) / cs,
            w: (r - l) / cs,
            h: (b - t) / cs,
            fontFamily: cssOf.fontFamily,
            fontSize: cssOf.fontSize,
            fontWeight: cssOf.fontWeight,
            lineHeight: cssOf.lineHeight,
            letterSpacing: cssOf.letterSpacing,
            color: cssOf.webkitTextFillColor && cssOf.webkitTextFillColor !== 'rgba(0, 0, 0, 0)' ? cssOf.webkitTextFillColor : cssOf.color,
            textAlign: cssOf.textAlign,
            fontFeatureSettings: cssOf.fontFeatureSettings,
          }
        : null;
    el.style.transform = prev;
    setInline(info);
    setDraft(text.value);
  };

  const finishText = () => {
    setInline(null);
    if (draft !== null && text && edit && draft !== text.value) edit.commitText(scene.id, text.target, draft);
    setDraft(null);
  };

  const showUi = selected && draft === null && (mode === 'flow' || box);
  const portal = showUi && box && pivot && edit?.overlay ? createPortal(renderUi(), edit.overlay) : null;
  // 触れられる要素は、マウスを乗せた時だけ細い枠を出す（CSS の [data-edit-hover]:hover）
  const hoverVars = active && !selected ? ({ '--edit-line': `${line}px`, '--edit-off': `${3 / cs}px` } as React.CSSProperties) : {};

  return (
    <div
      ref={rootRef}
      {...(mode === 'layer' ? { 'data-edit-layer': '' } : { 'data-edit-flow': '' })}
      data-edit-id={id}
      data-ea={adj.align}
      data-editing={draft !== null && inline ? '' : undefined}
      data-edit-hover={active && mode === 'flow' && !selected ? '' : undefined}
      onPointerDown={active ? onBodyDown : undefined}
      onDoubleClick={
        active && text
          ? (e) => {
              if ((e.target as Element).closest('[data-edit-ui]')) return;
              e.stopPropagation();
              beginEdit();
            }
          : undefined
      }
      style={{
        ...(mode === 'layer' ? { position: 'absolute', inset: 0, zIndex } : { position: 'relative', zIndex }),
        transform,
        transformOrigin: origin,
        cursor: active ? 'move' : undefined,
        touchAction: active ? 'none' : undefined,
        ...hoverVars,
      }}
    >
      {adj.align ? <style>{`[data-ea="${adj.align}"] * { text-align: ${adj.align} !important; }`}</style> : null}
      {children}
      {active && mode === 'layer' && box && !selected ? (
        <div data-edit-frame data-edit-hover-frame style={{ ...frameStyle, outline: `${line}px solid rgba(10,132,255,0.75)`, outlineOffset: 3 / cs, pointerEvents: 'none' }} />
      ) : null}
      {portal}
      {draft !== null ? (
        <textarea
          data-edit-ui
          autoFocus
          wrap="off"
          value={draft}
          ref={(el) => {
            if (el) {
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finishText}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              setInline(null);
              setDraft(null);
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              finishText();
            }
          }}
          style={
            inline
              ? {
                  position: 'absolute',
                  left: inline.x - inline.h * 0.05 - 24,
                  top: inline.y,
                  width: inline.w + 48,
                  minHeight: inline.h,
                  zIndex: 100,
                  boxSizing: 'border-box',
                  resize: 'none',
                  overflow: 'hidden',
                  whiteSpace: 'pre',
                  background: 'transparent',
                  border: 'none',
                  outline: `${line}px dashed ${ACCENT}`,
                  outlineOffset: 4 / cs,
                  margin: 0,
                  padding: '0 24px',
                  caretColor: ACCENT,
                  fontFamily: inline.fontFamily,
                  fontSize: inline.fontSize,
                  fontWeight: inline.fontWeight,
                  lineHeight: inline.lineHeight,
                  letterSpacing: inline.letterSpacing,
                  fontFeatureSettings: inline.fontFeatureSettings,
                  color: inline.color,
                  textAlign: inline.textAlign as React.CSSProperties['textAlign'],
                  pointerEvents: 'auto',
                }
              : {
                  position: 'absolute',
                  inset: 0,
                  zIndex: 100,
                  resize: 'none',
                  font: '700 32px "Noto Sans JP", sans-serif',
                  background: '#fff',
                  color: '#15172b',
                  border: `3px solid ${ACCENT}`,
                  pointerEvents: 'auto',
                }
          }
        />
      ) : null}
    </div>
  );
};

/** 回転・拡大縮小のつまみ（白い小さな丸／角丸の四角。macOS の選択ハンドル風） */
const handle = (ui: number): React.CSSProperties => ({
  position: 'absolute',
  width: ui,
  height: ui,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#fff',
  color: ACCENT,
  border: `1.5px solid ${ACCENT}`,
  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
  touchAction: 'none',
});

/** 操作バーのボタン（暗い半透明のバーに並ぶアイコン） */
const Chip: React.FC<{ ui: number; title: string; danger?: boolean; active?: boolean; onClick: () => void; children: React.ReactNode }> = ({ ui, title, danger, active, onClick, children }) => (
  <button
    type="button"
    data-edit-ui
    title={title}
    aria-label={title}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    style={{
      width: ui,
      height: ui,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      borderRadius: 7,
      border: 0,
      background: active ? 'rgba(255,255,255,0.22)' : 'transparent',
      color: danger ? '#ff6961' : '#fff',
      cursor: 'pointer',
    }}
  >
    {children}
  </button>
);

export { isIdentity };
