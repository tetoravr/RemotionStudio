import { confirmDialog, errorDialog, promptDialog } from '../components/Dialogs';
import React, { useContext, useEffect, useState } from 'react';
import { FORMATS } from '../../video/schema';
import { api, type ProjectSummary } from '../api';
import { go, MetaContext } from '../App';
import { Sparkles } from 'lucide-react';
import { Ic } from '../icons';

export const Home: React.FC = () => {
  const meta = useContext(MetaContext)!;
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.list().then(setList).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);

  const createBlank = async () => {
    const brandName = await promptDialog({ title: 'テンプレートから作る', message: '商品・ブランド名を入力してください', placeholder: '例: SUSHI TOP OCR', ok: '作成' });
    if (!brandName) return;
    try {
      const p = await api.create({ title: `${brandName} 広告動画`, brandName, format: 'vertical' });
      go(`/p/${p.id}`);
    } catch (e) {
      errorDialog('作成できませんでした', e);
    }
  };

  return (
    <div className="home">
      <div className="hero-banner">
        <div style={{ flex: 1 }}>
          <div className="pill" style={{ marginBottom: 12 }}>Remotion × OpenAI</div>
          <h1>
            商品情報を入れるだけで、
            <br />
            30秒のSNS広告動画を。
          </h1>
          <p>
            AIが台本・キャラクターの掛け合い・ナレーションを作り、集中線・吹き出し・図解アニメで仕上げます。
            <br />
            編集はプレビューを見ながら文字を直すだけ。縦型・正方形・横型に書き出せます。
          </p>
          <div className="btn-row">
            <button className="btn primary lg" onClick={() => go('/new')} disabled={!meta.openai} title={meta.openai ? '' : 'OPENAI_API_KEY が未設定です'}>
              <Ic n={Sparkles} />AIで新しく作る
            </button>
            <button className="btn lg" onClick={createBlank}>
              テンプレートから作る
            </button>
          </div>
          {!meta.openai ? (
            <div className="notice" style={{ marginTop: 14 }}>
              OpenAI API キーが未設定のため AI 機能はオフです。<code>.env</code> に <code>OPENAI_API_KEY</code> を設定してサーバーを再起動してください。
            </div>
          ) : null}
        </div>
      </div>

      <div className="row center" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, flex: 'none' }}>プロジェクト</h2>
        <span className="faint" style={{ flex: 'none' }}>{list ? `${list.length}件` : ''}</span>
      </div>
      {err ? <div className="error">{err}</div> : null}
      <div className="cards">
        {(list ?? []).map((p) => (
          <div key={p.id} className="card" onClick={() => go(`/p/${p.id}`)}>
            <div className="thumb" style={{ background: `linear-gradient(135deg, ${p.primary}, ${p.primary}88)` }}>
              <div className="brand">{p.brand}</div>
              {p.thumbnail ? <img src={p.thumbnail} alt="" /> : null}
            </div>
            <div className="body">
              <div style={{ fontWeight: 800 }}>{p.title}</div>
              <div className="btn-row tight">
                <span className="pill">{FORMATS[p.format].label.split('（')[0]}</span>
                <span className="pill">{p.scenes}シーン</span>
              </div>
              <div className="faint">{p.updatedAt ? new Date(p.updatedAt).toLocaleString('ja-JP') : ''}</div>
            </div>
            <div className="actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn sm ghost"
                onClick={async () => {
                  try {
                    const n = await api.duplicate(p.id);
                    go(`/p/${n.id}`);
                  } catch (e) {
                    errorDialog('複製できませんでした', e);
                  }
                }}
              >
                複製
              </button>
              <div className="spacer" />
              <button
                className="btn sm ghost danger"
                onClick={async () => {
                  const ok = await confirmDialog({ title: `「${p.title}」を削除しますか？`, message: '音声・画像・書き出した動画もすべて削除されます。元に戻せません。', ok: '削除する', danger: true });
                  if (!ok) return;
                  try {
                    await api.remove(p.id);
                  } catch (e) {
                    errorDialog('削除できませんでした', e);
                  }
                  load();
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
