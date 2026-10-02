declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

/** 画面に出すバージョン（package.json の version）。Vite 以外（テストなど）では空 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
/** ビルドした日（YYYY-MM-DD） */
export const BUILD_DATE = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
