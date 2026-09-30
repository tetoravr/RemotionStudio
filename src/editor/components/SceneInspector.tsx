import { ElementList } from './ElementList';
import React, { useContext, useRef } from 'react';
import { ICON_LABELS } from '../../video/components/Icon';
import { IRODORI_EMOJI } from '../../video/emotions';
import { isAudioStale } from '../../video/narrationKey';
import {
  BACKGROUNDS, ICON_NAMES, POSES, TRANSITIONS,
  type CharacterPlacement, type IconName, type Line, type Project, type Scene, type Visual,
} from '../../video/schema';
import { SCENE_TYPE_LABELS } from '../../video/templates';
import type { SceneTiming } from '../../video/timeline';
import { api, ttsFor } from '../api';
import { assetUrl } from './CastPanel';
import { MetaContext } from '../App';
import type { RunJob, Update } from '../pages/Editor';
import { regenerateLine } from './NarrationList';
import { Field, FilePick, Num, Select, Text, Toggle } from './Fields';

export const POSE_LABELS: Record<string, string> = {
  default: '通常', happy: '喜び', surprised: '驚き', sad: 'しょんぼり', think: '考え中', point: '指さし', wave: '手を振る', wink: 'ウインク',
};
const TRANSITION_LABELS: Record<string, string> = { wipe: '斜めワイプ', cut: 'カット', flash: 'フラッシュ', zoom: 'ズーム', slide: 'スライド' };
const BG_LABELS: Record<string, string> = {
  burst: '集中線（メイン色）', 'burst-light': '集中線（白）', 'burst-dark': '集中線（濃色）', stripes: 'ストライプ（淡）',
  'stripes-dark': 'ストライプ（濃）', dots: 'ドット', gradient: 'グラデーション', plain: '無地',
};
const iconOptions = ICON_NAMES.map((n) => ({ value: n, label: `${ICON_LABELS[n]}（${n}）` }));
const rid = () => Math.random().toString(36).slice(2, 8);

export const SceneInspector: React.FC<{ project: Project; index: number; update: Update; timing?: SceneTiming; runJob?: RunJob; onSelectElement?: (id: string) => void }> = ({ project, index, update, timing, runJob, onSelectElement }) => {
  const scene = project.scenes[index];
  const set = <K extends string>(key: K, value: unknown) =>
    update((p) => {
      (p.scenes[index] as Record<string, unknown>)[key] = value;
    });
  const s = scene as Scene & Record<string, unknown>;

  return (
    <div>
      <ElementList project={project} index={index} update={update} onSelect={onSelectElement} />
      <div className="section">
        <div className="section-title">
          {SCENE_TYPE_LABELS[scene.type]}
          <span className="faint">{timing ? `${(timing.duration / project.fps).toFixed(1)}秒` : ''}</span>
        </div>
        {scene.type === 'logo' ? (
          <>
            <Field label="ロゴ文字" hint="空欄ならブランド名。改行で2段にできます。ロゴ画像は「ブランド」タブで設定">
              <Text value={scene.logoText} onChange={(v) => set('logoText', v || undefined)} multiline placeholder={project.brand.name} />
            </Field>
            <Field label="サブコピー" hint="[[ ]] で囲むと強調色">
              <Text value={scene.subtitle} onChange={(v) => set('subtitle', v || undefined)} multiline />
            </Field>
            <Toggle checked={scene.ticker} onChange={(v) => set('ticker', v)} label="ブランド名の帯を流す" />
          </>
        ) : null}
        {scene.type === 'talk' ? (
          <>
            <div className="row">
              <Toggle checked={scene.showLogo} onChange={(v) => set('showLogo', v)} label="上部に小さくロゴ" />
            </div>
            <div style={{ height: 10 }} />
            <Field label="見出し（任意）">
              <Text value={scene.headline} onChange={(v) => set('headline', v || undefined)} multiline />
            </Field>
            <div className="row">
              <Field label="キャラの周りの記号">
                <Select
                  value={scene.decor}
                  onChange={(v) => set('decor', v)}
                  options={[
                    { value: 'none', label: 'なし' },
                    { value: 'question', label: '？？' },
                    { value: 'exclaim', label: '！！' },
                    { value: 'sparkle', label: 'キラキラ' },
                    { value: 'sweat', label: '汗' },
                    { value: 'heart', label: 'ハート' },
                  ]}
                />
              </Field>
              <Field label="小道具">
                <Toggle checked={Boolean(scene.prop)} onChange={(v) => set('prop', v ? { icon: 'card', badge: 'ng', label: '' } : undefined)} label="表示" />
              </Field>
            </div>
            {scene.prop ? (
              <div className="row">
                <Field label="アイコン">
                  <Select value={scene.prop.icon} onChange={(v) => set('prop', { ...scene.prop, icon: v })} options={iconOptions} />
                </Field>
                <Field label="バッジ">
                  <Select
                    value={scene.prop.badge}
                    onChange={(v) => set('prop', { ...scene.prop, badge: v })}
                    options={[
                      { value: 'none', label: 'なし' },
                      { value: 'ng', label: 'NG' },
                      { value: 'ok', label: 'OK' },
                    ]}
                  />
                </Field>
                <Field label="ラベル">
                  <Text value={scene.prop.label} onChange={(v) => set('prop', { ...scene.prop, label: v })} />
                </Field>
              </div>
            ) : null}
          </>
        ) : null}
        {scene.type === 'feature' ? (
          <>
            <Field label="1行目" hint="[[ ]] で囲むと強調色（例: [[与信審査]]なしで）">
              <Text value={scene.eyebrow} onChange={(v) => set('eyebrow', v)} />
            </Field>
            <Field label="見出し（特大）" hint="6文字前後が一番映えます">
              <Text value={scene.headline} onChange={(v) => set('headline', v)} />
            </Field>
            <Field label="注記（小さく）">
              <Text value={scene.footnote} onChange={(v) => set('footnote', v || undefined)} />
            </Field>
            <VisualEditor projectId={project.id} visual={scene.visual} onChange={(v) => set('visual', v)} />
          </>
        ) : null}
        {scene.type === 'showcase' ? <ShowcaseFields project={project} scene={scene} set={set} /> : null}
        {scene.type === 'cta' ? (
          <>
            <Field label="ロゴ文字" hint="空欄ならブランド名">
              <Text value={scene.logoText} onChange={(v) => set('logoText', v || undefined)} multiline placeholder={project.brand.name} />
            </Field>
            <Field label="ボタンの文言">
              <Text value={scene.buttonText} onChange={(v) => set('buttonText', v)} />
            </Field>
            <Field label="連絡先・URL">
              <Text value={scene.contact} onChange={(v) => set('contact', v || undefined)} />
            </Field>
            <Field label="注記（1行に1つ）">
              <Text value={scene.notes.join('\n')} onChange={(v) => set('notes', v.split('\n').filter((x) => x.trim()))} multiline />
            </Field>
          </>
        ) : null}
      </div>

      <LinesEditor project={project} index={index} update={update} timing={timing} runJob={runJob} />
      <CharactersEditor project={project} index={index} update={update} />

      <div className="section">
        <div className="section-title">演出</div>
        <div className="row">
          <Field label="入りのトランジション">
            <Select value={scene.transition} onChange={(v) => set('transition', v)} options={TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))} />
          </Field>
          <Field label="背景">
            <Select
              value={(s.background as string) ?? ''}
              onChange={(v) => set('background', v || undefined)}
              options={[{ value: '', label: '自動' }, ...BACKGROUNDS.map((b) => ({ value: b, label: BG_LABELS[b] }))]}
            />
          </Field>
        </div>
        <Field label="最低表示時間（秒）" hint="セリフが長ければ自動で延びます。空欄で自動">
          <Num value={scene.minDurationSec} step={0.1} min={0.5} max={15} onChange={(v) => set('minDurationSec', v || undefined)} />
        </Field>
      </div>
    </div>
  );
};

const LinesEditor: React.FC<{ project: Project; index: number; update: Update; timing?: SceneTiming; runJob?: RunJob }> = ({ project, index, update, timing, runJob }) => {
  const meta = useContext(MetaContext)!;
  const scene = project.scenes[index];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakers = [...project.cast.map((c) => ({ value: c.id, label: c.name })), { value: 'narrator', label: 'ナレーター（字幕）' }];
  const setLine = (li: number, patch: Partial<Line>) =>
    update((p) => {
      Object.assign(p.scenes[index].lines[li], patch);
    });
  const play = (src: string) => {
    audioRef.current?.pause();
    audioRef.current = new Audio(`/files/${project.id}/${src}?t=${Date.now()}`);
    audioRef.current.play();
  };
  const tts = ttsFor(meta, project.audio.ttsProvider);
  const redo = async (id: string) => {
    if (!runJob) return;
    const fresh = await regenerateLine(project, id, runJob);
    if (fresh) play(fresh.src);
  };
  return (
    <div className="section">
      <div className="section-title">セリフ</div>
      <div className="faint" style={{ margin: '-4px 0 10px' }}>
        上から順に喋ります。表示「なし」は声だけ（特徴シーンで見出しと同じ文を読む時など）
      </div>
      {scene.lines.map((l, li) => {
        const stale = isAudioStale(l, project.cast, ttsFor(meta, project.audio.ttsProvider).engine);
        const lt = timing?.lines[li];
        return (
          <div className="sub" key={l.id}>
            <div className="sub-head">
              <span className="grip">#{li + 1}</span>
              <div style={{ width: 130 }}>
                <Select value={l.speaker} onChange={(v) => setLine(li, { speaker: v })} options={speakers} />
              </div>
              {project.audio.narration ? (
                <>
                  {l.audio ? (
                    <button className={`icon-btn ${stale ? '' : 'audio-ok'}`} onClick={() => play(l.audio!.src)} title={stale ? '再生（文言や声を変えたので、いまの内容とは違います）' : '音声を再生'}>
                      ▶ {l.audio.durationSec.toFixed(1)}s
                    </button>
                  ) : null}
                  {stale ? <span className="audio-stale">● {l.audio ? '要作り直し' : '音声なし'}</span> : null}
                  {runJob ? (
                    <button className="icon-btn" disabled={!tts.ready || !(l.text.trim() || l.speak?.trim())} onClick={() => redo(l.id)} title="このセリフだけ音声を作り直して、すぐ再生します">
                      ↻ {l.audio ? '作り直す' : '作る'}
                    </button>
                  ) : null}
                </>
              ) : null}
              <div className="spacer" />
              {lt ? <span className="faint">{(lt.start / project.fps).toFixed(1)}s〜</span> : null}
              <button
                className="icon-btn"
                title="上へ"
                onClick={() =>
                  li > 0 &&
                  update((p) => {
                    const a = p.scenes[index].lines;
                    [a[li - 1], a[li]] = [a[li], a[li - 1]];
                  })
                }
              >
                ▲
              </button>
              <button className="icon-btn" title="削除" onClick={() => update((p) => void p.scenes[index].lines.splice(li, 1))}>
                ✕
              </button>
            </div>
            <Text value={l.text} onChange={(v) => setLine(li, { text: v })} multiline />
            <div className="row" style={{ marginTop: 8 }}>
              <Field label="表示">
                <Select
                  value={l.style}
                  onChange={(v) => setLine(li, { style: v })}
                  options={[
                    { value: 'bubble', label: '吹き出し（白）' },
                    { value: 'bubble-accent', label: '吹き出し（色）' },
                    { value: 'caption', label: '字幕' },
                    { value: 'none', label: 'なし（声だけ）' },
                  ]}
                />
              </Field>
              <Field label="表情">
                <Select value={l.pose ?? ''} onChange={(v) => setLine(li, { pose: (v || undefined) as Line['pose'] })} options={[{ value: '', label: '変えない' }, ...POSES.map((p) => ({ value: p, label: POSE_LABELS[p] }))]} />
              </Field>
            </div>
            {ttsFor(meta, project.audio.ttsProvider).provider === 'irodori' ? (
              <Field label="感情（Irodori-TTS）" hint="セリフの前に付く絵文字で、声の調子が変わります。効き方は文脈によって変わります">
                <div className="chips">
                  <button className={`chip ${!l.emoji ? 'on' : ''}`} onClick={() => setLine(li, { emoji: undefined })}>
                    なし
                  </button>
                  {IRODORI_EMOJI.map((e) => (
                    <button key={e.emoji} className={`chip ${l.emoji === e.emoji ? 'on' : ''}`} title={e.label} onClick={() => setLine(li, { emoji: e.emoji })}>
                      {e.emoji}
                      <span className="faint">{e.label}</span>
                    </button>
                  ))}
                </div>
              </Field>
            ) : null}
            <Field label="演技指示（任意）" hint="声の感情。例: 驚いて／困って小声で／ワクワクして。棒読み対策に効果的です">
              <Text value={l.delivery} onChange={(v) => setLine(li, { delivery: v || undefined })} />
            </Field>
            <Field label="読み方（任意）" hint="英字ブランド名などの読み間違い対策。句読点は残して、その語だけ直す。例: だったら、スシトップ オーシーアール！">
              <Text value={l.speak} onChange={(v) => setLine(li, { speak: v || undefined })} />
            </Field>
          </div>
        );
      })}
      <button
        className="btn sm"
        onClick={() =>
          update((p) =>
            void p.scenes[index].lines.push({ id: `l-${rid()}`, speaker: project.cast[0]?.id ?? 'narrator', text: 'セリフ', style: 'bubble' }),
          )
        }
      >
        ＋ セリフを追加
      </button>
    </div>
  );
};

const CharactersEditor: React.FC<{ project: Project; index: number; update: Update }> = ({ project, index, update }) => {
  const scene = project.scenes[index];
  const setC = (ci: number, patch: Partial<CharacterPlacement>) => update((p) => void Object.assign(p.scenes[index].characters[ci], patch));
  return (
    <div className="section">
      <div className="section-title">登場キャラ</div>
      {scene.characters.map((c, ci) => (
        <div className="sub" key={`${c.id}-${ci}`}>
          <div className="sub-head">
            <div style={{ width: 130 }}>
              <Select value={c.id} onChange={(v) => setC(ci, { id: v })} options={project.cast.map((m) => ({ value: m.id, label: m.name }))} />
            </div>
            <div className="spacer" />
            <Toggle checked={c.flip} onChange={(v) => setC(ci, { flip: v })} label={<span className="faint">左右反転</span>} />
            <button className="icon-btn" title="削除" onClick={() => update((p) => void p.scenes[index].characters.splice(ci, 1))}>
              ✕
            </button>
          </div>
          <div className="row tight">
            <Field label="位置">
              <Select
                value={c.position}
                onChange={(v) => setC(ci, { position: v })}
                options={[
                  { value: 'far-left', label: '左端' },
                  { value: 'left', label: '左' },
                  { value: 'center', label: '中央' },
                  { value: 'right', label: '右' },
                  { value: 'far-right', label: '右端' },
                ]}
              />
            </Field>
            <Field label="大きさ">
              <Select
                value={c.size}
                onChange={(v) => setC(ci, { size: v })}
                options={[
                  { value: 's', label: '小' },
                  { value: 'm', label: '中' },
                  { value: 'l', label: '大' },
                  { value: 'xl', label: 'アップ' },
                ]}
              />
            </Field>
            <Field label="表情">
              <Select value={c.pose} onChange={(v) => setC(ci, { pose: v })} options={POSES.map((p) => ({ value: p, label: POSE_LABELS[p] }))} />
            </Field>
          </div>
          <div className="row tight">
            <Field label="登場">
              <Select
                value={c.enter}
                onChange={(v) => setC(ci, { enter: v })}
                options={[
                  { value: 'pop', label: 'ポップ' },
                  { value: 'jump', label: 'ジャンプ' },
                  { value: 'slide', label: 'スライド' },
                  { value: 'drop', label: '落下' },
                  { value: 'none', label: 'なし' },
                ]}
              />
            </Field>
            <Field label="遅れ（秒）">
              <Num value={c.enterDelaySec} step={0.1} min={0} max={10} onChange={(v) => setC(ci, { enterDelaySec: v })} />
            </Field>
          </div>
        </div>
      ))}
      {project.cast.length ? (
        <button
          className="btn sm"
          onClick={() =>
            update(
              (p) =>
                void p.scenes[index].characters.push({
                  id: project.cast[scene.characters.length % project.cast.length].id,
                  pose: 'default',
                  position: 'center',
                  size: 'm',
                  enter: 'pop',
                  enterDelaySec: 0,
                  flip: false,
                }),
            )
          }
        >
          ＋ キャラを追加
        </button>
      ) : (
        <div className="faint">「キャラ・声」タブでキャラクターを追加してください</div>
      )}
    </div>
  );
};

const VISUAL_KINDS: { value: Visual['kind']; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'flow', label: 'A → B（流れ）' },
  { value: 'icons', label: 'アイコン並び' },
  { value: 'stack', label: '積み上げ→完了' },
  { value: 'jump', label: '障壁を飛び越える' },
  { value: 'counter', label: '数字カウントアップ' },
  { value: 'compare', label: 'Before → After' },
  { value: 'image', label: '画像' },
];

const defaultVisual = (kind: Visual['kind']): Visual => {
  switch (kind) {
    case 'flow':
      return { kind, from: 'phone', to: 'store', fromLabel: '', toLabel: '', effect: 'sparkles' };
    case 'icons':
      return { kind, items: [{ icon: 'check', label: 'ポイント1' }, { icon: 'star', label: 'ポイント2' }] };
    case 'stack':
      return { kind, icon: 'document', count: 4 };
    case 'jump':
      return { kind, obstacleLabel: '面倒な手続き', goal: 'store' };
    case 'counter':
      return { kind, from: 0, to: 100, suffix: '%' };
    case 'compare':
      return { kind, before: { icon: 'document', label: 'これまで' }, after: { icon: 'phone', label: 'これから' } };
    case 'image':
      return { kind, src: '' };
    default:
      return { kind: 'none' };
  }
};

const VisualEditor: React.FC<{ projectId: string; visual: Visual; onChange: (v: Visual) => void }> = ({ projectId, visual, onChange }) => {
  const v = visual as Visual & Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => onChange({ ...visual, ...p } as Visual);
  const icon = (key: string) => (
    <Select value={v[key] as IconName} onChange={(x) => patch({ [key]: x })} options={iconOptions} />
  );
  return (
    <div className="sub" style={{ marginTop: 6 }}>
      <Field label="図解">
        <Select value={visual.kind} onChange={(k) => onChange(defaultVisual(k))} options={VISUAL_KINDS} />
      </Field>
      {visual.kind === 'flow' ? (
        <>
          <div className="row tight">
            <Field label="左のアイコン">{icon('from')}</Field>
            <Field label="右のアイコン">{icon('to')}</Field>
          </div>
          <div className="row tight">
            <Field label="左ラベル">
              <Text value={visual.fromLabel} onChange={(x) => patch({ fromLabel: x })} />
            </Field>
            <Field label="右ラベル">
              <Text value={visual.toLabel} onChange={(x) => patch({ toLabel: x })} />
            </Field>
          </div>
          <Field label="演出">
            <Select
              value={visual.effect}
              onChange={(x) => patch({ effect: x })}
              options={[
                { value: 'coins', label: 'コインが降る' },
                { value: 'sparkles', label: 'キラキラ' },
                { value: 'confetti', label: '紙吹雪' },
                { value: 'none', label: 'なし' },
              ]}
            />
          </Field>
        </>
      ) : null}
      {visual.kind === 'icons' ? (
        <>
          {visual.items.map((it, i) => (
            <div className="row tight" key={i}>
              <Field>
                <Select
                  value={it.icon}
                  onChange={(x) => patch({ items: visual.items.map((o, j) => (j === i ? { ...o, icon: x } : o)) })}
                  options={iconOptions}
                />
              </Field>
              <Field>
                <Text value={it.label} onChange={(x) => patch({ items: visual.items.map((o, j) => (j === i ? { ...o, label: x } : o)) })} />
              </Field>
              <button className="icon-btn" style={{ flex: 'none', marginTop: 6 }} onClick={() => visual.items.length > 1 && patch({ items: visual.items.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          {visual.items.length < 3 ? (
            <button className="btn sm" onClick={() => patch({ items: [...visual.items, { icon: 'star', label: 'ポイント' }] })}>
              ＋ アイコン
            </button>
          ) : null}
        </>
      ) : null}
      {visual.kind === 'stack' ? (
        <div className="row tight">
          <Field label="アイコン">{icon('icon')}</Field>
          <Field label="枚数">
            <Num value={visual.count} min={2} max={6} onChange={(x) => patch({ count: Math.max(2, Math.min(6, Math.round(x))) })} />
          </Field>
        </div>
      ) : null}
      {visual.kind === 'jump' ? (
        <div className="row tight">
          <Field label="障壁の名前">
            <Text value={visual.obstacleLabel} onChange={(x) => patch({ obstacleLabel: x })} />
          </Field>
          <Field label="ゴール">{icon('goal')}</Field>
        </div>
      ) : null}
      {visual.kind === 'counter' ? (
        <>
          <div className="row tight">
            <Field label="開始">
              <Num value={visual.from} onChange={(x) => patch({ from: x })} />
            </Field>
            <Field label="終了">
              <Num value={visual.to} onChange={(x) => patch({ to: x })} />
            </Field>
            <Field label="小数">
              <Num value={visual.decimals ?? 0} min={0} max={2} onChange={(x) => patch({ decimals: x })} />
            </Field>
          </div>
          <div className="row tight">
            <Field label="前に付ける">
              <Text value={visual.prefix} onChange={(x) => patch({ prefix: x })} />
            </Field>
            <Field label="単位">
              <Text value={visual.suffix} onChange={(x) => patch({ suffix: x })} />
            </Field>
            <Field label="上の小見出し">
              <Text value={visual.caption} onChange={(x) => patch({ caption: x })} />
            </Field>
          </div>
        </>
      ) : null}
      {visual.kind === 'compare' ? (
        <>
          <div className="row tight">
            <Field label="Before">
              <Select value={visual.before.icon} onChange={(x) => patch({ before: { ...visual.before, icon: x } })} options={iconOptions} />
            </Field>
            <Field label="ラベル">
              <Text value={visual.before.label} onChange={(x) => patch({ before: { ...visual.before, label: x } })} />
            </Field>
          </div>
          <div className="row tight">
            <Field label="After">
              <Select value={visual.after.icon} onChange={(x) => patch({ after: { ...visual.after, icon: x } })} options={iconOptions} />
            </Field>
            <Field label="ラベル">
              <Text value={visual.after.label} onChange={(x) => patch({ after: { ...visual.after, label: x } })} />
            </Field>
          </div>
        </>
      ) : null}
      {visual.kind === 'image' ? (
        <div className="row center">
          {visual.src ? <img src={`/files/${projectId}/${visual.src}`} alt="" style={{ height: 60, flex: 'none', objectFit: 'contain' }} /> : <span className="faint">未設定</span>}
          <FilePick accept="image/*" onFile={async (f) => patch({ src: (await api.upload(projectId, f)).path })}>
            画像をアップロード
          </FilePick>
        </div>
      ) : null}
    </div>
  );
};

const ShowcaseFields: React.FC<{ project: Project; scene: Extract<Scene, { type: 'showcase' }>; set: (k: string, v: unknown) => void }> = ({ project, scene, set }) => {
  const pick = async (f: File) => {
    const { path, size } = await api.upload(project.id, f);
    set('screenshot', path);
    set('screenshotSize', size);
    // 縦長ならスマホ枠、横長ならブラウザ枠を自動選択
    if (size) set('screenshotFrame', size.h >= size.w * 1.2 ? 'phone' : 'browser');
  };
  return (
    <>
      <Field label="タイトル" hint="[[ ]] で強調">
        <Text value={scene.title} onChange={(v) => set('title', v)} multiline />
      </Field>
      <Field label="注記">
        <Text value={scene.note} onChange={(v) => set('note', v || undefined)} />
      </Field>
      <Field label="実際の画面のスクリーンショット *" hint="アプリ・管理画面・Webページなど、実際の画面を使います（疑似の画面は作りません）。縦に長い画像は自動でスクロールして全体を見せます">
        <div className="row center">
          {scene.screenshot ? (
            <img src={assetUrl(project.id, scene.screenshot)} alt="" style={{ height: 90, flex: 'none', borderRadius: 6, border: '1px solid var(--border)' }} />
          ) : (
            <span className="faint" style={{ color: 'var(--warn)' }}>未設定（書き出し前に必須）</span>
          )}
          <FilePick accept="image/*" onFile={pick}>
            {scene.screenshot ? '差し替える' : '画像を選ぶ'}
          </FilePick>
        </div>
      </Field>
      <Field label="表示の枠">
        <Select
          value={scene.screenshotFrame}
          onChange={(v) => set('screenshotFrame', v)}
          options={[
            { value: 'phone', label: 'スマホ枠（縦長の画面向け）' },
            { value: 'browser', label: 'ブラウザ枠（PC・管理画面向け）' },
          ]}
        />
      </Field>
    </>
  );
};
