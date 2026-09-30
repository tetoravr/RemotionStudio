import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Ellipsis, FlipHorizontal2, ImagePlus, Play, Plus, RefreshCw, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react';
import React, { useContext, useRef, useState } from 'react';
import { ICON_LABELS } from '../../video/components/Icon';
import { normalizeAdjust, readAdjust, sceneLayout, setSceneLayout } from '../../video/edit/textEdit';
import { isAudioStale } from '../../video/narrationKey';
import {
  BACKGROUNDS, ICON_NAMES, TRANSITIONS,
  type CharacterPlacement, type IconName, type Line, type Project, type Scene, type Visual,
} from '../../video/schema';
import type { SceneTiming } from '../../video/timeline';
import { api, ttsFor } from '../api';
import { MetaContext } from '../App';
import { Ic } from '../icons';
import type { RunJob, Update } from '../pages/Editor';
import { SCENE_META } from '../sceneMeta';
import { ElementList } from './ElementList';
import { Cell, Disclosure, Field, FilePick, MenuItem, Num, Popover, Section, Seg, Select, Text, Toggle } from './Fields';
import { regenerateLine } from './NarrationList';
import { assetUrl, Avatar, EmojiPicker, POSE_LABELS, PosePicker, SpeakerPicker } from './pickers';

export { POSE_LABELS };

const TRANSITION_LABELS: Record<string, string> = { wipe: '斜めワイプ', cut: 'カット', flash: 'フラッシュ', zoom: 'ズーム', slide: 'スライド' };
const BG_LABELS: Record<string, string> = {
  burst: '集中線（メイン色）', 'burst-light': '集中線（白）', 'burst-dark': '集中線（濃色）', stripes: 'ストライプ（淡）',
  'stripes-dark': 'ストライプ（濃）', dots: 'ドット', gradient: 'グラデーション', plain: '無地',
};
const iconOptions = ICON_NAMES.map((n) => ({ value: n, label: ICON_LABELS[n] }));
const rid = () => Math.random().toString(36).slice(2, 8);
const STYLE_LABELS: Record<Line['style'], string> = { bubble: '吹き出し', 'bubble-accent': '強調', caption: '字幕', none: '声のみ' };
const HIGHLIGHT_HINT = '[[ ]] で囲んだ文字はブランドカラーになります';

export const SceneInspector: React.FC<{ project: Project; index: number; update: Update; timing?: SceneTiming; runJob?: RunJob; onSelectElement?: (id: string) => void }> = ({
  project,
  index,
  update,
  timing,
  runJob,
  onSelectElement,
}) => {
  const scene = project.scenes[index];
  const set = (key: string, value: unknown) =>
    update((p) => {
      (p.scenes[index] as Record<string, unknown>)[key] = value;
    });
  const s = scene as Scene & Record<string, unknown>;
  const m = SCENE_META[scene.type];

  return (
    <div>
      <div className="insp-title">
        <span className="insp-icon">
          <Ic n={m.icon} size={16} mr={0} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t">{m.name}</div>
          <div className="s">
            シーン{index + 1}
            {timing ? ` ・ ${(timing.duration / project.fps).toFixed(1)}秒` : ''}
          </div>
        </div>
      </div>

      {scene.type === 'logo' ? (
        <Section title="テキスト" footer={`${HIGHLIGHT_HINT}。ロゴ画像は「デザイン」で設定できます`}>
          <div className="group">
            <Cell label="ロゴ文字" stack>
              <Text bare multiline rows={1} value={scene.logoText} onChange={(v) => set('logoText', v || undefined)} placeholder={project.brand.name} />
            </Cell>
            <Cell label="サブコピー" stack>
              <Text bare multiline rows={1} value={scene.subtitle} onChange={(v) => set('subtitle', v || undefined)} placeholder="なし" />
            </Cell>
          </div>
        </Section>
      ) : null}
      {scene.type === 'talk' ? (
        <Section title="テキスト">
          <div className="group">
            <Cell label="見出し" stack>
              <Text bare multiline rows={1} value={scene.headline} onChange={(v) => set('headline', v || undefined)} placeholder="なし" />
            </Cell>
          </div>
        </Section>
      ) : null}
      {scene.type === 'feature' ? (
        <Section title="テキスト" footer={`${HIGHLIGHT_HINT}。見出しは6文字前後が一番映えます`}>
          <div className="group">
            <Cell label="1行目" stack>
              <Text bare value={scene.eyebrow} onChange={(v) => set('eyebrow', v)} />
            </Cell>
            <Cell label="見出し" stack>
              <Text bare value={scene.headline} onChange={(v) => set('headline', v)} />
            </Cell>
            <Cell label="注記" stack>
              <Text bare value={scene.footnote} onChange={(v) => set('footnote', v || undefined)} placeholder="なし" />
            </Cell>
          </div>
        </Section>
      ) : null}
      {scene.type === 'showcase' ? (
        <Section title="テキスト" footer={HIGHLIGHT_HINT}>
          <div className="group">
            <Cell label="タイトル" stack>
              <Text bare multiline rows={1} value={scene.title} onChange={(v) => set('title', v)} />
            </Cell>
            <Cell label="注記" stack>
              <Text bare value={scene.note} onChange={(v) => set('note', v || undefined)} placeholder="なし" />
            </Cell>
          </div>
        </Section>
      ) : null}
      {scene.type === 'cta' ? (
        <Section title="テキスト">
          <div className="group">
            <Cell label="ロゴ文字" stack>
              <Text bare multiline rows={1} value={scene.logoText} onChange={(v) => set('logoText', v || undefined)} placeholder={project.brand.name} />
            </Cell>
            <Cell label="ボタンの文言" stack>
              <Text bare value={scene.buttonText} onChange={(v) => set('buttonText', v)} />
            </Cell>
            <Cell label="連絡先・URL" stack>
              <Text bare value={scene.contact} onChange={(v) => set('contact', v || undefined)} placeholder="なし" />
            </Cell>
            <Cell label="注記（1行に1つ）" stack>
              <Text bare multiline rows={1} value={scene.notes.join('\n')} onChange={(v) => set('notes', v.split('\n').filter((x) => x.trim()))} placeholder="なし" />
            </Cell>
          </div>
        </Section>
      ) : null}

      {scene.type === 'showcase' ? <ShowcaseFields project={project} scene={scene} set={set} /> : null}
      {scene.type === 'feature' ? (
        <Section title="図解">
          <VisualEditor projectId={project.id} sceneId={scene.id} visual={scene.visual} onChange={(v) => set('visual', v)} runJob={runJob} />
        </Section>
      ) : null}
      {scene.type === 'talk' ? <PropEditor project={project} scene={scene} set={set} runJob={runJob} /> : null}

      <LinesEditor project={project} index={index} update={update} runJob={runJob} />
      <CharactersEditor project={project} index={index} update={update} />

      <Section title="そのほか">
        <div className="group">
          <Disclosure summary="演出">
            <div className="kv">
              <span>切り替え</span>
              <Select value={scene.transition} onChange={(v) => set('transition', v)} options={TRANSITIONS.map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))} />
            </div>
            <div className="kv">
              <span>背景</span>
              <Select
                value={(s.background as string) ?? ''}
                onChange={(v) => set('background', v || undefined)}
                options={[{ value: '', label: '自動' }, ...BACKGROUNDS.map((b) => ({ value: b, label: BG_LABELS[b] }))]}
              />
            </div>
            <div className="kv">
              <span>最短の長さ</span>
              <div className="hstack">
                <Num value={scene.minDurationSec} step={0.1} min={0.5} max={15} placeholder="自動" onChange={(v) => set('minDurationSec', v || undefined)} style={{ width: 90 }} />
                <span className="caption">秒（セリフが長ければ自動で延びます）</span>
              </div>
            </div>
            {scene.type === 'talk' ? (
              <>
                <div className="kv">
                  <span>記号</span>
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
                </div>
                <div className="kv">
                  <span>ロゴ</span>
                  <Toggle checked={scene.showLogo} onChange={(v) => set('showLogo', v)} label={<span className="small">上部に小さく表示</span>} />
                </div>
              </>
            ) : null}
            {scene.type === 'logo' ? (
              <div className="kv">
                <span>帯</span>
                <Toggle checked={scene.ticker} onChange={(v) => set('ticker', v)} label={<span className="small">ブランド名の帯を流す</span>} />
              </div>
            ) : null}
          </Disclosure>
          <ElementList project={project} index={index} update={update} onSelect={onSelectElement} />
        </div>
      </Section>
    </div>
  );
};

/* ---------------- セリフ ---------------- */

const LinesEditor: React.FC<{ project: Project; index: number; update: Update; runJob?: RunJob }> = ({ project, index, update, runJob }) => {
  const scene = project.scenes[index];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const play = (src: string) => {
    audioRef.current?.pause();
    audioRef.current = new Audio(`/files/${project.id}/${src}?t=${Date.now()}`);
    audioRef.current.play();
  };
  return (
    <Section title="セリフ" right={<span className="caption">上から順に話します</span>}>
      <div className="group">
        {scene.lines.map((l, li) => (
          <LineCard key={l.id} project={project} index={index} li={li} line={l} update={update} runJob={runJob} play={play} />
        ))}
        <Cell
          className="cell-action"
          onClick={() =>
            update((p) => void p.scenes[index].lines.push({ id: `l-${rid()}`, speaker: project.cast[0]?.id ?? 'narrator', text: '', style: 'bubble' }))
          }
        >
          <Ic n={Plus} size={14} mr={0} />
          セリフを追加
        </Cell>
      </div>
    </Section>
  );
};

const LineCard: React.FC<{
  project: Project;
  index: number;
  li: number;
  line: Line;
  update: Update;
  runJob?: RunJob;
  play: (src: string) => void;
}> = ({ project, index, li, line: l, update, runJob, play }) => {
  const meta = useContext(MetaContext)!;
  const [open, setOpen] = useState(false);
  const scene = project.scenes[index];
  const tts = ttsFor(meta, project.audio.ttsProvider);
  const narration = project.audio.narration;
  const stale = isAudioStale(l, project.cast, tts.engine);
  const setLine = (patch: Partial<Line>) => update((p) => void Object.assign(p.scenes[index].lines[li], patch));
  const isCast = project.cast.some((c) => c.id === l.speaker);
  const bubble = l.style === 'bubble' || l.style === 'bubble-accent';
  const redo = async () => {
    if (!runJob) return;
    const fresh = await regenerateLine(project, l.id, runJob);
    if (fresh) play(fresh.src);
  };
  const move = (d: number) =>
    update((p) => {
      const a = p.scenes[index].lines;
      const j = li + d;
      if (j < 0 || j >= a.length) return;
      [a[j], a[li]] = [a[li], a[j]];
    });

  // しっぽは画面の形（縦型・正方形・横型）ごとに持つ
  const tailKey = `line:${l.id}`;
  const tail = readAdjust(scene, tailKey, project.format).tail;
  const setTail = (t: { dx: number; dy: number; hidden?: boolean } | undefined) =>
    update((p) => {
      const sc = p.scenes[index];
      const map = { ...sceneLayout(sc, p.format) };
      const next = normalizeAdjust({ ...readAdjust(sc, tailKey, p.format), tail: t });
      if (next) map[tailKey] = next;
      else delete map[tailKey];
      setSceneLayout(sc, p.format, map);
    });

  return (
    <div className="line-card cell" style={{ display: 'block', padding: 0 }}>
      <div className="line-main">
        <SpeakerPicker project={project} value={l.speaker} onChange={(v) => setLine({ speaker: v })} />
        <Text bare multiline rows={1} value={l.text} onChange={(v) => setLine({ text: v })} placeholder="セリフを入力" />
        <div className="line-tools">
          {narration && l.audio ? (
            <button className="icon-btn sm" onClick={() => play(l.audio!.src)} title={stale ? '前の音声を再生（今の内容とは違います）' : '音声を再生'}>
              <Ic n={Play} size={13} mr={0} />
            </button>
          ) : null}
          <Popover
            align="right"
            button={({ open: o, toggle }) => (
              <button className="icon-btn sm" aria-expanded={o} onClick={toggle} title="セリフの操作">
                <Ic n={Ellipsis} size={14} mr={0} />
              </button>
            )}
          >
            {(close) => (
              <>
                {runJob && narration ? (
                  <MenuItem icon={RefreshCw} disabled={!tts.ready || !(l.text.trim() || l.speak?.trim())} onClick={() => (close(), redo())}>
                    {l.audio ? '音声を作り直して聴く' : '音声を作って聴く'}
                  </MenuItem>
                ) : null}
                <MenuItem icon={ArrowUp} disabled={li === 0} onClick={() => (close(), move(-1))}>
                  上へ移動
                </MenuItem>
                <MenuItem icon={ArrowDown} disabled={li === scene.lines.length - 1} onClick={() => (close(), move(1))}>
                  下へ移動
                </MenuItem>
                <div className="menu-sep" />
                <MenuItem icon={Trash2} danger onClick={() => (close(), update((p) => void p.scenes[index].lines.splice(li, 1)))}>
                  削除
                </MenuItem>
              </>
            )}
          </Popover>
        </div>
      </div>
      <button type="button" className="line-meta" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="badge">{STYLE_LABELS[l.style]}</span>
        {l.pose ? <span className="badge">{POSE_LABELS[l.pose]}</span> : null}
        {l.emoji ? <span className="badge">{l.emoji}</span> : null}
        {l.delivery ? <span className="badge ellipsis" style={{ maxWidth: 110 }}>{l.delivery}</span> : null}
        {narration ? (
          stale ? (
            <span className="badge warn">{l.audio ? '音声を更新' : '音声なし'}</span>
          ) : l.audio ? (
            <span className="caption">{l.audio.durationSec.toFixed(1)}秒</span>
          ) : null
        ) : null}
        <span className="spacer" />
        <Ic n={open ? ChevronDown : ChevronRight} size={13} mr={0} />
      </button>
      {open ? (
        <div className="line-detail">
          <Field label="表示">
            <Seg
              block
              value={l.style}
              onChange={(v) => setLine({ style: v })}
              options={(['bubble', 'bubble-accent', 'caption', 'none'] as const).map((v) => ({ value: v, label: STYLE_LABELS[v] }))}
            />
          </Field>
          {isCast ? (
            <Field label="表情">
              <div className="hstack">
                <PosePicker project={project} castId={l.speaker} value={l.pose} inherit onChange={(v) => setLine({ pose: v })} />
              </div>
            </Field>
          ) : null}
          <Field label="声の調子">
            <div className="hstack">
              <EmojiPicker value={l.emoji} onChange={(v) => setLine({ emoji: v })} />
              <Text value={l.delivery} onChange={(v) => setLine({ delivery: v || undefined })} placeholder="演技の指示（例: 驚いて）" />
            </div>
          </Field>
          <Field label="読み方" hint="英字のブランド名などを読み間違える時だけ、その語をカタカナに（句読点は残す）">
            <Text value={l.speak} onChange={(v) => setLine({ speak: v || undefined })} placeholder="例: だったら、スシトップ オーシーアール！" />
          </Field>
          {bubble ? (
            <Field label="吹き出しのしっぽ" hint="位置は映像の上で吹き出しを選び、先端の点をドラッグして変えられます">
              <div className="hstack">
                <Seg
                  value={tail?.hidden ? 'off' : 'on'}
                  onChange={(v) => setTail({ dx: tail?.dx ?? 0, dy: tail?.dy ?? 0, hidden: v === 'off' ? true : undefined })}
                  options={[
                    { value: 'on', label: 'あり' },
                    { value: 'off', label: 'なし' },
                  ]}
                />
                <button className="btn sm plain" disabled={!tail} onClick={() => setTail(undefined)}>
                  位置を戻す
                </button>
              </div>
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/* ---------------- キャラクター ---------------- */

const POSITIONS: { value: CharacterPlacement['position']; label: string }[] = [
  { value: 'far-left', label: '左端' },
  { value: 'left', label: '左' },
  { value: 'center', label: '中央' },
  { value: 'right', label: '右' },
  { value: 'far-right', label: '右端' },
];
const SIZES: { value: CharacterPlacement['size']; label: string }[] = [
  { value: 's', label: '小' },
  { value: 'm', label: '中' },
  { value: 'l', label: '大' },
  { value: 'xl', label: 'アップ' },
];

const CharactersEditor: React.FC<{ project: Project; index: number; update: Update }> = ({ project, index, update }) => {
  const scene = project.scenes[index];
  const setC = (ci: number, patch: Partial<CharacterPlacement>) => update((p) => void Object.assign(p.scenes[index].characters[ci], patch));
  return (
    <Section title="キャラクター">
      <div className="group">
        {scene.characters.map((c, ci) => (
          <div className="cell stack" key={`${c.id}-${ci}`} style={{ gap: 8 }}>
            <div className="hstack">
              <Avatar project={project} id={c.id} size={30} />
              <Select value={c.id} onChange={(v) => setC(ci, { id: v })} options={project.cast.map((mm) => ({ value: mm.id, label: mm.name }))} style={{ flex: 1 }} />
              <PosePicker project={project} castId={c.id} value={c.pose} onChange={(v) => setC(ci, { pose: v ?? 'default' })} />
              <Popover
                align="right"
                button={({ open, toggle }) => (
                  <button className="icon-btn sm" aria-expanded={open} onClick={toggle} title="キャラクターの操作">
                    <Ic n={Ellipsis} size={14} mr={0} />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem icon={FlipHorizontal2} onClick={() => (close(), setC(ci, { flip: !c.flip }))}>
                      {c.flip ? '左右反転をやめる' : '左右反転'}
                    </MenuItem>
                    <div className="menu-sep" />
                    <MenuItem icon={Trash2} danger onClick={() => (close(), update((p) => void p.scenes[index].characters.splice(ci, 1)))}>
                      このシーンから外す
                    </MenuItem>
                  </>
                )}
              </Popover>
            </div>
            <div className="kv">
              <span>位置</span>
              <Seg block value={c.position} onChange={(v) => setC(ci, { position: v })} options={POSITIONS} />
            </div>
            <div className="kv">
              <span>大きさ</span>
              <Seg block value={c.size} onChange={(v) => setC(ci, { size: v })} options={SIZES} />
            </div>
            <div className="kv">
              <span>登場</span>
              <div className="hstack">
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
                <Num value={c.enterDelaySec} step={0.1} min={0} max={10} onChange={(v) => setC(ci, { enterDelaySec: v })} style={{ width: 70 }} />
                <span className="caption none">秒後</span>
              </div>
            </div>
          </div>
        ))}
        {project.cast.length ? (
          <Cell
            className="cell-action"
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
            <Ic n={Plus} size={14} mr={0} />
            キャラクターを追加
          </Cell>
        ) : (
          <Cell label={<span className="faint">「キャスト」でキャラクターを追加してください</span>} />
        )}
      </div>
    </Section>
  );
};

/* ---------------- 小道具（会話シーン） ---------------- */

const PropEditor: React.FC<{ project: Project; scene: Extract<Scene, { type: 'talk' }>; set: (k: string, v: unknown) => void; runJob?: RunJob }> = ({ project, scene, set, runJob }) => {
  const meta = useContext(MetaContext)!;
  const prop = scene.prop;
  return (
    <Section title="小道具" footer={prop ? '図解イラストがあると、アイコンのカードの代わりに大きく表示されます' : undefined}>
      <div className="group">
        <Cell label="課題を表す小道具を出す">
          <Toggle checked={Boolean(prop)} onChange={(v) => set('prop', v ? { icon: 'card', badge: 'ng', label: '' } : undefined)} />
        </Cell>
        {prop ? (
          <>
            <Cell label="アイコン">
              <Select value={prop.icon} onChange={(v) => set('prop', { ...prop, icon: v })} options={iconOptions} style={{ width: 150 }} />
            </Cell>
            <Cell label="バッジ">
              <Seg
                value={prop.badge}
                onChange={(v) => set('prop', { ...prop, badge: v })}
                options={[
                  { value: 'none', label: 'なし' },
                  { value: 'ng', label: 'NG' },
                  { value: 'ok', label: 'OK' },
                ]}
              />
            </Cell>
            <Cell label="ラベル" stack>
              <Text bare value={prop.label} onChange={(v) => set('prop', { ...prop, label: v })} placeholder="なし" />
            </Cell>
            <Cell label="図解イラスト" stack>
              <div className="hstack wrap" style={{ marginTop: 4 }}>
                {prop.image ? <img src={assetUrl(project.id, prop.image)} alt="" className="thumb-img" style={{ height: 64, background: '#fff' }} /> : null}
                <button
                  className="btn sm"
                  disabled={!meta.openai || !runJob}
                  title={meta.openai ? '課題の状況をAIが図解にします（文字なし・約20秒）' : 'OPENAI_API_KEY が必要です'}
                  onClick={() => runJob?.('課題の図解を作っています', `/api/projects/${project.id}/illustrations`, { sceneIds: [scene.id] })}
                >
                  <Ic n={Sparkles} size={13} mr={0} />
                  {prop.image ? 'AIで描き直す' : 'AIで描く'}
                </button>
                <FilePick
                  accept="image/*"
                  onFile={async (f) => {
                    const { path } = await api.upload(project.id, f);
                    set('prop', { ...prop, image: path });
                  }}
                >
                  画像を選ぶ…
                </FilePick>
                {prop.image ? (
                  <button className="btn sm plain danger" onClick={() => set('prop', { ...prop, image: undefined })}>
                    外す
                  </button>
                ) : null}
              </div>
            </Cell>
          </>
        ) : null}
      </div>
    </Section>
  );
};

/* ---------------- 図解（特徴シーン） ---------------- */

const VISUAL_KINDS: { value: Visual['kind']; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'flow', label: 'A → B（流れ）' },
  { value: 'icons', label: 'アイコンを並べる' },
  { value: 'stack', label: '積み上げ → 完了' },
  { value: 'jump', label: '障壁を飛び越える' },
  { value: 'counter', label: '数字のカウントアップ' },
  { value: 'compare', label: 'Before → After' },
  { value: 'image', label: 'イラスト・画像' },
  { value: 'screen', label: '実際の画面' },
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
    case 'screen':
      return { kind, src: '', frame: 'browser' };
    default:
      return { kind: 'none' };
  }
};

const VisualEditor: React.FC<{ projectId: string; sceneId: string; visual: Visual; onChange: (v: Visual) => void; runJob?: RunJob }> = ({ projectId, sceneId, visual, onChange, runJob }) => {
  const meta = useContext(MetaContext)!;
  const v = visual as Visual & Record<string, unknown>;
  const patch = (p: Record<string, unknown>) => onChange({ ...visual, ...p } as Visual);
  const icon = (key: string) => <Select value={v[key] as IconName} onChange={(x) => patch({ [key]: x })} options={iconOptions} style={{ width: 140 }} />;
  return (
    <div className="group">
      <Cell label="種類">
        <Select value={visual.kind} onChange={(k) => onChange(defaultVisual(k))} options={VISUAL_KINDS} style={{ width: 180 }} />
      </Cell>
      {visual.kind === 'flow' ? (
        <>
          <Cell label="左">
            {icon('from')}
          </Cell>
          <Cell label="左のラベル" stack>
            <Text bare value={visual.fromLabel} onChange={(x) => patch({ fromLabel: x })} placeholder="なし" />
          </Cell>
          <Cell label="右">
            {icon('to')}
          </Cell>
          <Cell label="右のラベル" stack>
            <Text bare value={visual.toLabel} onChange={(x) => patch({ toLabel: x })} placeholder="なし" />
          </Cell>
          <Cell label="演出">
            <Select
              value={visual.effect}
              onChange={(x) => patch({ effect: x })}
              options={[
                { value: 'coins', label: 'コインが降る' },
                { value: 'sparkles', label: 'キラキラ' },
                { value: 'confetti', label: '紙吹雪' },
                { value: 'none', label: 'なし' },
              ]}
              style={{ width: 140 }}
            />
          </Cell>
        </>
      ) : null}
      {visual.kind === 'icons' ? (
        <>
          {visual.items.map((it, i) => (
            <Cell key={i}>
              <Select value={it.icon} onChange={(x) => patch({ items: visual.items.map((o, j) => (j === i ? { ...o, icon: x } : o)) })} options={iconOptions} style={{ width: 120 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text bare value={it.label} onChange={(x) => patch({ items: visual.items.map((o, j) => (j === i ? { ...o, label: x } : o)) })} placeholder="ラベル" />
              </div>
              <button className="icon-btn sm" disabled={visual.items.length <= 1} onClick={() => patch({ items: visual.items.filter((_, j) => j !== i) })} title="外す">
                <Ic n={X} size={13} mr={0} />
              </button>
            </Cell>
          ))}
          {visual.items.length < 3 ? (
            <Cell className="cell-action" onClick={() => patch({ items: [...visual.items, { icon: 'star', label: 'ポイント' }] })}>
              <Ic n={Plus} size={14} mr={0} />
              アイコンを追加
            </Cell>
          ) : null}
        </>
      ) : null}
      {visual.kind === 'stack' ? (
        <>
          <Cell label="アイコン">{icon('icon')}</Cell>
          <Cell label="枚数">
            <Num value={visual.count} min={2} max={6} onChange={(x) => patch({ count: Math.max(2, Math.min(6, Math.round(x))) })} style={{ width: 80 }} />
          </Cell>
        </>
      ) : null}
      {visual.kind === 'jump' ? (
        <>
          <Cell label="障壁の名前" stack>
            <Text bare value={visual.obstacleLabel} onChange={(x) => patch({ obstacleLabel: x })} />
          </Cell>
          <Cell label="ゴール">{icon('goal')}</Cell>
        </>
      ) : null}
      {visual.kind === 'counter' ? (
        <>
          <Cell label="数字">
            <div className="hstack">
              <Num value={visual.from} onChange={(x) => patch({ from: x })} style={{ width: 80 }} />
              <span className="caption">→</span>
              <Num value={visual.to} onChange={(x) => patch({ to: x })} style={{ width: 80 }} />
            </div>
          </Cell>
          <Cell label="小数の桁">
            <Num value={visual.decimals ?? 0} min={0} max={2} onChange={(x) => patch({ decimals: x })} style={{ width: 80 }} />
          </Cell>
          <Cell label="前に付ける" stack>
            <Text bare value={visual.prefix} onChange={(x) => patch({ prefix: x })} placeholder="なし" />
          </Cell>
          <Cell label="単位" stack>
            <Text bare value={visual.suffix} onChange={(x) => patch({ suffix: x })} placeholder="なし" />
          </Cell>
          <Cell label="上の小見出し" stack>
            <Text bare value={visual.caption} onChange={(x) => patch({ caption: x })} placeholder="なし" />
          </Cell>
        </>
      ) : null}
      {visual.kind === 'compare' ? (
        <>
          <Cell label="Before">
            <Select value={visual.before.icon} onChange={(x) => patch({ before: { ...visual.before, icon: x } })} options={iconOptions} style={{ width: 140 }} />
          </Cell>
          <Cell label="Before のラベル" stack>
            <Text bare value={visual.before.label} onChange={(x) => patch({ before: { ...visual.before, label: x } })} />
          </Cell>
          <Cell label="After">
            <Select value={visual.after.icon} onChange={(x) => patch({ after: { ...visual.after, icon: x } })} options={iconOptions} style={{ width: 140 }} />
          </Cell>
          <Cell label="After のラベル" stack>
            <Text bare value={visual.after.label} onChange={(x) => patch({ after: { ...visual.after, label: x } })} />
          </Cell>
        </>
      ) : null}
      {visual.kind === 'image' ? (
        <>
          <Cell label="イラストの内容（AIへの指示）" stack>
            <Text
              bare
              multiline
              rows={2}
              value={visual.prompt}
              onChange={(x) => patch({ prompt: x || undefined })}
              placeholder="解決した後の場面を具体的に。例: 受付でスタッフがタブレットで来場者の参加履歴を確認し、笑顔でうなずいている"
            />
          </Cell>
          <Cell>
            <div className="hstack wrap">
              {visual.src ? <img src={`/files/${projectId}/${visual.src}`} alt="" className="thumb-img" style={{ height: 64, background: '#fff' }} /> : null}
              <button
                className="btn sm"
                disabled={!meta.openai || !runJob || !visual.prompt?.trim()}
                title={!visual.prompt?.trim() ? 'イラストの内容を入力してください' : '約20秒かかります'}
                onClick={() => runJob?.('イラストを描いています', `/api/projects/${projectId}/illustrations`, { sceneIds: [sceneId] })}
              >
                <Ic n={Sparkles} size={13} mr={0} />
                {visual.src ? 'AIで描き直す' : 'AIで描く'}
              </button>
              <FilePick accept="image/*" onFile={async (f) => patch({ src: (await api.upload(projectId, f)).path })}>
                画像を選ぶ…
              </FilePick>
            </div>
          </Cell>
        </>
      ) : null}
      {visual.kind === 'screen' ? (
        <>
          <Cell>
            <div className="hstack wrap">
              {visual.src && !visual.src.startsWith('ui:') ? (
                <img src={`/files/${projectId}/${visual.src}`} alt="" className="thumb-img" style={{ height: 64 }} />
              ) : (
                <span className="warn-text small">
                  <Ic n={TriangleAlert} size={12} />
                  未設定
                </span>
              )}
              <FilePick
                accept="image/*"
                onFile={async (f) => {
                  const { path, size } = await api.upload(projectId, f);
                  patch({ src: path, size, frame: size && size.h > size.w * 1.2 ? 'phone' : 'browser' });
                }}
              >
                スクリーンショットを選ぶ…
              </FilePick>
            </div>
          </Cell>
          <Cell label="枠">
            <Seg
              value={visual.frame}
              onChange={(x) => patch({ frame: x })}
              options={[
                { value: 'browser', label: 'PC' },
                { value: 'phone', label: 'スマホ' },
              ]}
            />
          </Cell>
        </>
      ) : null}
    </div>
  );
};

/* ---------------- 画面紹介 ---------------- */

const ShowcaseFields: React.FC<{ project: Project; scene: Extract<Scene, { type: 'showcase' }>; set: (k: string, v: unknown) => void }> = ({ project, scene, set }) => {
  const pick = async (f: File) => {
    const { path, size } = await api.upload(project.id, f);
    set('screenshot', path);
    set('screenshotSize', size);
    // 縦長ならスマホ枠、横長ならブラウザ枠を自動選択
    if (size) set('screenshotFrame', size.h >= size.w * 1.2 ? 'phone' : 'browser');
  };
  const missing = !scene.screenshot || scene.screenshot.startsWith('ui:');
  return (
    <Section title="スクリーンショット" footer="アプリ・管理画面・Webページなど、実際の画面を使います。縦に長い画像は自動でスクロールして全体を見せます">
      <div className="group">
        <Cell>
          <div className="hstack wrap" style={{ flex: 1 }}>
            {!missing ? (
              <img src={assetUrl(project.id, scene.screenshot!)} alt="" className="thumb-img" style={{ height: 88 }} />
            ) : (
              <span className="warn-text small" style={{ flex: 1 }}>
                <Ic n={TriangleAlert} size={12} />
                未設定（書き出しの前に必要です）
              </span>
            )}
            <span className="spacer" />
            <FilePick accept="image/*" onFile={pick} className={`btn sm ${missing ? 'primary' : ''}`}>
              <Ic n={ImagePlus} size={13} mr={0} />
              {missing ? '画像を選ぶ…' : '差し替える…'}
            </FilePick>
          </div>
        </Cell>
        <Cell label="枠">
          <Seg
            value={scene.screenshotFrame}
            onChange={(v) => set('screenshotFrame', v)}
            options={[
              { value: 'phone', label: 'スマホ' },
              { value: 'browser', label: 'ブラウザ' },
            ]}
          />
        </Cell>
      </div>
    </Section>
  );
};
