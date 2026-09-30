import { Plus } from 'lucide-react';
import React, { useState } from 'react';
import type { Project } from '../../video/schema';
import { api, waitJob, type Job } from '../api';
import { go } from '../App';
import { Field, FilePick, Progress, Seg, Text } from '../components/Fields';
import { ArrowLeft, Sparkles, X } from 'lucide-react';
import { Ic } from '../icons';

type Brief = {
  productName: string;
  oneLiner: string;
  target: string;
  problems: string;
  features: string;
  proof: string;
  cta: string;
  contact: string;
  tone: string;
  durationSec: number;
  notes: string;
};

const EMPTY: Brief = {
  productName: '',
  oneLiner: '',
  target: '',
  problems: '',
  features: '',
  proof: '',
  cta: '',
  contact: '',
  tone: 'ポップで親しみやすい',
  durationSec: 30,
  notes: '',
};

const EXAMPLE: Brief = {
  productName: 'SUSHI TOP OCR',
  oneLiner: 'レシート撮影で購買証明を取り、AI判定→特典配布→分析まで一気通貫で行うレシート販促ソリューション',
  target: 'メーカー・小売などで販促キャンペーンを運用するマーケティング担当者',
  problems: 'マストバイ施策の運用コストが高い／実店舗で自社商品が何と一緒に買われているか分からない／独自販促アプリの立ち上げ・維持コストが高い',
  features:
    '参加者はレシートを撮影して送信するだけ\nAIが商品・金額・決済手段・店舗・日時を読み取り、条件と自動照合してその場でNFT特典を配布\n対象商品・合計金額・決済手段などで特典を出し分け、重複登録もブロック\nPOS改修不要で、店舗別・日付別・商品別の購買データを分析',
  proof: 'レシート判定の一部の仕組みは特許出願中',
  cta: 'サービス資料をダウンロード',
  contact: 'sushitopmarketing.com',
  tone: 'ポップで分かりやすく、BtoBの信頼感も残す',
  durationSec: 30,
  notes: '機能ではなく価値を伝える',
};

export const NewWizard: React.FC = () => {
  const [b, setB] = useState<Brief>(EMPTY);
  const [format, setFormat] = useState<Project['format']>('vertical');
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shots, setShots] = useState<{ staged: string; name: string; url: string }[]>([]);
  const set = (k: keyof Brief) => (v: string) => setB((o) => ({ ...o, [k]: v }));

  const submit = async () => {
    setErr(null);
    try {
      const { jobId } = await api.post('/api/ai/storyboard', { brief: b, format, screenshots: shots.map((x) => ({ staged: x.staged, name: x.name })) });
      const done = await waitJob(jobId, setJob);
      go(`/p/${(done.result as { projectId: string }).projectId}`);
    } catch (e) {
      setErr((e as Error).message);
      setJob(null);
    }
  };

  return (
    <div className="wizard">
      <div className="row center" style={{ marginBottom: 18 }}>
        <button className="btn ghost" onClick={() => go('/')} style={{ flex: 'none' }}>
          <Ic n={ArrowLeft} />戻る
        </button>
        <h2 style={{ fontSize: 20 }}>AIで広告動画をつくる</h2>
        <button className="btn sm" style={{ flex: 'none' }} onClick={() => setB(EXAMPLE)}>
          記入例を入れる
        </button>
      </div>
      <div className="panel">
        <h3>1. 商品について</h3>
        <div className="row">
          <Field label="商品・サービス名 *">
            <Text value={b.productName} onChange={set('productName')} placeholder="例: SUSHI TOP OCR" />
          </Field>
          <Field label="尺">
            <Seg
              value={String(b.durationSec)}
              onChange={(v) => setB((o) => ({ ...o, durationSec: Number(v) }))}
              options={[
                { value: '15', label: '15秒' },
                { value: '30', label: '30秒' },
                { value: '45', label: '45秒' },
                { value: '60', label: '60秒' },
              ]}
            />
          </Field>
        </div>
        <Field label="ひとことで言うと？ *" hint="何をする商品・サービスかを1〜2文で">
          <Text value={b.oneLiner} onChange={set('oneLiner')} multiline />
        </Field>
        <div className="row">
          <Field label="ターゲット">
            <Text value={b.target} onChange={set('target')} multiline placeholder="例: 販促担当者" />
          </Field>
          <Field label="ターゲットの悩み・課題">
            <Text value={b.problems} onChange={set('problems')} multiline />
          </Field>
        </div>
        <Field label="特徴・メリット（1行に1つ）" hint="上から3つ程度が「特徴シーン」になります">
          <Text value={b.features} onChange={set('features')} multiline rows={4} />
        </Field>
        <Field label="実績・数字・根拠" hint="AIは書かれていない数字を作りません">
          <Text value={b.proof} onChange={set('proof')} />
        </Field>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>2. 実際の画面（スクリーンショット）</h3>
        <div className="muted" style={{ marginBottom: 10, lineHeight: 1.7 }}>
          アプリ・管理画面・Webページなど、<b>実際の画面</b>の画像を入れると、その枚数ぶんだけ「画面紹介」シーンを作ります（疑似の画面は作りません）。
          入れない場合は画面紹介シーンなしの構成になります。
        </div>
        <div className="row center" style={{ flexWrap: 'wrap', gap: 10 }}>
          {shots.map((x, i) => (
            <div key={x.staged} style={{ flex: 'none', position: 'relative' }}>
              <img src={x.url} alt={x.name} style={{ height: 110, borderRadius: 8, border: '1px solid var(--border)' }} />
              <button className="icon-btn" style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.6)' }} onClick={() => setShots((o) => o.filter((_, j) => j !== i))}>
                <Ic n={X} mr={0} />
              </button>
            </div>
          ))}
          <FilePick
            accept="image/*"
            onFile={async (f) => {
              try {
                const r = await api.stage(f);
                setShots((o) => [...o, { staged: r.staged, name: r.name, url: URL.createObjectURL(f) }].slice(0, 4));
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            <Ic n={Plus} />スクリーンショットを追加（最大4枚）
          </FilePick>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>3. 見せ方</h3>
        <div className="row">
          <Field label="CTA（視聴者にしてほしい行動）">
            <Text value={b.cta} onChange={set('cta')} placeholder="例: 資料請求はこちら" />
          </Field>
          <Field label="連絡先・URL">
            <Text value={b.contact} onChange={set('contact')} placeholder="example.com" />
          </Field>
        </div>
        <div className="row">
          <Field label="トーン">
            <Text value={b.tone} onChange={set('tone')} />
          </Field>
          <Field label="画面の向き">
            <Seg
              value={format}
              onChange={setFormat}
              options={[
                { value: 'vertical', label: '縦 9:16' },
                { value: 'square', label: '正方形' },
                { value: 'horizontal', label: '横 16:9' },
              ]}
            />
          </Field>
        </div>
        <Field label="注意事項・必ず入れる注記">
          <Text value={b.notes} onChange={set('notes')} multiline />
        </Field>
      </div>
      {err ? <div className="error" style={{ marginTop: 14 }}>{err}</div> : null}
      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn primary lg" disabled={!b.productName || !b.oneLiner || Boolean(job)} onClick={submit}>
          <Ic n={Sparkles} />台本を生成して編集へ
        </button>
      </div>
      {job ? (
        <div className="modal-bg">
          <div className="modal">
            <h3>AIが台本を作っています</h3>
            <div className="muted">{job.message}</div>
            <Progress value={job.progress} />
            <div className="faint">構成・セリフ・図解・配色を考えています。通常30〜60秒ほどかかります。</div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
