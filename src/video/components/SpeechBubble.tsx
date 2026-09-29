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
      <svg
        width={60 * u}
        height={tailH + bw * 2}
        style={{
          position: 'absolute',
          left: tailX - 30 * u,
          top: tail === 'down' ? h - bw * 1.5 : -tailH - bw * 0.5,
          overflow: 'visible',
          transform: tail === 'up' ? 'scaleY(-1)' : undefined,
        }}
      >
        <path
          d={`M${8 * u} 0 L${30 * u} ${tailH + bw} L${52 * u} 0`}
          fill={bg}
          stroke={border}
          strokeWidth={bw}
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: bg,
          border: `${bw}px solid ${border}`,
          borderRadius: 26 * u,
          boxShadow: `${6 * u}px ${8 * u}px 0 rgba(0,0,0,0.14)`,
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
      {/* しっぽと本体の境界線を消す */}
      <div
        style={{
          position: 'absolute',
          left: tailX - 20 * u,
          width: 40 * u,
          top: tail === 'down' ? h - bw : 0,
          height: bw,
          background: bg,
        }}
      />
    </div>
  );
};
