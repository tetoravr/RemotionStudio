import React from 'react';
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { bob, clamp } from '../anim';
import type { CastMember, CharacterPlacement, Pose } from '../schema';
import { useScene } from '../SceneContext';
import { type Layout, useTheme } from '../theme';
import { currentPose, speakingLine } from '../timeline';

const CROP: Record<CharacterPlacement['size'], number> = { s: 0, m: 0.02, l: 0.14, xl: 0.26 };

/** キャラクターの足元・頭の座標（吹き出しの配置に使う） */
/** 横長のキャラ（マスコットなど）は、縦長の人物と同じ高さだと大きすぎるので小さめに表示する */
export const shapeScale = (member?: CastMember) => (member?.aspect && member.aspect > 0.9 ? 0.72 : 1);

export const characterGeometry = (p: CharacterPlacement, layout: Layout, member?: CastMember) => {
  const h = layout.charHeight[p.size] * shapeScale(member);
  const x = layout.slotX[p.position];
  const feetY = layout.groundY + h * CROP[p.size];
  return { x, feetY, h, headY: feetY - h * 0.97 };
};

const POSE_FALLBACKS: Record<string, string[]> = {
  happy: ['wink', 'wave', 'point'],
  wink: ['happy', 'wave'],
  wave: ['happy', 'wink'],
  point: ['happy', 'wave'],
  surprised: ['think'],
  think: ['surprised'],
  sad: ['think'],
};

/** 指定の表情の画像を返す。無ければ近い表情で代用する（口を閉じた版と開けた版で同じ表情キーを使う） */
export const pickPose = (member: CastMember, pose: Pose | string): string | undefined => {
  const imgs = member.images as Record<string, string | undefined>;
  if (imgs[pose]) return pose;
  for (const f of POSE_FALLBACKS[pose] ?? []) if (imgs[f]) return f;
  return imgs.default ? 'default' : Object.keys(imgs).find((k) => imgs[k]);
};

export const pickImages = (member: CastMember, pose: Pose | string): { closed: string; open?: string } | undefined => {
  const key = pickPose(member, pose);
  if (!key) return undefined;
  const closed = (member.images as Record<string, string | undefined>)[key];
  if (!closed) return undefined;
  return { closed, open: (member.imagesOpen as Record<string, string | undefined>)[key] };
};

/** 口の開き（0=閉じ / 1=開き）。音声から算出した口パクデータを使い、無ければ発話中だけ周期的に動かす */
export const mouthLevel = (talking: { start: number; line: { audio?: { mouth?: number[] } } } | undefined, frame: number, fps: number): number => {
  if (!talking) return 0;
  const t = frame - talking.start;
  const env = talking.line.audio?.mouth;
  if (env) return env[Math.floor((t * 30) / fps)] ? 1 : 0;
  return Math.sin(t * 1.25) + Math.sin(t * 0.53) > 0.2 ? 1 : 0;
};

export const Character: React.FC<{ placement: CharacterPlacement; zIndex?: number }> = ({ placement, zIndex }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { layout, project, resolveAsset } = theme;
  const { timing, enterOffset } = useScene();
  const member = project.cast.find((c) => c.id === placement.id);
  if (!member) return null;

  const { x, feetY, h } = characterGeometry(placement, layout, member);
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
  const mouthOpen = mouthLevel(talking, frame, fps) > 0;
  if (talking) {
    // 話している間は、口の開閉に合わせて体がわずかに弾む
    const lt = frame - talking.start;
    const hop = Math.abs(Math.sin(lt * 0.34));
    dy -= hop * 6 * u;
    sy *= 1 + hop * 0.008;
  }

  const pose = currentPose(timing.lines, member.id, frame, placement.pose) as Pose;
  // ポーズが変わった瞬間に軽く跳ねる
  const poseLine = [...timing.lines].reverse().find((l) => l.line.speaker === member.id && l.line.pose && frame >= l.start);
  if (poseLine) {
    const pt = frame - poseLine.start;
    dy -= interpolate(pt, [0, 4, 9], [0, 22 * u, 0], clamp);
  }

  const flip = placement.flip ? -1 : 1;
  const imgs = pickImages(member, pose);
  if (!imgs) return null;
  // 口を閉じた版と開けた版を重ねて置き、表示だけ切り替える（画像の読み込み待ちでちらつかない）
  const imgStyle = (visible: boolean): React.CSSProperties => ({
    position: 'absolute',
    left: 0,
    top: 0,
    height: h,
    width: 'auto',
    display: 'block',
    visibility: visible ? 'visible' : 'hidden',
  });
  const body = (
    <div style={{ position: 'relative', height: h, aspectRatio: 'auto' }}>
      <Img src={resolveAsset(imgs.closed)!} style={{ ...imgStyle(!mouthOpen || !imgs.open), position: 'relative' }} />
      {imgs.open ? <Img src={resolveAsset(imgs.open)!} style={imgStyle(mouthOpen)} /> : null}
    </div>
  );

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
