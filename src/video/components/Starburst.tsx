import React from 'react';
import { random, useCurrentFrame } from 'remotion';

/** ギザギザの爆発型（ロゴ背景など） */
export const Starburst: React.FC<{
  x: number;
  y: number;
  radius: number;
  /** 0〜1（ポップの進捗、オーバーシュート可） */
  progress: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  spikes?: number;
  seed?: string;
  shadow?: string;
  children?: React.ReactNode;
}> = ({ x, y, radius, progress, fill = '#fff', stroke, strokeWidth = 0, spikes = 20, seed = 'burst', shadow, children }) => {
  const frame = useCurrentFrame();
  const jitterFrame = Math.floor(frame / 5); // コマ打ち風の揺らぎ
  const pts: string[] = [];
  const size = radius * 2.4;
  const c = size / 2;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const outer = i % 2 === 0;
    const j = random(`${seed}-${i}`) * 0.18 + random(`${seed}-${i}-${jitterFrame}`) * 0.03;
    const r = outer ? radius * (1.02 + j) : radius * (0.8 + j * 0.3);
    pts.push(`${c + Math.cos(a) * r},${c + Math.sin(a) * r}`);
  }
  const s = Math.max(0, progress);
  const rot = (1 - Math.min(1, progress)) * -25 + Math.sin(frame / 9) * 1.5;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - c,
        top: y - c,
        width: size,
        height: size,
        transform: `scale(${s}) rotate(${rot}deg)`,
        filter: shadow ? `drop-shadow(${shadow})` : undefined,
      }}
    >
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <polygon points={pts.join(' ')} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `rotate(${-rot * 0.6}deg)`,
        }}
      >
        {children}
      </div>
    </div>
  );
};
