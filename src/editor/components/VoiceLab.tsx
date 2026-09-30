import React, { useContext, useState } from 'react';
import type { CastMember } from '../../video/schema';
import { api } from '../api';
import { MetaContext, RefreshMetaContext } from '../App';
import { Field, FilePick, Text } from './Fields';

type Candidate = { id: string; seed: number; url: string; durationSec: number };

const sampleText = (name: string) => `こんにちは、${name}です。今日は、とっても便利なサービスをご紹介します。難しいことは何もありません。気軽に、はじめてみてくださいね。`;

/**
 * 参照音声ラボ。
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
    setMsg(`「${v.label}」を ${c.name} の声に設定しました。ナレーションを生成し直すと、全セリフがこの声になります。`);
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
    if (!confirm('この参照音声を削除しますか？（この声を使っている他の動画も、声が変わります）')) return;
    await api.deleteVoice(c.voice.refVoice!);
    await refreshMeta();
    set((m) => void (m.voice.refVoice = undefined));
    setMsg(null);
  };

  return (
    <details className="sub" style={{ marginTop: 10 }} open={!fixed}>
      <summary className="label" style={{ cursor: 'pointer' }}>
        🧪 参照音声をつくる（全編で同じ声にする）{fixed ? <span className="faint">　設定済み：{refLabel}</span> : null}
      </summary>
      {!fixed ? (
        <div className="notice" style={{ margin: '8px 0', color: 'var(--danger)' }}>
          いまは参照音声がなく、声の指定が毎回ゆるく作り直されるため、セリフごとに声が変わることがあります。下で気に入った声を選ぶと、全セリフがその声になります。
        </div>
      ) : null}
      <Field label="声のイメージ" hint="年齢感・トーンなど。同じ指示でも候補ごとに別の声になります。気に入るまで何度でも作れます">
        <Text value={caption} onChange={setCaption} multiline />
      </Field>
      <Field label="試し読みの文章" hint="10秒前後の自然な文章が参照音声に向いています（そのまま参照音声になります）">
        <Text value={text} onChange={setText} multiline />
      </Field>
      <div className="row center voice-actions">
        <button className="btn sm primary" style={{ flex: 'none' }} disabled={!irodori.online || pending > 0 || !text.trim()} title={irodori.online ? '' : `Irodori-TTS に接続できません（${irodori.url}）`} onClick={() => generate(3)}>
          候補を3つつくる
        </button>
        <button className="btn sm" style={{ flex: 'none' }} disabled={!irodori.online || pending > 0 || !text.trim()} onClick={() => generate(1)}>
          ＋1つ追加
        </button>
        <FilePick accept="audio/*" onFile={upload} className="btn sm nowrap">手持ちの音声を使う</FilePick>
        {cands.length ? (
          <button className="btn sm ghost" style={{ flex: 'none' }} onClick={() => setCands([])}>
            候補をクリア
          </button>
        ) : null}
        {pending ? <span className="faint">生成中…（あと{pending}つ）</span> : null}
      </div>
      {cands.map((cand, i) => (
        <div key={cand.id} className="row center voice-cand">
          <span className="faint" style={{ flex: '0 0 auto' }}>#{i + 1}</span>
          <audio controls src={cand.url} style={{ flex: '1 1 160px', height: 32 }} />
          <span className="faint" style={{ flex: '0 0 auto' }}>{cand.durationSec.toFixed(1)}秒</span>
          <button className="btn sm" style={{ flex: 'none' }} disabled={adopting !== null} onClick={() => adopt(cand)}>
            {adopting === cand.id ? '登録中…' : 'この声に決定'}
          </button>
        </div>
      ))}
      {msg ? <div className="faint" style={{ marginTop: 6 }}>✓ {msg}</div> : null}
      {err ? <div className="faint" style={{ marginTop: 6, color: 'var(--danger)' }}>{err}</div> : null}
      {fixed ? (
        <button className="btn sm ghost danger" style={{ marginTop: 8 }} onClick={remove}>
          設定中の参照音声を削除
        </button>
      ) : null}
    </details>
  );
};
