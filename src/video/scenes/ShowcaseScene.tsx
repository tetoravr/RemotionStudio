import React from 'react';
import { Editable } from '../edit/Editable';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { bob, clamp, pop } from '../anim';
import { Background } from '../components/Background';
import { fitFontSize } from '../components/RichText';
import { ScreenFrame } from '../components/ScreenFrame';
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
  const noteP = interpolate(frame, [k.enterOffset + 8, k.enterOffset + 14], [0, 1], clamp);

  const top = titleTop + titleH + (portrait ? 70 * u : 40 * u);
  const enter = spring({ frame: frame - k.visualAt, fps, config: { damping: 14, stiffness: 120 } });
  const isPhone = scene.screenshotFrame === 'phone';
  // 画面は縦長ならスマホ枠、横長ならブラウザ枠。キャラと重ならないよう、縦型では少し左に寄せる
  const frameW = isPhone ? (portrait ? 540 * u : layout.format === 'square' ? 300 * u : 330 * u) : portrait ? W - layout.safe * 2 : W * 0.6;
  const maxH = H - top - (portrait ? 330 * u : 60 * u);
  const frameX = isPhone && portrait ? W * 0.42 : W / 2;
  const slideY = interpolate(enter, [0, 1], [H * 0.8, 0]);
  const rot = isPhone ? interpolate(enter, [0, 1], [-18, -5]) + Math.sin(frame / 20) * 0.8 : 0;
  const scrollFrom = Math.max(k.visualAt + 24, timing.lines[0] ? timing.lines[0].start + 10 : 0);
  const scrollDur = Math.max(30, timing.duration - scrollFrom - 20);

  return (
    <AbsoluteFill>
      <Background kind={bg} />
      <Editable id="title" text={{ target: { type: 'field', field: 'title' }, value: scene.title }}>
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
      </Editable>
      {scene.note ? (
        <Editable id="note" text={{ target: { type: 'field', field: 'note' }, value: scene.note }}>
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
        </Editable>
      ) : null}
      {frame >= k.visualAt ? (
        scene.screenshot && !scene.screenshot.startsWith('ui:') ? (
          <Editable id="screen">
          <div
            style={{
              position: 'absolute',
              left: frameX - frameW / 2,
              top: top + slideY + bob(frame, fps, 6 * u, 0.8),
              transform: `rotate(${rot}deg)`,
              width: frameW,
            }}
          >
            <ScreenFrame
              kind={scene.screenshotFrame}
              src={scene.screenshot}
              size={scene.screenshotSize}
              width={frameW}
              maxHeight={maxH}
              scrollFrom={scrollFrom}
              scrollDur={scrollDur}
            />
          </div>
          </Editable>
        ) : (
          // 疑似UIは作らない。スクリーンショット未設定であることを明示（書き出しはエラーで止まる）
          <div
            style={{
              position: 'absolute',
              left: layout.safe,
              right: layout.safe,
              top,
              height: maxH,
              border: `${6 * u}px dashed ${colors.primary}`,
              borderRadius: 30 * u,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: fonts.heading,
              fontWeight: 900,
              fontSize: 44 * u,
              color: colors.primary,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            {'実際の画面のスクリーンショットを\nこのシーンに設定してください'}
          </div>
        )
      ) : null}
      <SceneCharacters />
      <SceneBubbles />
      <SceneCaptions />
    </AbsoluteFill>
  );
};
