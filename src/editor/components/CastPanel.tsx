import React, { useContext, useRef, useState } from 'react';
import { POSES, type CastMember, type Pose, type Project } from '../../video/schema';
import { api } from '../api';
import { MetaContext } from '../App';
import type { RunJob, Update } from '../pages/Editor';
import { Field, Seg, Select, Slider, Text } from './Fields';
import { POSE_LABELS } from './SceneInspector';

const STYLE_LABELS: Record<string, string> = { anime: 'アニメ（ちびキャラ）', mascot: 'ゆるキャラ', flat: 'フラットイラスト', '3d': '3Dトイ風' };
const SHAPES = [
  { value: 'mochi', label: 'おもち' },
  { value: 'sushi', label: 'おすし' },
  { value: 'cat', label: 'ねこ' },
  { value: 'bear', label: 'くま' },
  { value: 'bunny', label: 'うさぎ' },
  { value: 'bird', label: 'とり' },
] as const;

export const CastPanel: React.FC<{ project: Project; update: Update; runJob: RunJob; flush: () => Promise<void> }> = ({ project, update, runJob, flush }) => {
  return (
    <div>
      <div className="notice" style={{ marginBottom: 12 }}>
        1人目が主人公（説明役）、2人目が相方（リアクション役）として AI 台本に使われます。画像キャラは表情ごとの透過画像を用意するか、AIで生成できます。
      </div>
      {project.cast.map((c, i) => (
        <CastCard key={c.id} project={project} member={c} index={i} update={update} runJob={runJob} flush={flush} />
      ))}
      <button
        className="btn sm"
        onClick={() =>
          update((p) =>
            void p.cast.push({
              id: `c${Math.random().toString(36).slice(2, 6)}`,
              name: `キャラ${p.cast.length + 1}`,
              persona: '',
              kind: 'builtin',
              builtin: { shape: 'cat', bodyColor: '#ffffff', emblem: '' },
              images: {},
              voice: { voice: 'nova', instructions: '明るく元気な声で、テンポよく。', speed: 1.15 },
            }),
          )
        }
      >
        ＋ キャラクターを追加
      </button>
    </div>
  );
};

const CastCard: React.FC<{ project: Project; member: CastMember; index: number; update: Update; runJob: RunJob; flush: () => Promise<void> }> = ({
  project,
  member: c,
  index,
  update,
  runJob,
}) => {
  const meta = useContext(MetaContext)!;
  const set = (fn: (m: CastMember) => void) => update((p) => fn(p.cast[index]));
  const [desc, setDesc] = useState('');
  const [style, setStyle] = useState('anime');
  const [poses, setPoses] = useState<Pose[]>([...POSES]);
  const [previewing, setPreviewing] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const b = c.builtin ?? { shape: 'mochi' as const, bodyColor: '#ffffff', emblem: '' };

  const preview = async () => {
    setPreviewing(true);
    setPreviewErr(null);
    try {
      const url = await api.ttsPreview(project.scenes.flatMap((s) => s.lines).find((l) => l.speaker === c.id)?.text ?? 'こんにちは！よろしくね！', c.voice);
      audio.current?.pause();
      audio.current = new Audio(url);
      await audio.current.play();
    } catch (e) {
      setPreviewErr((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="section">
      <div className="section-title">
        {index === 0 ? '主人公' : index === 1 ? '相方' : `キャラ${index + 1}`}
        <span className="faint">id: {c.id}</span>
        <div className="spacer" />
        {index > 1 ? (
          <button className="icon-btn" onClick={() => confirm(`${c.name} を削除しますか？`) && update((p) => void p.cast.splice(index, 1))}>
            ✕
          </button>
        ) : null}
      </div>
      <div className="row">
        <Field label="名前">
          <Text value={c.name} onChange={(v) => set((m) => void (m.name = v))} />
        </Field>
        <Field label="見た目">
          <Seg
            value={c.kind}
            onChange={(v) => set((m) => void (m.kind = v))}
            options={[
              { value: 'image', label: '画像' },
              { value: 'builtin', label: '組み込み' },
            ]}
          />
        </Field>
      </div>
      <Field label="キャラ設定（AI台本用）">
        <Text value={c.persona} onChange={(v) => set((m) => void (m.persona = v))} placeholder="例: とぼけたマスコット。視聴者の本音を代弁する" />
      </Field>

      {c.kind === 'builtin' ? (
        <div className="sub">
          <div className="row tight">
            <Field label="形">
              <Select value={b.shape} onChange={(v) => set((m) => void (m.builtin = { ...b, shape: v }))} options={SHAPES} />
            </Field>
            <Field label="体の色">
              <input className="input" type="color" value={b.bodyColor} onChange={(e) => set((m) => void (m.builtin = { ...b, bodyColor: e.target.value }))} />
            </Field>
            <Field label="手足の色">
              <input
                className="input"
                type="color"
                value={b.accentColor || project.brand.colors.primary}
                onChange={(e) => set((m) => void (m.builtin = { ...b, accentColor: e.target.value }))}
              />
            </Field>
            <Field label="おなかの文字">
              <Text value={b.emblem} onChange={(v) => set((m) => void (m.builtin = { ...b, emblem: v.slice(0, 2) }))} />
            </Field>
          </div>
        </div>
      ) : (
        <>
          <div className="label" style={{ marginBottom: 6 }}>
            表情ごとの画像（クリックで差し替え）
          </div>
          <div className="pose-grid" style={{ marginBottom: 10 }}>
            {POSES.map((pose) => (
              <PoseSlot
                key={pose}
                src={c.images[pose] ? `/files/${project.id}/${c.images[pose]}` : undefined}
                label={POSE_LABELS[pose]}
                onFile={async (f) => {
                  const { path } = await api.upload(project.id, f);
                  set((m) => void (m.images = { ...m.images, [pose]: path }));
                }}
              />
            ))}
          </div>
          <div className="sub">
            <div className="label" style={{ marginBottom: 6 }}>
              ✨ AIでキャラクター画像を生成（gpt-image）
            </div>
            <Field hint="髪型・服装・色・小物など。ブランドカラーを入れると統一感が出ます">
              <Text value={desc} onChange={setDesc} multiline placeholder="例: オレンジのパーカーを着た元気な女の子。茶色のポニーテールにサーモン寿司の髪飾り" />
            </Field>
            <div className="row tight">
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
            <div className="row center">
              <button
                className="btn primary sm"
                style={{ flex: 'none' }}
                disabled={!meta.openai || !desc.trim()}
                onClick={() =>
                  runJob(`「${c.name}」の画像を生成しています`, `/api/projects/${project.id}/cast/${c.id}/generate`, { description: desc, style, poses })
                }
              >
                生成する（{poses.length}枚）
              </button>
              <button
                className="btn sm"
                style={{ flex: 'none' }}
                disabled={!meta.openai || !c.images.default}
                title="今の「通常」画像のデザインを保ったまま、表情だけを作り直します"
                onClick={() =>
                  runJob(`「${c.name}」の表情を生成しています`, `/api/projects/${project.id}/cast/${c.id}/generate`, {
                    description: desc || c.persona || c.name,
                    style,
                    poses: poses.filter((p) => p !== 'default'),
                    keepBase: true,
                  })
                }
              >
                「通常」を元に表情だけ生成
              </button>
            </div>
            <div className="faint" style={{ marginTop: 6 }}>1枚目の生成に約40秒、残りの表情は並列で約1分かかります。</div>
          </div>
        </>
      )}

      <div className="sub" style={{ marginTop: 10 }}>
        <div className="label" style={{ marginBottom: 6 }}>
          🎙 声（OpenAI TTS）
        </div>
        <div className="row tight">
          <Field label="ボイス">
            <Select value={c.voice.voice} onChange={(v) => set((m) => void (m.voice.voice = v))} options={meta.voices.map((v) => ({ value: v.id, label: v.label }))} />
          </Field>
          <Field label="話す速さ">
            <Slider value={c.voice.speed} min={0.8} max={1.6} step={0.05} onChange={(v) => set((m) => void (m.voice.speed = v))} format={(v) => `×${v.toFixed(2)}`} />
          </Field>
        </div>
        <Field label="話し方の指示" hint="例: 明るく元気なアニメの女の子の声。語尾をはずませて">
          <Text value={c.voice.instructions} onChange={(v) => set((m) => void (m.voice.instructions = v))} multiline />
        </Field>
        <div className="row center">
          <button className="btn sm" style={{ flex: 'none' }} disabled={!meta.openai || previewing} onClick={preview}>
            {previewing ? '生成中…' : '▶ 試聴'}
          </button>
          {previewErr ? <span className="faint" style={{ color: 'var(--danger)' }}>{previewErr}</span> : null}
        </div>
      </div>
    </div>
  );
};

const PoseSlot: React.FC<{ src?: string; label: string; onFile: (f: File) => void }> = ({ src, label, onFile }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="pose" onClick={() => ref.current?.click()} title="クリックして画像をアップロード">
      {src ? <img src={src} alt="" /> : <div className="faint" style={{ margin: 'auto' }}>＋</div>}
      <span>{label}</span>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
};

