import { createContext, useContext } from 'react';
import type { SceneTiming } from './timeline';

export type SceneCtx = {
  timing: SceneTiming;
  /** トランジションで隠れている間は演出を遅らせる（フレーム） */
  enterOffset: number;
};

export const SceneContext = createContext<SceneCtx | null>(null);

export const useScene = (): SceneCtx => {
  const c = useContext(SceneContext);
  if (!c) throw new Error('SceneContext missing');
  return c;
};
