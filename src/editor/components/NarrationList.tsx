import { Ellipsis, Play, RefreshCw, Square } from 'lucide-react';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { isAudioStale } from '../../video/narrationKey';
import type { Project } from '../../video/schema';
import { ttsFor } from '../api';
import { MetaContext } from '../App';
import { useVoice } from '../voice';
import { Ic } from '../icons';
import { confirmDialog } from './Dialogs';
import { MenuItem, Popover } from './Fields';
import { Avatar, speakerName } from './pickers';

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

/** 全セリフの音声の確認・作り直し */
export const NarrationList: React.FC<{ project: Project; onSelectScene?: (i: number) => void }> = ({ project, onSelectScene }) => {
  const meta = useContext(MetaContext)!;
  const tts = ttsFor(meta, project.audio);
  const voice = useVoice();
  const { playing, play, stop } = useNarrationPlayer(project);

  const rows = project.scenes.flatMap((s, si) =>
    s.lines.filter((l) => l.text.trim() || l.speak?.trim()).map((l) => ({ scene: si, line: l, stale: isAudioStale(l, project.cast, tts.engine) })),
  );
  const playable = rows.filter((r) => r.line.audio).map((r) => ({ id: r.line.id, src: r.line.audio!.src }));
  const staleCount = rows.filter((r) => r.stale).length;

  /** このセリフだけ作り直して、すぐ聴く */
  const redo = async (id: string) => {
    if (!voice) return;
    stop();
    await voice.request([id], { force: true });
    const src = voice.audioOf(id);
    if (src) play([{ id, src }]);
  };
  const busy = Boolean(voice?.running.size);

  return (
    <div className="group">
      <div className="cell">
        <button className="btn sm" disabled={!playable.length} onClick={() => (playing ? stop() : play(playable))}>
          <Ic n={playing ? Square : Play} size={12} mr={0} />
          {playing ? '停止' : '通して聴く'}
        </button>
        <span className="spacer" />
        {busy ? (
          <span className="hstack caption">
            <span className="spinner" style={{ width: 12, height: 12 }} />
            作成中
          </span>
        ) : staleCount ? (
          <button className="btn sm primary" disabled={!tts.ready} onClick={() => void voice?.request('stale')} title="音声がない・内容が変わったセリフだけを作ります">
            {staleCount}件を作り直す
          </button>
        ) : (
          <span className="caption">すべて最新です</span>
        )}
        <Popover
          align="right"
          button={({ open, toggle }) => (
            <button className="icon-btn sm" aria-expanded={open} onClick={toggle} title="そのほかの操作">
              <Ic n={Ellipsis} size={14} mr={0} />
            </button>
          )}
        >
          {(close) => (
            <MenuItem
              icon={RefreshCw}
              disabled={!tts.ready}
              onClick={async () => {
                close();
                if (await confirmDialog({ title: 'すべてのセリフの音声を作り直しますか？', message: `${rows.length}件のセリフの音声を作り直します。`, ok: '作り直す' }))
                  void voice?.request(
                    rows.map((r) => r.line.id),
                    { force: true },
                  );
              }}
            >
              すべて作り直す
            </MenuItem>
          )}
        </Popover>
      </div>
      {rows.map(({ scene, line, stale }) => (
        <div key={line.id} className={`narr-row ${playing === line.id ? 'playing' : ''}`}>
          <button
            className="icon-btn sm round"
            title={line.audio ? '再生' : '音声がありません'}
            disabled={!line.audio}
            onClick={() => (playing === line.id ? stop() : play([{ id: line.id, src: line.audio!.src }]))}
          >
            <Ic n={playing === line.id ? Square : Play} size={12} mr={0} />
          </button>
          <Avatar project={project} id={line.speaker} size={22} />
          <div className="narr-text" onClick={() => onSelectScene?.(scene)} title="このシーンを開く">
            <div className="t">{line.text.replace(/\n/g, '')}</div>
            <div className="m">
              シーン{scene + 1} ・ {speakerName(project, line.speaker)}
              {line.audio && !stale ? ` ・ ${line.audio.durationSec.toFixed(1)}秒` : ''}
              {voice?.running.has(line.id) ? (
                <span className="accent-text">・作成中</span>
              ) : voice?.errors[line.id] ? (
                <span className="danger-text" title={voice.errors[line.id]}>
                  ・作れませんでした
                </span>
              ) : stale ? (
                <span className="warn-text">・{voice?.waiting.has(line.id) ? 'まもなく更新' : line.audio ? '内容が変わりました' : '音声なし'}</span>
              ) : line.audio?.check && !line.audio.check.ok ? (
                <span className="warn-text" title={`聞こえた文: ${line.audio.check.heard}`}>
                  ・読み違いかも
                </span>
              ) : null}
            </div>
          </div>
          <button className="icon-btn sm" title="このセリフだけ作り直して、すぐ聴く" disabled={!tts.ready || Boolean(voice?.running.has(line.id))} onClick={() => redo(line.id)}>
            <Ic n={RefreshCw} size={13} mr={0} />
          </button>
        </div>
      ))}
      {!rows.length ? <div className="cell faint">セリフがありません</div> : null}
    </div>
  );
};
