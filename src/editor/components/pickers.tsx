import { Check, Mic, Plus, Smile, X } from 'lucide-react';
import React, { useState } from 'react';
import { AUDIO_TAG_GROUPS, AUDIO_TAGS, autoTags, lineTags, MAX_LINE_TAGS, normalizeTag, tagLabel } from '../../video/audioTags';
import { IRODORI_EMOJI } from '../../video/emotions';
import { LIBRARY_CHARACTERS } from '../../video/library';
import { POSES, type CastMember, type Line, type Pose, type Project } from '../../video/schema';
import { Ic } from '../icons';
import { Popover } from './Fields';
import { withBase } from '../base';

export const POSE_LABELS: Record<string, string> = {
  default: '通常', happy: '喜び', surprised: '驚き', sad: 'しょんぼり', think: '考え中', point: '指さし', wave: '手を振る', wink: 'ウインク',
};

/** プロジェクト内パス（assets/..）・ライブラリ(lib:)・URL を、エディターで表示できるURLにする */
export const assetUrl = (projectId: string, p: string) => (p.startsWith('lib:') ? withBase(`/${p.slice(4)}`) : /^(https?:|data:|blob:|\/)/.test(p) ? p : withBase(`/files/${projectId}/${p}`));

const isHuman = (m: CastMember) => (m.library ? LIBRARY_CHARACTERS[m.library]?.kind === 'human' : (m.aspect ?? 0.5) < 0.75);

export const poseImage = (project: Project, m: CastMember | undefined, pose: Pose = 'default') => {
  if (!m) return undefined;
  const p = m.images[pose] ?? m.images.default ?? Object.values(m.images)[0];
  return p ? assetUrl(project.id, p) : undefined;
};

/** キャラクターの丸いアイコン（全身画像の顔のあたりを切り出す） */
export const Avatar: React.FC<{ project: Project; id: string; size?: number }> = ({ project, id, size = 28 }) => {
  const m = project.cast.find((c) => c.id === id);
  const src = poseImage(project, m);
  if (!m || !src) {
    return (
      <span className="avatar" style={{ width: size, height: size }} title="ナレーター">
        <Ic n={Mic} size={size * 0.5} mr={0} />
      </span>
    );
  }
  const human = isHuman(m);
  return (
    <span
      className="avatar"
      title={m.name}
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${src}")`,
        backgroundSize: human ? '300% auto' : '135% auto',
        backgroundPosition: human ? '50% 3%' : '50% 30%',
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
};

export const speakerName = (project: Project, id: string) => project.cast.find((c) => c.id === id)?.name ?? 'ナレーター';

/** 話し手を選ぶ（アイコンを押すとメニュー） */
export const SpeakerPicker: React.FC<{ project: Project; value: string; onChange: (id: string) => void }> = ({ project, value, onChange }) => (
  <Popover
    button={({ toggle }) => (
      <button type="button" className="avatar-btn" onClick={toggle} title={`話し手: ${speakerName(project, value)}（クリックで変更）`}>
        <Avatar project={project} id={value} />
      </button>
    )}
  >
    {(close) => (
      <>
        {[...project.cast.map((c) => ({ id: c.id, name: c.name })), { id: 'narrator', name: 'ナレーター（字幕）' }].map((o) => (
          <button
            key={o.id}
            type="button"
            className="menu-item"
            onClick={() => {
              onChange(o.id);
              close();
            }}
          >
            <Avatar project={project} id={o.id} size={22} />
            <span style={{ flex: 1 }}>{o.name}</span>
            {o.id === value ? <Ic n={Check} size={14} mr={0} /> : null}
          </button>
        ))}
      </>
    )}
  </Popover>
);

/** 表情を選ぶ。inherit=true なら「変えない」を選べる（セリフごとの表情） */
export const PosePicker: React.FC<{
  project: Project;
  castId: string;
  value: Pose | undefined;
  onChange: (p: Pose | undefined) => void;
  inherit?: boolean;
}> = ({ project, castId, value, onChange, inherit }) => {
  const m = project.cast.find((c) => c.id === castId);
  const cells: (Pose | undefined)[] = [...(inherit ? [undefined] : []), ...POSES.filter((p) => !m || m.images[p])];
  const cur = value ? poseImage(project, m, value) : undefined;
  return (
    <Popover
      width={292}
      button={({ toggle }) => (
        <button type="button" className="btn sm" onClick={toggle} style={{ gap: 6, paddingLeft: cur ? 4 : 10 }}>
          {cur ? <img src={cur} alt="" style={{ height: 20, width: 16, objectFit: 'cover', objectPosition: 'top', borderRadius: 3 }} /> : null}
          {value ? POSE_LABELS[value] : inherit ? '変えない' : POSE_LABELS.default}
        </button>
      )}
    >
      {(close) => (
        <div className="pose-strip" style={{ padding: 4 }}>
          {cells.map((p) => {
            const src = p ? poseImage(project, m, p) : undefined;
            return (
              <button
                key={p ?? 'inherit'}
                type="button"
                className={`pose-cell ${value === p ? 'on' : ''}`}
                onClick={() => {
                  onChange(p);
                  close();
                }}
              >
                {src ? <img src={src} alt="" /> : <span style={{ margin: 'auto', fontSize: 11 }}>—</span>}
                <span>{p ? POSE_LABELS[p] : '変えない'}</span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
};

/** 声の調子（Irodori-TTS の感情の絵文字） */
export const EmojiPicker: React.FC<{ value: string | undefined; onChange: (v: string | undefined) => void }> = ({ value, onChange }) => {
  const label = IRODORI_EMOJI.find((e) => e.emoji === value)?.label;
  return (
    <Popover
      width={300}
      button={({ toggle }) => (
        <button type="button" className="btn sm" onClick={toggle} title="声の調子（セリフの前に付く絵文字で、読み方の感情が変わります）">
          {value ? <span style={{ fontSize: 14 }}>{value}</span> : <Ic n={Smile} size={14} mr={0} />}
          {label ?? 'ふつう'}
        </button>
      )}
    >
      {(close) => (
        <div className="emoji-grid">
          <button
            type="button"
            className={!value ? 'on' : ''}
            onClick={() => {
              onChange(undefined);
              close();
            }}
          >
            <Ic n={Smile} size={18} mr={0} />
            <span>ふつう</span>
          </button>
          {IRODORI_EMOJI.map((e) => (
            <button
              key={e.emoji}
              type="button"
              className={value === e.emoji ? 'on' : ''}
              onClick={() => {
                onChange(e.emoji);
                close();
              }}
            >
              {e.emoji}
              <span>{e.label}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
};

/**
 * 声の調子（ElevenLabs のオーディオタグ）。選んだタグがセリフの前に付き、その気持ち・話し方で読まれる。
 * 選んでいない時は、演技指示（と以前の感情の絵文字）から自動で付ける
 */
export const TagPicker: React.FC<{ line: Pick<Line, 'tags' | 'emoji' | 'delivery'>; onChange: (tags: string[] | undefined) => void }> = ({ line, onChange }) => {
  const auto = line.tags === undefined;
  const current = lineTags(line);
  const [custom, setCustom] = useState('');
  const toggle = (tag: string) => {
    const base = line.tags ?? [];
    onChange(base.includes(tag) ? base.filter((t) => t !== tag) : [...base, tag].slice(-MAX_LINE_TAGS));
  };
  const addCustom = () => {
    const t = normalizeTag(custom);
    if (!t) return;
    const base = line.tags ?? [];
    if (!base.includes(t)) onChange([...base, t].slice(-MAX_LINE_TAGS));
    setCustom('');
  };
  return (
    <Popover
      width={340}
      button={({ open, toggle: t }) => (
        <button type="button" className="tag-field" aria-expanded={open} onClick={t} title="セリフの前に付くタグで、気持ちや話し方が変わります">
          {current.length ? (
            current.map((tag) => (
              <span key={tag} className={`tag-chip ${auto ? 'auto' : ''}`} title={`[${tag}]`}>
                {tagLabel(tag)}
              </span>
            ))
          ) : (
            <span className="tag-none">
              <Ic n={Smile} size={13} mr={0} />
              ふつう
            </span>
          )}
          {auto && current.length ? <span className="tag-auto-mark">自動</span> : null}
        </button>
      )}
    >
      {() => (
        <div className="tag-pop">
          <button type="button" className={`tag-auto-row ${auto ? 'on' : ''}`} onClick={() => onChange(undefined)}>
            <span className="tag-auto-title">
              {auto ? <Ic n={Check} size={13} mr={0} /> : null}
              自動（演技指示から）
            </span>
            <span className="caption">{autoTags(line).map(tagLabel).join('・') || 'タグなし'}</span>
          </button>
          {AUDIO_TAG_GROUPS.map((g) => (
            <div key={g.id} className="tag-group">
              <div className="tag-group-title">{g.label}</div>
              <div className="tag-grid">
                {AUDIO_TAGS.filter((x) => x.group === g.id).map((x) => {
                  const on = !auto && current.includes(x.tag);
                  return (
                    <button key={x.tag} type="button" className={`chip ${on ? 'on' : ''}`} title={`[${x.tag}]`} onClick={() => toggle(x.tag)}>
                      {x.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!auto && current.some((t) => !AUDIO_TAGS.some((x) => x.tag === t)) ? (
            <div className="tag-grid" style={{ marginTop: 6 }}>
              {current
                .filter((t) => !AUDIO_TAGS.some((x) => x.tag === t))
                .map((t) => (
                  <button key={t} type="button" className="chip on" onClick={() => toggle(t)} title="外す">
                    {t}
                    <Ic n={X} size={11} mr={0} />
                  </button>
                ))}
            </div>
          ) : null}
          <div className="tag-custom">
            <input
              className="input"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())}
              placeholder="英語で自由に（例: laughs softly）"
            />
            <button type="button" className="btn sm" disabled={!normalizeTag(custom)} onClick={addCustom}>
              <Ic n={Plus} size={13} mr={0} />
              追加
            </button>
          </div>
          <div className="tag-foot">
            <span className="caption">最大{MAX_LINE_TAGS}つ。付けすぎると演技が大げさになります</span>
            <button type="button" className="btn sm plain" disabled={!auto && !current.length} onClick={() => onChange([])}>
              タグなし
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
};
