import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * アプリ内の確認・入力ダイアログ。
 * window.confirm / prompt は、埋め込みブラウザ（アプリ内のプレビューなど）では表示されずに
 * 常にキャンセル扱いになることがあるため使わない。
 */
type Opts = { title: string; message?: string; ok?: string; cancel?: string; danger?: boolean };

const open = <T,>(render: (done: (v: T) => void) => React.ReactNode): Promise<T> =>
  new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: T) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(render(done));
  });

const Frame: React.FC<{ onCancel: () => void; children: React.ReactNode }> = ({ onCancel, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="modal-bg" style={{ zIndex: 2000 }} onClick={onCancel}>
      <div className="modal" style={{ width: 'min(440px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

export const confirmDialog = (o: Opts) =>
  open<boolean>((done) => (
    <Frame onCancel={() => done(false)}>
      <h3>{o.title}</h3>
      {o.message ? <div className="muted" style={{ marginBottom: 16, whiteSpace: 'pre-wrap' }}>{o.message}</div> : null}
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => done(false)}>
          {o.cancel ?? 'キャンセル'}
        </button>
        <button className={`btn ${o.danger ? 'danger' : 'primary'}`} style={o.danger ? { background: '#ff5d6c', color: '#fff', borderColor: '#ff5d6c' } : undefined} autoFocus onClick={() => done(true)}>
          {o.ok ?? 'OK'}
        </button>
      </div>
    </Frame>
  ));

const PromptBody: React.FC<{ o: Opts & { placeholder?: string; initial?: string }; done: (v: string | null) => void }> = ({ o, done }) => {
  const [v, setV] = useState(o.initial ?? '');
  return (
    <Frame onCancel={() => done(null)}>
      <h3>{o.title}</h3>
      {o.message ? <div className="muted" style={{ marginBottom: 10 }}>{o.message}</div> : null}
      <input
        className="input"
        autoFocus
        value={v}
        placeholder={o.placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v.trim()) done(v.trim());
        }}
      />
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={() => done(null)}>
          {o.cancel ?? 'キャンセル'}
        </button>
        <button className="btn primary" disabled={!v.trim()} onClick={() => done(v.trim())}>
          {o.ok ?? 'OK'}
        </button>
      </div>
    </Frame>
  );
};

export const promptDialog = (o: Opts & { placeholder?: string; initial?: string }) => open<string | null>((done) => <PromptBody o={o} done={done} />);

/** 失敗をダイアログで知らせる */
export const errorDialog = (title: string, e: unknown) =>
  open<void>((done) => (
    <Frame onCancel={() => done()}>
      <h3>{title}</h3>
      <div className="error" style={{ marginBottom: 16, whiteSpace: 'pre-wrap' }}>{(e as Error)?.message ?? String(e)}</div>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" autoFocus onClick={() => done()}>
          閉じる
        </button>
      </div>
    </Frame>
  ));
