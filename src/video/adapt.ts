import type { Project } from './schema';

/**
 * 横型・正方形では画面中央を文字に使うため、中央に立つキャラを左右に逃がす（会話シーン以外）。
 */
export const adaptForFormat = (project: Project): Project => {
  if (project.format === 'vertical') return project;
  return {
    ...project,
    scenes: project.scenes.map((s) => {
      if (s.type === 'talk' || !s.characters.some((c) => c.position === 'center')) return s;
      const leftUsed = s.characters.some((c) => c.position === 'left' || c.position === 'far-left');
      return {
        ...s,
        characters: s.characters.map((c) => (c.position === 'center' ? { ...c, position: leftUsed ? 'far-right' : 'far-left' } : c)),
      };
    }),
  };
};
