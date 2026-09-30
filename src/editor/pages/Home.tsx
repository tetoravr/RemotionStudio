import { Clapperboard, Copy, Ellipsis, LayoutTemplate, LogOut, Plus, Sparkles, Trash2 } from 'lucide-react';
import React, { useContext, useEffect, useState } from 'react';
import { FORMATS } from '../../video/schema';
import { api, type ProjectSummary } from '../api';
import { go, MetaContext } from '../App';
import { confirmDialog, errorDialog } from '../components/Dialogs';
import { MenuItem, Popover, Sheet } from '../components/Fields';
import { Ic } from '../icons';

/** 「今日 14:32」「昨日」「9月28日」のような短い日時 */
const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const hm = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `今日 ${hm}`;
  if (diff === 1) return `昨日 ${hm}`;
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

/** ログイン中のユーザー（Google ログインを設定した時だけ表示） */
const UserMenu: React.FC = () => {
  const [me, setMe] = useState<{ email: string; name: string; picture?: string } | null>(null);
  useEffect(() => {
    api.me().then((r) => setMe(r.user)).catch(() => setMe(null));
  }, []);
  if (!me) return null;
  return (
    <Popover
      align="right"
      width={240}
      button={({ toggle }) => (
        <button className="avatar-btn" onClick={toggle} title={me.email}>
          {me.picture ? (
            <img src={me.picture} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 28, borderRadius: '50%', display: 'block' }} />
          ) : (
            <span className="avatar">{me.name.slice(0, 1)}</span>
          )}
        </button>
      )}
    >
      {() => (
        <>
          <div style={{ padding: '8px 10px 6px' }}>
            <div style={{ fontWeight: 600 }}>{me.name}</div>
            <div className="caption">{me.email}</div>
          </div>
          <div className="menu-sep" />
          <MenuItem
            icon={LogOut}
            onClick={async () => {
              await api.logout();
              window.location.href = '/auth/login';
            }}
          >
            ログアウト
          </MenuItem>
        </>
      )}
    </Popover>
  );
};

/** 新しい動画の作り方を選ぶシート */
const NewSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const meta = useContext(MetaContext)!;
  const [blank, setBlank] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await api.create({ title: `${name.trim()} 広告動画`, brandName: name.trim(), format: 'vertical' });
      go(`/p/${p.id}`);
    } catch (e) {
      setBusy(false);
      errorDialog('作成できませんでした', e);
    }
  };
  return (
    <Sheet onClose={onClose}>
      {!blank ? (
        <>
          <h3>新しい動画</h3>
          <div className="sheet-text">作り方を選んでください。</div>
          <div className="choice-list">
            <button className="choice" disabled={!meta.openai} onClick={() => go('/new')} title={meta.openai ? '' : 'OPENAI_API_KEY が未設定です'}>
              <span className="choice-icon">
                <Ic n={Sparkles} size={20} mr={0} />
              </span>
              <span>
                <div className="choice-title">AIで作る</div>
                <div className="choice-sub">商品のURLや資料から、台本・キャラクターの掛け合い・ナレーションまで作ります</div>
              </span>
            </button>
            <button className="choice" onClick={() => setBlank(true)}>
              <span className="choice-icon">
                <Ic n={LayoutTemplate} size={20} mr={0} />
              </span>
              <span>
                <div className="choice-title">テンプレートから作る</div>
                <div className="choice-sub">定番の構成のひな形に、自分で文字を入れて作ります</div>
              </span>
            </button>
          </div>
          <div className="sheet-actions">
            <button className="btn" onClick={onClose}>
              キャンセル
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>テンプレートから作る</h3>
          <div className="sheet-text" style={{ marginBottom: 12 }}>
            紹介する商品・サービスの名前を入れてください。
          </div>
          <input
            className="input"
            autoFocus
            value={name}
            placeholder="例: SUSHI TOP OCR"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <div className="sheet-actions">
            <button className="btn" onClick={() => setBlank(false)}>
              戻る
            </button>
            <button className="btn primary" disabled={!name.trim() || busy} onClick={create}>
              作成
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
};

const ProjectTile: React.FC<{ p: ProjectSummary; reload: () => void }> = ({ p, reload }) => (
  <div className="tile" onClick={() => go(`/p/${p.id}`)}>
    <div className="art" style={{ background: `linear-gradient(155deg, ${p.primary} 0%, color-mix(in srgb, ${p.primary} 72%, #000) 100%)` }}>
      <div className="brand ellipsis">{p.brand}</div>
      {p.thumbnail ? <img src={p.thumbnail} alt="" /> : null}
    </div>
    <div className="meta">
      <div className="name ellipsis">{p.title}</div>
      <div className="sub">
        {FORMATS[p.format].label.split('（')[0]} ・ {p.scenes}シーン{p.updatedAt ? ` ・ ${when(p.updatedAt)}` : ''}
        {p.updatedBy ? ` ・ ${p.updatedBy.split('@')[0]}` : ''}
      </div>
    </div>
    <div className="more-wrap">
      <Popover
        align="right"
        button={({ open, toggle }) => (
          <button className="icon-btn round more" aria-expanded={open} onClick={toggle} title="操作">
            <Ic n={Ellipsis} size={15} mr={0} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={Copy}
              onClick={async () => {
                close();
                try {
                  const n = await api.duplicate(p.id);
                  go(`/p/${n.id}`);
                } catch (e) {
                  errorDialog('複製できませんでした', e);
                }
              }}
            >
              複製
            </MenuItem>
            <div className="menu-sep" />
            <MenuItem
              icon={Trash2}
              danger
              onClick={async () => {
                close();
                const ok = await confirmDialog({ title: `「${p.title}」を削除しますか？`, message: '音声・画像・書き出した動画もすべて削除されます。元に戻せません。', ok: '削除', danger: true });
                if (!ok) return;
                try {
                  await api.remove(p.id);
                } catch (e) {
                  errorDialog('削除できませんでした', e);
                }
                reload();
              }}
            >
              削除
            </MenuItem>
          </>
        )}
      </Popover>
    </div>
  </div>
);

export const Home: React.FC = () => {
  const meta = useContext(MetaContext)!;
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = () => api.list().then(setList).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="home">
      <header className="home-bar">
        <div className="wordmark">
          <span className="logo">
            <Ic n={Clapperboard} size={13} mr={0} />
          </span>
          Ad Studio
        </div>
        <span className="spacer" />
        <UserMenu />
      </header>
      <main className="home-main">
        <div className="home-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="title-1">プロジェクト</h1>
            <p>商品の情報から、キャラクターが話す短い広告動画をつくります。</p>
          </div>
        </div>
        {!meta.openai ? (
          <div className="notice warn" style={{ marginBottom: 22 }}>
            OpenAI の API キーが未設定のため、AI の機能は使えません。<code>.env</code> に <code>OPENAI_API_KEY</code> を設定してサーバーを再起動してください。
          </div>
        ) : null}
        {err ? (
          <div className="error" style={{ marginBottom: 22 }}>
            {err}
          </div>
        ) : null}
        <div className="grid">
          <div className="tile new" onClick={() => setCreating(true)}>
            <div className="art">
              <span className="plus">
                <Ic n={Plus} size={22} mr={0} />
              </span>
              <span style={{ fontWeight: 600 }}>新しい動画</span>
            </div>
            <div className="meta">
              <div className="name">新規作成</div>
              <div className="sub">AIで作る・テンプレートから作る</div>
            </div>
          </div>
          {(list ?? []).map((p) => (
            <ProjectTile key={p.id} p={p} reload={load} />
          ))}
        </div>
      </main>
      {creating ? <NewSheet onClose={() => setCreating(false)} /> : null}
    </div>
  );
};
