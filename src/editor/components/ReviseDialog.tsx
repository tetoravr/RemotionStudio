import React, { useState } from 'react';

const EXAMPLES = [
  'もっとテンポよく、セリフを短くして',
  '15秒版に短くして',
  'ターゲットを経営者向けに変えて',
  '課題の共感パートを強めて',
  '特徴を「コスト削減」中心にして',
  '敬語でフォーマルなトーンにして',
];

export const ReviseDialog: React.FC<{ onClose: () => void; onSubmit: (instruction: string) => void }> = ({ onClose, onSubmit }) => {
  const [text, setText] = useState('');
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>✨ AIに台本の修正を頼む</h3>
        <div className="muted" style={{ marginBottom: 10 }}>
          構成・セリフ・図解をまとめて書き直します。キャラクター・配色・画像はそのまま残ります。修正後も「元に戻す」で戻せます。
        </div>
        <textarea className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="例: 2つ目の特徴を「導入が3日で完了」に差し替えて" autoFocus />
        <div className="chips" style={{ margin: '10px 0 16px' }}>
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => setText(e)}>
              {e}
            </button>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" style={{ flex: 'none' }} onClick={onClose}>
            キャンセル
          </button>
          <button className="btn primary" style={{ flex: 'none' }} disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>
            修正する
          </button>
        </div>
      </div>
    </div>
  );
};
