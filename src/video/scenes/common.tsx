import React from 'react';
import { Editable, useEditMode } from '../edit/Editable';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { clamp, shake } from '../anim';
import { Character, characterGeometry } from '../components/Character';
import { SpeechBubble } from '../components/SpeechBubble';
import { StrokeText } from '../components/StrokeText';
import { fitFontSize } from '../components/RichText';
import { useScene } from '../SceneContext';
import { useTheme } from '../theme';
import { speechOnset } from '../timeline';

/** シーンのキャラクター（小さい順に奥から描く） */
export const SceneCharacters: React.FC = () => {
  const { timing } = useScene();
  const order = { s: 0, m: 1, l: 2, xl: 3 } as const;
  // 調整の保存先ID（char:<元の並び順>）を保つため、並べ替える前の番号を持たせる
  const list = timing.scene.characters.map((p, index) => ({ p, index })).sort((a, b) => order[a.p.size] - order[b.p.size]);
  return (
    <AbsoluteFill>
      {list.map(({ p, index }, i) => (
        <Editable key={`${p.id}-${index}`} id={`char:${index}`} z={i}>
          <Character placement={p} zIndex={i} />
        </Editable>
      ))}
    </AbsoluteFill>
  );
};

/** 話者の頭上に吹き出し。話者がいないセリフは画面中央付近に出す */
/** 直接調整中は、レイアウトを決めやすいように、時間で出入りする要素も全部出したままにする */
export const useShowAll = () => {
  const edit = useEditMode();
  const { timing } = useScene();
  return Boolean(edit?.enabled && edit.activeSceneId === timing.scene.id);
};

export const SceneBubbles: React.FC<{ fallbackY?: number; minTipY?: number }> = ({ fallbackY, minTipY }) => {
  const { timing } = useScene();
  const showAll = useShowAll();
  const { layout, project } = useTheme();
  const { u, width: W, height: H } = layout;
  return (
    <AbsoluteFill>
      {timing.lines.map((lt) => {
        const style = lt.line.style;
        if (style !== 'bubble' && style !== 'bubble-accent') return null;
        const placement = timing.scene.characters.find((c) => c.id === lt.line.speaker);
        let tipX = W / 2;
        let tipY = fallbackY ?? H * 0.55;
        if (placement) {
          const g = characterGeometry(placement, layout, project.cast.find((c) => c.id === placement.id));
          const side = g.x < W * 0.45 ? 1 : g.x > W * 0.55 ? -1 : 0;
          tipX = g.x + side * g.h * 0.08;
          tipY = Math.max(minTipY ?? 0, g.headY + 10 * u);
        }
        return (
          <Editable key={lt.line.id} id={`line:${lt.line.id}`} z={20} text={{ target: { type: 'line', lineId: lt.line.id }, value: lt.line.text }}>
          <SpeechBubble
            text={lt.line.text}
            tipX={tipX}
            tipY={tipY}
            appearAt={Math.max(0, lt.start + speechOnset(project.fps) - 1)}
            hideAt={!showAll && lt.visibleUntil < timing.duration ? lt.visibleUntil : undefined}
            variant={style === 'bubble-accent' ? 'accent' : 'white'}
            fontSize={layout.portrait ? 54 * u : 50 * u}
            maxWidth={layout.portrait ? W - layout.safe * 2 : W * 0.46}
          />
          </Editable>
        );
      })}
    </AbsoluteFill>
  );
};

/** 字幕（style: caption のセリフ、または全体設定で字幕ON） */
export const SceneCaptions: React.FC = () => {
  const frame = useCurrentFrame();
  const { timing } = useScene();
  const showAll = useShowAll();
  const { layout, colors, fonts, project } = useTheme();
  const { u, width: W, height: H } = layout;
  const isCaption = (lt: (typeof timing.lines)[number]) => lt.line.style === 'caption' || project.subtitles;
  const active = showAll
    ? timing.lines.filter(isCaption)
    : timing.lines.filter((lt) => isCaption(lt) && frame >= lt.start - 1 && frame < Math.min(lt.end + 8, lt.visibleUntil)).slice(0, 1);
  return (
    <>
      {active.map((lt) => {
        const fs = fitFontSize(lt.line.text, W - layout.safe * 2, layout.portrait ? 60 * u : 54 * u);
        const o = showAll ? 1 : interpolate(frame, [lt.start - 1, lt.start + 3], [0, 1], clamp);
        return (
          <Editable key={lt.line.id} id={`caption:${lt.line.id}`} z={30} text={{ target: { type: 'line', lineId: lt.line.id }, value: lt.line.text }}>
            <div style={{ position: 'absolute', left: layout.safe, right: layout.safe, top: H * (layout.portrait ? 0.8 : 0.84), zIndex: 30, opacity: o }}>
              <StrokeText
                text={lt.line.text}
                fontSize={fs}
                color="#fff"
                highlightColor={colors.accent}
                strokeColor={colors.dark}
                strokeWidth={9 * u}
                fontFamily={fonts.heading}
                shadow={`0 ${6 * u}px 0 rgba(0,0,0,0.25)`}
              />
            </div>
          </Editable>
        );
      })}
    </>
  );
};

/** 叩きつけ時の画面揺れ */
export const Shake: React.FC<{ at: number[]; strength?: number; children: React.ReactNode }> = ({ at, strength = 14, children }) => {
  const frame = useCurrentFrame();
  const { layout } = useTheme();
  let x = 0;
  let y = 0;
  for (const a of at) {
    const s = shake(frame, a, strength * layout.u);
    x += s.x;
    y += s.y;
  }
  return <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px)` }}>{children}</AbsoluteFill>;
};
