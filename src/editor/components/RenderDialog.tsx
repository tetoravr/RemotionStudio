import { Download, Film, Play, TriangleAlert } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { FORMATS, type Project } from '../../video/schema';
import { api, waitJob, type Job } from '../api';
import { Ic } from '../icons';
import { Progress, Sheet } from './Fields';

type RenderItem = { name: string; url: string; size: number; at: number };

export const RenderDialog: React.FC<{ project: Project; onClose: () => void; staleCount: number; missingShots: number[] }> = ({ project, onClose, staleCount, missingShots }) => {
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [renders, setRenders] = useState<RenderItem[]>([]);
  const load = () => api.renders(project.id).then(setRenders).catch(() => undefined);
  useEffect(() => {
    load();
  }, []);

  const start = async () => {
    setErr(null);
    setResult(null);
    setJob({ id: '', kind: 'render', status: 'running', progress: 0, message: '準備しています' });
    try {
      const { jobId } = await api.post(`/api/projects/${project.id}/render`);
      const done = await waitJob(jobId, setJob);
      setResult((done.result as { file: string }).file);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setJob(null);
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

      {!result && staleCount > 0 && project.audio.narration ? (
        <div className="notice warn" style={{ marginBottom: 10 }}>
          <Ic n={TriangleAlert} size={15} mr={0} />
          <span>音声がまだないセリフが {staleCount} 件あります。その部分は無音になります。</span>
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
            <span className="muted">{job?.message}</span>
          </div>
          <Progress value={job?.progress ?? 0} />
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
            <button className="btn primary" onClick={start} disabled={missingShots.length > 0}>
              書き出す
            </button>
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
