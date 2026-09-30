import React, { useEffect, useState } from 'react';
import { FORMATS, type Project } from '../../video/schema';
import { api, waitJob, type Job } from '../api';
import { Progress } from './Fields';
import { Download } from 'lucide-react';
import { Ic } from '../icons';

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
  return (
    <div className="modal-bg" onClick={() => !running && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(640px, 94vw)' }}>
        <h3>MP4に書き出す</h3>
        <div className="muted" style={{ marginBottom: 10 }}>
          {FORMATS[project.format].label} ・ {FORMATS[project.format].width}×{FORMATS[project.format].height} ・ {project.fps}fps ・ H.264 + AAC
        </div>
        {staleCount > 0 && project.audio.narration ? (
          <div className="notice" style={{ marginBottom: 10, color: 'var(--warn)' }}>
            音声が未生成のセリフが {staleCount} 件あります（その部分は無音になります）。先に「ナレーション生成」を実行するのがおすすめです。
          </div>
        ) : null}
        {missingShots.length ? (
          <div className="error" style={{ marginBottom: 10 }}>
            シーン{missingShots.join('・')}（画面紹介）に、実際の画面のスクリーンショットが設定されていません。画像を設定するか、そのシーンを削除してください。
          </div>
        ) : null}
        {running || job ? (
          <>
            <div className="muted">{job?.message}</div>
            <Progress value={job?.progress ?? 0} />
            <div className="faint">30秒の動画で2〜4分ほどかかります（PCの性能によります）。このままお待ちください。</div>
          </>
        ) : null}
        {err ? <div className="error">{err}</div> : null}
        {result ? (
          <div style={{ marginTop: 10 }}>
            <video className="result" src={result} controls autoPlay />
            <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
              <a className="btn primary" style={{ flex: 'none', textDecoration: 'none' }} href={result} download>
                <Ic n={Download} />ダウンロード
              </a>
            </div>
          </div>
        ) : null}
        {!running && !result ? (
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" style={{ flex: 'none' }} onClick={onClose}>
              閉じる
            </button>
            <button className="btn primary" style={{ flex: 'none' }} onClick={start} disabled={missingShots.length > 0}>
              書き出し開始
            </button>
          </div>
        ) : null}
        {renders.length ? (
          <div style={{ marginTop: 18 }}>
            <div className="label" style={{ marginBottom: 6 }}>
              過去の書き出し
            </div>
            {renders.slice(0, 8).map((r) => (
              <div key={r.name} className="row center" style={{ marginBottom: 4 }}>
                <span className="faint" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {new Date(r.at).toLocaleString('ja-JP')} ・ {(r.size / 1024 / 1024).toFixed(1)}MB
                </span>
                <a className="btn sm" style={{ flex: 'none', textDecoration: 'none' }} href={r.url} target="_blank" rel="noreferrer">
                  再生
                </a>
                <a className="btn sm" style={{ flex: 'none', textDecoration: 'none' }} href={r.url} download>
                  保存
                </a>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
