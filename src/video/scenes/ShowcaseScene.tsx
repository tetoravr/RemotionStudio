import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { bob, clamp, pop } from '../anim';
import { Background } from '../components/Background';
import { PhoneMockup } from '../components/PhoneMockup';
import { fitFontSize } from '../components/RichText';
import { StrokeText } from '../components/StrokeText';
import { sceneKeys } from '../events';
import type { SceneOf } from '../schema';
import { useScene } from '../SceneContext';
import { useTheme } from '../theme';
import { SceneBubbles, SceneCaptions, SceneCharacters } from './common';

export const ShowcaseScene: React.FC<{ scene: SceneOf<'showcase'> }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { timing } = useScene();
  const { layout, colors, fonts, project } = useTheme();
  const { u, width: W, height: H, portrait } = layout;
  const k = sceneKeys(timing, project);
  const bg = scene.background ?? 'stripes';
  const dark = bg.endsWith('dark') || bg === 'gradient' || bg === 'burst';

  const titleP = pop(frame, fps, k.enterOffset + 2, 12, 170);
  const titleFs = fitFontSize(scene.title, layout.text.w, portrait ? 80 * u : 64 * u);
  const titleTop = portrait ? 110 * u : 50 * u;
  const titleH = scene.title.split('\n').length * titleFs * 1.2;

  const phoneW = portrait ? 540 * u : layout.format === 'square' ? 300 * u : 330 * u;
  const phoneH = phoneW * 2.04;
  const phoneTop = portrait ? titleTop + titleH + 90 * u : titleTop + titleH + 40 * u;
  const enter = spring({ frame: frame - k.visualAt, fps, config: { damping: 14, stiffness: 120 } });
  const phoneY = interpolate(enter, [0, 1], [H * 0.8, 0]);
  const phoneRot = interpolate(enter, [0, 1], [-18, -5]) + Math.sin(frame / 20) * 0.8;
  const phoneX = portrait ? W * 0.42 : W * 0.5;
  const noteP = interpolate(frame, [k.enterOffset + 8, k.enterOffset + 14], [0, 1], clamp);

  return (
    <AbsoluteFill>
      <Background kind={bg} />
      <div style={{ position: 'absolute', left: layout.text.x, width: layout.text.w, top: titleTop, transform: `scale(${titleP})` }}>
        <StrokeText
          text={scene.title}
          fontSize={titleFs}
          color={dark ? '#fff' : colors.text}
          highlightColor={dark ? colors.accent : colors.primary}
          strokeColor={dark ? colors.dark : '#fff'}
          strokeWidth={9 * u}
          fontFamily={fonts.heading}
        />
      </div>
      {scene.note ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: titleTop + titleH + 12 * u,
            textAlign: 'center',
            fontFamily: fonts.body,
            fontWeight: 500,
            fontSize: 24 * u,
            color: dark ? 'rgba(255,255,255,0.7)' : 'rgba(20,24,40,0.55)',
            opacity: noteP,
          }}
        >
          {scene.note}
        </div>
      ) : null}
      {frame >= k.visualAt ? (
        <div
          style={{
            position: 'absolute',
            left: phoneX - phoneW / 2,
            top: phoneTop + phoneY + bob(frame, fps, 8 * u, 0.8),
            transform: `rotate(${phoneRot}deg)`,
            width: phoneW,
            height: phoneH,
          }}
        >
          <PhoneMockup width={phoneW} screenshot={scene.screenshot} ui={scene.mockup} startAt={k.visualAt + 8} />
        </div>
      ) : null}
      <SceneCharacters />
      <SceneBubbles />
      <SceneCaptions />
    </AbsoluteFill>
  );
};
