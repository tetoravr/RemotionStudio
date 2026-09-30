import React from 'react';
import { elementExists, layoutLabel, sceneElementIds, sceneLayout, setSceneLayout } from '../../video/edit/textEdit';
import { FORMATS, type ElementAdjust, type Project } from '../../video/schema';
import type { Update } from '../pages/Editor';
import { Puzzle } from 'lucide-react';
import { Ic } from '../icons';

/**
 * 直接調整した要素の一覧。プレビューに出ていない時間帯の要素の非表示・復元や、調整のリセットに使う。
 * 調整はプレビュー上（「直接調整」）で行う。調整は画面の形（縦型・正方形・横型）ごとに別々。
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
    <details className="section" style={{ marginBottom: 10 }}>
      <summary className="section-title" style={{ cursor: 'pointer' }}>
        <Ic n={Puzzle} />要素の表示・調整{adjusted ? <span className="count">{adjusted}</span> : null}
        <span className="faint">（{FORMATS[project.format].label.split('（')[0]}）</span>
        <span className="faint">プレビュー上の「直接調整」で動かせます</span>
      </summary>
      {ids.map((id) => {
        const a = current[id];
        const moved = a && (a.dx || a.dy || (a.scale ?? 1) !== 1 || a.rotate);
        return (
          <div key={id} className="row center tight" style={{ marginBottom: 4 }}>
            <span
              style={{ flex: 1, cursor: onSelect ? 'pointer' : undefined, opacity: a?.hidden ? 0.5 : 1, textDecoration: a?.hidden ? 'line-through' : undefined }}
              onClick={() => !a?.hidden && onSelect?.(id)}
              title={onSelect ? 'クリックで選択（重なった要素も選べます）' : undefined}
            >
              {layoutLabel(id, scene)}
            </span>
            {moved ? <span className="faint" style={{ flex: '0 0 auto' }}>調整あり</span> : null}
            <button
              className="btn sm"
              style={{ flex: 'none' }}
              onClick={() => set(id, (cur) => (cur?.hidden ? (cur.dx || cur.dy || cur.scale !== 1 || cur.rotate ? { ...cur, hidden: undefined } : null) : { dx: 0, dy: 0, scale: 1, rotate: 0, ...cur, hidden: true }))}
            >
              {a?.hidden ? '表示する' : '非表示'}
            </button>
            <button className="btn sm ghost" style={{ flex: 'none' }} disabled={!a} onClick={() => set(id, () => null)} title="位置・大きさ・回転・非表示を元に戻す">
              リセット
            </button>
          </div>
        );
      })}
      {adjusted ? (
        <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => update((p) => setSceneLayout(p.scenes[index], p.format, {}))}>
          この画面の形の調整をすべてリセット
        </button>
      ) : null}
    </details>
  );
};
