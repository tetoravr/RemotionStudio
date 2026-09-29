import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, pop } from '../anim';
import { useTheme } from '../theme';

/** キャラの頭の周りの記号（？や汗など） */
export const Decor: React.FC<{ kind: 'question' | 'sparkle' | 'sweat' | 'heart' | 'exclaim'; x: number; y: number; at: number }> = ({ kind, x, y, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { layout, colors, fonts } = useTheme();
  const { u } = layout;
  const items =
    kind === 'question'
      ? [
          { ch: '?', dx: 0, dy: 0, s: 1.25, d: 0 },
          { ch: '?', dx: 120, dy: -110, s: 0.95, d: 5 },
        ]
      : kind === 'exclaim'
        ? [
            { ch: '!', dx: 0, dy: 0, s: 1.3, d: 0 },
            { ch: '!', dx: 90, dy: -70, s: 0.9, d: 4 },
          ]
        : kind === 'heart'
          ? [
              { ch: 'heart', dx: 0, dy: 0, s: 1, d: 0 },
              { ch: 'heart', dx: 110, dy: -90, s: 0.7, d: 5 },
            ]
          : kind === 'sweat'
            ? [{ ch: 'drop', dx: 0, dy: 0, s: 1, d: 0 }]
            : [
                { ch: 'star', dx: 0, dy: 0, s: 1, d: 0 },
                { ch: 'star', dx: 110, dy: -80, s: 0.7, d: 4 },
                { ch: 'star', dx: -60, dy: -130, s: 0.5, d: 8 },
              ];
  return (
    <>
      {items.map((it, i) => {
        const p = pop(frame, fps, at + it.d, 9, 200);
        if (frame < at + it.d) return null;
        const wob = Math.sin((frame - at) / 5 + i) * 8;
        const fall = kind === 'sweat' ? interpolate(frame - at, [0, 30], [0, 40 * u], clamp) : 0;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x + it.dx * u,
              top: y + it.dy * u + fall,
              transform: `translate(-50%,-50%) scale(${p * it.s}) rotate(${wob}deg)`,
              fontFamily: fonts.heading,
              fontWeight: 900,
              fontSize: 150 * u,
              lineHeight: 1,
              color: kind === 'heart' ? '#ff5c8a' : kind === 'sparkle' ? colors.accent : colors.primary,
              WebkitTextStroke: kind === 'sweat' ? undefined : `${6 * u}px #fff`,
              paintOrder: 'stroke fill',
              filter: `drop-shadow(0 ${6 * u}px 0 rgba(0,0,0,0.12))`,
            }}
          >
            {it.ch === 'drop' ? (
              <svg width={70 * u} height={100 * u} viewBox="0 0 70 100" style={{ display: 'block' }}>
                <path d="M35 4 C48 30 64 48 64 66 A29 29 0 0 1 6 66 C6 48 22 30 35 4 Z" fill="#7cc8ff" stroke="#fff" strokeWidth={6} />
                <ellipse cx={24} cy={62} rx={7} ry={12} fill="#fff" opacity={0.7} />
              </svg>
            ) : it.ch === 'heart' ? (
              <svg width={110 * u} height={100 * u} viewBox="0 0 110 100" style={{ display: 'block' }}>
                <path d="M55 92 C20 66 6 48 6 30 A24 24 0 0 1 55 20 A24 24 0 0 1 104 30 C104 48 90 66 55 92 Z" fill="#ff5c8a" stroke="#fff" strokeWidth={7} />
              </svg>
            ) : it.ch === 'star' ? (
              <svg width={110 * u} height={110 * u} viewBox="-10 -10 20 20" style={{ display: 'block' }}>
                <path d="M0 -9.5 Q1.6 -1.6 9.5 0 Q1.6 1.6 0 9.5 Q-1.6 1.6 -9.5 0 Q-1.6 -1.6 0 -9.5 Z" fill={colors.accent} stroke="#fff" strokeWidth={0.8} />
              </svg>
            ) : (
              it.ch
            )}
          </div>
        );
      })}
    </>
  );
};
