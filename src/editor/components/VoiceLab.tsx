import { Check, Plus, Upload, Wand2 } from 'lucide-react';
import React, { useContext, useState } from 'react';
import type { CastMember } from '../../video/schema';
import { api } from '../api';
import { MetaContext, RefreshMetaContext } from '../App';
import { Ic } from '../icons';
import { confirmDialog } from './Dialogs';
import { Field, FilePick, Text } from './Fields';

type Candidate = { id: string; seed: number; url: string; durationSec: number };

const sampleText = (name: string) => `こんにちは、${name}です。今日は、とっても便利なサービスをご紹介します。難しいことは何もありません。気軽に、はじめてみてくださいね。`;

/**
 * 声を決める。
 * Voice Design は呼ぶたびに声が変わるので、候補を聴き比べて1本を選び、その声を全セリフの参照音声にする。
 */
export const VoiceLab: React.FC<{ member: CastMember; set: (fn: (m: CastMember) => void) => void }> = ({ member: c, set }) => {
  const meta = useContext(MetaContext)!;
  const refreshMeta = useContext(RefreshMetaContext);
  const irodori = meta.tts.irodori;
  const fixed = Boolean(c.voice.refVoice);
  const refLabel = c.voice.refVoice ? irodori.labels?.[c.voice.refVoice] ?? c.voice.refVoice : '';
  const [caption, setCaption] = useState(c.voice.caption || c.voice.instructions);
  const [text, setText] = useState(() => sampleText(c.name));
  const [cands, setCands] = useState<Candidate[]>([]);
  const [pending, setPending] = useState(0);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const generate = async (count: number) => {
    setErr(null);
    setMsg(null);
    setPending(count);
    try {
      for (let i = 0; i < count; i++) {
        const cand = await api.voiceCandidate({ caption, text });
        setCands((o) => [...o, cand]);
        setPending((n) => n - 1);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPending(0);
    }
  };

  const adopted = async (v: { id: string; label: string }) => {
    await refreshMeta();
    set((m) => {
      m.voice.refVoice = v.id;
      m.voice.caption = caption;
    });
    setMsg(`「${v.label}」に決めました。音声を作り直すと、すべてのセリフがこの声になります。`);
  };

  const adopt = async (cand: Candidate) => {
    setAdopting(cand.id);
    setErr(null);
    try {
      await adopted(await api.adoptVoice({ candidateId: cand.id, name: c.id, label: `${c.name}の声（seed ${cand.seed}）`, caption, text, seed: cand.seed }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAdopting(null);
    }
  };

  const upload = async (f: File) => {
    setErr(null);
    try {
      await adopted(await api.uploadVoice(f, c.id, `${c.name}の声（${f.name}）`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: 'この声を削除しますか？', message: 'この声を使っている他の動画も、声が変わります。', ok: '削除', danger: true }))) return;
    await api.deleteVoice(c.voice.refVoice!);
    await refreshMeta();
    set((m) => void (m.voice.refVoice = undefined));
    setMsg(null);
  };

  return (
    <div>
      {fixed ? (
        <div className="notice accent" style={{ marginBottom: 14, alignItems: 'center' }}>
          <Ic n={Check} size={15} mr={0} />
          <span style={{ flex: 1 }}>いまの声: {refLabel}</span>
          <button className="btn sm plain danger" onClick={remove}>
            削除
          </button>
        </div>
      ) : null}
      <Field label="声のイメージ" hint="年齢・トーンなど。同じ指示でも候補ごとに別の声になります">
        <Text value={caption} onChange={setCaption} multiline />
      </Field>
      <Field label="試しに読む文章" hint="10秒前後の自然な文章が向いています（選んだ候補の音声がそのまま声の見本になります）">
        <Text value={text} onChange={setText} multiline />
      </Field>
      <div className="hstack wrap" style={{ marginBottom: 12 }}>
        <button
          className="btn primary"
          disabled={!irodori.online || pending > 0 || !text.trim()}
          title={irodori.online ? '' : `Irodori-TTS に接続できません（${irodori.url}）`}
          onClick={() => generate(3)}
        >
          <Ic n={Wand2} size={14} mr={0} />
          候補を3つ作る
        </button>
        <button className="btn" disabled={!irodori.online || pending > 0 || !text.trim()} onClick={() => generate(1)}>
          <Ic n={Plus} size={14} mr={0} />
          1つ追加
        </button>
        <FilePick accept="audio/*" onFile={upload} className="btn quiet">
          <Ic n={Upload} size={14} mr={0} />
          手持ちの音声を使う…
        </FilePick>
        {pending ? (
          <span className="hstack caption">
            <span className="spinner" style={{ width: 13, height: 13 }} />
            作成中（あと{pending}つ）
          </span>
        ) : null}
      </div>
      {cands.length ? (
        <div className="group" style={{ marginBottom: 8 }}>
          {cands.map((cand, i) => (
            <div key={cand.id} className="cell">
              <span className="caption" style={{ width: 18 }}>
                {i + 1}
              </span>
              <audio controls src={cand.url} style={{ flex: 1, minWidth: 0, height: 32 }} />
              <span className="caption">{cand.durationSec.toFixed(1)}秒</span>
              <button className="btn sm primary" disabled={adopting !== null} onClick={() => adopt(cand)}>
                {adopting === cand.id ? '登録中…' : 'この声にする'}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {cands.length ? (
        <button className="btn sm plain" onClick={() => setCands([])}>
          候補をクリア
        </button>
      ) : null}
      {msg ? (
        <div className="notice accent" style={{ marginTop: 8 }}>
          <Ic n={Check} size={15} mr={0} />
          {msg}
        </div>
      ) : null}
      {err ? (
        <div className="error" style={{ marginTop: 8 }}>
          {err}
        </div>
      ) : null}
    </div>
  );
};
