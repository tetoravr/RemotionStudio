import { Download, Film, Play, TriangleAlert } from 'lucide-react';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { isAudioStale } from '../../video/narrationKey';
import { FORMATS, type Project } from '../../video/schema';
import { api, ttsFor, waitJob, type Job } from '../api';
import { MetaContext } from '../App';
import { Ic } from '../icons';
import { useVoice } from '../voice';
import { Progress, Sheet } from './Fields';

type RenderItem = { name: string; url: string; size: number; at: number };

export const RenderDialog: React.FC<{ project: Project; onClose: () => void; missingShots: number[] }> = ({ project, onClose, missingShots }) => {
  const meta = useContext(MetaContext)!;
  const tts = ttsFor(meta, project.audio);
  const voice = useVoice();
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [renders, setRenders] = useState<RenderItem[]>([]);
  const alive = useRef(true);
  const load = () => api.renders(project.id).then(setRenders).catch(() => undefined);

  // 音声の状態: まだ無いセリフは無音、内容を変えたセリフは前の音声のまま書き出される
  const lines = project.audio.narration ? project.scenes.flatMap((s) => s.lines).filter((l) => l.text.trim() || l.speak?.trim()) : [];
  const stale = lines.filter((l) => isAudioStale(l, project.cast, tts.engine));
  const missingAudio = stale.filter((l) => !l.audio).length;
  const outdatedAudio = stale.length - missingAudio;
  const canMakeVoice = Boolean(voice && tts.ready && stale.length);

  const follow = async (jobId: string) => {
    try {
      const done = await waitJob(jobId, (j) => alive.current && setJob(j));
      if (!alive.current) return;
      setResult((done.result as { file: string }).file);
      load();
    } catch (e) {
      if (alive.current) setErr((e as Error).message);
    } finally {
      if (alive.current) setJob(null);
    }
  };

  useEffect(() => {
    alive.current = true;
    load();
    // 書き出し中に画面を閉じた・再読み込みした時は、その続きを表示する
    api
      .jobs(project.id)
      .then((list) => {
        const r = list.find((j) => j.kind === 'render');
        if (r && alive.current) {
          setJob(r);
          void follow(r.id);
        }
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (makeVoice: boolean) => {
    setErr(null);
    setResult(null);
    setJob({ id: '', kind: 'render', status: 'running', progress: 0, message: makeVoice ? '音声を作っています' : '準備しています' });
    if (makeVoice && voice) {
      // 音声がまだ無い・古いセリフを先に作る（作れなかったセリフは、そのまま書き出す）
      await voice.request('stale');
      if (!alive.current) return;
      setJob({ id: '', kind: 'render', status: 'running', progress: 0, message: '準備しています' });
    }
    try {
      const { jobId } = await api.post(`/api/projects/${project.id}/render`);
      await follow(jobId);
    } catch (e) {
      if (alive.current) {
        setErr((e as Error).message);
        setJob(null);
      }
    }
  };

  const running = job?.status === 'running';
  const f = FORMATS[project.format];
  return (
    <Sheet wide onClose={running ? undefined : onClose}>
      {!result ? (
        <div className="sheet-icon">
          <Ic n={Film} size={22} mr={0} />
        </div>
      ) : null}
      <h3>{result ? '書き出しが完了しました' : '動画を書き出す'}</h3>
      <div className="sheet-text" style={{ marginBottom: 14 }}>
        MP4 ・ {f.label.split('（')[0]} {f.width}×{f.height} ・ {project.fps}fps
      </div>

      {!result && !running && stale.length ? (
        <div className="notice warn" style={{ marginBottom: 10 }}>
          <Ic n={TriangleAlert} size={15} mr={0} />
          <span>
            {[missingAudio ? `音声がまだないセリフが ${missingAudio} 件（その部分は無音）` : '', outdatedAudio ? `内容を変えて音声が古いセリフが ${outdatedAudio} 件（前の音声のまま）` : '']
              .filter(Boolean)
              .join('、')}
            あります。
            {canMakeVoice ? '「音声を作ってから書き出す」で、先に作り直せます。' : ''}
          </span>
        </div>
      ) : null}
      {!result && missingShots.length ? (
        <div className="error" style={{ marginBottom: 10 }}>
          シーン{missingShots.join('・')}（画面紹介）にスクリーンショットがありません。画像を設定するか、そのシーンを削除してください。
        </div>
      ) : null}

      {running ? (
        <>
          <div className="hstack">
            <span className="spinner" />
            <span className="muted">
              {!job?.id && voice?.progress ? `音声を作っています ${voice.progress.done}/${voice.progress.total}` : job?.message}
            </span>
          </div>
          <Progress value={!job?.id && voice?.progress ? voice.progress.done / Math.max(1, voice.progress.total) : job?.progress ?? 0} />
          <div className="caption">30秒の動画で2〜4分ほどかかります。このままお待ちください。</div>
        </>
      ) : null}
      {err ? <div className="error">{err}</div> : null}
      {result ? <video className="result" src={result} controls autoPlay /> : null}

      <div className="sheet-actions">
        {result ? (
          <>
            <button className="btn" onClick={onClose}>
              閉じる
            </button>
            <a className="btn primary" href={result} download>
              <Ic n={Download} size={14} mr={0} />
              ダウンロード
            </a>
          </>
        ) : !running ? (
          <>
            <button className="btn" onClick={onClose}>
              キャンセル
            </button>
            {canMakeVoice ? (
              <>
                <button className="btn" onClick={() => void start(false)} disabled={missingShots.length > 0}>
                  このまま書き出す
                </button>
                <button className="btn primary" onClick={() => void start(true)} disabled={missingShots.length > 0}>
                  音声を作ってから書き出す
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={() => void start(false)} disabled={missingShots.length > 0}>
                書き出す
              </button>
            )}
          </>
        ) : null}
      </div>

      {renders.length && !running ? (
        <>
          <div className="section-title" style={{ marginTop: 22 }}>
            これまでの書き出し
          </div>
          <div className="group">
            {renders.slice(0, 6).map((r) => (
              <div key={r.name} className="cell">
                <span className="cell-label">
                  {new Date(r.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  <span className="sub">{(r.size / 1024 / 1024).toFixed(1)}MB</span>
                </span>
                <a className="icon-btn" href={r.url} target="_blank" rel="noreferrer" title="再生">
                  <Ic n={Play} size={14} mr={0} />
                </a>
                <a className="icon-btn" href={r.url} download title="保存">
                  <Ic n={Download} size={14} mr={0} />
                </a>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Sheet>
  );
};
