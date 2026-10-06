import React, { useCallback, useEffect, useState } from 'react';
import { api, type Meta } from './api';
import { Splash } from './components/Splash';
import { Editor } from './pages/Editor';
import { Home } from './pages/Home';
import { NewWizard } from './pages/NewWizard';

export const MetaContext = React.createContext<Meta | null>(null);
/** 参照音声の追加・削除のあとにボイス一覧を読み直す */
export const RefreshMetaContext = React.createContext<() => Promise<void>>(async () => undefined);

const useHashRoute = () => {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
};

export const go = (path: string) => {
  window.location.hash = path;
};

/** サーバーにつながるまで待つ回数（3秒おき・約1分。デプロイ直後などでサーバーが起動中のことがある） */
const MAX_TRIES = 20;
const local = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

export const App: React.FC = () => {
  const route = useHashRoute();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 応答が遅い時は、サーバーの準備中であることを伝える
    const slow = setTimeout(() => alive && setMessage('サーバーの準備をしています…'), 4000);
    const load = () =>
      api
        .meta()
        .then((m) => alive && setMeta(m))
        .catch((e: Error & { auth?: boolean }) => {
          if (!alive || e.auth) return; // ログインが切れていたら、ログイン画面へ移っている
          if (++tries >= MAX_TRIES) return setError(e.message);
          setMessage('サーバーに接続できません。もう一度つないでいます…\n（サーバーの起動中は、1分ほどかかることがあります）');
          timer = setTimeout(load, 3000);
        });
    void load();
    return () => {
      alive = false;
      clearTimeout(slow);
      clearTimeout(timer);
    };
  }, []);
  const refreshMeta = useCallback(() => api.meta().then(setMeta), []);
  if (error)
    return (
      <Splash
        error={{
          title: 'サーバーに接続できません',
          message: local
            ? 'サーバーが起動しているか確認してください（npm run dev）。起動したら、再読み込みしてください。'
            : 'しばらく待ってから、再読み込みしてください。直らない時は、管理者に連絡してください。',
          detail: error,
        }}
      />
    );
  if (!meta) return <Splash message={message} />;
  const m = route.match(/^\/p\/([^/]+)/);
  return (
    <MetaContext.Provider value={meta}>
      <RefreshMetaContext.Provider value={refreshMeta}>
        {m ? <Editor key={m[1]} id={m[1]} /> : route.startsWith('/new') ? <NewWizard /> : <Home />}
      </RefreshMetaContext.Provider>
    </MetaContext.Provider>
  );
};
