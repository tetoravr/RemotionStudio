import React, { useMemo } from 'react';
import { Audio, interpolate, Sequence, staticFile, useVideoConfig } from 'remotion';
import { collectSfx } from './events';
import { useTheme } from './theme';
import type { Project } from './schema';
import type { Timeline } from './timeline';

export const DEFAULT_BGM = 'audio/bgm-pop.mp3';

/** BGM の音声ファイル（無しなら null） */
const bgmSource = (project: Project, resolveAsset: (p: string | undefined) => string | undefined) =>
  project.audio.bgm === 'none' ? null : project.audio.bgm ? resolveAsset(project.audio.bgm) ?? null : staticFile(DEFAULT_BGM);
const sfxSource = (kind: string) => staticFile(`audio/sfx/${kind}.wav`);

/**
 * 動画で鳴らす音声ファイルの一覧（BGM・セリフ・効果音）。
 * エディターは再生前にこれを先読みしておく（再生中に読み込みが間に合わず、セリフが遅れたり途切れたりしないように）
 */
export const audioSources = (timeline: Timeline, project: Project, resolveAsset: (p: string | undefined) => string | undefined, mutedLines?: string[]) => {
  const out = new Set<string>();
  const bgm = bgmSource(project, resolveAsset);
  if (bgm) out.add(bgm);
  if (project.audio.narration)
    for (const st of timeline.scenes)
      for (const lt of st.lines) {
        const src = lt.line.audio && !mutedLines?.includes(lt.line.id) ? resolveAsset(lt.line.audio.src) : undefined;
        if (src) out.add(src);
      }
  if (project.audio.sfx) for (const e of collectSfx(timeline, project)) out.add(sfxSource(e.kind));
  return [...out];
};

export const AudioTrack: React.FC<{ timeline: Timeline; mutedLines?: string[] }> = ({ timeline, mutedLines }) => {
  const { project, resolveAsset } = useTheme();
  const { fps, durationInFrames } = useVideoConfig();
  const a = project.audio;

  const voiceRanges = useMemo(() => {
    const r: [number, number][] = [];
    if (!a.narration) return r;
    for (const st of timeline.scenes) for (const lt of st.lines) if (lt.line.audio) r.push([st.start + lt.start, st.start + lt.end]);
    return r;
  }, [timeline, a.narration]);

  const sfx = useMemo(() => (a.sfx ? collectSfx(timeline, project) : []), [timeline, project, a.sfx]);

  const bgmSrc = bgmSource(project, resolveAsset);

  return (
    <>
      {bgmSrc ? (
        <Audio
          src={bgmSrc}
          loop
          volume={(f) => {
            const fade = interpolate(f, [0, 4, durationInFrames - fps * 1.2, durationInFrames - 1], [0, 1, 1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            // セリフ中はBGMを下げる（ダッキング）
            let duck = 1;
            for (const [s, e] of voiceRanges) {
              const d = interpolate(f, [s - 4, s, e, e + 6], [1, 0.5, 0.5, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              duck = Math.min(duck, d);
            }
            return a.bgmVolume * fade * duck;
          }}
        />
      ) : null}
      {a.narration
        ? timeline.scenes.flatMap((st) =>
            st.lines
              .filter((lt) => lt.line.audio && !mutedLines?.includes(lt.line.id))
              .map((lt) => (
                // 音声が変わったら作り直す（同じ要素の src だけを差し替えると、前の音声が鳴り続けることがある）。
                // 鳴らす1秒前から用意しておく（その場で読み込むと、出だしが遅れたり途切れたりする）
                <Sequence
                  key={`${st.scene.id}-${lt.line.id}-${lt.line.audio!.src}`}
                  from={st.start + lt.start}
                  durationInFrames={Math.max(1, lt.end - lt.start + 6)}
                  premountFor={fps}
                  style={{ pointerEvents: 'none' }}
                >
                  <Audio src={resolveAsset(lt.line.audio!.src)!} volume={a.narrationVolume} acceptableTimeShiftInSeconds={1} />
                </Sequence>
              )),
          )
        : null}
      {sfx.map((e, i) => (
        <Sequence key={`sfx-${i}`} from={e.frame} durationInFrames={Math.round(fps * 1.6)} premountFor={fps} style={{ pointerEvents: 'none' }}>
          <Audio src={sfxSource(e.kind)} volume={a.sfxVolume * (e.volume ?? 1)} />
        </Sequence>
      ))}
    </>
  );
};
