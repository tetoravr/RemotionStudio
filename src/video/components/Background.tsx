import React, { useId } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { BackgroundKind } from '../schema';
import { alpha, shade, useTheme } from '../theme';

export const useSvgId = (prefix: string) => `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

type Palette = { base: string; ray?: string; glow?: string; dot?: string; stripe?: string };

const palette = (kind: BackgroundKind, c: { primary: string; dark: string; light: string }): Palette => {
  switch (kind) {
    case 'burst':
      return { base: c.primary, ray: shade(c.primary, 0.14), glow: 'rgba(255,255,255,0.35)', dot: alpha(shade(c.primary, -0.35), 0.38) };
    case 'burst-light':
      return { base: '#ffffff', ray: shade(c.light, -0.02), glow: 'rgba(255,255,255,0.95)', dot: alpha(c.primary, 0.1) };
    case 'burst-dark':
      return { base: c.dark, ray: shade(c.dark, 0.1), glow: alpha(shade(c.primary, 0.1), 0.35), dot: alpha(c.primary, 0.28) };
    case 'stripes':
      return { base: shade(c.light, 0.55), stripe: shade(c.light, -0.03), dot: alpha(c.primary, 0.06) };
    case 'stripes-dark':
      return { base: c.dark, stripe: shade(c.dark, 0.07), dot: alpha(c.primary, 0.2) };
    case 'dots':
      return { base: shade(c.light, 0.4), dot: alpha(c.primary, 0.14) };
    case 'gradient':
      return { base: c.primary };
    default:
      return { base: shade(c.light, 0.5) };
  }
};

export const Background: React.FC<{
  kind: BackgroundKind;
  /** 集中線の中心（0〜1） */
  center?: { x: number; y: number };
  spin?: number;
}> = ({ kind, center = { x: 0.5, y: 0.32 }, spin = 1 }) => {
  const frame = useCurrentFrame();
  const { colors, layout } = useTheme();
  const { width: W, height: H, u } = layout;
  const p = palette(kind, colors);
  const id = useSvgId('bg');

  if (kind === 'gradient') {
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${center.x * 100}% ${center.y * 100}%, ${shade(colors.primary, 0.2)} 0%, ${colors.primary} 40%, ${colors.dark} 100%)`,
        }}
      />
    );
  }

  const isBurst = kind.startsWith('burst');
  const isStripes = kind.startsWith('stripes');
  const cx = W * center.x;
  const cy = H * center.y;
  const R = Math.hypot(W, H) * 1.1;
  const D = Math.hypot(W, H) + 400 * u;
  const RAYS = 28;
  const rot = frame * 0.22 * spin;
  const stripeW = 70 * u;
  // 周期の整数倍で巻き戻す → 継ぎ目なくループ
  const stripeShift = (frame * 1.2 * u) % (stripeW * 2);
  const dotSize = 30 * u;

  return (
    <AbsoluteFill style={{ backgroundColor: p.base, overflow: 'hidden' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id={`${id}-glow`} cx={cx} cy={cy} r={Math.max(W, H) * 0.55} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={p.glow ?? 'transparent'} />
            <stop offset="1" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <pattern id={`${id}-dots`} width={dotSize} height={dotSize} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <circle cx={dotSize / 2} cy={dotSize / 2} r={dotSize * 0.2} fill={p.dot ?? 'transparent'} />
          </pattern>
          <radialGradient id={`${id}-fade`} cx={cx} cy={cy} r={Math.max(W, H) * 0.75} gradientUnits="userSpaceOnUse">
            <stop offset="0.25" stopColor="#000" />
            <stop offset="1" stopColor="#fff" />
          </radialGradient>
          <mask id={`${id}-mask`}>
            <rect width={W} height={H} fill={`url(#${id}-fade)`} />
          </mask>
        </defs>
        {isBurst ? (
          <g transform={`translate(${cx} ${cy}) rotate(${rot})`}>
            {Array.from({ length: RAYS }).map((_, i) => {
              if (i % 2) return null;
              const a0 = (i / RAYS) * Math.PI * 2;
              const a1 = ((i + 1) / RAYS) * Math.PI * 2;
              return (
                <path
                  key={i}
                  d={`M0 0 L${Math.cos(a0) * R} ${Math.sin(a0) * R} L${Math.cos(a1) * R} ${Math.sin(a1) * R} Z`}
                  fill={p.ray}
                />
              );
            })}
          </g>
        ) : null}
        {isBurst ? <rect width={W} height={H} fill={`url(#${id}-glow)`} /> : null}
        {p.dot ? <rect width={W} height={H} fill={`url(#${id}-dots)`} mask={kind === 'dots' ? undefined : `url(#${id}-mask)`} /> : null}
      </svg>
      {isStripes ? (
        // 画面より十分大きい要素を回転し、周期ぶんだけ平行移動する（backgroundPosition を動かすとタイル境界に継ぎ目が出る）
        <div
          style={{
            position: 'absolute',
            left: W / 2 - D,
            top: H / 2 - D,
            width: D * 2,
            height: D * 2,
            transform: `rotate(32deg) translateX(${stripeShift}px)`,
            backgroundImage: `repeating-linear-gradient(90deg, ${p.stripe} 0px, ${p.stripe} ${stripeW}px, transparent ${stripeW}px, transparent ${stripeW * 2}px)`,
            opacity: 0.9,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
