import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, Freeze, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { adaptForFormat } from './adapt';
import { AudioTrack } from './AudioTrack';
import { DiagonalWipe, Flash, WIPE_CUT, WIPE_FRAMES } from './components/Transitions';
import { sceneKeys } from './events';
import { useProjectFonts } from './fonts';
import { SceneContext } from './SceneContext';
import { CtaScene } from './scenes/CtaScene';
import { FeatureScene } from './scenes/FeatureScene';
import { LogoScene } from './scenes/LogoScene';
import { ShowcaseScene } from './scenes/ShowcaseScene';
import { TalkScene } from './scenes/TalkScene';
import { Project, type AdVideoProps } from './schema';
import { FONT_STACKS, getLayout, ThemeProvider, type Theme } from './theme';
import { computeTimeline, type SceneTiming } from './timeline';

const MOVE_FRAMES = 10;

export const makeAssetResolver = (base: string) => (path: string | undefined) => {
  if (!path) return undefined;
  if (path.startsWith('lib:')) return staticFile(path.slice(4));
  if (/^(https?:|data:|blob:|\/)/.test(path)) return path;
  if (base.startsWith('static:')) return staticFile(base.slice(7) + path);
  if (base) return base + path;
  return staticFile(path);
};

const SceneRenderer: React.FC<{ st: SceneTiming; project: Project }> = ({ st, project }) => {
  const enterOffset = sceneKeys(st, project).enterOffset;
  const s = st.scene;
  return (
    <SceneContext.Provider value={{ timing: st, enterOffset }}>
      {s.type === 'logo' ? <LogoScene scene={s} /> : null}
      {s.type === 'talk' ? <TalkScene scene={s} /> : null}
      {s.type === 'feature' ? <FeatureScene scene={s} /> : null}
      {s.type === 'showcase' ? <ShowcaseScene scene={s} /> : null}
      {s.type === 'cta' ? <CtaScene scene={s} /> : null}
    </SceneContext.Provider>
  );
};

/** slide / zoom: 直前シーンの最終フレームを止めて重ねる */
const MoveIn: React.FC<{ kind: 'slide' | 'zoom'; children: React.ReactNode }> = ({ kind, children }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const p = interpolate(frame, [0, MOVE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const style: React.CSSProperties =
    kind === 'slide'
      ? { transform: `translateX(${(1 - p) * width}px)` }
      : { transform: `scale(${1.35 - 0.35 * p})`, opacity: Math.min(1, p * 1.6), filter: `blur(${(1 - p) * 12}px)` };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

const MoveOut: React.FC<{ kind: 'slide' | 'zoom'; children: React.ReactNode }> = ({ kind, children }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const p = interpolate(frame, [0, MOVE_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const style: React.CSSProperties = kind === 'slide' ? { transform: `translateX(${-p * width * 0.35}px)`, filter: `brightness(${1 - p * 0.3})` } : { transform: `scale(${1 + p * 0.4})` };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

export const AdVideo: React.FC<AdVideoProps> = (props) => {
  const parsed = useMemo(() => Project.safeParse(props.project), [props.project]);
  if (!parsed.success) {
    return (
      <AbsoluteFill style={{ background: '#1b1d29', color: '#fff', padding: 60, fontSize: 28, fontFamily: 'sans-serif', whiteSpace: 'pre-wrap' }}>
        プロジェクトデータに誤りがあります{'\n\n'}
        {parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}
      </AbsoluteFill>
    );
  }
  return <AdVideoInner project={parsed.data} assetBaseUrl={props.assetBaseUrl ?? ''} />;
};

const AdVideoInner: React.FC<{ project: Project; assetBaseUrl: string }> = ({ project: raw, assetBaseUrl }) => {
  const project = useMemo(() => adaptForFormat(raw), [raw]);
  useProjectFonts(project);
  const timeline = useMemo(() => computeTimeline(project), [project]);
  const theme: Theme = useMemo(
    () => ({
      colors: project.brand.colors,
      fonts: FONT_STACKS[project.brand.font],
      layout: getLayout(project.format),
      brand: project.brand,
      project,
      resolveAsset: makeAssetResolver(assetBaseUrl),
    }),
    [project, assetBaseUrl],
  );
  const { fps } = project;

  return (
    <ThemeProvider value={theme}>
      <AbsoluteFill style={{ backgroundColor: project.brand.colors.light, overflow: 'hidden' }}>
        {timeline.scenes.map((st, i) => {
          const prev = timeline.scenes[i - 1];
          const move = st.scene.transition === 'slide' || st.scene.transition === 'zoom' ? st.scene.transition : null;
          return (
            <React.Fragment key={st.scene.id + '-' + i}>
              {prev && move ? (
                <Sequence from={st.start} durationInFrames={MOVE_FRAMES} name={`↳ ${prev.scene.type} (out)`}>
                  <MoveOut kind={move}>
                    <Freeze frame={prev.duration - 1}>
                      <SceneRenderer st={prev} project={project} />
                    </Freeze>
                  </MoveOut>
                </Sequence>
              ) : null}
              <Sequence from={st.start} durationInFrames={st.duration} premountFor={fps} name={`${i + 1}. ${st.scene.type}`}>
                {move && prev ? (
                  <MoveIn kind={move}>
                    <SceneRenderer st={st} project={project} />
                  </MoveIn>
                ) : (
                  <SceneRenderer st={st} project={project} />
                )}
              </Sequence>
            </React.Fragment>
          );
        })}
        {timeline.scenes.map((st, i) =>
          i > 0 && st.scene.transition === 'wipe' ? (
            <Sequence key={`wipe-${i}`} from={st.start - WIPE_CUT} durationInFrames={WIPE_FRAMES} name="wipe">
              <DiagonalWipe />
            </Sequence>
          ) : i > 0 && st.scene.transition === 'flash' ? (
            <Sequence key={`flash-${i}`} from={st.start} durationInFrames={12} name="flash">
              <Flash />
            </Sequence>
          ) : null,
        )}
        <AudioTrack timeline={timeline} />
      </AbsoluteFill>
    </ThemeProvider>
  );
};
