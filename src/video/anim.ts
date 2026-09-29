import { Easing, interpolate, spring } from 'remotion';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 弾むポップイン（0→1、少しオーバーシュート） */
export const pop = (frame: number, fps: number, delay = 0, damping = 11, stiffness = 180) =>
  spring({ frame: frame - delay, fps, config: { damping, stiffness, mass: 0.7 } });

/** 素直なイン（0→1、オーバーシュートなし） */
export const ease = (frame: number, start: number, dur: number, easing = Easing.out(Easing.cubic)) =>
  interpolate(frame, [start, start + dur], [0, 1], { ...clamp, easing });

/** 叩きつけ（大→等倍）。0→1 の進捗を返す */
export const slam = (frame: number, fps: number, delay = 0) =>
  spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 260, mass: 0.6 } });

/** 着地時のスクワッシュ量（0→1→0） */
export const impactPulse = (frame: number, at: number, dur = 8) =>
  interpolate(frame, [at, at + 2, at + dur], [0, 1, 0], clamp);

/** カメラシェイク */
export const shake = (frame: number, at: number, strength: number, dur = 10) => {
  const t = frame - at;
  if (t < 0 || t > dur) return { x: 0, y: 0 };
  const k = (1 - t / dur) * strength;
  return { x: Math.sin(t * 2.7) * k, y: Math.cos(t * 3.3) * k * 0.7 };
};

/** ふわふわ上下 */
export const bob = (frame: number, fps: number, amp: number, speed = 1, phase = 0) =>
  Math.sin((frame / fps) * Math.PI * 2 * speed * 0.5 + phase) * amp;
