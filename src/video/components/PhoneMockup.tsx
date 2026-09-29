import React from 'react';
import { Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, pop } from '../anim';
import type { MockupUi } from '../schema';
import { shade, useTheme } from '../theme';
import { RichText } from './RichText';

/** スマホ枠。中身は画像（スクショ）か、データから組み立てるUIモック */
export const PhoneMockup: React.FC<{ width: number; screenshot?: string; ui?: MockupUi; startAt: number }> = ({ width, screenshot, ui, startAt }) => {
  const { colors, resolveAsset } = useTheme();
  const h = width * 2.04;
  const bezel = width * 0.035;
  return (
    <div
      style={{
        width,
        height: h,
        borderRadius: width * 0.14,
        background: '#15161c',
        padding: bezel,
        boxSizing: 'border-box',
        boxShadow: `0 ${width * 0.05}px ${width * 0.1}px rgba(0,0,0,0.28), inset 0 0 0 ${width * 0.008}px #3a3d48`,
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: width * 0.11,
          overflow: 'hidden',
          background: '#fff',
          position: 'relative',
        }}
      >
        {screenshot ? (
          <Img src={resolveAsset(screenshot)!} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
        ) : ui ? (
          <UiScreen ui={ui} width={width - bezel * 2} startAt={startAt} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: `linear-gradient(160deg, ${colors.light}, #fff)` }} />
        )}
        <div
          style={{
            position: 'absolute',
            top: width * 0.03,
            left: '50%',
            transform: 'translateX(-50%)',
            width: width * 0.3,
            height: width * 0.085,
            borderRadius: width * 0.05,
            background: '#15161c',
          }}
        />
      </div>
    </div>
  );
};

const UiScreen: React.FC<{ ui: MockupUi; width: number; startAt: number }> = ({ ui, width, startAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { colors, fonts } = useTheme();
  const k = width / 400; // 400px幅基準のUI
  const t = frame - startAt;
  const btnP = pop(frame, fps, startAt + 12 + ui.items.length * 4, 12, 160);
  const tap = t - (22 + ui.items.length * 4);
  const tapR = interpolate(tap, [0, 14], [0, 60 * k], clamp);
  const tapO = interpolate(tap, [0, 14], [0.5, 0], clamp);
  const pressed = tap >= 0 && tap < 5;
  return (
    <div style={{ width: '100%', height: '100%', fontFamily: fonts.body, color: colors.text, position: 'relative', background: '#f6f7fb' }}>
      <div style={{ height: 44 * k, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: `0 ${26 * k}px ${4 * k}px`, fontSize: 15 * k, fontWeight: 700 }}>
        <span>9:41</span>
        <span style={{ display: 'flex', gap: 3 * k, alignItems: 'flex-end', paddingBottom: 3 * k }}>
          {[6, 9, 12, 15].map((bh) => (
            <span key={bh} style={{ width: 4 * k, height: bh * k, background: colors.text, borderRadius: 1 * k }} />
          ))}
          <span style={{ width: 24 * k, height: 12 * k, border: `${1.5 * k}px solid ${colors.text}`, borderRadius: 3 * k, marginLeft: 5 * k, boxSizing: 'border-box', padding: 1.5 * k }}>
            <span style={{ display: 'block', width: '75%', height: '100%', background: colors.text, borderRadius: 1 * k }} />
          </span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 * k, padding: `${10 * k}px ${20 * k}px`, background: '#fff', borderBottom: `1px solid #e6e8ef` }}>
        <div style={{ width: 30 * k, height: 30 * k, borderRadius: 8 * k, background: colors.primary }} />
        <div style={{ fontWeight: 900, fontSize: 18 * k }}>{ui.appName}</div>
      </div>
      <div style={{ padding: `${16 * k}px ${18 * k}px 0` }}>
        <div style={{ fontWeight: 900, fontSize: 21 * k, marginBottom: 12 * k }}>
          <RichText text={ui.heading} highlightColor={colors.primary} />
        </div>
        {ui.items.map((it, i) => {
          const p = interpolate(t, [6 + i * 4, 14 + i * 4], [0, 1], clamp);
          return (
            <div
              key={i}
              style={{
                background: '#fff',
                borderRadius: 12 * k,
                padding: `${13 * k}px ${14 * k}px`,
                marginBottom: 9 * k,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 2px 6px rgba(20,30,60,0.06)',
                fontSize: 15 * k,
                opacity: p,
                transform: `translateY(${(1 - p) * 20 * k}px)`,
              }}
            >
              <span style={{ fontWeight: 700, color: shade(colors.text, 0.25) }}>{it.label}</span>
              <span style={{ fontWeight: 900 }}>{it.value}</span>
            </div>
          );
        })}
        {ui.total ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: `${10 * k}px ${4 * k}px`,
              borderTop: `2px dashed #d7dbe6`,
              marginTop: 6 * k,
              opacity: interpolate(t, [10 + ui.items.length * 4, 18 + ui.items.length * 4], [0, 1], clamp),
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15 * k }}>{ui.total.label}</span>
            <span style={{ fontWeight: 900, fontSize: 26 * k, color: colors.primary }}>{ui.total.value}</span>
          </div>
        ) : null}
      </div>
      <div style={{ position: 'absolute', left: 18 * k, right: 18 * k, bottom: 34 * k }}>
        <div
          style={{
            background: pressed ? shade(colors.primary, -0.15) : colors.primary,
            color: '#fff',
            textAlign: 'center',
            fontWeight: 900,
            fontSize: 18 * k,
            padding: `${16 * k}px 0`,
            borderRadius: 999,
            transform: `scale(${btnP * (pressed ? 0.95 : 1)})`,
            boxShadow: `0 ${6 * k}px ${14 * k}px ${shade(colors.primary, -0.2)}55`,
            position: 'relative',
            overflow: 'visible',
          }}
        >
          {ui.button}
          {tap >= 0 ? (
            <div
              style={{
                position: 'absolute',
                left: '72%',
                top: '50%',
                width: tapR * 2,
                height: tapR * 2,
                marginLeft: -tapR,
                marginTop: -tapR,
                borderRadius: '50%',
                background: '#fff',
                opacity: tapO,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
