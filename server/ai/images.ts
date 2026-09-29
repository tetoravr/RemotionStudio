import fs from 'node:fs/promises';
import path from 'node:path';
import { toFile } from 'openai';
import type { Pose } from '../../src/video/schema';
import { config } from '../env';
import { getOpenAI } from './client';

export const POSE_PROMPTS: Record<Pose, string> = {
  default: 'standing naturally facing the viewer, gentle friendly smile, arms relaxed',
  happy: 'very happy with a big open-mouth smile, both fists raised up in excitement',
  surprised: 'surprised, wide eyes and open mouth, both hands raised near the face',
  sad: 'disappointed and a little teary, droopy eyebrows, shoulders slumped',
  think: 'thinking with a puzzled look, index finger on the chin, head tilted',
  point: 'confidently pointing to the side with the index finger, winking with a bright smile',
  wave: 'waving one hand high at the viewer with a big cheerful smile',
  wink: 'playful wink and making a peace sign next to the face',
};

export const STYLE_PRESETS = {
  anime: 'Japanese chibi anime style (2.5 heads tall), thick clean outlines, flat cel shading, vivid colors, cute and friendly',
  mascot: 'simple rounded mascot character like a Japanese yuru-chara, thick clean outlines, flat colors, very cute',
  flat: 'modern flat vector illustration style, clean geometric shapes, minimal shading',
  '3d': 'cute 3D toy-like render, soft studio lighting, smooth plastic material',
} as const;
export type StylePreset = keyof typeof STYLE_PRESETS;

const COMMON =
  'Full body visible with some margin, centered, on a fully transparent background. No text, no letters, no logos, no watermark, no ground shadow, no background objects.';

const b64 = (s: string | undefined) => {
  if (!s) throw new Error('画像が返りませんでした');
  return Buffer.from(s, 'base64');
};

/** キャラクターの基本デザイン（default ポーズ）を生成 */
export const generateCharacterBase = async (description: string, style: StylePreset, outFile: string) => {
  const client = getOpenAI();
  const prompt = `Original character design for a Japanese product advertisement video. ${description}. ${STYLE_PRESETS[style]}. Pose: ${POSE_PROMPTS.default}. ${COMMON}`;
  const r = await client.images.generate({
    model: config.models.image,
    prompt,
    size: '1024x1536',
    background: 'transparent',
    output_format: 'webp',
    quality: config.imageQuality,
  });
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, b64(r.data?.[0]?.b64_json));
};

/** 基本デザインを参照して別ポーズを生成（同じ見た目を保つ） */
export const generatePose = async (baseFile: string, pose: Pose, description: string, outFile: string) => {
  const client = getOpenAI();
  const buf = await fs.readFile(baseFile);
  const ext = path.extname(baseFile).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const prompt = `The exact same character as the reference image: identical face, hairstyle, hair color, eye color, outfit, colors, proportions and art style. ${description ? `(${description}) ` : ''}Change only the pose and facial expression: ${POSE_PROMPTS[pose]}. ${COMMON}`;
  const r = await client.images.edit({
    model: config.models.image,
    image: await toFile(buf, path.basename(baseFile), { type: mime }),
    prompt,
    size: '1024x1536',
    background: 'transparent',
    output_format: 'webp',
    quality: config.imageQuality,
  });
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, b64(r.data?.[0]?.b64_json));
};
