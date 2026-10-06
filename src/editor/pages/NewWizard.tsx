import { ArrowRight, ChevronLeft, FileText, ImagePlus, Sparkles, Upload, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { Project } from '../../video/schema';
import { api, waitJob, type Job } from '../api';
import { go } from '../App';
import { Cell, Progress, Section, Seg, Sheet, Text } from '../components/Fields';
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

const STEPS = ['素材', '内容', '仕上がり'];
const DOC_ACCEPT = '.pdf,.pptx,.docx,.xlsx,.txt,.md,.csv,.html,.htm,image/*';

/** ファイルをドラッグ＆ドロップ、またはクリックで選ぶ場所 */
const DropZone: React.FC<{ accept: string; onFiles: (f: File[]) => void; icon: typeof Upload; title: string; sub: string }> = ({ accept, onFiles, icon, title, sub }) => {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <span className="dz-icon">
        <Ic n={icon} size={20} mr={0} />
      </span>
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div className="caption">{sub}</div>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
};

/** 入力途中の内容（再読み込み・戻るで消えないように、このブラウザに残す。作成できたら消す） */
const DRAFT_KEY = 'vc:new-draft';
type Draft = { step: number; b: Brief; format: Project['format']; urls: string; hint: string };
const readDraft = (): Partial<Draft> => {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<Draft>;
  } catch {
    return {};
  }
};

export const NewWizard: React.FC = () => {
  const [saved] = useState(readDraft);
  const [step, setStep] = useState(saved.step ?? 0);
  const [b, setB] = useState<Brief>({ ...EMPTY, ...saved.b });
  const [format, setFormat] = useState<Project['format']>(saved.format ?? 'vertical');
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shots, setShots] = useState<{ staged: string; name: string; url: string }[]>([]);
  // URL・資料から読み込む
  const [urls, setUrls] = useState(saved.urls ?? '');
  const [docs, setDocs] = useState<File[]>([]);
  const [hint, setHint] = useState(saved.hint ?? '');
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, b, format, urls, hint } satisfies Draft));
    } catch {
      // 保存できない環境（プライベートブラウズなど）では残さない
    }
  }, [step, b, format, urls, hint]);
  const [colors, setColors] = useState<Project['brand']['colors'] | null>(null);
  const [draft, setDraft] = useState<{ sources: { label: string; chars?: number; note?: string }[]; cautions: string[] } | null>(null);
  const [reading, setReading] = useState<Job | null>(null);
  const set = (k: keyof Brief) => (v: string) => setB((o) => ({ ...o, [k]: v }));
  const hasSources = Boolean(urls.trim() || docs.length);
  const canWrite = Boolean(b.productName.trim() && b.oneLiner.trim());

  const readSources = async () => {
    setErr(null);
    setReading({ id: '', kind: 'brief', status: 'running', progress: 0, message: '読み込みを始めています' });
    try {
      const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
      const { jobId } = await api.briefFromSources(list, docs, hint);
      const done = await waitJob(jobId, setReading);
      const r = done.result as { brief: Partial<Brief>; colors: Project['brand']['colors'] | null; sources: { label: string; chars?: number; note?: string }[]; cautions: string[] };
      // 資料から読み取れた項目だけを上書きする（空の項目は今の入力を残す）
      setB((o) => {
        const next = { ...o };
        for (const [k, v] of Object.entries(r.brief)) if (typeof v === 'string' && v.trim()) (next as Record<string, unknown>)[k] = v;
        return next;
      });
      setColors(r.colors);
      setDraft({ sources: r.sources, cautions: r.cautions });
      setStep(1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setReading(null);
    }
  };

  const addShots = async (files: File[]) => {
    for (const f of files.filter((x) => x.type.startsWith('image/'))) {
      try {
        const r = await api.stage(f);
        setShots((o) => [...o, { staged: r.staged, name: r.name, url: URL.createObjectURL(f) }].slice(0, 4));
      } catch (e) {
        setErr((e as Error).message);
      }
    }
  };

  const submit = async () => {
    setErr(null);
    setJob({ id: '', kind: 'storyboard', status: 'running', progress: 0, message: '準備しています' });
    try {
      const { jobId } = await api.post('/api/ai/storyboard', { brief: b, format, colors: colors ?? undefined, screenshots: shots.map((x) => ({ staged: x.staged, name: x.name })) });
      const done = await waitJob(jobId, setJob);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // 消せなくても続ける
      }
      go(`/p/${(done.result as { projectId: string }).projectId}`);
    } catch (e) {
      setErr((e as Error).message);
      setJob(null);
    }
  };

  return (
    <div className="flow">
      <header className="home-bar" style={{ justifyContent: 'space-between' }}>
        <button className="btn quiet" onClick={() => go('/')} style={{ marginLeft: -8 }}>
          <Ic n={ChevronLeft} size={16} mr={0} />
          プロジェクト
        </button>
        <div className="steps">
          {STEPS.map((label, i) => (
            <React.Fragment key={label}>
              {i ? <span className="line" /> : null}
              <span className={`step ${i === step ? 'on' : i < step ? 'done' : ''}`}>
                <span className="n">{i + 1}</span>
                {label}
              </span>
            </React.Fragment>
          ))}
        </div>
        <div className="hstack" style={{ gap: 4 }}>
          {Object.values(b).some((v) => typeof v === 'string' && v.trim()) || urls.trim() || hint.trim() ? (
            <button
              className="btn quiet"
              title="入力した内容を消して、最初から入力します"
              onClick={() => {
                setB(EMPTY);
                setUrls('');
                setHint('');
                setDocs([]);
                setColors(null);
                setDraft(null);
                setStep(0);
              }}
            >
              クリア
            </button>
          ) : null}
          <button className="btn quiet" onClick={() => setB(EXAMPLE)} title="SUSHI TOP OCR の記入例を入れます">
            記入例を使う
          </button>
        </div>
      </header>

      <main className="flow-main">
        {step === 0 ? (
          <>
            <div className="flow-head">
              <h1>何を紹介しますか？</h1>
              <p>
                商品のWebページや資料を読み込むと、AIが内容をまとめます。
                <br />
                手元になければ、そのまま次へ進んで入力できます。
              </p>
            </div>
            <Section title="Webページ">
              <div className="group">
                <Cell stack>
                  <Text bare multiline rows={2} value={urls} onChange={setUrls} placeholder={'https://example.com/service\n（1行に1つ）'} />
                </Cell>
              </div>
            </Section>
            <Section title="資料">
              <DropZone
                accept={DOC_ACCEPT}
                icon={Upload}
                title="ここにファイルをドロップ"
                sub="PDF・PowerPoint・Word・Excel・テキスト・画像（最大10個）"
                onFiles={(fs) => setDocs((o) => [...o, ...fs].slice(0, 10))}
              />
              {docs.length ? (
                <div className="hstack wrap" style={{ marginTop: 10 }}>
                  {docs.map((f, i) => (
                    <span key={`${f.name}-${i}`} className="file-pill">
                      <Ic n={FileText} size={13} mr={0} />
                      <span className="ellipsis">{f.name}</span>
                      <button className="icon-btn sm round" onClick={() => setDocs((o) => o.filter((_, j) => j !== i))} title="外す">
                        <Ic n={X} size={12} mr={0} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </Section>
            <Section title="補足（任意）" footer="資料に複数の商品がある時は「〇〇について」、ターゲットを絞りたい時は「自治体向けに」など">
              <div className="group">
                <Cell stack>
                  <Text bare value={hint} onChange={setHint} placeholder="例: トークングラフマーケターについて、観光・地域振興の担当者向けに" />
                </Cell>
              </div>
            </Section>
            {reading ? (
              <div className="group" style={{ marginTop: 20, padding: '14px 16px' }}>
                <div className="hstack">
                  <span className="spinner" />
                  <span>{reading.message}</span>
                </div>
                <Progress value={reading.progress} />
              </div>
            ) : null}
          </>
        ) : null}

        {step === 1 ? (
          <>
            <div className="flow-head">
              <h1>内容を確認しましょう</h1>
              <p>AIは、ここに書かれていない数字や実績を作りません。</p>
            </div>
            {draft ? (
              <div className="notice accent" style={{ marginBottom: 6, display: 'block' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>読み込んだ資料から入力しました</div>
                {draft.sources.map((x) => (
                  <div key={x.label} className="caption">
                    ・{x.label}
                    {x.note ? `（${x.note}）` : x.chars ? `（${x.chars.toLocaleString()}文字）` : ''}
                  </div>
                ))}
                {colors ? (
                  <div className="hstack" style={{ marginTop: 8 }}>
                    <span className="caption">ブランドカラー</span>
                    {[colors.primary, colors.accent, colors.dark, colors.light].map((c) => (
                      <span key={c} title={c} style={{ width: 16, height: 16, borderRadius: '50%', background: c, boxShadow: 'inset 0 0 0 .5px rgba(0,0,0,.2)' }} />
                    ))}
                  </div>
                ) : null}
                {draft.cautions.length ? (
                  <>
                    <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>確認してほしい点</div>
                    {draft.cautions.map((c) => (
                      <div key={c} className="caption">
                        ・{c}
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}
            <Section title="商品">
              <div className="group">
                <Cell label="商品・サービス名" stack>
                  <Text bare value={b.productName} onChange={set('productName')} placeholder="例: SUSHI TOP OCR" autoFocus={!b.productName} />
                </Cell>
                <Cell label="ひとことで言うと" stack>
                  <Text bare multiline rows={2} value={b.oneLiner} onChange={set('oneLiner')} placeholder="何をする商品・サービスかを1〜2文で" />
                </Cell>
              </div>
            </Section>
            <Section title="だれに・なぜ">
              <div className="group">
                <Cell label="ターゲット" stack>
                  <Text bare multiline rows={1} value={b.target} onChange={set('target')} placeholder="例: 販促キャンペーンの担当者" />
                </Cell>
                <Cell label="ターゲットの悩み・課題" stack>
                  <Text bare multiline rows={2} value={b.problems} onChange={set('problems')} placeholder="例: キャンペーンの運用に手間がかかる" />
                </Cell>
              </div>
            </Section>
            <Section title="強み" footer="上から3つほどが「特徴」のシーンになります">
              <div className="group">
                <Cell label="特徴・メリット（1行に1つ）" stack>
                  <Text bare multiline rows={4} value={b.features} onChange={set('features')} />
                </Cell>
                <Cell label="実績・数字・根拠" stack>
                  <Text bare multiline rows={1} value={b.proof} onChange={set('proof')} placeholder="なし" />
                </Cell>
              </div>
            </Section>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="flow-head">
              <h1>どんな動画にしますか？</h1>
              <p>あとからエディターでいつでも変えられます。</p>
            </div>
            <Section title="画面の向き">
              <div className="format-tiles">
                {(
                  [
                    ['vertical', '縦', 'リール・ショート', 30, 52],
                    ['square', '正方形', 'フィード', 44, 44],
                    ['horizontal', '横', 'YouTube・Web', 60, 34],
                  ] as const
                ).map(([v, name, sub, w, h]) => (
                  <button key={v} type="button" className={`format-tile ${format === v ? 'on' : ''}`} onClick={() => setFormat(v)}>
                    <span style={{ height: 56, display: 'grid', placeItems: 'center' }}>
                      <span className="shape" style={{ width: w, height: h }} />
                    </span>
                    <span className="ft-name">{name}</span>
                    <span className="ft-sub">{sub}</span>
                  </button>
                ))}
              </div>
            </Section>
            <Section title="長さ">
              <Seg
                block
                size="lg"
                value={String(b.durationSec)}
                onChange={(v) => setB((o) => ({ ...o, durationSec: Number(v) }))}
                options={[
                  { value: '15', label: '15秒' },
                  { value: '30', label: '30秒' },
                  { value: '45', label: '45秒' },
                  { value: '60', label: '60秒' },
                ]}
              />
            </Section>
            <Section title="実際の画面（任意）" footer="アプリや管理画面のスクリーンショットを入れると、その枚数ぶん「画面紹介」のシーンを作ります（最大4枚）">
              {shots.length ? (
                <div className="hstack wrap" style={{ gap: 14, marginBottom: 10 }}>
                  {shots.map((x, i) => (
                    <div key={x.staged} className="shot-thumb">
                      <img src={x.url} alt={x.name} />
                      <button className="icon-btn sm" onClick={() => setShots((o) => o.filter((_, j) => j !== i))} title="外す">
                        <Ic n={X} size={12} mr={0} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {shots.length < 4 ? <DropZone accept="image/*" icon={ImagePlus} title="スクリーンショットを追加" sub="ドロップ、またはクリックして選ぶ" onFiles={addShots} /> : null}
            </Section>
            <Section title="締めくくり">
              <div className="group">
                <Cell label="見た人にしてほしいこと" stack>
                  <Text bare value={b.cta} onChange={set('cta')} placeholder="例: 資料請求はこちら" />
                </Cell>
                <Cell label="連絡先・URL" stack>
                  <Text bare value={b.contact} onChange={set('contact')} placeholder="例: example.com" />
                </Cell>
              </div>
            </Section>
            <Section title="雰囲気と注意">
              <div className="group">
                <Cell label="トーン" stack>
                  <Text bare value={b.tone} onChange={set('tone')} />
                </Cell>
                <Cell label="注意事項・必ず入れる注記" stack>
                  <Text bare multiline rows={1} value={b.notes} onChange={set('notes')} placeholder="なし" />
                </Cell>
              </div>
            </Section>
          </>
        ) : null}

        {err ? (
          <div className="error" style={{ marginTop: 18 }}>
            {err}
          </div>
        ) : null}
      </main>

      <footer className="flow-foot">
        <div className="flow-foot-inner">
          {step > 0 ? (
            <button className="btn lg" onClick={() => setStep(step - 1)}>
              戻る
            </button>
          ) : null}
          <span className="spacer" />
          {step === 0 ? (
            <>
              <button className="btn lg quiet" onClick={() => setStep(1)} disabled={Boolean(reading)}>
                {hasSources ? 'スキップ' : '自分で入力する'}
              </button>
              <button className="btn lg primary" disabled={Boolean(reading) || !hasSources} onClick={readSources}>
                <Ic n={Sparkles} size={15} mr={0} />
                読み込む
              </button>
            </>
          ) : null}
          {step === 1 ? (
            <button className="btn lg primary" disabled={!canWrite} onClick={() => setStep(2)} title={canWrite ? '' : '商品名とひとことを入れてください'}>
              次へ
              <Ic n={ArrowRight} size={15} mr={0} />
            </button>
          ) : null}
          {step === 2 ? (
            <button className="btn lg primary" disabled={!canWrite || Boolean(job)} onClick={submit}>
              <Ic n={Sparkles} size={15} mr={0} />
              台本を作る
            </button>
          ) : null}
        </div>
      </footer>

      {job ? (
        <Sheet>
          <div className="hstack" style={{ gap: 12 }}>
            <div className="spinner" />
            <h3 style={{ margin: 0 }}>AIが台本を書いています</h3>
          </div>
          <div className="sheet-text" style={{ margin: '10px 0 0' }}>
            {job.message}
          </div>
          <Progress value={job.progress} />
          <div className="caption">構成・セリフ・図解・配色を考えています。30〜60秒ほどかかります。</div>
        </Sheet>
      ) : null}
    </div>
  );
};

