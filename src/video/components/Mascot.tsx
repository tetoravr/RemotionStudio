import React from 'react';
import type { Pose } from '../schema';
import { shade } from '../theme';
import { useSvgId } from './Background';

export type MascotShape = 'mochi' | 'cat' | 'bear' | 'bunny' | 'bird' | 'sushi';

export const MASCOT_VIEWBOX = { w: 440, h: 480 };

/**
 * コードで描く組み込みマスコット（画像素材がなくても動画が作れるように）。
 * 表情・手・口パク・まばたきはフレームから決定的に計算する。
 */
export const Mascot: React.FC<{
  shape: MascotShape;
  bodyColor: string;
  accentColor: string;
  outline: string;
  emblem?: string;
  emblemFont?: string;
  pose: Pose;
  /** 0〜1 口の開き */
  mouthOpen: number;
  frame: number;
  height: number;
}> = ({ shape, bodyColor, accentColor, outline, emblem, emblemFont, pose, mouthOpen, frame, height }) => {
  const id = useSvgId('mascot');
  const sw = 9;
  const blink = pose !== 'happy' && pose !== 'wink' && frame % 97 > 93;
  const wave = Math.sin(frame / 3.2) * 14;

  // 手の位置
  const hands: { l: [number, number, number]; r: [number, number, number] } = (() => {
    switch (pose) {
      case 'surprised':
        return { l: [52, 205, 0], r: [348, 205, 0] };
      case 'wave':
        return { l: [48, 305, 0], r: [362, 185 + wave * 0.3, wave] };
      case 'point':
        return { l: [48, 305, 0], r: [392, 262, 0] };
      case 'sad':
        return { l: [78, 345, 0], r: [322, 345, 0] };
      case 'think':
        return { l: [48, 305, 0], r: [338, 318, -20] };
      case 'happy':
        return { l: [40, 250 + wave * 0.4, 0], r: [360, 250 - wave * 0.4, 0] };
      default:
        return { l: [46, 302, 0], r: [354, 302, 0] };
    }
  })();

  const ear = (() => {
    const inner = shade(accentColor, 0.55);
    switch (shape) {
      case 'cat':
        return (
          <g stroke={outline} strokeWidth={sw} strokeLinejoin="round">
            <path d="M92 175 L108 62 L185 118 Z" fill={bodyColor} />
            <path d="M308 175 L292 62 L215 118 Z" fill={bodyColor} />
            <path d="M112 140 L117 95 L152 122 Z" fill={inner} strokeWidth={0} />
            <path d="M288 140 L283 95 L248 122 Z" fill={inner} strokeWidth={0} />
          </g>
        );
      case 'bear':
        return (
          <g stroke={outline} strokeWidth={sw}>
            <circle cx={100} cy={128} r={46} fill={bodyColor} />
            <circle cx={300} cy={128} r={46} fill={bodyColor} />
            <circle cx={100} cy={128} r={22} fill={inner} strokeWidth={0} />
            <circle cx={300} cy={128} r={22} fill={inner} strokeWidth={0} />
          </g>
        );
      case 'bunny':
        return (
          <g stroke={outline} strokeWidth={sw}>
            <ellipse cx={148} cy={62} rx={32} ry={82} fill={bodyColor} transform="rotate(-12 148 62)" />
            <ellipse cx={252} cy={62} rx={32} ry={82} fill={bodyColor} transform="rotate(12 252 62)" />
            <ellipse cx={148} cy={70} rx={14} ry={56} fill={inner} strokeWidth={0} transform="rotate(-12 148 70)" />
            <ellipse cx={252} cy={70} rx={14} ry={56} fill={inner} strokeWidth={0} transform="rotate(12 252 70)" />
          </g>
        );
      case 'bird':
        return (
          <g stroke={outline} strokeWidth={sw} strokeLinejoin="round" fill={accentColor}>
            <path d="M200 96 C180 50 190 30 205 22 C212 50 215 70 200 96 Z" />
            <path d="M200 96 C170 70 150 60 140 70 C160 80 175 92 200 96 Z" />
            <path d="M200 96 C230 70 250 60 262 72 C240 80 225 92 200 96 Z" />
          </g>
        );
      case 'sushi':
        return null;
      default:
        return (
          <g fill="none" stroke={outline} strokeWidth={sw} strokeLinecap="round">
            <path d="M188 98 C176 64 204 44 226 62" />
          </g>
        );
    }
  })();

  // にぎり寿司のネタ（サーモン）
  const topping =
    shape === 'sushi' ? (
      <g>
        <path
          d="M30 238 C24 140 108 70 200 70 C292 70 376 140 370 238 C336 206 272 190 200 194 C128 190 64 206 30 238 Z"
          fill="#ff8a5b"
          stroke={outline}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
        <g stroke="#fff" strokeWidth={11} strokeLinecap="round" fill="none" opacity={0.85}>
          <path d="M96 118 C112 146 118 170 114 196" />
          <path d="M160 88 C176 122 182 156 178 190" />
          <path d="M232 88 C246 122 250 156 244 190" />
          <path d="M300 116 C312 144 316 170 310 200" />
        </g>
        <ellipse cx={140} cy={104} rx={26} ry={10} fill="#fff" opacity={0.35} transform="rotate(-22 140 104)" />
      </g>
    ) : null;

  const eyeY = 238;
  const eye = (cx: number, side: 'l' | 'r') => {
    if (blink) return <path d={`M${cx - 18} ${eyeY + 4} Q${cx} ${eyeY + 14} ${cx + 18} ${eyeY + 4}`} stroke={outline} strokeWidth={9} fill="none" strokeLinecap="round" />;
    if (pose === 'happy' || pose === 'point' || (pose === 'wave' && side === 'r'))
      return <path d={`M${cx - 20} ${eyeY + 8} Q${cx} ${eyeY - 18} ${cx + 20} ${eyeY + 8}`} stroke={outline} strokeWidth={10} fill="none" strokeLinecap="round" />;
    if (pose === 'wink' && side === 'r')
      return <path d={`M${cx + 16} ${eyeY - 14} L${cx - 14} ${eyeY} L${cx + 16} ${eyeY + 14}`} stroke={outline} strokeWidth={10} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    const big = pose === 'surprised';
    const rx = big ? 19 : 16;
    const ry = big ? 27 : 23;
    const look = pose === 'think' ? { x: 5, y: -7 } : { x: 0, y: 0 };
    return (
      <g>
        <ellipse cx={cx + look.x} cy={eyeY + look.y} rx={rx} ry={ry} fill={outline} />
        <circle cx={cx + look.x + 5} cy={eyeY + look.y - 9} r={big ? 8 : 6.5} fill="#fff" />
        <circle cx={cx + look.x - 5} cy={eyeY + look.y + 8} r={3} fill="#fff" opacity={0.8} />
      </g>
    );
  };

  const mouthY = 292;
  const mouth = (() => {
    if (shape === 'bird') {
      const o = 6 + mouthOpen * 16;
      return (
        <g stroke={outline} strokeWidth={6} strokeLinejoin="round" fill="#ffab2e">
          <path d={`M178 ${mouthY - 12} L222 ${mouthY - 12} L200 ${mouthY + 4} Z`} />
          <path d={`M182 ${mouthY - 4} L218 ${mouthY - 4} L200 ${mouthY + o} Z`} />
        </g>
      );
    }
    if (mouthOpen > 0.15 || pose === 'surprised') {
      const o = pose === 'surprised' && mouthOpen < 0.15 ? 0.6 : mouthOpen;
      const w = pose === 'surprised' ? 14 : 22;
      const h = 8 + o * 20;
      return (
        <g>
          <ellipse cx={200} cy={mouthY + h * 0.4} rx={w} ry={h} fill="#7a1f2b" stroke={outline} strokeWidth={6} />
          <ellipse cx={200} cy={mouthY + h * 0.9} rx={w * 0.6} ry={h * 0.4} fill="#ff7b8f" />
        </g>
      );
    }
    if (pose === 'sad') return <path d={`M182 ${mouthY + 10} Q200 ${mouthY - 6} 218 ${mouthY + 10}`} stroke={outline} strokeWidth={7} fill="none" strokeLinecap="round" />;
    if (pose === 'think') return <path d={`M188 ${mouthY + 4} L212 ${mouthY + 2}`} stroke={outline} strokeWidth={7} strokeLinecap="round" />;
    // ω口
    return (
      <path
        d={`M176 ${mouthY} Q188 ${mouthY + 16} 200 ${mouthY + 2} Q212 ${mouthY + 16} 224 ${mouthY}`}
        stroke={outline}
        strokeWidth={7}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  })();

  const hand = ([x, y, rot]: [number, number, number], key: string) => (
    <g key={key} transform={`rotate(${rot} ${x} ${y})`}>
      <ellipse cx={x} cy={y} rx={40} ry={36} fill={accentColor} stroke={outline} strokeWidth={sw} />
      <ellipse cx={x - 10} cy={y - 12} rx={12} ry={7} fill="#fff" opacity={0.35} />
    </g>
  );

  const width = (height * MASCOT_VIEWBOX.w) / MASCOT_VIEWBOX.h;
  return (
    <svg width={width} height={height} viewBox="-20 -20 440 480" style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <radialGradient id={`${id}-body`} cx="38%" cy="30%" r="80%">
          <stop offset="0" stopColor={shade(bodyColor, 0.5)} />
          <stop offset="0.6" stopColor={bodyColor} />
          <stop offset="1" stopColor={shade(bodyColor, -0.12)} />
        </radialGradient>
      </defs>
      {/* 足 */}
      <ellipse cx={142} cy={414} rx={44} ry={24} fill={accentColor} stroke={outline} strokeWidth={sw} />
      <ellipse cx={258} cy={414} rx={44} ry={24} fill={accentColor} stroke={outline} strokeWidth={sw} />
      {ear}
      {/* 胴体 */}
      <path
        d="M200 92 C318 92 372 196 372 292 C372 382 304 420 200 420 C96 420 28 382 28 292 C28 196 82 92 200 92 Z"
        fill={`url(#${id}-body)`}
        stroke={outline}
        strokeWidth={sw}
      />
      {shape === 'sushi' ? null : <ellipse cx={140} cy={150} rx={34} ry={18} fill="#fff" opacity={0.55} transform="rotate(-28 140 150)" />}
      {topping}
      {/* ほっぺ */}
      <ellipse cx={122} cy={286} rx={27} ry={15} fill="#ff8fa3" opacity={0.55} />
      <ellipse cx={278} cy={286} rx={27} ry={15} fill="#ff8fa3" opacity={0.55} />
      {eye(158, 'l')}
      {eye(242, 'r')}
      {pose === 'sad' ? (
        <g stroke={outline} strokeWidth={6} strokeLinecap="round">
          <path d="M136 198 L176 186" />
          <path d="M264 198 L224 186" />
        </g>
      ) : null}
      {mouth}
      {emblem ? (
        <text
          x={200}
          y={385}
          textAnchor="middle"
          fontFamily={emblemFont}
          fontWeight={900}
          fontSize={62}
          fill={accentColor}
          stroke="#fff"
          strokeWidth={4}
          paintOrder="stroke"
        >
          {emblem.slice(0, 2)}
        </text>
      ) : null}
      {hand(hands.l, 'l')}
      {hand(hands.r, 'r')}
    </svg>
  );
};
