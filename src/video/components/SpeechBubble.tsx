import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { pop } from '../anim';
import { useTheme } from '../theme';
import { estimateEm, RichText } from './RichText';

export type BubbleVariant = 'white' | 'accent';
type Side = 'top' | 'right' | 'bottom' | 'left';

/** しっぽの先端を直接ドラッグするための情報（直接調整中のみ） */
export type TailEdit = {
  /** 吹き出しのローカル 1px が画面上で何 px か */
  screenScale: number;
  /** 吹き出し全体の回転（度）。ドラッグ量を吹き出しの向きに直すのに使う */
  rotate: number;
  begin: () => void;
  set: (offset: { dx: number; dy: number }) => void;
};

/**
 * 吹き出しの輪郭（本体としっぽを1本の線にする）。
 * しっぽの先端 (tx, ty) が本体の外のどちら側にあるかで、しっぽを出す辺を決める。先端が本体の内側ならしっぽなし。
 */
const bubbleOutline = (w: number, h: number, bw: number, r: number, a: number, tip: { x: number; y: number } | null) => {
  const x0 = bw / 2;
  const y0 = bw / 2;
  const x1 = w - bw / 2;
  const y1 = h - bw / 2;
  let side: Side | null = null;
  if (tip) {
    const out = {
      top: y0 - tip.y,
      bottom: tip.y - y1,
      left: x0 - tip.x,
      right: tip.x - x1,
    };
    // 一番はみ出している方向の辺から出す（縦横はそれぞれの辺の長さで割って比べる）
    const cands = (Object.entries(out) as [Side, number][]).filter(([, v]) => v > 0);
    if (cands.length) {
      side = cands.sort((p, q) => q[1] / (q[0] === 'top' || q[0] === 'bottom' ? h : w) - p[1] / (p[0] === 'top' || p[0] === 'bottom' ? h : w))[0][0];
    }
  }
  const clampX = (x: number) => Math.min(Math.max(x, x0 + r + a), x1 - r - a);
  const aV = Math.max(6, Math.min(a, (h - 2 * r) / 2 - 2)); // 左右の辺は短いので、しっぽの根元を細くする
  const clampY = (y: number) => Math.min(Math.max(y, y0 + r + aV), y1 - r - aV);
  const T = tip ? `L${tip.x} ${tip.y}` : '';
  let d = `M${x0 + r} ${y0} `;
  if (side === 'top') {
    const bx = clampX(tip!.x);
    d += `H${bx - a} ${T} L${bx + a} ${y0} `;
  }
  d += `H${x1 - r} Q${x1} ${y0} ${x1} ${y0 + r} `;
  if (side === 'right') {
    const by = clampY(tip!.y);
    d += `V${by - aV} ${T} L${x1} ${by + aV} `;
  }
  d += `V${y1 - r} Q${x1} ${y1} ${x1 - r} ${y1} `;
  if (side === 'bottom') {
    const bx = clampX(tip!.x);
    d += `H${bx + a} ${T} L${bx - a} ${y1} `;
  }
  d += `H${x0 + r} Q${x0} ${y1} ${x0} ${y1 - r} `;
  if (side === 'left') {
    const by = clampY(tip!.y);
    d += `V${by + aV} ${T} L${x0} ${by - aV} `;
  }
  d += `V${y0 + r} Q${x0} ${y0} ${x0 + r} ${y0} Z`;
  return d;
};

/**
 * 吹き出し。(tipX, tipY) が自動で決まるしっぽの先端。tailOffset で先端を動かすと、しっぽの向きも変わる。
 * 本体は画面外にはみ出さないよう左右にクランプされる。
 */
export const SpeechBubble: React.FC<{
  text: string;
  tipX: number;
  tipY: number;
  appearAt: number;
  hideAt?: number;
  variant?: BubbleVariant;
  fontSize?: number;
  maxWidth?: number;
  /** 本体を先端の上に置く（down）か下に置く（up） */
  tail?: 'down' | 'up';
  /** しっぽの先端を自動の位置からずらす量／しっぽを消す */
  tailOffset?: { dx: number; dy: number; hidden?: boolean };
  tailEdit?: TailEdit;
}> = ({ text, tipX, tipY, appearAt, hideAt, variant = 'white', fontSize, maxWidth, tail = 'down', tailOffset, tailEdit }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { layout, colors, fonts } = useTheme();
  const { u, width: W, safe } = layout;
  if (frame < appearAt) return null;
  if (hideAt !== undefined && frame > hideAt + 8) return null;

  const fs = fontSize ?? 50 * u;
  const lines = text.split('\n');
  const em = Math.max(...lines.map((l) => estimateEm(l)));
  const padX = 34 * u;
  const padY = 20 * u;
  const limit = maxWidth ?? W - safe * 2;
  const scaleFs = Math.min(fs, (limit - padX * 2) / Math.max(1, em));
  const w = Math.min(limit, em * scaleFs + padX * 2 + 8 * u);
  const h = lines.length * scaleFs * 1.3 + padY * 2;
  const tailH = 30 * u;
  const left = Math.min(Math.max(safe * 0.6, tipX - w * 0.5), W - safe * 0.6 - w);
  const top = tail === 'down' ? tipY - tailH - h : tipY + tailH;

  const inP = pop(frame, fps, appearAt, 10, 220);
  const outP = hideAt !== undefined ? interpolate(frame, [hideAt, hideAt + 7], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;
  const scale = inP * (0.7 + 0.3 * outP);
  const reveal = interpolate(frame, [appearAt + 1, appearAt + 1 + Math.max(4, text.length * 0.7)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const bg = variant === 'accent' ? colors.primary : '#ffffff';
  const fg = variant === 'accent' ? '#ffffff' : colors.text;
  const border = colors.dark;
  const bw = 5 * u;
  const r = 26 * u;
  const a = 22 * u;

  // 自動の先端：本体の辺から tailH だけ外（本体の中に入らないよう、横方向は本体の幅に収める）
  const autoTip = {
    x: Math.min(Math.max(tipX - left, 40 * u), w - 40 * u),
    y: tail === 'down' ? h + tailH : -tailH,
  };
  const tip = { x: autoTip.x + (tailOffset?.dx ?? 0), y: autoTip.y + (tailOffset?.dy ?? 0) };
  const inside = tip.x > 0 && tip.x < w && tip.y > 0 && tip.y < h;
  const showTail = !tailOffset?.hidden && !inside;
  const path = bubbleOutline(w, h, bw, r, a, showTail ? tip : null);

  const onTipDown = (e: React.PointerEvent) => {
    if (!tailEdit) return;
    e.stopPropagation();
    e.preventDefault();
    tailEdit.begin();
    const sx = e.clientX;
    const sy = e.clientY;
    const base = { dx: tailOffset?.dx ?? 0, dy: tailOffset?.dy ?? 0 };
    const th = (-tailEdit.rotate * Math.PI) / 180;
    const k = 1 / Math.max(0.01, tailEdit.screenScale);
    const move = (ev: PointerEvent) => {
      if (ev.buttons === 0) return up();
      const mx = (ev.clientX - sx) * k;
      const my = (ev.clientY - sy) * k;
      tailEdit.set({ dx: base.dx + mx * Math.cos(th) - my * Math.sin(th), dy: base.dy + mx * Math.sin(th) + my * Math.cos(th) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const hs = tailEdit ? 26 / Math.max(0.05, tailEdit.screenScale) : 0;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: h,
        transform: `scale(${scale})`,
        transformOrigin: `${showTail ? tip.x : w / 2}px ${showTail ? tip.y : h / 2}px`,
        opacity: outP,
      }}
    >
      {/* 本体としっぽを1本の輪郭にする（つなぎ目ができず、角も丸くなる） */}
      <svg width={w + bw} height={h + bw} style={{ position: 'absolute', left: -bw / 2, top: -bw / 2, overflow: 'visible' }}>
        <g transform={`translate(${bw / 2} ${bw / 2})`}>
          <path d={path} fill="rgba(0,0,0,0.14)" transform={`translate(${6 * u} ${8 * u})`} />
          <path d={path} fill={bg} stroke={border} strokeWidth={bw} strokeLinejoin="round" />
        </g>
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: `${padY}px ${padX}px`,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            fontFamily: fonts.heading,
            fontWeight: 900,
            fontSize: scaleFs,
            lineHeight: 1.3,
            color: fg,
            textAlign: 'left',
            whiteSpace: 'pre',
            fontFeatureSettings: '"palt" 1',
          }}
        >
          <RichText text={text} color={fg} highlightColor={variant === 'accent' ? colors.accent : colors.primary} reveal={reveal} />
        </div>
      </div>
      {tailEdit ? (
        <div
          data-edit-ui
          title="ドラッグでしっぽの位置・向きを変える（吹き出しの内側に入れるとしっぽなし）"
          onPointerDown={onTipDown}
          style={{
            position: 'absolute',
            left: (showTail ? tip.x : autoTip.x) - hs / 2,
            top: (showTail ? tip.y : autoTip.y) - hs / 2,
            width: hs,
            height: hs,
            borderRadius: '50%',
            background: '#ffb020',
            border: `${hs * 0.14}px solid #fff`,
            boxShadow: '0 0 0 2px #0a84ff',
            boxSizing: 'border-box',
            cursor: 'crosshair',
            touchAction: 'none',
            zIndex: 5,
          }}
        />
      ) : null}
    </div>
  );
};
