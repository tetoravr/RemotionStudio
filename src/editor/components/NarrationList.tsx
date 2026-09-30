import { confirmDialog } from './Dialogs';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { isAudioStale } from '../../video/narrationKey';
import type { Project } from '../../video/schema';
import { api, ttsFor } from '../api';
import { MetaContext } from '../App';
import type { RunJob } from '../pages/Editor';
import { Circle, Play, RefreshCw, Square } from 'lucide-react';
import { Ic } from '../icons';

/** セリフ音声の再生（1つずつ／通し）。再生中のセリフIDを返す */
export const useNarrationPlayer = (project: Project) => {
  const audio = useRef<HTMLAudioElement | null>(null);
  const run = useRef(0);
  const [playing, setPlaying] = useState<string | null>(null);

  const stop = useCallback(() => {
    run.current++;
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  }, []);

  useEffect(() => stop, [stop]);

  const playOne = useCallback(
    (id: string, src: string) =>
      new Promise<void>((resolve) => {
        const a = new Audio(`/files/${project.id}/${src}?t=${Date.now()}`);
        audio.current = a;
        setPlaying(id);
        a.onended = () => resolve();
        a.onerror = () => resolve();
        a.play().catch(() => resolve());
      }),
    [project.id],
  );

  /** ids の順に再生する（音声がないセリフは飛ばす） */
  const play = useCallback(
    async (items: { id: string; src: string }[]) => {
      audio.current?.pause();
      const me = ++run.current;
      for (const it of items) {
        if (run.current !== me) return;
        await playOne(it.id, it.src);
      }
      if (run.current === me) setPlaying(null);
    },
    [playOne],
  );

  return { playing, play, stop };
};

/** 作り直したあとの音声を取り直して、すぐ再生する */
export const regenerateLine = async (project: Project, lineId: string, runJob: RunJob): Promise<{ id: string; src: string } | null> => {
  const done = await runJob('このセリフの音声を作り直しています', `/api/projects/${project.id}/narration`, { lineIds: [lineId] });
  if (!done) return null;
  const fresh = await api.get(project.id);
  const line = fresh.scenes.flatMap((s) => s.lines).find((l) => l.id === lineId);
  return line?.audio ? { id: lineId, src: line.audio.src } : null;
};

/** 全セリフの音声の確認・作り直し */
export const NarrationList: React.FC<{ project: Project; runJob: RunJob; onSelectScene?: (i: number) => void }> = ({ project, runJob, onSelectScene }) => {
  const meta = useContext(MetaContext)!;
  const tts = ttsFor(meta, project.audio.ttsProvider);
  const { playing, play, stop } = useNarrationPlayer(project);

  const rows = project.scenes.flatMap((s, si) =>
    s.lines.filter((l) => l.text.trim() || l.speak?.trim()).map((l) => ({ scene: si, line: l, stale: isAudioStale(l, project.cast, tts.engine) })),
  );
  const playable = rows.filter((r) => r.line.audio).map((r) => ({ id: r.line.id, src: r.line.audio!.src }));
  const staleCount = rows.filter((r) => r.stale).length;
  const name = (speaker: string) => project.cast.find((c) => c.id === speaker)?.name ?? 'ナレーター';

  const redo = async (id: string) => {
    stop();
    const fresh = await regenerateLine(project, id, runJob);
    if (fresh) play([fresh]);
  };

  return (
    <div>
      <div className="row center tight" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="btn sm primary" style={{ flex: 'none' }} disabled={!playable.length} onClick={() => (playing ? stop() : play(playable))}>
          {playing ? (
            <>
              <Ic n={Square} size={12} />停止
            </>
          ) : (
            <>
              <Ic n={Play} size={12} />最初から通して聴く
            </>
          )}
        </button>
        <button
          className="btn sm"
          style={{ flex: 'none' }}
          disabled={!tts.ready || staleCount === 0}
          onClick={() => runJob('ナレーションを生成しています', `/api/projects/${project.id}/narration`)}
          title="変更されたセリフ・音声のないセリフだけを作ります"
        >
          未作成・変更分を作る{staleCount ? `（${staleCount}）` : ''}
        </button>
        <button
          className="btn sm ghost"
          style={{ flex: 'none' }}
          disabled={!tts.ready}
          onClick={async () =>
            (await confirmDialog({ title: 'すべてのセリフの音声を作り直しますか？', message: `${rows.length}セリフぶんの音声を作り直します。`, ok: '作り直す' })) &&
            runJob('ナレーションを作り直しています', `/api/projects/${project.id}/narration`, { force: true })
          }
        >
          すべて作り直す
        </button>
      </div>
      {rows.map(({ scene, line, stale }) => (
        <div
          key={line.id}
          className="row center tight"
          style={{ marginBottom: 4, padding: '4px 6px', borderRadius: 6, background: playing === line.id ? 'rgba(124,92,255,0.18)' : undefined }}
        >
          <button className="icon-btn" style={{ flex: 'none' }} title={line.audio ? '再生' : '音声がありません'} disabled={!line.audio} onClick={() => (playing === line.id ? stop() : play([{ id: line.id, src: line.audio!.src }]))}>
            {playing === line.id ? <Ic n={Square} size={12} mr={0} /> : <Ic n={Play} size={12} mr={0} />}
          </button>
          <button className="icon-btn" style={{ flex: 'none' }} title="このセリフだけ作り直して、すぐ聴く" disabled={!tts.ready} onClick={() => redo(line.id)}>
            <Ic n={RefreshCw} mr={0} />
          </button>
          <div style={{ flex: 1, minWidth: 0, cursor: onSelectScene ? 'pointer' : undefined }} onClick={() => onSelectScene?.(scene)} title="このシーンを開く">
            <div className="faint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              シーン{scene + 1} ・ {name(line.speaker)}
              {line.audio ? ` ・ ${line.audio.durationSec.toFixed(1)}秒` : ''}
              {stale ? <span className="audio-stale">
                {' '}
                <Ic n={Circle} size={8} mr={3} />
                {line.audio ? '内容が変わりました' : '音声なし'}</span> : null}
            </div>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line.text.replace(/\n/g, '')}</div>
          </div>
        </div>
      ))}
      {!rows.length ? <div className="faint">セリフがありません</div> : null}
    </div>
  );
};
