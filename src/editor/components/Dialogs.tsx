import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TriangleAlert } from 'lucide-react';
import { Ic } from '../icons';
import { isEnter } from '../keys';

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
    <div className="sheet-backdrop" style={{ zIndex: 2000 }} onClick={onCancel}>
      <div className="sheet" style={{ width: 'min(400px, 100%)' }} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
};

export const confirmDialog = (o: Opts) =>
  open<boolean>((done) => (
    <Frame onCancel={() => done(false)}>
      <h3>{o.title}</h3>
      {o.message ? <div className="sheet-text">{o.message}</div> : null}
      <div className="sheet-actions">
        <button className="btn" onClick={() => done(false)}>
          {o.cancel ?? 'キャンセル'}
        </button>
        <button className={`btn ${o.danger ? 'destructive' : 'primary'}`} autoFocus onClick={() => done(true)}>
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
      {o.message ? <div className="sheet-text" style={{ marginBottom: 12 }}>{o.message}</div> : null}
      <input
        className="input"
        autoFocus
        value={v}
        placeholder={o.placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (isEnter(e) && v.trim()) done(v.trim());
        }}
      />
      <div className="sheet-actions">
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
      <div className="sheet-icon" style={{ background: 'rgba(255,59,48,.12)', color: 'var(--red)' }}>
        <Ic n={TriangleAlert} size={22} mr={0} />
      </div>
      <h3>{title}</h3>
      <div className="sheet-text">{(e as Error)?.message ?? String(e)}</div>
      <div className="sheet-actions">
        <button className="btn primary" autoFocus onClick={() => done()}>
          OK
        </button>
      </div>
    </Frame>
  ));
