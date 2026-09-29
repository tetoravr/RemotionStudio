import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/noto-sans-jp/900.css';
import '@fontsource/dela-gothic-one/400.css';
import '@fontsource/m-plus-rounded-1c/700.css';
import '@fontsource/m-plus-rounded-1c/800.css';
import { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import type { Project } from './schema';

const FACES = [
  '500 40px "Noto Sans JP"',
  '700 40px "Noto Sans JP"',
  '900 40px "Noto Sans JP"',
  '400 40px "Dela Gothic One"',
  '700 40px "M PLUS Rounded 1c"',
  '800 40px "M PLUS Rounded 1c"',
];

/** プロジェクト中の全テキストを集める（フォントのサブセットを事前ロードするため） */
export const collectText = (project: Project): string => {
  const parts: string[] = [project.brand.name, project.brand.tagline, project.title, '0123456789!?！？、。…〜ー★※%％円'];
  for (const s of project.scenes) {
    for (const l of s.lines) parts.push(l.text);
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'string' && k !== 'id' && k !== 'type') parts.push(v);
    }
    if (s.type === 'feature') {
      const v = s.visual as Record<string, unknown>;
      parts.push(JSON.stringify(v));
    }
    if (s.type === 'showcase' && s.mockup) parts.push(JSON.stringify(s.mockup));
    if (s.type === 'cta') parts.push(...s.notes);
    if (s.type === 'talk' && s.prop?.label) parts.push(s.prop.label);
  }
  for (const c of project.cast) parts.push(c.name, c.builtin?.emblem ?? '');
  return Array.from(new Set(parts.join('').split(''))).join('');
};

/**
 * unicode-range で分割された日本語フォントは「使われた文字」が出た瞬間に遅延ロードされる。
 * レンダリング中にフォールバックフォントが写り込まないよう、最初に全文字分をロードしておく。
 */
export const useProjectFonts = (project: Project) => {
  const text = collectText(project);
  const [handle] = useState(() => delayRender('Loading fonts', { timeoutInMilliseconds: 60000 }));
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      continueRender(handle);
    };
    if (typeof document === 'undefined' || !document.fonts) {
      finish();
      return;
    }
    Promise.all(FACES.map((f) => document.fonts.load(f, text).catch(() => [])))
      .then(() => document.fonts.ready)
      .catch(() => undefined)
      .finally(finish);
    return finish;
    // text が変わった時はエディター上なので delayRender 不要（ブラウザが自動でロード）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);
};
