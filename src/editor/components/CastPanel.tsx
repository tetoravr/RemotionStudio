import { Download, Ellipsis, Pause, Play, Plus, Sparkles, Square, Trash2 } from 'lucide-react';
import React, { useContext, useRef, useState } from 'react';
import { LIBRARY_CHARACTERS, libraryCastMember } from '../../video/library';
import { POSES, type CastMember, type Pose, type Project } from '../../video/schema';
import { api, ttsFor } from '../api';
import { MetaContext } from '../App';
import { Ic } from '../icons';
import type { RunJob, Update } from '../pages/Editor';
import { confirmDialog, errorDialog } from './Dialogs';
import { Cell, Disclosure, Field, FilePick, MenuItem, Num, Popover, Section, Select, Sheet, Slider, Text } from './Fields';
import { assetUrl, POSE_LABELS, poseImage } from './pickers';
import { VoiceLab } from './VoiceLab';

export { assetUrl };

const STYLE_LABELS: Record<string, string> = {
  anime: 'アニメ調（基準画像に合わせる）',
  chibi: 'ちびキャラ',
  mascot: 'ゆるキャラ',
  flat: 'フラットイラスト',
  '3d': '3Dトイ風',
};

export const CastPanel: React.FC<{ project: Project; update: Update; runJob: RunJob; flush: () => Promise<void> }> = ({ project, update, runJob }) => (
  <div>
    <Section title="キャスト" right={<span className="caption">1人目が説明役・2人目がリアクション役</span>}>
      {project.cast.map((c, i) => (
        <CastCard key={c.id} project={project} member={c} index={i} update={update} runJob={runJob} />
      ))}
    </Section>
    <button
      className="btn block"
      style={{ marginTop: 12 }}
      onClick={() =>
        update((p) => {
          const m = libraryCastMember(p.cast.some((c) => c.library === 'osushi-chan') ? 'hayami-saki' : 'osushi-chan', `c${Math.random().toString(36).slice(2, 6)}`);
          p.cast.push(m);
        })
      }
    >
      <Ic n={Plus} size={14} mr={0} />
      キャラクターを追加
    </button>
  </div>
);

const CastCard: React.FC<{ project: Project; member: CastMember; index: number; update: Update; runJob: RunJob }> = ({ project, member: c, index, update, runJob }) => {
  const meta = useContext(MetaContext)!;
  const set = (fn: (m: CastMember) => void) => update((p) => fn(p.cast[index]));
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [previewing, setPreviewing] = useState<'loading' | 'playing' | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const tts = ttsFor(meta, project.audio.ttsProvider);
  const fixed = Boolean(c.voice.refVoice);
  const refLabel = c.voice.refVoice ? meta.tts.irodori.labels?.[c.voice.refVoice] ?? c.voice.refVoice : '';

  const applyLibrary = (libId: string) =>
    update((p) => {
      const cur = p.cast[index];
      const lib = libraryCastMember(libId, cur.id);
      p.cast[index] = { ...lib, voice: cur.library === libId ? cur.voice : lib.voice };
    });

  const preview = async () => {
    if (previewing === 'playing') {
      audio.current?.pause();
      setPreviewing(null);
      return;
    }
    setPreviewing('loading');
    try {
      const line = project.scenes.flatMap((s) => s.lines).find((l) => l.speaker === c.id);
      const url = await api.ttsPreview(line?.speak || line?.text || 'こんにちは！今日はよろしくお願いします！', c.voice, {
        delivery: line?.delivery,
        emoji: line?.emoji,
        provider: tts.provider,
      });
      audio.current?.pause();
      const a = new Audio(url);
      a.onended = () => setPreviewing(null);
      audio.current = a;
      await a.play();
      setPreviewing('playing');
    } catch (e) {
      setPreviewing(null);
      errorDialog('声を再生できませんでした', e);
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
    <div className="group">
      <div className="cast-head">
        <div className="cast-portrait">{poseImage(project, c) ? <img src={poseImage(project, c)} alt="" /> : null}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text bare value={c.name} onChange={(v) => set((m) => void (m.name = v))} className="title-3" />
          <div className="caption" style={{ marginTop: 2 }}>
            {index === 0 ? '主人公（説明役）' : index === 1 ? '相方（リアクション役）' : `キャラクター${index + 1}`}
          </div>
          <button className="btn sm" style={{ marginTop: 10 }} disabled={!tts.ready || previewing === 'loading'} onClick={preview} title={tts.ready ? 'このキャラのセリフを1つ読み上げます' : '音声エンジンに接続できません'}>
            {previewing === 'loading' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Ic n={previewing === 'playing' ? Pause : Play} size={12} mr={0} />}
            {previewing === 'loading' ? '作成中…' : previewing === 'playing' ? '停止' : '声を聴く'}
          </button>
        </div>
        {index > 1 ? (
          <Popover
            align="right"
            button={({ open, toggle }) => (
              <button className="icon-btn" aria-expanded={open} onClick={toggle} title="キャラクターの操作" style={{ alignSelf: 'flex-start' }}>
                <Ic n={Ellipsis} size={15} mr={0} />
              </button>
            )}
          >
            {(close) => (
              <MenuItem
                icon={Trash2}
                danger
                onClick={async () => {
                  close();
                  if (await confirmDialog({ title: `${c.name} を削除しますか？`, ok: '削除', danger: true })) update((p) => void p.cast.splice(index, 1));
                }}
              >
                削除
              </MenuItem>
            )}
          </Popover>
        ) : null}
      </div>

      <Cell label="見た目" stack>
        <div className="char-picker" style={{ marginTop: 4 }}>
          {Object.entries(LIBRARY_CHARACTERS).map(([id, lc]) => (
            <button key={id} type="button" className={`char-option ${c.library === id ? 'on' : ''}`} onClick={() => (c.library === id ? undefined : applyLibrary(id))}>
              <span className="img">
                <img src={`/characters/${id}/default.webp`} alt="" />
              </span>
              {lc.name}
            </button>
          ))}
          <div className={`char-option ${!c.library ? 'on' : ''}`} style={{ cursor: 'default' }} title="下の「AIでオリジナルの見た目を作る」で作れます">
            <span className="img">
              <Ic n={Sparkles} size={22} mr={0} />
            </span>
            オリジナル
          </div>
        </div>
      </Cell>

      <Cell label="声" sub={fixed ? refLabel : '決めると、すべてのセリフが同じ声になります'}>
        <span className={`badge ${fixed ? 'ok' : 'warn'}`}>{fixed ? '固定済み' : '未固定'}</span>
        <button className="btn sm" onClick={() => setVoiceOpen(true)}>
          声を選ぶ…
        </button>
      </Cell>
      <Cell label="話す速さ" stack>
        <Slider value={c.voice.speed} min={0.8} max={1.6} step={0.01} onChange={(v) => set((m) => void (m.voice.speed = v))} format={(v) => `×${v.toFixed(2)}`} />
      </Cell>

      <Disclosure summary="表情の画像">
        <div className="hint" style={{ marginBottom: 8 }}>
          左が口を閉じた画像、右が口を開けた画像です（口パク用）。押すと差し替えられます。
        </div>
        <div className="pose-grid">
          {POSES.map((pose) => {
            const closed = c.images[pose];
            const open = c.imagesOpen[pose];
            return (
              <div key={pose} className="pose">
                <div style={{ display: 'flex', width: '100%', flex: 1, minHeight: 0 }}>
                  <PoseThumb src={closed ? assetUrl(project.id, closed) : undefined} onFile={(f) => setPoseImage(pose, false, f)} />
                  <PoseThumb src={open ? assetUrl(project.id, open) : undefined} onFile={(f) => setPoseImage(pose, true, f)} dim />
                </div>
                <span>
                  {POSE_LABELS[pose]}
                  {closed && !open ? '・口パクなし' : ''}
                </span>
              </div>
            );
          })}
        </div>
      </Disclosure>
      <Disclosure summary="AIでオリジナルの見た目を作る">
        <CharacterGenerator project={project} member={c} runJob={runJob} />
      </Disclosure>
      <Disclosure summary="台本での役割">
        <Text value={c.persona} onChange={(v) => set((m) => void (m.persona = v))} multiline placeholder="例: とぼけたマスコット。視聴者の本音を代弁する" />
        <div className="hint" style={{ marginTop: 6 }}>
          AIが台本を書くときの参考になります
        </div>
      </Disclosure>

      {voiceOpen ? <VoiceSheet member={c} set={set} onClose={() => setVoiceOpen(false)} /> : null}
    </div>
  );
};

/** 声を決めるシート（候補を聴き比べて固定する） */
const VoiceSheet: React.FC<{ member: CastMember; set: (fn: (m: CastMember) => void) => void; onClose: () => void }> = ({ member: c, set, onClose }) => {
  const meta = useContext(MetaContext)!;
  return (
    <Sheet wide onClose={onClose}>
      <h3>{c.name}の声</h3>
      <div className="sheet-text">候補をいくつか作って聴き比べ、気に入った声に決めると、すべてのセリフがその声で読まれます。</div>
      <VoiceLab member={c} set={set} />
      <div style={{ marginTop: 14 }}>
        <div className="group">
          <Disclosure summary="詳しい設定">
            <Field label="声のデザイン" hint="声を固定していない時に使います。年齢・性別・声質・話し方を日本語で">
              <Text value={c.voice.caption ?? ''} onChange={(v) => set((m) => void (m.voice.caption = v || undefined))} multiline placeholder={c.voice.instructions} />
            </Field>
            <div className="row">
              <Field label="声のシード" hint="同じ数字なら同じ声になりやすい">
                <Num value={c.voice.seed ?? 0} min={0} max={999999} onChange={(v) => set((m) => void (m.voice.seed = Math.round(v)))} />
              </Field>
              <Field label="使う参照音声">
                <Select
                  value={c.voice.refVoice ?? ''}
                  onChange={(v) => set((m) => void (m.voice.refVoice = v || undefined))}
                  options={[{ value: '', label: 'なし（毎回作る）' }, ...meta.tts.irodori.voices.map((v) => ({ value: v, label: meta.tts.irodori.labels?.[v] ?? v }))]}
                />
              </Field>
            </div>
            {c.voice.refVoice ? <RefVoiceActions id={c.voice.refVoice} /> : null}
          </Disclosure>
        </div>
      </div>
      <div className="sheet-actions">
        <button className="btn primary" onClick={onClose}>
          完了
        </button>
      </div>
    </Sheet>
  );
};

/** 参照中の声を聞く・保存する */
const RefVoiceActions: React.FC<{ id: string }> = ({ id }) => {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = `/api/tts/voices/${encodeURIComponent(id)}/file`;
  return (
    <div className="hstack">
      <button
        className="btn sm"
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
        <Ic n={playing ? Square : Play} size={12} mr={0} />
        {playing ? '停止' : '参照音声を聴く'}
      </button>
      <a className="btn sm" href={`${url}?download=1`} download>
        <Ic n={Download} size={12} mr={0} />
        ダウンロード
      </a>
    </div>
  );
};

/** オリジナルキャラクターの画像をAIで作る */
const CharacterGenerator: React.FC<{ project: Project; member: CastMember; runJob: RunJob }> = ({ project, member: c, runJob }) => {
  const meta = useContext(MetaContext)!;
  const [desc, setDesc] = useState('');
  const [style, setStyle] = useState('anime');
  const [kind, setKind] = useState<'human' | 'creature'>('human');
  const [poses, setPoses] = useState<Pose[]>([...POSES]);
  const [refs, setRefs] = useState<string[]>([]);
  return (
    <>
      <Field label="キャラの説明" hint="髪型・服装・色・小物など。ブランドカラーを入れると統一感が出ます">
        <Text value={desc} onChange={setDesc} multiline placeholder="例: 30代の営業担当の女性。黒髪ショートボブ、グレーのジャケット" />
      </Field>
      <Field label="基準にする画像" hint="デザインシートやイラストがあれば、その見た目に合わせて全表情を作ります">
        <div className="hstack wrap">
          {refs.map((r) => (
            <img key={r} src={assetUrl(project.id, r)} alt="" className="thumb-img" style={{ height: 44 }} />
          ))}
          <FilePick
            accept="image/*"
            onFile={async (f) => {
              const { path } = await api.upload(project.id, f);
              setRefs((o) => [...o, path].slice(-2));
            }}
          >
            画像を追加…
          </FilePick>
          {refs.length ? (
            <button className="btn sm plain" onClick={() => setRefs([])}>
              クリア
            </button>
          ) : null}
        </div>
      </Field>
      <div className="row">
        <Field label="種類">
          <Select value={kind} onChange={setKind} options={[{ value: 'human', label: '人間（全身）' }, { value: 'creature', label: '人外・マスコット' }]} />
        </Field>
        <Field label="タッチ">
          <Select value={style} onChange={setStyle} options={meta.styles.map((s) => ({ value: s, label: STYLE_LABELS[s] ?? s }))} />
        </Field>
      </div>
      <Field label="作る表情">
        <div className="chips">
          {POSES.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip ${poses.includes(p) ? 'on' : ''}`}
              onClick={() => setPoses((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p]))}
              disabled={p === 'default'}
            >
              {POSE_LABELS[p]}
            </button>
          ))}
        </div>
      </Field>
      <button
        className="btn primary block"
        disabled={!meta.openai || !desc.trim()}
        title={meta.openai ? '' : 'OPENAI_API_KEY が必要です'}
        onClick={() =>
          runJob(`「${c.name}」の画像を作っています`, `/api/projects/${project.id}/cast/${c.id}/generate`, {
            description: desc,
            style,
            kind,
            poses,
            referenceAssets: refs,
          })
        }
      >
        <Ic n={Sparkles} size={14} mr={0} />
        {poses.length}表情を作る
      </button>
      <div className="hint" style={{ marginTop: 8 }}>
        表情ごとに口を閉じた画像と開けた画像を作ります（{poses.length * 2}枚・5〜10分）。口以外は完全に同じなので、口パクしても全身がちらつきません。
      </div>
    </>
  );
};

const PoseThumb: React.FC<{ src?: string; onFile: (f: File) => void | Promise<unknown>; dim?: boolean }> = ({ src, onFile, dim }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'pointer', opacity: dim && !src ? 0.5 : 1 }}
      onClick={() => ref.current?.click()}
      title="押して画像を差し替え"
    >
      {src ? (
        <img src={src} alt="" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
      ) : (
        <div className="faint" style={{ margin: 'auto' }}>
          <Ic n={Plus} size={16} mr={0} />
        </div>
      )}
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
