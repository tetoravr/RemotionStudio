import 'dotenv/config';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

export const config = {
  port: Number(process.env.PORT || 3210),
  /** 既定はローカルのみ。LAN に公開する場合は HOST=0.0.0.0 */
  host: process.env.HOST || '127.0.0.1',
  projectsDir: path.resolve(ROOT, process.env.PROJECTS_DIR || 'projects'),
  publicDir: path.resolve(ROOT, 'public'),
  openaiKey: process.env.OPENAI_API_KEY || '',
  models: {
    text: process.env.OPENAI_TEXT_MODEL || 'gpt-5.5',
    tts: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    image: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  },
  imageQuality: (process.env.OPENAI_IMAGE_QUALITY || 'medium') as 'low' | 'medium' | 'high',
  browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null,
};

export const hasOpenAI = () => Boolean(config.openaiKey);
