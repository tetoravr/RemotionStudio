import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import sample from '../../public/samples/sushitop-ocr/project.json';
import { AdVideo } from './AdVideo';
import { AdVideoProps, FORMATS, Project } from './schema';
import { computeTimeline } from './timeline';

export const calculateAdMetadata: CalculateMetadataFunction<AdVideoProps> = ({ props }) => {
  const parsed = Project.safeParse(props.project);
  if (!parsed.success) return { durationInFrames: 90, fps: 30, width: 1080, height: 1920 };
  const project = parsed.data;
  const { width, height } = FORMATS[project.format];
  const timeline = computeTimeline(project);
  return { durationInFrames: timeline.total, fps: project.fps, width, height, props: { ...props, project } };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="AdVideo"
      component={AdVideo}
      schema={AdVideoProps}
      defaultProps={{ project: sample as unknown as Project, assetBaseUrl: 'static:samples/sushitop-ocr/' }}
      calculateMetadata={calculateAdMetadata}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
