import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { pop } from '../anim';
import { useTheme } from '../theme';
import { estimateEm, RichText } from './RichText';

export type BubbleVariant = 'white' | 'accent';

/**
 * 吹き出し。(tipX, tipY) がしっぽの先端。
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
  /** しっぽの向き（上に出す=down / 下に出す=up） */
  tail?: 'down' | 'up';
}> = ({ text, tipX, tipY, appearAt, hideAt, variant = 'white', fontSize, maxWidth, tail = 'down' }) => {
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
  const tailX = Math.min(Math.max(tipX - left, 40 * u), w - 40 * u);

  const r = 26 * u;
  const a = 22 * u;
  const x0 = bw / 2;
  const y0 = bw / 2;
  const x1 = w - bw / 2;
  const y1 = h - bw / 2;
  const tx = Math.min(Math.max(tailX, r + a), w - r - a);
  const bubblePath =
    `M${x0 + r} ${y0} H${x1 - r} Q${x1} ${y0} ${x1} ${y0 + r} V${y1 - r} Q${x1} ${y1} ${x1 - r} ${y1} ` +
    `H${tx + a} L${tx} ${h + tailH} L${tx - a} ${y1} H${x0 + r} Q${x0} ${y1} ${x0} ${y1 - r} V${y0 + r} Q${x0} ${y0} ${x0 + r} ${y0} Z`;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: h,
        transform: `scale(${scale})`,
        transformOrigin: `${tailX}px ${tail === 'down' ? h + tailH : -tailH}px`,
        opacity: outP,
      }}
    >
      {/* 本体としっぽを1本の輪郭にする（つなぎ目ができず、角も丸くなる） */}
      <svg
        width={w + bw}
        height={h + tailH + bw * 2}
        style={{ position: 'absolute', left: -bw / 2, top: tail === 'down' ? -bw / 2 : -tailH - bw * 1.5, overflow: 'visible', transform: tail === 'up' ? 'scaleY(-1)' : undefined }}
      >
        <g transform={`translate(${bw / 2} ${bw / 2})`}>
          <path d={bubblePath} fill="rgba(0,0,0,0.14)" transform={`translate(${6 * u} ${8 * u})`} />
          <path d={bubblePath} fill={bg} stroke={border} strokeWidth={bw} strokeLinejoin="round" />
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
    </div>
  );
};
