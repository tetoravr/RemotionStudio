import React from 'react';
import type { IconName } from '../schema';
import { shade, useTheme } from '../theme';
import { Icon } from './Icon';

/** 会話シーンの小道具（NG/OKバッジ付きのカード） */
export const PropCard: React.FC<{ icon: IconName; badge: 'none' | 'ng' | 'ok'; label?: string; width: number }> = ({ icon, badge, label, width }) => {
  const { colors, fonts } = useTheme();
  const h = width * 0.63;
  const dark = shade(colors.dark, 0.12);
  return (
    <div
      style={{
        width,
        height: h,
        borderRadius: width * 0.07,
        background: `linear-gradient(150deg, ${shade(dark, 0.15)}, ${dark})`,
        border: `${width * 0.018}px solid ${colors.dark}`,
        boxShadow: `0 ${width * 0.04}px 0 rgba(0,0,0,0.18)`,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ position: 'absolute', left: width * 0.09, top: width * 0.1 }}>
        <Icon name={icon} size={width * 0.22} color="#fff" strokeWidth={2.2} />
      </div>
      {badge !== 'none' ? (
        <div
          style={{
            position: 'absolute',
            right: width * 0.08,
            top: width * 0.07,
            width: width * 0.26,
            height: width * 0.26,
            borderRadius: '50%',
            border: `${width * 0.02}px solid #fff`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: fonts.heading,
            fontWeight: 900,
            fontSize: width * 0.09,
            color: '#fff',
            background: badge === 'ng' ? '#ff4d5e' : '#22c55e',
          }}
        >
          {badge === 'ng' ? 'NG' : 'OK'}
        </div>
      ) : null}
      {label ? (
        <div
          style={{
            position: 'absolute',
            left: width * 0.09,
            bottom: width * 0.07,
            fontFamily: fonts.body,
            fontWeight: 700,
            fontSize: width * 0.06,
            color: 'rgba(255,255,255,0.85)',
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
};
