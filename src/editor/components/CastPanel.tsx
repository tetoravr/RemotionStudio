import { confirmDialog, errorDialog } from './Dialogs';
import { Plus } from 'lucide-react';
import React, { useContext, useRef, useState } from 'react';
import { LIBRARY_CHARACTERS, libraryCastMember } from '../../video/library';
import { POSES, type CastMember, type Pose, type Project } from '../../video/schema';
import { api, ttsFor } from '../api';
import { MetaContext } from '../App';
import type { RunJob, Update } from '../pages/Editor';
import { VoiceLab } from './VoiceLab';
import { Field, FilePick, Num, Select, Slider, Text } from './Fields';
import { POSE_LABELS } from './SceneInspector';
import { Download, Mic, Play, Sparkles, Square, X } from 'lucide-react';
import { Ic } from '../icons';

const STYLE_LABELS: Record<string, string> = {
  anime: 'アニメ調（基準画像に合わせる）',
  chibi: 'ちびキャラ',
  mascot: 'ゆるキャラ',
  flat: 'フラットイラスト',
  '3d': '3Dトイ風',
};

/** プロジェクト内パス（assets/..）・ライブラリ(lib:)・URL を、エディターで表示できるURLにする */
export const assetUrl = (projectId: string, p: string) => (p.startsWith('lib:') ? `/${p.slice(4)}` : /^(https?:|data:|blob:|\/)/.test(p) ? p : `/files/${projectId}/${p}`);

export const CastPanel: React.FC<{ project: Project; update: Update; runJob: RunJob; flush: () => Promise<void> }> = ({ project, update, runJob }) => {
  return (
    <div>
      <div className="notice" style={{ marginBottom: 12 }}>
        1人目が主人公（説明役）、2人目が相方（リアクション役）です。人間は <b>速水さき</b>、人外（マスコット）は <b>おすしちゃん</b> を使います。
        各表情に「口を閉じた画像」と「口を開けた画像」があり、ナレーションの音声に合わせて口パクします。
      </div>
      {project.cast.map((c, i) => (
        <CastCard key={c.id} project={project} member={c} index={i} update={update} runJob={runJob} />
      ))}
      <button
        className="btn sm"
        onClick={() =>
          update((p) => {
            const m = libraryCastMember(p.cast.some((c) => c.library === 'osushi-chan') ? 'hayami-saki' : 'osushi-chan', `c${Math.random().toString(36).slice(2, 6)}`);
            p.cast.push(m);
          })
        }
      >
        <Ic n={Plus} />キャラクターを追加
      </button>
    </div>
  );
};

const CastCard: React.FC<{ project: Project; member: CastMember; index: number; update: Update; runJob: RunJob }> = ({ project, member: c, index, update, runJob }) => {
  const meta = useContext(MetaContext)!;
  const set = (fn: (m: CastMember) => void) => update((p) => fn(p.cast[index]));
  const [desc, setDesc] = useState('');
  const [style, setStyle] = useState('anime');
  const [kind, setKind] = useState<'human' | 'creature'>('human');
  const [poses, setPoses] = useState<Pose[]>([...POSES]);
  const [refs, setRefs] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const tts = ttsFor(meta, project.audio.ttsProvider);

  const applyLibrary = (libId: string) =>
    update((p) => {
      const cur = p.cast[index];
      const lib = libraryCastMember(libId, cur.id);
      p.cast[index] = { ...lib, voice: cur.library === libId ? cur.voice : lib.voice };
    });

  const preview = async () => {
    setPreviewing(true);
    setPreviewErr(null);
    try {
      const line = project.scenes.flatMap((s) => s.lines).find((l) => l.speaker === c.id);
      const url = await api.ttsPreview(line?.speak || line?.text || 'こんにちは！今日はよろしくお願いします！', c.voice, {
        delivery: line?.delivery,
        emoji: line?.emoji,
        provider: tts.provider,
      });
      audio.current?.pause();
      audio.current = new Audio(url);
      await audio.current.play();
    } catch (e) {
      setPreviewErr((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  const setPoseImage = async (pose: Pose, open: boolean, f: File) => {
    const { path } = await api.upload(project.id, f);
    set((m) => {
      if (open) m.imagesOpen = { ...m.imagesOpen, [pose]: path };
      else m.images = { ...m.images, [pose]: path };
    });
  };

  return (
    <div className="section">
      <div className="section-title">
        {index === 0 ? '主人公' : index === 1 ? '相方' : `キャラ${index + 1}`}
        <span className="faint">id: {c.id}</span>
        <div className="spacer" />
        {index > 1 ? (
          <button className="icon-btn" onClick={async () => (await confirmDialog({ title: `${c.name} を削除しますか？`, ok: '削除する', danger: true })) && update((p) => void p.cast.splice(index, 1))}>
            <Ic n={X} mr={0} />
          </button>
        ) : null}
      </div>
      <div className="row">
        <Field label="名前">
          <Text value={c.name} onChange={(v) => set((m) => void (m.name = v))} />
        </Field>
      </div>
      <Field label="キャラクター">
        <div className="chips">
          {Object.entries(LIBRARY_CHARACTERS).map(([id, lc]) => (
            <button key={id} className={`chip ${c.library === id ? 'on' : ''}`} onClick={() => (c.library === id ? undefined : applyLibrary(id))}>
              {lc.name}
              <span className="faint">（{lc.kind === 'human' ? '人間' : '人外'}）</span>
            </button>
          ))}
          <span className={`chip ${!c.library ? 'on' : ''}`} style={{ cursor: 'default' }}>
            オリジナル
          </span>
        </div>
      </Field>
      <Field label="キャラ設定（AI台本用）">
        <Text value={c.persona} onChange={(v) => set((m) => void (m.persona = v))} placeholder="例: とぼけたマスコット。視聴者の本音を代弁する" />
      </Field>

      <div className="label" style={{ marginBottom: 6 }}>
        表情（上: 口を閉じた画像 / 下: 口を開けた画像 ・ クリックで差し替え）
      </div>
      <div className="pose-grid" style={{ marginBottom: 10 }}>
        {POSES.map((pose) => {
          const closed = c.images[pose];
          const open = c.imagesOpen[pose];
          return (
            <div key={pose} className="pose" style={{ height: 130, cursor: 'default' }}>
              <div style={{ display: 'flex', width: '100%', flex: 1, minHeight: 0 }}>
                <PoseThumb src={closed ? assetUrl(project.id, closed) : undefined} onFile={(f) => setPoseImage(pose, false, f)} />
                <PoseThumb src={open ? assetUrl(project.id, open) : undefined} onFile={(f) => setPoseImage(pose, true, f)} dim />
              </div>
              <span>{POSE_LABELS[pose]}{closed && !open ? '（口パクなし）' : ''}</span>
            </div>
          );
        })}
      </div>

      <div className="sub">
        <div className="label" style={{ marginBottom: 6 }}>
          <Ic n={Sparkles} />オリジナルキャラクターをAIで生成
        </div>
        <Field label="基準にする画像（任意）" hint="キャラのデザインシートやイラストを入れると、その見た目に合わせて全表情を作ります。無い場合は説明文から作ります">
          <div className="row center">
            {refs.map((r) => (
              <img key={r} src={assetUrl(project.id, r)} alt="" style={{ height: 48, flex: 'none', borderRadius: 6 }} />
            ))}
            <FilePick
              accept="image/*"
              onFile={async (f) => {
                const { path } = await api.upload(project.id, f);
                setRefs((o) => [...o, path].slice(-2));
              }}
            >
              画像を追加
            </FilePick>
            {refs.length ? (
              <button className="btn sm ghost" onClick={() => setRefs([])}>
                クリア
              </button>
            ) : null}
          </div>
        </Field>
        <Field label="キャラの説明" hint="髪型・服装・色・小物など。ブランドカラーを入れると統一感が出ます">
          <Text value={desc} onChange={setDesc} multiline placeholder="例: 30代の営業担当の女性。黒髪ショートボブ、グレーのジャケット" />
        </Field>
        <div className="row tight">
          <Field label="種類">
            <Select value={kind} onChange={setKind} options={[{ value: 'human', label: '人間（全身）' }, { value: 'creature', label: '人外・マスコット' }]} />
          </Field>
          <Field label="タッチ">
            <Select value={style} onChange={setStyle} options={meta.styles.map((s) => ({ value: s, label: STYLE_LABELS[s] ?? s }))} />
          </Field>
        </div>
        <div className="chips" style={{ marginBottom: 10 }}>
          {POSES.map((p) => (
            <button
              key={p}
              className={`chip ${poses.includes(p) ? 'on' : ''}`}
              onClick={() => setPoses((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p]))}
              disabled={p === 'default'}
            >
              {POSE_LABELS[p]}
            </button>
          ))}
        </div>
        <button
          className="btn primary sm"
          disabled={!meta.openai || !desc.trim()}
          onClick={() =>
            runJob(`「${c.name}」の画像を生成しています（表情×口の開閉）`, `/api/projects/${project.id}/cast/${c.id}/generate`, {
              description: desc,
              style,
              kind,
              poses,
              referenceAssets: refs,
            })
          }
        >
          生成する（{poses.length}表情 × 口閉じ/口開け = {poses.length * 2}枚）
        </button>
        <div className="faint" style={{ marginTop: 6 }}>
          全身画像を高品質で作るため、{poses.length}表情で5〜10分ほどかかります。口以外は口閉じ画像と完全に同じになるので、口パクしても全身がちらつきません。
        </div>
      </div>

      <div className="sub" style={{ marginTop: 10 }}>
        <div className="label" style={{ marginBottom: 6 }}>
          <Ic n={Mic} />声（{tts.provider === 'irodori' ? 'Irodori-TTS' : 'OpenAI TTS'}）
        </div>
        {tts.provider === 'irodori' ? (
          <>
            <Field label="声のデザイン（キャプション）" hint="年齢・性別・声質・話し方を日本語で。例: 落ち着いた低めの女性の声。丁寧で穏やかに話す。空ならこのキャラの「話し方の指示」を使います">
              <Text
                value={c.voice.caption ?? ''}
                onChange={(v) => set((m) => void (m.voice.caption = v || undefined))}
                multiline
                placeholder={c.voice.instructions}
              />
            </Field>
            <div className="row tight">
              <Field label="声のシード" hint="同じ数字なら同じ声になりやすい。声が気に入らなければ数字を変えて試聴">
                <Num value={c.voice.seed ?? 0} min={0} max={999999} onChange={(v) => set((m) => void (m.voice.seed = Math.round(v)))} />
              </Field>
              <Field label="参照音声（声の固定）" hint="サーバーに登録した声を選ぶと、その声をまねます（自分の声・許諾を得た声のみ）。選ぶとキャプションは感情の指示だけに使われます">
                <Select
                  value={c.voice.refVoice ?? ''}
                  onChange={(v) => set((m) => void (m.voice.refVoice = v || undefined))}
                  options={[{ value: '', label: 'なし（キャプション＋シードで声を作る）' }, ...meta.tts.irodori.voices.map((v) => ({ value: v, label: meta.tts.irodori.labels?.[v] ?? v }))]}
                />
                {c.voice.refVoice ? <RefVoiceActions id={c.voice.refVoice} /> : null}
              </Field>
            </div>
            <Field label="話速" hint="1.0が標準。上げると、モデル自身が速く話します（音が不自然になりにくい）。セリフごとの感情は、シーンの「感情」「演技指示」で指定できます">
              <Slider value={c.voice.speed} min={0.8} max={1.6} step={0.01} onChange={(v) => set((m) => void (m.voice.speed = v))} format={(v) => `×${v.toFixed(2)}`} />
            </Field>
            <VoiceLab member={c} set={set} />
          </>
        ) : (
          <>
            <div className="row tight">
              <Field label="ボイス">
                <Select value={c.voice.voice} onChange={(v) => set((m) => void (m.voice.voice = v))} options={meta.voices.map((v) => ({ value: v.id, label: v.label }))} />
              </Field>
              <Field label="話速調整" hint="1.0が自然。1.1を超えると不自然になりやすい">
                <Slider value={c.voice.speed} min={0.9} max={1.5} step={0.01} onChange={(v) => set((m) => void (m.voice.speed = v))} format={(v) => `×${v.toFixed(2)}`} />
              </Field>
            </div>
            <Field label="話し方の指示" hint="年齢感・声のトーン・間の取り方など。セリフごとの感情は、シーンの「演技指示」で指定できます">
              <Text value={c.voice.instructions} onChange={(v) => set((m) => void (m.voice.instructions = v))} multiline />
            </Field>
          </>
        )}
        <div className="row center">
          <button className="btn sm" style={{ flex: 'none' }} disabled={!tts.ready || previewing} onClick={preview}>
            {previewing ? '生成中…' : (
              <>
                <Ic n={Play} />試聴
              </>
            )}
          </button>
          {previewing && tts.provider === 'irodori' ? <span className="faint">GPUなしだと1文で30〜60秒かかります</span> : null}
          {previewErr ? <span className="faint" style={{ color: 'var(--danger)' }}>{previewErr}</span> : null}
        </div>
      </div>
    </div>
  );
};

/** 参照中の声を聞く・保存する */
const RefVoiceActions: React.FC<{ id: string }> = ({ id }) => {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = `/api/tts/voices/${encodeURIComponent(id)}/file`;
  return (
    <div className="row center tight" style={{ marginTop: 6 }}>
      <button
        className="btn sm"
        style={{ flex: 'none' }}
        onClick={() => {
          if (playing) {
            audio.current?.pause();
            setPlaying(false);
            return;
          }
          audio.current?.pause();
          const a = new Audio(url);
          a.onended = () => setPlaying(false);
          a.onerror = () => setPlaying(false);
          audio.current = a;
          a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        }}
      >
        <Ic n={playing ? Square : Play} size={12} />
        {playing ? '停止' : '参照音声を聞く'}
      </button>
      <a className="btn sm" style={{ flex: 'none', textDecoration: 'none' }} href={`${url}?download=1`} download>
        <Ic n={Download} size={12} />
        ダウンロード
      </a>
    </div>
  );
};

const PoseThumb: React.FC<{ src?: string; onFile: (f: File) => void | Promise<unknown>; dim?: boolean }> = ({ src, onFile, dim }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'pointer', opacity: dim && !src ? 0.5 : 1 }} onClick={() => ref.current?.click()}>
      {src ? <img src={src} alt="" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} /> : <div className="faint" style={{ margin: 'auto' }}><Ic n={Plus} size={16} mr={0} /></div>}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) Promise.resolve(onFile(f)).catch((err) => errorDialog('画像を読み込めませんでした', err));
          e.target.value = '';
        }}
      />
    </div>
  );
};
