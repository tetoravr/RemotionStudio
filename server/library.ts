import type { CharacterKind, StylePreset } from './ai/images';
import { LIBRARY_CHARACTERS } from '../src/video/library';

/** 組み込みキャラクターの画像生成の指示（画像は public/characters/<id>/ に scripts/build-character.ts で生成） */
export type LibrarySpec = {
  name: string;
  kind: CharacterKind;
  persona: string;
  /** 画像生成へのキャラ説明 */
  description: string;
  style: StylePreset;
  size: '1024x1536' | '1024x1024';
  poses: (typeof LIBRARY_CHARACTERS)[string]['poses'];
  voice: (typeof LIBRARY_CHARACTERS)[string]['voice'];
};

export const LIBRARY_SPECS: Record<string, LibrarySpec> = {
  'hayami-saki': {
    ...LIBRARY_CHARACTERS['hayami-saki'],
    description:
      'Hayami Saki: adult Japanese woman, short black bob haircut with bangs, dark red-brown eyes, grey blazer over a cream t-shirt, black belt, grey plaid tapered trousers, black high-heeled pumps, holding an orange smartphone showing a QR code',
    style: 'anime',
    size: '1024x1536',
  },
  'osushi-chan': {
    ...LIBRARY_CHARACTERS['osushi-chan'],
    description:
      'Osushi-chan: a cute round sushi mascot, a white rice body with a red-orange tuna/salmon topping with pale stripes draped over it, a black graduation cap with a gold tassel, two small black dot eyes, red swirl-shaped cheek marks; soft 3D clay toy rendering',
    style: '3d',
    size: '1024x1024',
  },
};
