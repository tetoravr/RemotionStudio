import React from 'react';
import { Editable } from '../edit/Editable';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { clamp, pop } from '../anim';
import { Background } from '../components/Background';
import { characterGeometry } from '../components/Character';
import { Decor } from '../components/Decor';
import { IllustrationCard } from '../components/IllustrationCard';
import { PropCard } from '../components/PropCard';
import { fitFontSize } from '../components/RichText';
import { StrokeText } from '../components/StrokeText';
import { sceneKeys } from '../events';
import type { SceneOf } from '../schema';
import { useScene } from '../SceneContext';
import { useTheme } from '../theme';
import { SceneBubbles, SceneCaptions, SceneCharacters, Shake } from './common';

export const TalkScene: React.FC<{ scene: SceneOf<'talk'> }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { timing } = useScene();
  const { layout, colors, fonts, brand, project } = useTheme();
  const { u, width: W, portrait } = layout;
  const k = sceneKeys(timing, project);
  const bg = scene.background ?? 'stripes';
  const dark = bg.endsWith('dark') || bg === 'gradient';

  const logoP = pop(frame, fps, k.enterOffset + 2, 12, 160);
  const headP = pop(frame, fps, k.enterOffset + 4, 11, 170);

  const first = scene.characters[0];
  const g = first ? characterGeometry(first, layout, project.cast.find((c) => c.id === first.id)) : null;

  // 小道具: 上から落ちてきて着地
  const propW = portrait ? 380 * u : 300 * u;
  const propLand = k.propAt + 8;
  const propTargetY = portrait ? layout.visual.y + 40 * u : layout.visual.y;
  const propY = interpolate(frame, [k.propAt, propLand], [-propW, propTargetY], { ...clamp, easing: Easing.in(Easing.quad) });
  const bounce = interpolate(frame, [propLand, propLand + 5, propLand + 12], [0, -30 * u, 0], clamp);
  const propRot = interpolate(frame, [k.propAt, propLand, propLand + 14], [-25, 8, -6], clamp);

  const headlineTop = scene.showLogo ? layout.text.y + 140 * u : layout.text.y;

  // 図解イラスト: 見出しの下から、キャラの頭上の吹き出しスペースまでを使って大きく見せる
  const headlineFs = scene.headline ? fitFontSize(scene.headline, layout.text.w, portrait ? 110 * u : 96 * u) : 0;
  const illTop = (scene.headline ? headlineTop + scene.headline.split('\n').length * headlineFs * 1.18 : headlineTop) + 30 * u;
  const heads = scene.characters.map((c) => characterGeometry(c, layout, project.cast.find((m) => m.id === c.id)).headY);
  const illBottom = Math.min(layout.height - 200 * u, ...(heads.length ? heads.map((h) => h - (portrait ? 170 * u : 40 * u)) : [layout.height]));
  const labelRatio = scene.prop?.label ? 1.17 : 1.08;
  const illSize = Math.max(portrait ? 560 * u : 300 * u, Math.min(portrait ? W - layout.safe * 2 : W * 0.4, (illBottom - illTop) / labelRatio));

  return (
    <AbsoluteFill>
      <Background kind={bg} />
      <Shake at={scene.prop ? [propLand] : []} strength={10}>
        {scene.showLogo ? (
          <Editable id="miniLogo" text={{ target: { type: 'brandName' }, value: brand.name }}>
          <div
            style={{
              position: 'absolute',
              top: portrait ? 120 * u : 60 * u,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontFamily: fonts.logo,
              fontSize: portrait ? 76 * u : 64 * u,
              color: dark ? '#fff' : colors.dark,
              transform: `scale(${logoP}) skewX(-10deg)`,
            }}
          >
            {brand.name.replace(/\n/g, ' ')}
          </div>
          </Editable>
        ) : null}
        {scene.headline ? (
          <Editable id="headline" text={{ target: { type: 'field', field: 'headline' }, value: scene.headline }}>
          <div style={{ position: 'absolute', left: layout.text.x, width: layout.text.w, top: headlineTop, transform: `scale(${headP})` }}>
            <StrokeText
              text={scene.headline}
              fontSize={headlineFs}
              color={dark ? '#fff' : colors.text}
              highlightColor={dark ? colors.accent : colors.primary}
              strokeColor={dark ? colors.dark : '#fff'}
              strokeWidth={10 * u}
              fontFamily={fonts.heading}
              shadow={`0 ${8 * u}px 0 rgba(0,0,0,0.12)`}
            />
          </div>
          </Editable>
        ) : null}
        <SceneCharacters />
        {scene.decor !== 'none' && g ? (
          <Editable id="decor">
            <Decor kind={scene.decor} x={Math.min(W - 200 * u, g.x + g.h * 0.55)} y={g.headY - 60 * u} at={k.enterOffset + 8} />
          </Editable>
        ) : null}
        {scene.prop?.image ? (
          <Editable id="prop" z={10} text={{ target: { type: 'propLabel' }, value: scene.prop.label ?? '' }}>
            <IllustrationCard src={scene.prop.image} badge={scene.prop.badge} label={scene.prop.label} x={W / 2} y={illTop} size={illSize} at={k.propAt} />
          </Editable>
        ) : scene.prop && frame >= k.propAt ? (
          <Editable id="prop" z={10} text={{ target: { type: 'propLabel' }, value: scene.prop.label ?? '' }}>
          <div
            style={{
              position: 'absolute',
              left: W / 2 - propW / 2,
              top: propY + bounce,
              transform: `rotate(${propRot}deg)`,
              zIndex: 10,
            }}
          >
            <PropCard icon={scene.prop.icon} badge={scene.prop.badge} label={scene.prop.label} width={propW} />
          </div>
          </Editable>
        ) : null}
        <SceneBubbles />
        <SceneCaptions />
      </Shake>
    </AbsoluteFill>
  );
};
