import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, pop, slam } from '../anim';
import { Background } from '../components/Background';
import { ImpactRing, SpeedLines } from '../components/Particles';
import { fitFontSize } from '../components/RichText';
import { StrokeText } from '../components/StrokeText';
import { sceneKeys } from '../events';
import type { SceneOf } from '../schema';
import { useScene } from '../SceneContext';
import { shade, useTheme } from '../theme';
import { FeatureVisual } from '../visuals/FeatureVisual';
import { SceneBubbles, SceneCaptions, SceneCharacters, Shake } from './common';

export const FeatureScene: React.FC<{ scene: SceneOf<'feature'> }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { timing } = useScene();
  const { layout, colors, fonts, project } = useTheme();
  const { u, portrait } = layout;
  const k = sceneKeys(timing, project);
  const bg = scene.background ?? 'burst-light';
  const dark = bg.endsWith('dark') || bg === 'gradient' || bg === 'burst';

  const box = layout.text;
  const ebFs = fitFontSize(scene.eyebrow, box.w, portrait ? 88 * u : 76 * u);
  const hlFs = fitFontSize(scene.headline, box.w, portrait ? 210 * u : 170 * u);
  const ebP = pop(frame, fps, k.eyebrowAt, 12, 170);
  const ebX = interpolate(ebP, [0, 1], [-60 * u, 0]);
  const hlP = slam(frame, fps, k.headAt);
  const hlScale = interpolate(hlP, [0, 1], [2.4, 1]);
  const hlBlur = interpolate(frame - k.headAt, [0, 5], [12, 0], clamp);
  const hlOpacity = interpolate(frame - k.headAt, [0, 2], [0, 1], clamp);
  const ebLines = scene.eyebrow.split('\n').length;
  const hlY = box.y + ebFs * 1.22 * ebLines + 12 * u;
  const hlCenterY = hlY + hlFs * 0.6;

  const headColor = dark ? shade(colors.primary, 0.55) : colors.dark;
  const textColor = dark ? '#fff' : colors.text;
  const footP = interpolate(frame, [k.headAt + 6, k.headAt + 12], [0, 1], clamp);

  const visTop = Math.max(layout.visual.y - (portrait ? 80 * u : 0), hlY + hlFs * 1.3 + (scene.footnote ? 50 * u : 10 * u));
  const visBottom = portrait ? layout.height - 470 * u : layout.visual.y + layout.visual.h;
  const visualBox = { ...layout.visual, y: visTop, h: Math.max(240 * u, visBottom - visTop) };

  return (
    <AbsoluteFill>
      <Background kind={bg} center={{ x: 0.5, y: hlCenterY / layout.height }} />
      <Shake at={[k.headAt]} strength={12}>
        <ImpactRing at={k.headAt} x={layout.width / 2} y={hlCenterY} color={dark ? '#fff' : colors.primary} maxR={420 * u} />
        <SpeedLines at={k.headAt} x={layout.width / 2} y={hlCenterY} color={dark ? '#fff' : colors.primary} />
        {frame >= k.eyebrowAt ? (
          <div style={{ position: 'absolute', left: box.x, width: box.w, top: box.y, transform: `translateX(${ebX}px)`, opacity: Math.min(1, ebP * 1.5) }}>
            <StrokeText
              text={scene.eyebrow}
              fontSize={ebFs}
              color={textColor}
              highlightColor={dark ? colors.accent : colors.primary}
              strokeColor={dark ? colors.dark : '#fff'}
              strokeWidth={8 * u}
              fontFamily={fonts.heading}
            />
          </div>
        ) : null}
        {frame >= k.headAt ? (
          <div
            style={{
              position: 'absolute',
              left: box.x,
              width: box.w,
              top: hlY,
              transform: `scale(${hlScale})`,
              filter: `blur(${hlBlur}px)`,
              opacity: hlOpacity,
            }}
          >
            <StrokeText
              text={scene.headline}
              fontSize={hlFs}
              color={headColor}
              highlightColor={dark ? colors.accent : colors.primary}
              strokeColor={dark ? colors.dark : '#fff'}
              strokeWidth={12 * u}
              fontFamily={fonts.heading}
              lineHeight={1.08}
              shadow={`0 ${10 * u}px 0 ${dark ? 'rgba(0,0,0,0.35)' : shade(colors.primary, 0.6)}`}
            />
          </div>
        ) : null}
        {scene.footnote ? (
          <div
            style={{
              position: 'absolute',
              left: box.x,
              width: box.w,
              top: hlY + hlFs * 1.18,
              textAlign: 'center',
              fontFamily: fonts.body,
              fontWeight: 500,
              fontSize: 26 * u,
              color: dark ? 'rgba(255,255,255,0.7)' : 'rgba(20,24,40,0.6)',
              opacity: footP,
            }}
          >
            {scene.footnote}
          </div>
        ) : null}
        <FeatureVisual visual={scene.visual} box={visualBox} startAt={k.visualAt} dark={dark} />
        <SceneCharacters />
        <SceneBubbles />
        <SceneCaptions />
      </Shake>
    </AbsoluteFill>
  );
};
