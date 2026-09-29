import React from 'react';
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { bob, clamp } from '../anim';
import type { CastMember, CharacterPlacement, Pose } from '../schema';
import { useScene } from '../SceneContext';
import { type Layout, useTheme } from '../theme';
import { currentPose, speakingLine } from '../timeline';
import { Mascot } from './Mascot';

const CROP: Record<CharacterPlacement['size'], number> = { s: 0, m: 0.02, l: 0.14, xl: 0.26 };

/** キャラクターの足元・頭の座標（吹き出しの配置に使う） */
export const characterGeometry = (p: CharacterPlacement, layout: Layout) => {
  const h = layout.charHeight[p.size];
  const x = layout.slotX[p.position];
  const feetY = layout.groundY + h * CROP[p.size];
  return { x, feetY, h, headY: feetY - h * 0.97 };
};

export const pickImage = (member: CastMember, pose: Pose | string): string | undefined => {
  const imgs = member.images as Record<string, string | undefined>;
  const fallbacks: Record<string, string[]> = {
    happy: ['wink', 'wave', 'point'],
    wink: ['happy', 'wave'],
    wave: ['happy', 'wink'],
    point: ['happy', 'wave'],
    surprised: ['think'],
    think: ['surprised'],
    sad: ['think'],
  };
  if (imgs[pose]) return imgs[pose];
  for (const f of fallbacks[pose] ?? []) if (imgs[f]) return imgs[f];
  return imgs.default ?? Object.values(imgs).find(Boolean);
};

export const Character: React.FC<{ placement: CharacterPlacement; zIndex?: number }> = ({ placement, zIndex }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { layout, project, colors, resolveAsset, fonts } = theme;
  const { timing, enterOffset } = useScene();
  const member = project.cast.find((c) => c.id === placement.id);
  if (!member) return null;

  const { x, feetY, h } = characterGeometry(placement, layout);
  const { u, width: W, height: H } = layout;
  const delay = enterOffset + Math.round(placement.enterDelaySec * fps);
  const t = frame - delay;
  if (t < 0 && placement.enter !== 'none') return null;

  // 登場
  let dx = 0;
  let dy = 0;
  let sx = 1;
  let sy = 1;
  let rot = 0;
  let opacity = 1;
  const sp = spring({ frame: t, fps, config: { damping: 12, stiffness: 150, mass: 0.8 } });
  switch (placement.enter) {
    case 'jump': {
      const arc = interpolate(t, [0, 7, 13], [h * 0.75, -h * 0.13, 0], clamp);
      dy = arc;
      const land = interpolate(t, [12, 14, 20], [0, 1, 0], clamp);
      sy = 1 - land * 0.1;
      sx = 1 + land * 0.08;
      break;
    }
    case 'slide': {
      const fromLeft = x < W / 2;
      dx = (1 - sp) * (fromLeft ? -1 : 1) * (W * 0.55);
      rot = (1 - sp) * (fromLeft ? 12 : -12);
      break;
    }
    case 'drop': {
      dy = interpolate(sp, [0, 1], [-H, 0]);
      const land = interpolate(t, [8, 10, 17], [0, 1, 0], clamp);
      sy = 1 - land * 0.12;
      sx = 1 + land * 0.1;
      break;
    }
    case 'pop': {
      const s = Math.max(0, sp);
      sx *= s;
      sy *= s;
      opacity = interpolate(t, [0, 3], [0, 1], clamp);
      break;
    }
    default:
      break;
  }

  // 待機モーション
  const phase = (x / W) * 3;
  dy += bob(frame, fps, 6 * u, 1.1, phase);
  sy *= 1 + Math.sin(frame / 11 + phase) * 0.008;

  // 喋っている時は弾む
  const talking = speakingLine(timing.lines, member.id, frame);
  let mouthOpen = 0;
  if (talking) {
    const lt = frame - talking.start;
    const hop = Math.abs(Math.sin(lt * 0.42));
    dy -= hop * 10 * u;
    sy *= 1 + hop * 0.018;
    mouthOpen = Math.max(0, Math.sin(lt * 1.25) * 0.6 + Math.sin(lt * 0.53) * 0.4);
  }

  const pose = currentPose(timing.lines, member.id, frame, placement.pose) as Pose;
  // ポーズが変わった瞬間に軽く跳ねる
  const poseLine = [...timing.lines].reverse().find((l) => l.line.speaker === member.id && l.line.pose && frame >= l.start);
  if (poseLine) {
    const pt = frame - poseLine.start;
    dy -= interpolate(pt, [0, 4, 9], [0, 22 * u, 0], clamp);
  }

  const flip = placement.flip ? -1 : 1;
  let body: React.ReactNode;
  if (member.kind === 'builtin' || !pickImage(member, pose)) {
    const b = member.builtin ?? { shape: 'mochi' as const, bodyColor: '#ffffff', emblem: '' };
    body = (
      <Mascot
        shape={b.shape}
        bodyColor={b.bodyColor}
        accentColor={b.accentColor || colors.primary}
        outline={colors.dark}
        emblem={b.emblem}
        emblemFont={fonts.heading}
        pose={pose}
        mouthOpen={mouthOpen}
        frame={frame}
        height={h}
      />
    );
  } else {
    body = <Img src={resolveAsset(pickImage(member, pose))!} style={{ height: h, width: 'auto', display: 'block' }} />;
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: feetY - h,
        height: h,
        zIndex,
        transform: `translate(-50%, 0) translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
        opacity,
      }}
    >
      <div
        style={{
          transform: `scale(${sx * flip}, ${sy})`,
          transformOrigin: '50% 100%',
          filter: `drop-shadow(0 ${10 * u}px ${14 * u}px rgba(0,0,0,0.18))`,
        }}
      >
        {body}
      </div>
    </div>
  );
};
