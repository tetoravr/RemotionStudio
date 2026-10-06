import type React from 'react';

/** Enter で確定した時（日本語入力の変換を確定する Enter は除く） */
export const isEnter = (e: React.KeyboardEvent) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229;
