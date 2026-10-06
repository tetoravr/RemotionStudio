import React from 'react';
import { withBase } from '../base';
import { APP_VERSION } from '../version';

/**
 * 最初の読み込み画面。index.html に書いた画面と同じ見た目（スタイルも index.html にある）で、
 * 画面のプログラムが届いてから、サーバーの準備ができるまでの間に出す。
 * error を渡すと、つながらない時の画面になる
 */
export const Splash: React.FC<{
  message?: string;
  error?: { title: string; message: string; detail?: string; action?: { label: string; onClick: () => void } };
}> = ({ message, error }) => (
  // handoff: index.html の画面から引き継ぐので、出てくる動きはもう一度は付けない
  <div className={`boot handoff ${error ? 'boot-failed' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">
    <img className="boot-logo" src={withBase('/brand/logo.png')} alt="" width={76} height={76} />
    <div className="boot-name">Video Creator</div>
    <div className="boot-sub">AI広告動画メーカー</div>
    {error ? (
      <div className="boot-err">
        <b>{error.title}</b>
        {error.message}
        {error.detail ? <div className="boot-detail">{error.detail}</div> : null}
        <div className="boot-actions">
          {error.action ? (
            <button type="button" className="boot-btn quiet" onClick={error.action.onClick}>
              {error.action.label}
            </button>
          ) : null}
          <button type="button" className="boot-btn" onClick={() => window.location.reload()}>
            再読み込み
          </button>
        </div>
      </div>
    ) : (
      <>
        <div className="boot-bar" />
        <div className="boot-msg">{message ?? '読み込んでいます…'}</div>
      </>
    )}
    {APP_VERSION ? <div className="boot-ver">v{APP_VERSION}</div> : null}
  </div>
);
