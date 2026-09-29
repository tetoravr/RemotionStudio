import OpenAI from 'openai';
import { config } from '../env';

let client: OpenAI | null = null;

export class MissingKeyError extends Error {
  constructor() {
    super('OPENAI_API_KEY が設定されていません。.env に設定してからサーバーを再起動してください。');
  }
}

export const getOpenAI = () => {
  if (!config.openaiKey) throw new MissingKeyError();
  if (!client) client = new OpenAI({ apiKey: config.openaiKey, maxRetries: 2, timeout: 240_000 });
  return client;
};
