import React from 'react';
import { Editable } from '../edit/Editable';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, pop, slam } from '../anim';
import { Background } from '../components/Background';
import { Sparkles } from '../components/Particles';
import { fitFontSize } from '../components/RichText';
import { sceneKeys } from '../events';
import type { SceneOf } from '../schema';
import { useScene } from '../SceneContext';
import { shade, useTheme } from '../theme';
import { SceneBubbles, SceneCaptions, SceneCharacters } from './common';

export const CtaScene: React.FC<{ scene: SceneOf<'cta'> }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { timing } = useScene();
  const { layout, colors, fonts, brand, project, resolveAsset } = useTheme();
  const { u, width: W, portrait } = layout;
  const k = sceneKeys(timing, project);
  const bg = scene.background ?? 'stripes';
  const dark = bg.endsWith('dark') || bg === 'gradient' || bg === 'burst';
  const logoText = scene.logoText || brand.name;

  const logoAt = Math.min(k.logoAt, k.enterOffset + 4);
  const logoP = slam(frame, fps, logoAt);
  const logoScale = interpolate(logoP, [0, 1], [1.8, 1]);
  const logoFs = fitFontSize(logoText, W - layout.safe * 2.5, portrait ? 150 * u : 120 * u, 20, true);
  const top = portrait ? 380 * u : layout.format === 'square' ? 110 * u : 90 * u;

  const btnP = pop(frame, fps, logoAt + 8, 10, 170);
  const pulse = 1 + Math.max(0, Math.sin((frame - logoAt) / 6)) * 0.035;
  const btnFs = fitFontSize(scene.buttonText, W * 0.72, portrait ? 56 * u : 48 * u);
  const contactP = interpolate(frame, [logoAt + 14, logoAt + 22], [0, 1], clamp);
  const notesP = interpolate(frame, [logoAt + 20, logoAt + 28], [0, 1], clamp);
  const shine = interpolate((frame - logoAt - 16) % 60, [0, 18], [-0.3, 1.3], clamp);

  return (
    <AbsoluteFill>
      <Background kind={bg} />
      <Editable id="fx">
        <Sparkles from={logoAt + 6} count={12} box={{ x: 0, y: top - 80 * u, w: W, h: 700 * u }} color={dark ? '#fff' : colors.primary} />
      </Editable>
      <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 * u }}>
        <Editable id="logo" mode="flow" text={brand.logo ? undefined : { target: { type: 'field', field: 'logoText' }, value: logoText }}>
        <div style={{ transform: `scale(${logoScale})`, opacity: interpolate(frame - logoAt, [0, 3], [0, 1], clamp) }}>
          {brand.logo ? (
            <Img src={resolveAsset(brand.logo)!} style={{ maxWidth: W * 0.7, maxHeight: 240 * u, objectFit: 'contain' }} />
          ) : (
            <div style={{ fontFamily: fonts.logo, fontSize: logoFs, color: dark ? '#fff' : colors.dark, transform: 'skewX(-10deg)', lineHeight: 1.05, whiteSpace: 'pre', textAlign: 'center' }}>
              {logoText}
            </div>
          )}
        </div>
        </Editable>
        <Editable id="button" mode="flow" text={{ target: { type: 'field', field: 'buttonText' }, value: scene.buttonText }}>
        <div
          style={{
            transform: `scale(${Math.max(0, btnP) * pulse})`,
            background: colors.primary,
            color: '#fff',
            fontFamily: fonts.heading,
            fontWeight: 900,
            fontSize: btnFs,
            padding: `${btnFs * 0.42}px ${btnFs * 1.1}px`,
            borderRadius: 999,
            boxShadow: `0 ${10 * u}px 0 ${shade(colors.primary, -0.35)}`,
            position: 'relative',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {scene.buttonText}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: '30%',
              left: `${shine * 100}%`,
              background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent)',
              transform: 'skewX(-20deg)',
            }}
          />
        </div>
        </Editable>
        {scene.contact ? (
          <Editable id="contact" mode="flow" text={{ target: { type: 'field', field: 'contact' }, value: scene.contact }}>
          <div
            style={{
              fontFamily: fonts.heading,
              fontWeight: 900,
              fontSize: fitFontSize(scene.contact, W * 0.86, portrait ? 64 * u : 54 * u),
              color: dark ? '#fff' : colors.text,
              opacity: contactP,
              transform: `translateY(${(1 - contactP) * 20 * u}px)`,
            }}
          >
            {scene.contact}
          </div>
          </Editable>
        ) : null}
        <div style={{ opacity: notesP, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 * u }}>
          {scene.notes.map((n, i) => (
            <Editable key={i} id={`note:${i}`} mode="flow" text={{ target: { type: 'notes', index: i }, value: n }}>
              <div style={{ fontFamily: fonts.body, fontWeight: 500, fontSize: (i === 0 ? 28 : 22) * u, color: dark ? 'rgba(255,255,255,0.75)' : 'rgba(20,24,40,0.6)' }}>{n}</div>
            </Editable>
          ))}
        </div>
      </div>
      <SceneCharacters />
      <SceneBubbles />
      <SceneCaptions />
    </AbsoluteFill>
  );
};
