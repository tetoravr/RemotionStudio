import React from 'react';
import { Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, pop, slam } from '../anim';
import { useTheme } from '../theme';

/**
 * 課題などを説明する図解イラストのカード。白いカードにイラストを大きく載せ、NG/OK スタンプとラベルを重ねる。
 * at: 出現フレーム（シーン先頭基準）
 */
export const IllustrationCard: React.FC<{
  src: string;
  badge: 'none' | 'ng' | 'ok';
  label?: string;
  x: number;
  y: number;
  size: number;
  at: number;
}> = ({ src, badge, label, x, y, size, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors, fonts, layout, resolveAsset } = useTheme();
  const { u } = layout;
  const p = pop(frame, fps, at, 12, 170);
  const rot = interpolate(p, [0, 1], [-8, -2]);
  const stampAt = at + 10;
  const sp = slam(frame, fps, stampAt);
  const stampScale = interpolate(sp, [0, 1], [2.4, 1]);
  const stampOpacity = interpolate(frame, [stampAt, stampAt + 2], [0, 1], clamp);
  const pad = size * 0.04;
  const labelH = label ? size * 0.13 : 0;
  const url = resolveAsset(src);
  if (frame < at || !url) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y,
        width: size,
        transform: `scale(${Math.max(0, p)}) rotate(${rot}deg)`,
        transformOrigin: '50% 60%',
      }}
    >
      <div
        style={{
          width: size,
          boxSizing: 'border-box',
          padding: pad,
          paddingBottom: label ? 0 : pad,
          background: '#fff',
          borderRadius: size * 0.06,
          border: `${Math.max(3, 6 * u)}px solid ${colors.dark}`,
          boxShadow: `0 ${14 * u}px 0 rgba(0,0,0,0.14)`,
          overflow: 'hidden',
        }}
      >
        <Img src={url} style={{ display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: size * 0.03 }} />
        {label ? (
          <div
            style={{
              height: labelH,
              margin: `0 ${-pad}px`,
              marginTop: pad * 0.6,
              background: colors.dark,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: fonts.heading,
              fontWeight: 900,
              fontSize: labelH * 0.5,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
        ) : null}
      </div>
      {badge !== 'none' && frame >= stampAt ? (
        <div
          style={{
            position: 'absolute',
            right: -size * 0.06,
            top: -size * 0.07,
            width: size * 0.3,
            height: size * 0.3,
            borderRadius: '50%',
            background: badge === 'ng' ? '#ff4d5e' : '#22c55e',
            border: `${size * 0.022}px solid #fff`,
            boxShadow: `0 ${8 * u}px 0 rgba(0,0,0,0.18)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: fonts.heading,
            fontWeight: 900,
            fontSize: size * 0.1,
            color: '#fff',
            transform: `scale(${stampScale}) rotate(-12deg)`,
            opacity: stampOpacity,
          }}
        >
          {badge === 'ng' ? 'NG' : 'OK'}
        </div>
      ) : null}
    </div>
  );
};
