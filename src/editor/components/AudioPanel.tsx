import { Music } from 'lucide-react';
import React, { useContext } from 'react';
import { ELEVEN_STABILITY } from '../../video/audioTags';
import type { Project } from '../../video/schema';
import { api, ttsFor } from '../api';
import { MetaContext } from '../App';
import { Ic } from '../icons';
import type { RunJob, Update } from '../pages/Editor';
import { Cell, Disclosure, FilePick, Num, Section, Seg, Slider, Toggle } from './Fields';
import { NarrationList } from './NarrationList';

const MODEL_NAMES: Record<string, string> = { eleven_v4: 'Eleven v4', eleven_v3: 'Eleven v3' };

export const AudioPanel: React.FC<{ project: Project; update: Update; runJob: RunJob; onSelectScene?: (i: number) => void }> = ({ project, update, runJob, onSelectScene }) => {
  const a = project.audio;
  const meta = useContext(MetaContext)!;
  const tts = ttsFor(meta, a);
  const ir = meta.tts.irodori;
  const el = meta.tts.elevenlabs;
  /** 読み方（speak）を指定しているセリフの数 */
  const speakCount = project.scenes.reduce((n, sc) => n + sc.lines.filter((l) => l.speak?.trim()).length, 0);
  const engineSub =
    tts.provider === 'elevenlabs'
      ? el.online
        ? `ElevenLabs（${MODEL_NAMES[el.model] ?? el.model}${el.requestedModel && el.requestedModel !== el.model ? `。${MODEL_NAMES[el.requestedModel] ?? el.requestedModel} が使えないため` : ''}）${el.quota ? ` ・ 今月 ${el.quota.used.toLocaleString()} / ${el.quota.limit.toLocaleString()} 文字` : ''}`
        : el.configured
          ? 'ElevenLabs ・ 接続できません'
          : 'ElevenLabs ・ API キーが未設定'
      : tts.provider === 'irodori'
        ? ir.online
          ? `Irodori-TTS${ir.device === 'cpu' ? ' ・ GPUなし（1セリフ30〜60秒）' : ''}`
          : 'Irodori-TTS ・ npm run irodori で起動してください'
        : 'OpenAI TTS';
  const bgmMode = a.bgm === 'none' ? 'none' : a.bgm ? 'custom' : 'default';
  const uploadBgm = async (f: File) => {
    const { path } = await api.upload(project.id, f);
    update((p) => void (p.audio.bgm = path));
  };
  return (
    <div>
      <Section
        title="ナレーション"
        footer={
          tts.provider === 'elevenlabs' && !el.online
            ? el.configured
              ? el.error ?? 'ElevenLabs に接続できません'
              : '.env に ELEVENLABS_API_KEY=（ElevenLabs の API キー）を書いて、サーバーを再起動してください'
            : undefined
        }
      >
        <div className="group">
          <Cell label="セリフを声で読み上げる">
            <Toggle checked={a.narration} onChange={(v) => update((p) => void (p.audio.narration = v))} />
          </Cell>
          <Cell label="音声エンジン" sub={engineSub}>
            <span className={`badge ${tts.ready ? 'ok' : 'danger'}`}>
              <span className={`dot ${tts.ready ? 'ok' : 'danger'}`} />
              {tts.ready ? '接続中' : tts.provider === 'elevenlabs' && !el.configured ? 'キー未設定' : '未接続'}
            </span>
          </Cell>
          <Cell label="セリフを変えたら自動で音声を作り直す" sub="オフ（標準）: セリフを書き換えたら、セリフの「音声を作り直す」を押して作ります。オン: 入力が落ち着いてから、変えたセリフだけを自動で作り直します">
            <Toggle checked={a.autoVoice} disabled={!a.narration} onChange={(v) => update((p) => void (p.audio.autoVoice = v))} />
          </Cell>
          {tts.provider === 'elevenlabs' && speakCount ? (
            <Cell label={`読み方の指定が ${speakCount} 件あります`} sub="以前の音声エンジン向けの読み方が残っていると、セリフと違う言葉で読まれます。ElevenLabs は英字のブランド名もそのまま読めます">
              <button className="btn sm" onClick={() => update((p) => p.scenes.forEach((sc) => sc.lines.forEach((l) => void (l.speak = undefined))))}>
                すべて外す
              </button>
            </Cell>
          ) : null}
          {tts.provider === 'elevenlabs' ? (
            <Cell label="表現の幅" sub="豊かなほどタグの気持ちが強く出ます（まれに読み方が崩れます）">
              <Seg
                value={a.elevenStability}
                onChange={(v) => update((p) => void (p.audio.elevenStability = v))}
                options={(['robust', 'natural', 'creative'] as const).map((v) => ({ value: v, label: ELEVEN_STABILITY[v].label }))}
              />
            </Cell>
          ) : null}
          <Cell label="音量" stack>
            <Slider value={a.narrationVolume} min={0} max={1} disabled={!a.narration} onChange={(v) => update((p) => void (p.audio.narrationVolume = v))} />
          </Cell>
          <Cell label="字幕を常に表示" sub="音を出さずに見る人のために、すべてのセリフを字幕でも出します">
            <Toggle checked={project.subtitles} onChange={(v) => update((p) => void (p.subtitles = v))} />
          </Cell>
        </div>
      </Section>

      {a.narration ? (
        <Section
          title="セリフの音声"
          footer={
            tts.provider === 'elevenlabs'
              ? '台本全体を1回で読み上げてからセリフごとに分けるので、シーンが変わっても同じキャラは同じ声のままです（セリフを1つでも変えると全体を読み直します）。気持ちはセリフごとの「声の調子」のタグで乗せます'
              : undefined
          }
        >
          <NarrationList project={project} onSelectScene={onSelectScene} />
        </Section>
      ) : null}

      <Section title="BGM" footer="セリフの間は自動で音量が下がります">
        <div className="group">
          <Cell>
            <Seg
              block
              value={bgmMode}
              onChange={(v) => {
                if (v === 'default') update((p) => void (p.audio.bgm = undefined));
                if (v === 'none') update((p) => void (p.audio.bgm = 'none'));
              }}
              options={[
                { value: 'default', label: '組み込み' },
                { value: 'none', label: 'なし' },
                ...(bgmMode === 'custom' ? [{ value: 'custom' as const, label: 'ファイル' }] : []),
              ]}
            />
          </Cell>
          <Cell label={bgmMode === 'custom' ? a.bgm!.split('/').pop() : '手持ちの曲を使う'} sub={bgmMode === 'default' ? '組み込み: 150BPMのポップな曲' : undefined}>
            <FilePick accept="audio/*" onFile={uploadBgm}>
              <Ic n={Music} size={13} mr={0} />
              {bgmMode === 'custom' ? '変更…' : '選ぶ…'}
            </FilePick>
          </Cell>
          <Cell label="音量" stack>
            <Slider value={a.bgmVolume} min={0} max={1} disabled={bgmMode === 'none'} onChange={(v) => update((p) => void (p.audio.bgmVolume = v))} />
          </Cell>
        </div>
      </Section>

      <Section title="効果音">
        <div className="group">
          <Cell label="自動で効果音を付ける" sub="ポップ・ワイプ・インパクトなど">
            <Toggle checked={a.sfx} onChange={(v) => update((p) => void (p.audio.sfx = v))} />
          </Cell>
          <Cell label="音量" stack>
            <Slider value={a.sfxVolume} min={0} max={1} disabled={!a.sfx} onChange={(v) => update((p) => void (p.audio.sfxVolume = v))} />
          </Cell>
        </div>
      </Section>

      <Section title="詳細">
        <div className="group">
          <Disclosure summary="テンポとフレームレート">
            <div className="kv">
              <span>BPM</span>
              <div className="hstack">
                <Num value={a.bpm} min={0} max={240} onChange={(v) => update((p) => void (p.audio.bpm = v))} style={{ width: 90 }} />
                <span className="caption">シーンの切り替えを曲のビートに合わせます（0で無効）</span>
              </div>
            </div>
            <div className="kv">
              <span>fps</span>
              <div className="hstack">
                <Num value={project.fps} min={24} max={60} onChange={(v) => update((p) => void (p.fps = Math.round(v)))} style={{ width: 90 }} />
                <span className="caption">1秒あたりのコマ数</span>
              </div>
            </div>
          </Disclosure>
        </div>
      </Section>
    </div>
  );
};
