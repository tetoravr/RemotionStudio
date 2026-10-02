import crypto from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';

/**
 * Google アカウントでのログイン（社内公開用）。許可したドメインのアカウントだけが使える。
 *
 * 必要な環境変数:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET … Google Cloud の OAuth クライアント（ウェブアプリケーション）
 *   AUTH_ALLOWED_DOMAINS … 許可するドメイン（カンマ区切り。例: tetoravr.com）
 *   AUTH_ALLOWED_EMAILS  … ドメイン外で個別に許可するメールアドレス（任意・カンマ区切り）
 *   PUBLIC_URL           … 公開URL（例: https://studio.example.com）。Google のリダイレクトURIは <PUBLIC_URL>/auth/callback
 *   SESSION_SECRET       … セッションの署名用の長いランダム文字列
 *
 * ログイン状態は署名付きの Cookie に入れる（サーバー側に保存しないので、再起動してもログインは続く）。
 */

const env = (k: string) => (process.env[k] ?? '').trim();
const list = (k: string) =>
  env(k)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const authConfig = () => ({
  clientId: env('GOOGLE_CLIENT_ID'),
  clientSecret: env('GOOGLE_CLIENT_SECRET'),
  domains: list('AUTH_ALLOWED_DOMAINS'),
  emails: list('AUTH_ALLOWED_EMAILS'),
  publicUrl: env('PUBLIC_URL').replace(/\/+$/, ''),
  secret: env('SESSION_SECRET'),
});

export const authEnabled = () => {
  const c = authConfig();
  return Boolean(c.clientId && c.clientSecret && c.secret && (c.domains.length || c.emails.length));
};

/** 設定の抜けを返す（公開時の起動チェック用） */
export const authProblems = () => {
  const c = authConfig();
  const p: string[] = [];
  if (!c.clientId) p.push('GOOGLE_CLIENT_ID');
  if (!c.clientSecret) p.push('GOOGLE_CLIENT_SECRET');
  if (!c.domains.length && !c.emails.length) p.push('AUTH_ALLOWED_DOMAINS（または AUTH_ALLOWED_EMAILS）');
  if (c.secret.length < 32) p.push('SESSION_SECRET（32文字以上）');
  if (!c.publicUrl) p.push('PUBLIC_URL');
  return p;
};

export type SessionUser = { email: string; name: string; picture?: string };

const COOKIE = 'adstudio_session';
const STATE_COOKIE = 'adstudio_oauth';
const MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14日

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (payload: string, secret: string) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

const seal = (data: object, secret: string, maxAgeSec: number) => {
  const payload = b64u(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + maxAgeSec }));
  return `${payload}.${sign(payload, secret)}`;
};

const unseal = <T,>(token: string | undefined, secret: string): T | null => {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T & { exp: number };
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
};

const cookies = (req: Request) =>
  Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((kv) => kv.length >= 2)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  ) as Record<string, string>;

const setCookie = (res: Response, name: string, value: string, maxAgeSec: number) => {
  const secure = authConfig().publicUrl.startsWith('https://');
  res.append(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`,
  );
};

export const currentUser = (req: Request): SessionUser | null => {
  if (!authEnabled()) return null;
  return unseal<SessionUser>(cookies(req)[COOKIE], authConfig().secret);
};

const allowed = (email: string, emailVerified: boolean, hd?: string) => {
  const c = authConfig();
  const e = email.toLowerCase();
  if (c.emails.includes(e)) return true;
  const domain = e.split('@')[1] ?? '';
  // Google Workspace のアカウントか（hd）、確認済みのメールのドメインで判定する
  return emailVerified && c.domains.some((d) => domain === d && (!hd || hd.toLowerCase() === d));
};

/** /auth/login・/auth/callback・/auth/logout・/auth/me */
export const authRouter = (): Router => {
  const r = express.Router();

  r.get('/auth/login', (req, res) => {
    const c = authConfig();
    const state = crypto.randomBytes(16).toString('hex');
    const back = typeof req.query.next === 'string' && req.query.next.startsWith('/') && !req.query.next.startsWith('//') ? req.query.next : '/';
    setCookie(res, STATE_COOKIE, seal({ state, back }, c.secret, 600), 600);
    const q = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: `${c.publicUrl}/auth/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      ...(c.domains.length === 1 ? { hd: c.domains[0] } : {}),
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  });

  r.get('/auth/callback', async (req, res) => {
    const c = authConfig();
    const saved = unseal<{ state: string; back: string }>(cookies(req)[STATE_COOKIE], c.secret);
    setCookie(res, STATE_COOKIE, '', 0);
    if (!saved || req.query.state !== saved.state || typeof req.query.code !== 'string') {
      res.status(400).send(page('ログインをやり直してください', 'ログインの手続きが途中で切れました。'));
      return;
    }
    try {
      // 認可コードをトークンに換え、Google から直接ユーザー情報を受け取る（TLS 経由なので改ざんされない）
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: c.clientId,
          client_secret: c.clientSecret,
          redirect_uri: `${c.publicUrl}/auth/callback`,
          grant_type: 'authorization_code',
        }),
      });
      const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
      if (!token.access_token) throw new Error(token.error_description ?? 'トークンを取得できませんでした');
      const info = (await (
        await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } })
      ).json()) as { email?: string; email_verified?: boolean; name?: string; picture?: string; hd?: string };
      if (!info.email || !allowed(info.email, Boolean(info.email_verified), info.hd)) {
        res.status(403).send(page('このアカウントでは使えません', `${info.email ?? '不明なアカウント'} は許可されていません。会社のアカウントでログインしてください。`, true));
        return;
      }
      const user: SessionUser = { email: info.email, name: info.name ?? info.email, picture: info.picture };
      setCookie(res, COOKIE, seal(user, c.secret, MAX_AGE_SEC), MAX_AGE_SEC);
      res.redirect(saved.back || '/');
    } catch (e) {
      res.status(500).send(page('ログインに失敗しました', (e as Error).message, true));
    }
  });

  r.post('/auth/logout', (_req, res) => {
    setCookie(res, COOKIE, '', 0);
    res.json({ ok: true });
  });

  r.get('/auth/me', (req, res) => {
    if (!authEnabled()) return void res.json({ enabled: false, user: null });
    res.json({ enabled: true, user: currentUser(req) });
  });

  return r;
};

/** ログインしていないリクエストを止める。API は 401、画面はログインへ転送 */
export const requireLogin = (req: Request, res: Response, next: NextFunction) => {
  if (!authEnabled()) return next();
  if (req.path.startsWith('/auth/') || req.path.startsWith('/brand/') || req.path === '/healthz') return next();
  if (currentUser(req)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/files/')) {
    res.status(401).json({ error: 'ログインしてください', login: '/auth/login' });
    return;
  }
  res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
};

const page = (title: string, message: string, retry = false) =>
  `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font-family:sans-serif;background:#0f1117;color:#e8eaf2;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="max-width:420px;padding:28px;border:1px solid #2a2f3d;border-radius:14px;background:#171a23">
<h2 style="margin:0 0 12px">${title}</h2><p style="color:#a3a8b8;line-height:1.7">${message.replace(/</g, '&lt;')}</p>
<a href="/auth/login" style="color:#9d86ff">${retry ? '別のアカウントでログイン' : 'ログイン'}</a></div></body></html>`;
