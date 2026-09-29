import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion';
import { clamp } from '../anim';
import { shade, useTheme } from '../theme';
import { Icon } from './Icon';

/** 紙吹雪の爆発（at フレームから） */
export const ConfettiBurst: React.FC<{ at: number; x: number; y: number; count?: number; seed?: string; spread?: number }> = ({
  at,
  x,
  y,
  count = 36,
  seed = 'confetti',
  spread = 1,
}) => {
  const frame = useCurrentFrame();
  const { colors, layout } = useTheme();
  const { u } = layout;
  const t = frame - at;
  if (t < 0 || t > 70) return null;
  const palette = [colors.primary, colors.accent, '#ffffff', shade(colors.primary, 0.45), '#ff6b9a'];
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: count }).map((_, i) => {
        const a = random(`${seed}-a-${i}`) * Math.PI * 2;
        const v = (18 + random(`${seed}-v-${i}`) * 26) * u * spread;
        const px = x + Math.cos(a) * v * t * 0.9 * Math.exp(-t / 28) * 1.6;
        const py = y + Math.sin(a) * v * t * 0.9 * Math.exp(-t / 28) * 1.6 + 0.35 * u * t * t;
        const r = random(`${seed}-r-${i}`) * 360 + t * (8 + random(`${seed}-s-${i}`) * 12);
        const w = (12 + random(`${seed}-w-${i}`) * 12) * u;
        const opacity = interpolate(t, [45, 70], [1, 0], clamp);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px,
              top: py,
              width: w,
              height: w * 0.55,
              background: palette[i % palette.length],
              transform: `rotate(${r}deg) scaleY(${Math.cos(t * 0.3 + i)})`,
              opacity,
              borderRadius: 2 * u,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** 上から降るコイン（着金演出など） */
export const CoinRain: React.FC<{ from: number; count?: number; seed?: string; area?: { x: number; w: number } }> = ({
  from,
  count = 18,
  seed = 'coins',
  area,
}) => {
  const frame = useCurrentFrame();
  const { colors, layout } = useTheme();
  const { u, width: W, height: H } = layout;
  const t = frame - from;
  if (t < 0) return null;
  const ax = area?.x ?? 0;
  const aw = area?.w ?? W;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: count }).map((_, i) => {
        const start = random(`${seed}-d-${i}`) * 40;
        const lt = t - start;
        if (lt < 0) return null;
        const speed = (14 + random(`${seed}-v-${i}`) * 12) * u;
        const px = ax + random(`${seed}-x-${i}`) * aw + Math.sin(lt / 6 + i) * 10 * u;
        const py = -80 * u + lt * speed;
        if (py > H + 100 * u) return null;
        const size = (44 + random(`${seed}-s-${i}`) * 28) * u;
        const spin = Math.cos(lt / 4 + i);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: px,
              top: py,
              width: size,
              height: size,
              borderRadius: '50%',
              background: colors.primary,
              border: `${4 * u}px solid ${shade(colors.primary, 0.5)}`,
              transform: `scaleX(${Math.abs(spin) * 0.8 + 0.2})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 ${4 * u}px 0 ${shade(colors.primary, -0.3)}`,
            }}
          >
            <Icon name="yen" size={size * 0.55} color="#fff" strokeWidth={3} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** キラキラ（ランダムな位置で瞬く） */
export const Sparkles: React.FC<{ from: number; count?: number; seed?: string; box?: { x: number; y: number; w: number; h: number }; color?: string }> = ({
  from,
  count = 10,
  seed = 'sparkle',
  box,
  color,
}) => {
  const frame = useCurrentFrame();
  const { colors, layout } = useTheme();
  const { u, width: W, height: H } = layout;
  const b = box ?? { x: 0, y: 0, w: W, h: H };
  const t = frame - from;
  if (t < 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: count }).map((_, i) => {
        const period = 26 + Math.floor(random(`${seed}-p-${i}`) * 20);
        const offset = Math.floor(random(`${seed}-o-${i}`) * period);
        const cyc = Math.floor((t + offset) / period);
        const lt = (t + offset) % period;
        const s = Math.sin((lt / period) * Math.PI);
        const px = b.x + random(`${seed}-x-${i}-${cyc}`) * b.w;
        const py = b.y + random(`${seed}-y-${i}-${cyc}`) * b.h;
        const size = (26 + random(`${seed}-s-${i}`) * 30) * u * s;
        return (
          <svg key={i} width={size} height={size} viewBox="-10 -10 20 20" style={{ position: 'absolute', left: px - size / 2, top: py - size / 2 }}>
            <path d="M0 -10 Q1.5 -1.5 10 0 Q1.5 1.5 0 10 Q-1.5 1.5 -10 0 Q-1.5 -1.5 0 -10 Z" fill={color ?? (i % 3 === 0 ? colors.accent : '#fff')} />
          </svg>
        );
      })}
    </AbsoluteFill>
  );
};

/** 衝撃リング（見出しの叩きつけ時） */
export const ImpactRing: React.FC<{ at: number; x: number; y: number; color: string; maxR: number }> = ({ at, x, y, color, maxR }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > 22) return null;
  const r = interpolate(t, [0, 22], [maxR * 0.2, maxR], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
  const o = interpolate(t, [0, 22], [0.8, 0], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        border: `${Math.max(2, maxR * 0.05 * (1 - t / 22))}px solid ${color}`,
        opacity: o,
      }}
    />
  );
};

/** スピード線（放射状） */
export const SpeedLines: React.FC<{ at: number; dur?: number; x: number; y: number; color: string; count?: number; seed?: string }> = ({
  at,
  dur = 14,
  x,
  y,
  color,
  count = 18,
  seed = 'speed',
}) => {
  const frame = useCurrentFrame();
  const { layout } = useTheme();
  const { u } = layout;
  const t = frame - at;
  if (t < 0 || t > dur) return null;
  const p = t / dur;
  return (
    <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width={layout.width} height={layout.height}>
      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * Math.PI * 2 + random(`${seed}-${i}`) * 0.3;
        const r0 = (160 + p * 260 + random(`${seed}-r-${i}`) * 60) * u;
        const len = (70 + random(`${seed}-l-${i}`) * 90) * u * (1 - p);
        return (
          <line
            key={i}
            x1={x + Math.cos(a) * r0}
            y1={y + Math.sin(a) * r0}
            x2={x + Math.cos(a) * (r0 + len)}
            y2={y + Math.sin(a) * (r0 + len)}
            stroke={color}
            strokeWidth={8 * u * (1 - p)}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
};
