import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, slam } from '../anim';
import { Background } from '../components/Background';
import { ConfettiBurst, SpeedLines } from '../components/Particles';
import { fitFontSize } from '../components/RichText';
import { Starburst } from '../components/Starburst';
import { StrokeText } from '../components/StrokeText';
import { Ticker } from '../components/Ticker';
import { sceneKeys } from '../events';
import type { SceneOf } from '../schema';
import { useScene } from '../SceneContext';
import { useTheme } from '../theme';
import { SceneBubbles, SceneCaptions, SceneCharacters, Shake } from './common';

export const LogoScene: React.FC<{ scene: SceneOf<'logo'> }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { timing } = useScene();
  const { layout, colors, fonts, brand, project, resolveAsset } = useTheme();
  const { u, width: W, height: H, portrait } = layout;
  const k = sceneKeys(timing, project);
  const logoText = scene.logoText || brand.name;

  const square = layout.format === 'square';
  const burstY = portrait ? 500 * u : square ? 235 * u : 300 * u;
  const radius = portrait ? 330 * u : square ? 195 * u : 230 * u;
  const burstP = slam(frame, fps, k.logoAt - 2);
  const logoP = slam(frame, fps, k.logoAt);
  const logoScale = interpolate(logoP, [0, 1], [2.6, 1]);
  const logoBlur = interpolate(frame - k.logoAt, [0, 5], [14, 0], clamp);
  const logoOpacity = interpolate(frame - k.logoAt, [0, 2], [0, 1], clamp);
  const logoFs = Math.min(fitFontSize(logoText, radius * 1.95, 160 * u, 20, true), (radius * 1.25) / logoText.split('\n').length);

  const subAt = k.logoAt + 10;
  const subReveal = scene.subtitle ? interpolate(frame, [subAt, subAt + Math.max(8, scene.subtitle.length * 1.3)], [0, 1], clamp) : 0;
  const subFs = portrait ? 66 * u : square ? 46 * u : 52 * u;
  const tickerY = portrait ? 1180 * u : square ? 860 * u : 880 * u;

  const logoLayer = brand.logo ? (
    <Img src={resolveAsset(brand.logo)!} style={{ maxWidth: radius * 1.6, maxHeight: radius * 1.1, objectFit: 'contain' }} />
  ) : (
    <div
      style={{
        fontFamily: fonts.logo,
        fontSize: logoFs,
        color: colors.dark,
        whiteSpace: 'pre',
        textAlign: 'center',
        transform: 'skewX(-10deg)',
        letterSpacing: '-0.02em',
        lineHeight: 1.02,
      }}
    >
      {logoText}
    </div>
  );

  return (
    <AbsoluteFill>
      <Background kind={scene.background ?? 'burst'} center={{ x: 0.5, y: burstY / H }} />
      <Shake at={[k.logoAt]} strength={16}>
        {scene.ticker ? <Ticker text={logoText.replace(/\n/g, ' ')} y={tickerY} delay={k.enterOffset} /> : null}
        <SpeedLines at={k.logoAt} x={W / 2} y={burstY} color="#fff" />
        {frame >= k.logoAt - 2 ? (
          <Starburst x={W / 2} y={burstY} radius={radius} progress={burstP} shadow={`0 ${14 * u}px 0 rgba(0,0,0,0.18)`} seed={scene.id}>
            <div style={{ transform: `scale(${logoScale})`, filter: `blur(${logoBlur}px)`, opacity: logoOpacity }}>{logoLayer}</div>
          </Starburst>
        ) : null}
        {scene.subtitle ? (
          <div
            style={{
              position: 'absolute',
              left: layout.safe,
              right: layout.safe,
              top: burstY + radius * (portrait ? 1.12 : 1.05),
            }}
          >
            <StrokeText
              text={scene.subtitle}
              fontSize={fitFontSize(scene.subtitle, portrait ? W - layout.safe * 2 : W * 0.56, subFs)}
              color="#fff"
              highlightColor={colors.accent}
              strokeColor={colors.dark}
              strokeWidth={8 * u}
              fontFamily={fonts.heading}
              align={portrait || square ? 'left' : 'center'}
              reveal={subReveal}
              shadow={`0 ${6 * u}px 0 rgba(0,0,0,0.2)`}
            />
          </div>
        ) : null}
        <SceneCharacters />
        <ConfettiBurst at={k.logoAt} x={W / 2} y={burstY} count={40} seed={scene.id} />
        <SceneBubbles minTipY={portrait ? burstY + radius * 1.2 : undefined} />
        <SceneCaptions />
      </Shake>
    </AbsoluteFill>
  );
};
