import React, { useEffect, useState } from 'react';
import { api, type Meta } from './api';
import { Editor } from './pages/Editor';
import { Home } from './pages/Home';
import { NewWizard } from './pages/NewWizard';

export const MetaContext = React.createContext<Meta | null>(null);

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

export const App: React.FC = () => {
  const route = useHashRoute();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.meta().then(setMeta).catch((e) => setError(`サーバーに接続できません（npm run dev で起動しているか確認してください）\n${e.message}`));
  }, []);
  if (error) return <div className="home"><div className="error">{error}</div></div>;
  if (!meta) return <div className="home muted">読み込み中…</div>;
  const m = route.match(/^\/p\/([^/]+)/);
  return (
    <MetaContext.Provider value={meta}>
      {m ? <Editor key={m[1]} id={m[1]} /> : route.startsWith('/new') ? <NewWizard /> : <Home />}
    </MetaContext.Provider>
  );
};
