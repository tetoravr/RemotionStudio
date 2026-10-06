import { Check, Pause, Play, RotateCcw, Search, Upload, Wand2 } from 'lucide-react';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { standardRefVoice } from '../../video/audioTags';
import { LIBRARY_CHARACTERS } from '../../video/library';
import type { CastMember } from '../../video/schema';
import { api, type ElevenVoice } from '../api';
import { MetaContext } from '../App';
import { Ic } from '../icons';
import { Field, FilePick, Seg, Sheet, Text } from './Fields';
import { isEnter } from '../keys';

type Set = (fn: (m: CastMember) => void) => void;

/** キャラの今の声の説明（選んだ声・標準の声・声のイメージから自動） */
export const elevenVoiceLabel = (c: CastMember) => {
  if (c.voice.eleven?.voiceId) return c.voice.eleven.name || 'ElevenLabs の声';
  const ref = standardRefVoice({ ...c.voice, library: c.library });
  if (ref) return `標準の声（${LIBRARY_CHARACTERS[ref]?.name ?? ref}）`;
  return '声のイメージから自動で作る声';
};

/** 試聴（1つだけ鳴らす） */
const usePlayer = () => {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (key: string, url: string) => {
    audio.current?.pause();
    if (playing === key) {
      setPlaying(null);
      return;
    }
    const a = new Audio(url);
    a.onended = () => setPlaying(null);
    a.onerror = () => setPlaying(null);
    audio.current = a;
    a.play().then(() => setPlaying(key)).catch(() => setPlaying(null));
  };
  return { playing, toggle };
};

const sampleText = (name: string) =>
  `こんにちは、${name}です。今日は、とっても便利なサービスをご紹介します。難しいことは何もありません。スマホひとつで、すぐに始められます。気軽に、はじめてみてくださいね。`;

type Tab = 'library' | 'mine' | 'design' | 'clone';

/** ElevenLabs の声を選ぶシート */
export const ElevenVoiceSheet: React.FC<{ member: CastMember; set: Set; onClose: () => void }> = ({ member: c, set, onClose }) => {
  const meta = useContext(MetaContext)!;
  const el = meta.tts.elevenlabs;
  const [tab, setTab] = useState<Tab>('library');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const player = usePlayer();

  const choose = (voiceId: string, name: string) => {
    set((m) => void (m.voice.eleven = { ...m.voice.eleven, voiceId, name }));
    setErr(null);
    setMsg(`「${name}」に決めました。音声を作り直すと、すべてのセリフがこの声になります。`);
  };
  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  return (
    <Sheet wide onClose={onClose}>
      <h3>{c.name}の声</h3>
      <div className="sheet-text">ElevenLabs の声から選ぶか、声のイメージから新しく作ります。決めた声で、すべてのセリフが読まれます。</div>

      <div className="notice accent" style={{ marginBottom: 14, alignItems: 'center' }}>
        <Ic n={Check} size={15} mr={0} />
        <span style={{ flex: 1 }}>いまの声: {elevenVoiceLabel(c)}</span>
        {c.voice.eleven?.voiceId && standardRefVoice({ ...c.voice, library: c.library }) ? (
          <button
            className="btn sm plain"
            onClick={() => {
              set((m) => void (m.voice.eleven = { ...m.voice.eleven, voiceId: undefined, name: undefined }));
              setMsg('標準の声に戻しました。');
            }}
          >
            <Ic n={RotateCcw} size={12} mr={0} />
            標準の声に戻す
          </button>
        ) : null}
      </div>

      {!el.online ? <div className="error" style={{ marginBottom: 12 }}>{el.configured ? el.error ?? 'ElevenLabs に接続できません' : 'ElevenLabs の API キーが未設定です（.env に ELEVENLABS_API_KEY を設定して、サーバーを再起動してください）'}</div> : null}

      <Seg
        block
        value={tab}
        onChange={setTab}
        options={[
          { value: 'library', label: 'ライブラリ' },
          { value: 'mine', label: '自分の声' },
          { value: 'design', label: '声を作る' },
          { value: 'clone', label: '手持ちの音声' },
        ]}
      />
      <div style={{ marginTop: 14, minHeight: 220 }}>
        {tab === 'library' || tab === 'mine' ? (
          <VoiceBrowser key={tab} scope={tab} disabled={!el.online} player={player} onPick={(v) => run(async () => {
            if (v.publicOwnerId) {
              const added = await api.elevenAddLibrary({ publicOwnerId: v.publicOwnerId, voiceId: v.id, name: v.name });
              choose(added.voiceId, v.name);
            } else choose(v.id, v.name);
          })} />
        ) : null}
        {tab === 'design' ? <VoiceDesigner member={c} disabled={!el.online} player={player} onChosen={choose} onError={setErr} /> : null}
        {tab === 'clone' ? (
          <div>
            <div className="notice" style={{ marginBottom: 12 }}>
              自分の声、または本人の許諾を得た声だけを使ってください。他人の声のまねは禁止です。1〜2分の、雑音のない話し声が向いています。
            </div>
            <FilePick
              accept="audio/*"
              className="btn primary"
              onFile={(f) =>
                run(async () => {
                  const r = await api.elevenClone(f, `${c.name}の声`);
                  choose(r.voiceId, r.name);
                })
              }
            >
              <Ic n={Upload} size={14} mr={0} />
              音声ファイルを選ぶ…
            </FilePick>
            {el.canClone === false ? <div className="hint" style={{ marginTop: 8 }}>いまのプランでは使えない可能性があります（Starter 以上が必要です）</div> : null}
          </div>
        ) : null}
      </div>

      {msg ? (
        <div className="notice accent" style={{ marginTop: 10 }}>
          <Ic n={Check} size={15} mr={0} />
          {msg}
        </div>
      ) : null}
      {err ? <div className="error" style={{ marginTop: 10 }}>{err}</div> : null}

      <div className="sheet-actions">
        <button className="btn primary" onClick={onClose}>
          完了
        </button>
      </div>
    </Sheet>
  );
};

/** 声の一覧（ライブラリ・自分の声） */
const VoiceBrowser: React.FC<{ scope: 'library' | 'mine'; disabled: boolean; player: ReturnType<typeof usePlayer>; onPick: (v: ElevenVoice) => Promise<void> }> = ({
  scope,
  disabled,
  player,
  onPick,
}) => {
  const [q, setQ] = useState('');
  const [gender, setGender] = useState('');
  const [list, setList] = useState<ElevenVoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (query = q, g = gender) => {
    if (disabled) return;
    setErr(null);
    setList(null);
    try {
      setList((await api.elevenVoices(scope, query, g)).voices);
    } catch (x) {
      setErr((x as Error).message);
      setList([]);
    }
  };
  useEffect(() => {
    void load('', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, disabled]);

  return (
    <div>
      <div className="hstack" style={{ marginBottom: 10 }}>
        <div className="search-field" style={{ flex: 1 }}>
          <Ic n={Search} size={14} mr={0} />
          <input
            className="input"
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            onKeyDown={(ev) => isEnter(ev) && load()}
            placeholder={scope === 'library' ? '例: ナレーション・明るい・アニメ' : '名前で探す'}
          />
        </div>
        {scope === 'library' ? (
          <Seg
            value={gender}
            onChange={(v) => (setGender(v), load(q, v))}
            options={[
              { value: '', label: 'すべて' },
              { value: 'female', label: '女性' },
              { value: 'male', label: '男性' },
            ]}
          />
        ) : null}
        <button className="btn sm" disabled={disabled} onClick={() => load()}>
          探す
        </button>
      </div>
      {scope === 'library' ? <div className="hint" style={{ marginBottom: 8 }}>ElevenLabs の共有ライブラリにある日本語の声です。選ぶと自分の声に追加されます。</div> : null}
      {err ? <div className="error">{err}</div> : null}
      {list === null ? (
        disabled ? null : (
          <div className="hstack caption" style={{ padding: 12 }}>
            <span className="spinner" style={{ width: 13, height: 13 }} />
            読み込んでいます
          </div>
        )
      ) : list.length ? (
        <div className="group voice-list">
          {list.map((v) => (
            <div key={v.id} className="cell">
              <button
                className="icon-btn"
                disabled={!v.previewUrl}
                onClick={() => v.previewUrl && player.toggle(v.id, v.previewUrl)}
                title={v.previewUrl ? '試聴' : '試聴の音声がありません'}
              >
                <Ic n={player.playing === v.id ? Pause : Play} size={14} mr={0} />
              </button>
              <div className="cell-label">
                {v.name}
                <span className="sub">{[...v.tags, v.description].filter(Boolean).join(' ・ ').slice(0, 90)}</span>
              </div>
              <button
                className="btn sm primary"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(v.id);
                  await onPick(v);
                  setBusy(null);
                }}
              >
                {busy === v.id ? '追加中…' : 'この声にする'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="lines-empty">{scope === 'mine' ? '自分の声がまだありません。「ライブラリ」か「声を作る」から選んでください' : '見つかりませんでした'}</div>
      )}
    </div>
  );
};

/** 声のイメージから作る（Voice Design） */
const VoiceDesigner: React.FC<{
  member: CastMember;
  disabled: boolean;
  player: ReturnType<typeof usePlayer>;
  onChosen: (voiceId: string, name: string) => void;
  onError: (e: string | null) => void;
}> = ({ member: c, disabled, player, onChosen, onError }) => {
  const [description, setDescription] = useState(c.voice.caption || c.voice.instructions);
  const [text, setText] = useState(() => sampleText(c.name));
  const [cands, setCands] = useState<{ id: string; durationSec: number; url: string }[]>([]);
  const [pending, setPending] = useState(false);
  const [adopting, setAdopting] = useState<string | null>(null);

  const generate = async () => {
    onError(null);
    setPending(true);
    try {
      const r = await api.elevenDesign({ description, text });
      setCands((o) => [...r.previews, ...o]);
    } catch (x) {
      onError((x as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <Field label="声のイメージ" hint="年齢・性別・声質・話し方など。日本語で書けます（例: 20代の明るい女性。やわらかく親しみやすい、CMのナレーター風）">
        <Text value={description} onChange={setDescription} multiline />
      </Field>
      <Field label="試しに読む文章" hint="100文字以上が必要です（短い時は見本の文を足して読みます）">
        <Text value={text} onChange={setText} multiline />
      </Field>
      <div className="hstack" style={{ marginBottom: 12 }}>
        <button className="btn primary" disabled={disabled || pending || description.trim().length < 4} onClick={generate}>
          <Ic n={Wand2} size={14} mr={0} />
          {cands.length ? '別の候補を作る' : '候補を作る'}
        </button>
        {pending ? (
          <span className="hstack caption">
            <span className="spinner" style={{ width: 13, height: 13 }} />
            作成中（20秒ほど）
          </span>
        ) : null}
      </div>
      {cands.length ? (
        <div className="group">
          {cands.map((cand, i) => (
            <div key={cand.id} className="cell">
              <button className="icon-btn" onClick={() => player.toggle(cand.id, cand.url)} title="試聴">
                <Ic n={player.playing === cand.id ? Pause : Play} size={14} mr={0} />
              </button>
              <div className="cell-label">
                候補 {cands.length - i}
                <span className="sub">{cand.durationSec ? `${cand.durationSec.toFixed(1)}秒` : ''}</span>
              </div>
              <button
                className="btn sm primary"
                disabled={adopting !== null}
                onClick={async () => {
                  setAdopting(cand.id);
                  onError(null);
                  try {
                    const name = `${c.name}の声`;
                    const r = await api.elevenAdoptDesign({ generatedVoiceId: cand.id, name, description });
                    onChosen(r.voiceId, r.name);
                  } catch (x) {
                    onError((x as Error).message);
                  } finally {
                    setAdopting(null);
                  }
                }}
              >
                {adopting === cand.id ? '保存中…' : 'この声にする'}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
