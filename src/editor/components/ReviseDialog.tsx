import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Ic } from '../icons';
import { Sheet } from './Fields';

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
    <Sheet onClose={onClose}>
      <div className="sheet-icon">
        <Ic n={Sparkles} size={22} mr={0} />
      </div>
      <h3>AIで台本を直す</h3>
      <div className="sheet-text">どう直したいかを書いてください。キャラクター・配色・画像はそのまま残ります。あとから取り消すこともできます。</div>
      <textarea
        className="textarea"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) onSubmit(text.trim());
        }}
        placeholder="例: 2つ目の特徴を「導入が3日で完了」に差し替えて"
        autoFocus
      />
      <div className="chips" style={{ marginTop: 10 }}>
        {EXAMPLES.map((e) => (
          <button key={e} className="chip" onClick={() => setText(e)}>
            {e}
          </button>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={onClose}>
          キャンセル
        </button>
        <button className="btn primary" disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>
          直す
        </button>
      </div>
    </Sheet>
  );
};
