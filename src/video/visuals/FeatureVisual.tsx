import React from 'react';
import { Img, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { bob, clamp, pop } from '../anim';
import { Icon } from '../components/Icon';
import { pickImages } from '../components/Character';
import { CoinRain, ConfettiBurst, Sparkles } from '../components/Particles';
import type { Box } from '../theme';
import type { IconName, Visual } from '../schema';
import { shade, useTheme } from '../theme';
import { visualTimes } from './timing';

const IconTile: React.FC<{ icon: IconName; size: number; p: number; muted?: boolean; badge?: 'check' | 'x' | null; badgeP?: number }> = ({
  icon,
  size,
  p,
  muted,
  badge,
  badgeP = 1,
}) => {
  const { colors, layout } = useTheme();
  const { u } = layout;
  const main = muted ? '#9aa0b4' : colors.primary;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: '#fff',
        border: `${7 * u}px solid ${muted ? '#9aa0b4' : colors.dark}`,
        boxShadow: `0 ${10 * u}px 0 ${muted ? 'rgba(0,0,0,0.12)' : shade(colors.primary, -0.25) + '55'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${Math.max(0, p)})`,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <Icon name={icon} size={size * 0.58} color={main} strokeWidth={2.3} />
      {badge ? (
        <div
          style={{
            position: 'absolute',
            right: -size * 0.14,
            top: -size * 0.14,
            width: size * 0.42,
            height: size * 0.42,
            borderRadius: '50%',
            background: badge === 'check' ? colors.primary : '#ff4d5e',
            border: `${6 * u}px solid #fff`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${Math.max(0, badgeP)})`,
            boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
          }}
        >
          <Icon name={badge === 'check' ? 'check' : 'x'} size={size * 0.26} color="#fff" strokeWidth={4} />
        </div>
      ) : null}
    </div>
  );
};

const Label: React.FC<{ text: string; dark?: boolean; size: number; p?: number }> = ({ text, dark, size, p = 1 }) => {
  const { fonts, colors } = useTheme();
  return (
    <div
      style={{
        fontFamily: fonts.heading,
        fontWeight: 900,
        fontSize: size,
        color: dark ? '#fff' : colors.text,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        opacity: p,
        transform: `translateY(${(1 - p) * 10}px)`,
      }}
    >
      {text}
    </div>
  );
};

export const FeatureVisual: React.FC<{ visual: Visual; box: Box; startAt: number; payoffAt?: number; dark?: boolean }> = ({ visual, box, startAt, payoffAt, dark }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { colors, layout, project, resolveAsset } = theme;
  const { u } = layout;
  const { P, checkStart, runStart, runDur } = visualTimes(visual, startAt, payoffAt ?? startAt + 20);

  const wrap = (children: React.ReactNode) => (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}>{children}</div>
  );

  switch (visual.kind) {
    case 'flow': {
      const size = Math.min(box.h * 0.55, box.w * 0.34);
      const pA = pop(frame, fps, startAt, 11, 170);
      const pB = pop(frame, fps, startAt + 5, 11, 170);
      const line = interpolate(frame, [startAt + 9, Math.max(startAt + 17, P - 2)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
      const bolt = pop(frame, fps, P - 4, 8, 220);
      const check = pop(frame, fps, P + 2, 9, 220);
      const gap = box.w - size * 2;
      return (
        <>
          {wrap(
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 * u, width: size }}>
                <IconTile icon={visual.from} size={size} p={pA} badge="check" badgeP={check} />
                {visual.fromLabel ? <Label text={visual.fromLabel} dark={dark} size={40 * u} p={Math.min(1, pA)} /> : null}
              </div>
              <div style={{ width: gap, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: gap * 0.1,
                    width: gap * 0.8 * line,
                    top: size / 2 - 5 * u,
                    height: 10 * u,
                    borderRadius: 10 * u,
                    background: `repeating-linear-gradient(90deg, ${colors.primary} 0 ${22 * u}px, transparent ${22 * u}px ${36 * u}px)`,
                  }}
                />
                <div style={{ transform: `scale(${Math.max(0, bolt)}) rotate(${Math.sin(frame / 3) * 6}deg)`, position: 'relative' }}>
                  <Icon name="bolt" size={size * 0.62} color={colors.accent} fill={colors.accent} strokeWidth={1.6} style={{ filter: `drop-shadow(0 0 ${3 * u}px ${colors.dark}) drop-shadow(0 0 ${2 * u}px ${colors.dark})` }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 * u, width: size }}>
                <IconTile icon={visual.to} size={size} p={pB} />
                {visual.toLabel ? <Label text={visual.toLabel} dark={dark} size={40 * u} p={Math.min(1, pB)} /> : null}
              </div>
            </div>,
          )}
          {visual.effect === 'coins' ? <CoinRain from={P} count={16} area={{ x: box.x - 40 * u, w: box.w + 80 * u }} /> : null}
          {visual.effect === 'confetti' ? <ConfettiBurst at={P + 2} x={box.x + box.w - size / 2} y={box.y + box.h / 2} /> : null}
          {visual.effect === 'sparkles' ? <Sparkles from={P} box={box} count={12} /> : null}
        </>
      );
    }
    case 'stack': {
      const n = visual.count;
      const size = Math.min(box.h * 0.36, box.w * 0.3);
      return wrap(
        <>
          {Array.from({ length: n }).map((_, i) => {
            const land = startAt + i * 5;
            const drop = interpolate(frame, [land, land + 7], [-box.h * 1.2, 0], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
            const check = pop(frame, fps, checkStart + i * 3, 9, 240);
            const y = box.h - size - i * size * 0.34;
            const x = box.w / 2 - size * 0.9 + (i % 2 ? 12 : -12) * u;
            if (frame < land) return null;
            return (
              <div key={i} style={{ position: 'absolute', left: x, top: y + drop, transform: `rotate(${i % 2 ? 3 : -4}deg)` }}>
                <div
                  style={{
                    width: size * 1.8,
                    height: size * 0.62,
                    borderRadius: 18 * u,
                    background: '#fff',
                    border: `${6 * u}px solid ${colors.dark}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16 * u,
                    padding: `0 ${20 * u}px`,
                    boxSizing: 'border-box',
                    boxShadow: `0 ${6 * u}px 0 rgba(0,0,0,0.12)`,
                  }}
                >
                  <Icon name={visual.icon} size={size * 0.38} color={colors.primary} strokeWidth={2.4} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9 * u }}>
                    <div style={{ height: 10 * u, borderRadius: 6 * u, background: '#d9deea', width: '90%' }} />
                    <div style={{ height: 10 * u, borderRadius: 6 * u, background: '#d9deea', width: '60%' }} />
                  </div>
                  <div
                    style={{
                      width: size * 0.4,
                      height: size * 0.4,
                      borderRadius: '50%',
                      background: colors.primary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transform: `scale(${Math.max(0, check)})`,
                    }}
                  >
                    <Icon name="check" size={size * 0.28} color="#fff" strokeWidth={4} />
                  </div>
                </div>
              </div>
            );
          })}
          <Sparkles from={checkStart + n * 3} box={{ x: box.x, y: box.y, w: box.w, h: box.h }} count={8} />
        </>,
      );
    }
    case 'jump': {
      const roadY = box.h * 0.72;
      const barrierX = box.w * 0.48;
      const goalSize = Math.min(box.h * 0.42, box.w * 0.26);
      const rh = box.h * 0.3;
      const x = interpolate(frame, [runStart, runStart + runDur], [box.w * 0.08, box.w - goalSize * 1.3], { ...clamp, easing: Easing.inOut(Easing.quad) });
      const jumpP = interpolate(x, [barrierX - box.w * 0.2, barrierX + box.w * 0.2], [0, 1], clamp);
      const y = -Math.sin(jumpP * Math.PI) * box.h * 0.5;
      const landed = frame > runStart + runDur;
      // 走る役は相方（2人目）。表情もジャンプ中は驚き、着地で喜びに切り替える
      const runner = project.cast[1] ?? project.cast[0];
      const runnerPose = jumpP > 0 && jumpP < 1 ? 'surprised' : landed ? 'happy' : 'default';
      const runnerImg = runner ? pickImages(runner, runnerPose)?.closed : undefined;
      const gateP = pop(frame, fps, startAt, 12, 160);
      const goalP = pop(frame, fps, startAt + 3, 12, 160);
      return (
        <>
          {wrap(
            <>
              <div style={{ position: 'absolute', left: 0, right: 0, top: roadY, height: 26 * u, borderRadius: 20 * u, background: colors.primary }} />
              <div
                style={{
                  position: 'absolute',
                  left: box.w * 0.04,
                  right: box.w * 0.04,
                  top: roadY + 9 * u,
                  height: 8 * u,
                  background: `repeating-linear-gradient(90deg, #fff 0 ${26 * u}px, transparent ${26 * u}px ${46 * u}px)`,
                }}
              />
              <div style={{ position: 'absolute', left: barrierX - 90 * u, top: roadY - 150 * u, width: 180 * u, transform: `scale(${Math.max(0, gateP)})`, transformOrigin: '50% 100%' }}>
                <Label text={visual.obstacleLabel} dark={dark} size={34 * u} />
                <div
                  style={{
                    marginTop: 8 * u,
                    height: 34 * u,
                    borderRadius: 8 * u,
                    border: `${5 * u}px solid ${colors.dark}`,
                    background: `repeating-linear-gradient(-45deg, #fff 0 ${16 * u}px, #ff4d5e ${16 * u}px ${32 * u}px)`,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: `0 ${14 * u}px` }}>
                  <div style={{ width: 12 * u, height: 70 * u, background: colors.dark }} />
                  <div style={{ width: 12 * u, height: 70 * u, background: colors.dark }} />
                </div>
              </div>
              <div style={{ position: 'absolute', right: 0, top: roadY - goalSize - 4 * u }}>
                <IconTile icon={visual.goal} size={goalSize} p={goalP} badge={landed ? 'check' : null} badgeP={pop(frame, fps, runStart + runDur + 1, 9, 220)} />
              </div>
              <div style={{ position: 'absolute', left: x - rh * 0.45, top: roadY - rh + y + 4 * u, transform: `rotate(${Math.sin(jumpP * Math.PI) * -12}deg)` }}>
                {runnerImg ? <Img src={resolveAsset(runnerImg)!} style={{ height: rh, width: 'auto', display: 'block' }} /> : null}
              </div>
            </>,
          )}
          <ConfettiBurst at={runStart + runDur + 1} x={box.x + box.w - goalSize / 2} y={box.y + roadY - goalSize / 2} count={24} />
        </>
      );
    }
    case 'counter': {
      const p = interpolate(frame, [startAt + 2, Math.max(startAt + 14, P + 6)], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
      const v = visual.from + (visual.to - visual.from) * p;
      const d = visual.decimals ?? 0;
      const num = v.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
      const size = Math.min(box.w, box.h) * 0.95;
      const ringP = pop(frame, fps, startAt, 12, 150);
      const R = size * 0.44;
      const C = 2 * Math.PI * R;
      const landed = pop(frame, fps, P + 6, 8, 260);
      return wrap(
        <div style={{ position: 'absolute', left: box.w / 2 - size / 2, top: box.h / 2 - size / 2, width: size, height: size, transform: `scale(${Math.max(0, ringP)})` }}>
          <svg width={size} height={size} style={{ position: 'absolute', inset: 0 }}>
            <circle cx={size / 2} cy={size / 2} r={R} fill="#fff" stroke={shade(colors.light, -0.05)} strokeWidth={size * 0.06} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={R}
              fill="none"
              stroke={colors.primary}
              strokeWidth={size * 0.06}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - p)}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: theme.fonts.heading,
              color: colors.text,
            }}
          >
            {visual.caption ? <div style={{ fontWeight: 900, fontSize: size * 0.08, marginBottom: size * 0.01 }}>{visual.caption}</div> : null}
            <div style={{ fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', transform: `scale(${1 + (1 - Math.min(1, landed)) * 0.15 * (frame > P + 6 ? 1 : 0)})` }}>
              {visual.prefix ? <span style={{ fontSize: size * 0.12 }}>{visual.prefix}</span> : null}
              <span style={{ fontSize: size * 0.26, color: colors.primary, letterSpacing: '-0.02em' }}>{num}</span>
              {visual.suffix ? <span style={{ fontSize: size * 0.12 }}>{visual.suffix}</span> : null}
            </div>
          </div>
        </div>,
      );
    }
    case 'icons': {
      const n = visual.items.length;
      const size = Math.min(box.h * 0.5, (box.w / n) * 0.78);
      return wrap(
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-evenly' }}>
          {visual.items.map((it, i) => {
            const p = pop(frame, fps, startAt + i * 5, 10, 180) * (1 + 0.12 * Math.sin(Math.PI * Math.min(1, Math.max(0, (frame - P - i * 2) / 8))));
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 * u, transform: `translateY(${bob(frame, fps, 6 * u, 1, i)}px)` }}>
                <IconTile icon={it.icon} size={size} p={p} />
                <Label text={it.label} dark={dark} size={Math.min(42 * u, (box.w / n) / Math.max(3, it.label.length) * 0.95)} p={Math.min(1, Math.max(0, p))} />
              </div>
            );
          })}
        </div>,
      );
    }
    case 'compare': {
      const size = Math.min(box.h * 0.5, box.w * 0.3);
      const pA = pop(frame, fps, startAt, 11, 170);
      const pArrow = pop(frame, fps, startAt + 7, 11, 200);
      const pB = pop(frame, fps, P, 10, 180);
      return wrap(
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 * u, width: size * 1.2 }}>
            <IconTile icon={visual.before.icon} size={size * 0.85} p={pA} muted badge="x" badgeP={pA} />
            <Label text={visual.before.label} dark={dark} size={36 * u} p={Math.min(1, pA)} />
          </div>
          <div style={{ transform: `scale(${Math.max(0, pArrow)}) translateX(${Math.sin(frame / 4) * 6 * u}px)` }}>
            <svg width={size * 0.6} height={size * 0.5} viewBox="0 0 60 50">
              <path d="M4 17 H34 V4 L58 25 L34 46 V33 H4 Z" fill={colors.accent} stroke={colors.dark} strokeWidth={4} strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 * u, width: size * 1.2 }}>
            <IconTile icon={visual.after.icon} size={size} p={pB} badge="check" badgeP={pop(frame, fps, P + 6, 9, 220)} />
            <Label text={visual.after.label} dark={dark} size={40 * u} p={Math.min(1, pB)} />
          </div>
        </div>,
      );
    }
    case 'image': {
      const p = pop(frame, fps, startAt, 12, 150);
      const src = resolveAsset(visual.src);
      if (!src) return null;
      return wrap(
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${Math.max(0, p)}) translateY(${bob(frame, fps, 8 * u)}px)` }}>
          <Img src={src} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', filter: 'drop-shadow(0 12px 20px rgba(0,0,0,0.2))' }} />
        </div>,
      );
    }
    default:
      return null;
  }
};
