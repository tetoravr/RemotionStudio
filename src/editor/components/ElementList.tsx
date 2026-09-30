import React from 'react';
import { elementExists, layoutLabel, sceneElementIds, sceneLayout, setSceneLayout } from '../../video/edit/textEdit';
import { FORMATS, type ElementAdjust, type Project } from '../../video/schema';
import type { Update } from '../pages/Editor';
import { Disclosure } from './Fields';

/**
 * 映像の要素の一覧。いま映っていない時間帯の要素の非表示・復元や、位置の調整のリセットに使う。
 * 位置の調整は映像の上で直接行う（一時停止中）。調整は画面の形（縦型・正方形・横型）ごとに別々。
 */
export const ElementList: React.FC<{ project: Project; index: number; update: Update; onSelect?: (id: string) => void }> = ({ project, index, update, onSelect }) => {
  const scene = project.scenes[index];
  const ids = sceneElementIds(scene).filter((id) => elementExists(scene, id));
  // 重なり順（z）だけの記録は「調整」として数えない
  const current = sceneLayout(scene, project.format);
  const adjusted = Object.values(current).filter((a) => a.hidden || a.align || a.dx || a.dy || (a.scale ?? 1) !== 1 || a.rotate || a.tail).length;
  const set = (id: string, fn: (cur: ElementAdjust | undefined) => ElementAdjust | null) =>
    update((p) => {
      const sc = p.scenes[index];
      const layout = { ...sceneLayout(sc, p.format) };
      const next = fn(layout[id]);
      if (next) layout[id] = next;
      else delete layout[id];
      setSceneLayout(sc, p.format, layout);
    });

  return (
    <Disclosure summary="要素の表示と位置" right={adjusted ? <span className="badge accent">{adjusted}件 調整</span> : null}>
      <div className="hint" style={{ marginBottom: 6 }}>
        {FORMATS[project.format].label.split('（')[0]}での調整です。名前を押すと映像の上で選べます。
      </div>
      {ids.map((id) => {
        const a = current[id];
        const moved = a && (a.dx || a.dy || (a.scale ?? 1) !== 1 || a.rotate);
        return (
          <div key={id} className={`el-row ${a?.hidden ? 'hidden' : ''}`}>
            <span className="name ellipsis" onClick={() => !a?.hidden && onSelect?.(id)}>
              {layoutLabel(id, scene)}
            </span>
            {moved ? <span className="caption">調整あり</span> : null}
            <button
              className="btn sm quiet"
              onClick={() => set(id, (cur) => (cur?.hidden ? (cur.dx || cur.dy || cur.scale !== 1 || cur.rotate ? { ...cur, hidden: undefined } : null) : { dx: 0, dy: 0, scale: 1, rotate: 0, ...cur, hidden: true }))}
            >
              {a?.hidden ? '表示する' : '隠す'}
            </button>
            <button className="btn sm quiet" disabled={!a} onClick={() => set(id, () => null)} title="位置・大きさ・回転・非表示を元に戻す">
              戻す
            </button>
          </div>
        );
      })}
      {adjusted ? (
        <button className="btn sm plain" style={{ marginTop: 6 }} onClick={() => update((p) => setSceneLayout(p.scenes[index], p.format, {}))}>
          このシーンの調整をすべて戻す
        </button>
      ) : null}
    </Disclosure>
  );
};
