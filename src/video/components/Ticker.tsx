import React from 'react';
import { interpolate, useCurrentFrame, Easing } from 'remotion';
import { useTheme } from '../theme';

/** 斜めに流れるブランド名の帯 */
export const Ticker: React.FC<{ text: string; y: number; angle?: number; delay?: number }> = ({ text, y, angle = -9, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { layout, colors, fonts } = useTheme();
  const { width: W, u } = layout;
  const h = 78 * u;
  const enter = interpolate(frame - delay, [0, 10], [W * 1.2, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const shift = -(frame * 5 * u);
  const unit = `${text}  ★  `;
  return (
    <div
      style={{
        position: 'absolute',
        left: -W * 0.25,
        width: W * 1.5,
        top: y - h / 2,
        height: h,
        transform: `rotate(${angle}deg) translateX(${enter}px)`,
        background: '#fff',
        borderTop: `${6 * u}px solid ${colors.dark}`,
        borderBottom: `${6 * u}px solid ${colors.dark}`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        boxShadow: `0 ${10 * u}px 0 rgba(0,0,0,0.12)`,
      }}
    >
      <div
        style={{
          whiteSpace: 'nowrap',
          transform: `translateX(${shift}px) skewX(-8deg)`,
          fontFamily: fonts.logo,
          fontWeight: 900,
          fontSize: 44 * u,
          color: colors.primary,
          letterSpacing: '0.04em',
        }}
      >
        {Array.from({ length: 24 }).map(() => unit).join('')}
      </div>
    </div>
  );
};
