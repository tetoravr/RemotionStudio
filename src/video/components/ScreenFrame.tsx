import React from 'react';
import { Img, interpolate, Easing, useCurrentFrame } from 'remotion';
import { clamp } from '../anim';
import { useTheme } from '../theme';

/**
 * 実際の画面（スクリーンショット）を見せる枠。疑似UIは作らず、渡された画像だけを表示する。
 * 画像が枠より縦に長い場合は、上から下へゆっくりスクロールして全体を見せる。
 */
export const ScreenFrame: React.FC<{
  kind: 'phone' | 'browser';
  src: string;
  size?: { w: number; h: number };
  /** 枠の幅(px) */
  width: number;
  /** 枠の最大の高さ(px)。browser の時に使用 */
  maxHeight?: number;
  /** スクロールを始めるフレーム／かける長さ */
  scrollFrom: number;
  scrollDur: number;
}> = ({ kind, src, size, width, maxHeight, scrollFrom, scrollDur }) => {
  const frame = useCurrentFrame();
  const { resolveAsset, colors } = useTheme();
  const url = resolveAsset(src)!;
  const aspect = size ? size.h / size.w : 2; // 高さ/幅

  const bezel = kind === 'phone' ? width * 0.035 : 0;
  const chrome = kind === 'browser' ? width * 0.055 : 0;
  const innerW = width - bezel * 2;
  const fullH = innerW * aspect; // 画像を幅いっぱいに置いた時の高さ
  const viewH = kind === 'phone' ? width * 2.04 - bezel * 2 : Math.min(fullH, (maxHeight ?? fullH + chrome) - chrome);
  const overflow = Math.max(0, fullH - viewH);
  const scroll = overflow
    ? interpolate(frame, [scrollFrom, scrollFrom + scrollDur], [0, -overflow], { ...clamp, easing: Easing.inOut(Easing.cubic) })
    : 0;
  const shot = (
    <div style={{ width: innerW, height: viewH, overflow: 'hidden', position: 'relative', background: '#fff' }}>
      <Img src={url} style={{ width: innerW, height: 'auto', display: 'block', transform: `translateY(${scroll}px)` }} />
    </div>
  );

  if (kind === 'phone') {
    return (
      <div
        style={{
          width,
          height: width * 2.04,
          borderRadius: width * 0.14,
          background: '#15161c',
          padding: bezel,
          boxSizing: 'border-box',
          boxShadow: `0 ${width * 0.05}px ${width * 0.1}px rgba(0,0,0,0.28), inset 0 0 0 ${width * 0.008}px #3a3d48`,
          position: 'relative',
        }}
      >
        <div style={{ borderRadius: width * 0.11, overflow: 'hidden', position: 'relative' }}>
          {shot}
          <div
            style={{
              position: 'absolute',
              top: width * 0.03,
              left: '50%',
              transform: 'translateX(-50%)',
              width: width * 0.28,
              height: width * 0.08,
              borderRadius: width * 0.05,
              background: '#15161c',
            }}
          />
        </div>
      </div>
    );
  }
  const dot = chrome * 0.24;
  return (
    <div
      style={{
        width,
        borderRadius: width * 0.02,
        overflow: 'hidden',
        background: '#fff',
        border: `${Math.max(2, width * 0.004)}px solid ${colors.dark}`,
        boxShadow: `0 ${width * 0.025}px ${width * 0.06}px rgba(0,0,0,0.25)`,
      }}
    >
      <div style={{ height: chrome, background: '#e9ebf0', display: 'flex', alignItems: 'center', gap: dot * 0.7, padding: `0 ${chrome * 0.4}px` }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: dot, height: dot, borderRadius: '50%', background: c }} />
        ))}
        <span style={{ marginLeft: chrome * 0.4, flex: 1, height: chrome * 0.55, borderRadius: chrome, background: '#fff' }} />
      </div>
      {shot}
    </div>
  );
};
