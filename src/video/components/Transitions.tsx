import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { clamp } from '../anim';
import { shade, useTheme } from '../theme';

export const WIPE_FRAMES = 22;
export const WIPE_CUT = 11;

/** 斜めの帯が画面を横切るワイプ（WIPE_CUT フレーム目でシーンが切り替わる） */
export const DiagonalWipe: React.FC = () => {
  const frame = useCurrentFrame();
  const { layout, colors } = useTheme();
  const { width: W, height: H } = layout;
  const D = Math.hypot(W, H);
  const pos = interpolate(frame, [0, WIPE_CUT, WIPE_FRAMES], [-1.75 * D, 0, 1.75 * D], {
    ...clamp,
    easing: Easing.inOut(Easing.quad),
  });
  const band = (offset: number, width: number, color: string, key: string) => (
    <div
      key={key}
      style={{
        position: 'absolute',
        top: -D,
        height: D * 3,
        left: D * 1.5 + pos + offset * D - (width * D) / 2,
        width: width * D,
        background: color,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: W / 2 - D * 1.5,
          top: H / 2 - D * 1.5,
          width: D * 3,
          height: D * 3,
          transform: 'rotate(-28deg)',
        }}
      >
        {band(-0.78, 0.07, shade(colors.primary, 0.55), 't2')}
        {band(-0.66, 0.1, shade(colors.primary, 0.3), 't1')}
        {band(0, 1.16, colors.primary, 'main')}
        {band(0.66, 0.1, shade(colors.primary, 0.3), 'l1')}
        {band(0.78, 0.07, shade(colors.primary, 0.55), 'l2')}
      </div>
    </AbsoluteFill>
  );
};

/** 白フラッシュ（0フレーム目が切替点） */
export const Flash: React.FC<{ color?: string }> = ({ color = '#fff' }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 2, 10], [0.95, 0.8, 0], clamp);
  return <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: 'none' }} />;
};
