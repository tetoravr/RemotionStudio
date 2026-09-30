import type { Project, Scene } from './schema';

/** 図解イラストのある課題シーンは、図解を主役にするためキャラを中サイズまでに抑え、左右に寄せる */
const makeRoomForIllustration = (s: Scene): Scene => {
  if (s.type !== 'talk' || !s.prop?.image) return s;
  const big = s.characters.some((c) => c.size === 'l' || c.size === 'xl' || c.position === 'center');
  if (!big) return s;
  const used = new Set<string>();
  return {
    ...s,
    characters: s.characters.map((c, i) => {
      let position = c.position;
      if (position === 'center') position = i === 0 ? 'left' : 'right';
      if (used.has(position)) position = position.includes('left') ? 'right' : 'left';
      used.add(position);
      return { ...c, size: c.size === 'l' || c.size === 'xl' ? 'm' : c.size, position };
    }),
  };
};

/**
 * 画面の形に合わせてシーンを整える。
 * - 図解のある課題シーンは、キャラを小さくして図解の場所を空ける
 * - 横型・正方形では画面中央を文字に使うため、中央に立つキャラを左右に逃がす（会話シーン以外）
 */
export const adaptForFormat = (project: Project): Project => {
  const scenes = project.scenes.map(makeRoomForIllustration);
  if (project.format === 'vertical') return scenes.every((s, i) => s === project.scenes[i]) ? project : { ...project, scenes };
  return {
    ...project,
    scenes: scenes.map((s) => {
      if (s.type === 'talk' || !s.characters.some((c) => c.position === 'center')) return s;
      const leftUsed = s.characters.some((c) => c.position === 'left' || c.position === 'far-left');
      return {
        ...s,
        characters: s.characters.map((c) => (c.position === 'center' ? { ...c, position: leftUsed ? 'far-right' : 'far-left' } : c)),
      };
    }),
  };
};
