import type { Project, Scene } from './schema';
import { stripMarkup, type SceneTiming, type Timeline } from './timeline';
import { WIPE_CUT } from './components/Transitions';
import { visualTimes } from './visuals/timing';

export type SfxKind = 'pop' | 'whoosh' | 'impact' | 'ding' | 'coin' | 'sparkle' | 'thud' | 'swish';
export type SfxEvent = { frame: number; kind: SfxKind; volume?: number };

const ENTER_OFFSET: Record<Scene['transition'], number> = { wipe: 5, flash: 2, zoom: 3, slide: 4, cut: 0 };

const norm = (s: string) => stripMarkup(s).replace(/[\s、。！？!?…「」『』〜ー~・,.]/g, '');

/** セリフの中から、見出しと同じ内容を喋っているものを探す（見出しを声に合わせて出すため） */
const findLineFor = (st: SceneTiming, text: string | undefined, after = -1) => {
  if (!text) return undefined;
  const target = norm(text);
  if (!target) return undefined;
  return st.lines.find((l) => {
    if (l.start <= after) return false;
    const n = norm(l.line.text);
    return n.length > 0 && (n.includes(target) || target.includes(n));
  });
};

export type SceneKeys = {
  enterOffset: number;
  logoAt: number;
  eyebrowAt: number;
  headAt: number;
  visualAt: number;
  /** 図解の「決め」（見出しの叩きつけ） */
  payoffAt: number;
  propAt: number;
};

/** シーン内の演出タイミング（フレーム・シーン先頭基準） */
export const sceneKeys = (st: SceneTiming, project: Project): SceneKeys => {
  const s = st.scene;
  const enterOffset = st.index === 0 ? 0 : ENTER_OFFSET[s.transition];
  let logoAt = enterOffset + 3;
  let eyebrowAt = enterOffset + 2;
  let headAt = enterOffset + 12;
  let propAt = enterOffset + 10;

  if (s.type === 'logo' || s.type === 'cta') {
    const name = norm(s.logoText || project.brand.name);
    const l = st.lines.find((x) => name && norm(x.line.text).includes(name));
    if (l) {
      // 「だったら、〇〇！」のように名前は文末に来ることが多い
      const idx = norm(l.line.text).indexOf(name);
      const ratio = Math.min(0.85, idx / Math.max(1, norm(l.line.text).length));
      logoAt = Math.max(enterOffset + 2, Math.round(l.start + (l.end - l.start) * ratio) - 2);
    }
  }
  if (s.type === 'feature') {
    const eb = findLineFor(st, s.eyebrow);
    if (eb) eyebrowAt = Math.max(enterOffset, eb.start - 2);
    const hl = findLineFor(st, s.headline, eb ? eb.start : -1);
    if (hl) headAt = Math.max(eyebrowAt + 6, hl.start - 1);
    else headAt = eb ? Math.max(eyebrowAt + 8, Math.round(eb.end - 2)) : eyebrowAt + 12;
  }
  if (s.type === 'talk' && s.prop) {
    const second = st.lines[1] ?? st.lines[0];
    propAt = second ? Math.max(enterOffset + 4, second.start - 10) : enterOffset + 10;
  }
  const visualAt = s.type === 'feature' ? Math.min(eyebrowAt + 6, headAt) : s.type === 'showcase' ? enterOffset + 4 : headAt;
  return { enterOffset, logoAt, eyebrowAt, headAt, visualAt, payoffAt: headAt, propAt };
};

/** 効果音の自動配置 */
export const collectSfx = (timeline: Timeline, project: Project): SfxEvent[] => {
  const ev: SfxEvent[] = [];
  for (const st of timeline.scenes) {
    const s = st.scene;
    const k = sceneKeys(st, project);
    const at = (f: number, kind: SfxKind, volume?: number) => ev.push({ frame: st.start + f, kind, volume });
    if (st.index > 0) {
      if (s.transition === 'wipe') at(-WIPE_CUT + 1, 'whoosh', 0.8);
      else if (s.transition === 'slide' || s.transition === 'zoom') at(0, 'swish', 0.8);
      else if (s.transition === 'flash') at(0, 'sparkle', 0.6);
    }
    for (const l of st.lines) {
      if (l.line.style === 'bubble' || l.line.style === 'bubble-accent') at(l.start, 'pop', 0.55);
    }
    for (const c of s.characters) {
      if (c.enter === 'jump' || c.enter === 'slide') at(k.enterOffset + Math.round(c.enterDelaySec * project.fps), 'swish', 0.35);
    }
    switch (s.type) {
      case 'logo':
        at(k.logoAt, 'impact', 0.9);
        at(k.logoAt + 2, 'sparkle', 0.4);
        break;
      case 'talk':
        if (s.prop) at(k.propAt + 8, 'thud', 0.7);
        if (s.decor !== 'none') at(k.enterOffset + 8, 'pop', 0.4);
        break;
      case 'feature': {
        at(k.eyebrowAt, 'pop', 0.45);
        at(k.headAt, 'impact', 0.85);
        const v = s.visual;
        const va = k.visualAt;
        const { P, checkStart, runStart, runDur } = visualTimes(v, va, k.payoffAt);
        if (v.kind === 'flow') {
          at(va, 'pop', 0.3);
          at(P - 4, 'pop', 0.4);
          at(P + 2, 'ding', 0.6);
          if (v.effect === 'coins') at(P + 3, 'coin', 0.55);
          if (v.effect === 'confetti' || v.effect === 'sparkles') at(P + 2, 'sparkle', 0.5);
        } else if (v.kind === 'stack') {
          for (let i = 0; i < v.count; i++) at(va + i * 5 + 5, 'thud', 0.25);
          at(checkStart, 'ding', 0.6);
        } else if (v.kind === 'jump') {
          at(runStart + 6, 'swish', 0.5);
          at(runStart + runDur + 1, 'ding', 0.6);
        } else if (v.kind === 'counter') {
          at(P + 6, 'ding', 0.6);
        } else if (v.kind === 'icons') {
          v.items.forEach((_, i) => at(va + i * 5, 'pop', 0.35));
        } else if (v.kind === 'compare') {
          at(P + 6, 'ding', 0.6);
        } else if (v.kind === 'image') {
          at(va, 'pop', 0.4);
        }
        break;
      }
      case 'showcase':
        at(k.enterOffset + 2, 'whoosh', 0.5);
        at(k.visualAt + 22 + (s.mockup?.items.length ?? 0) * 4, 'ding', 0.5);
        break;
      case 'cta':
        at(k.logoAt, 'impact', 0.6);
        at(k.logoAt + 10, 'sparkle', 0.5);
        break;
    }
  }
  // 近すぎる同種の音は間引く
  ev.sort((a, b) => a.frame - b.frame);
  const out: SfxEvent[] = [];
  for (const e of ev) {
    if (e.frame < 0) continue;
    if (out.some((o) => o.kind === e.kind && Math.abs(o.frame - e.frame) < 4)) continue;
    out.push(e);
  }
  return out;
};
