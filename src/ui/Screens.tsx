import { useEffect, useRef, useState } from 'preact/hooks';
import { RED_5P, RED_5S, kindOf, sortTiles, tileCode, tileLabel, type TileKey } from '../core/tiles';
import type { HandState } from '../game/types';
import { COUNTDOWN_MS, countdownState } from './flow';
import { THEME_ICON, THEME_LABEL, type ThemePref } from './theme';
import { Tile } from './Tile';

// ------------------------------------------------------------------ home

export function HomeScreen({ canResume, resumeLabel, onStart, onResume, onDetailed, theme, onTheme }: {
  canResume: boolean; resumeLabel: string; onStart: () => void; onResume: () => void; onDetailed: () => void;
  theme: ThemePref; onTheme: () => void;
}) {
  return (
    <div class="screen home">
      <button class="theme-fab" data-testid="theme" aria-label={`テーマ：${THEME_LABEL[theme]}`} onClick={onTheme}>
        <span aria-hidden="true">{THEME_ICON[theme]}</span> {THEME_LABEL[theme]}
      </button>
      <div class="home-hero">
        <div class="home-tiles" aria-hidden="true">
          <Tile t={33} size="xl" /><Tile t={RED_5P} size="xl" /><Tile t={18} size="xl" />
        </div>
        <h1>勝ちポン</h1>
        <p class="home-sub">雀魂 三人麻雀・東風戦の勝利支援AI</p>
      </div>
      <div class="home-actions">
        <button class="cta" onClick={onStart}>対局開始</button>
        {canResume && <button class="cta secondary" onClick={onResume}>続きから<small>{resumeLabel}</small></button>}
        <button class="linkish" onClick={onDetailed}>点数や局を指定して始める</button>
      </div>
      <ol class="home-steps">
        <li><b>1</b>自分の席（東・南・西）をタップ</li>
        <li><b>2</b>4秒間で、わかる配牌をタップ（全部でなくても大丈夫）</li>
        <li><b>3</b>あとは牌をタップするだけ。AIが次の一手を教えます</li>
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ seat

const SEATS: { wind: 0 | 1 | 2; label: string; note: string }[] = [
  { wind: 0, label: '東', note: '親（最初に切る人）' },
  { wind: 1, label: '南', note: '親の次' },
  { wind: 2, label: '西', note: '親の前' },
];

export function SeatScreen({ onPick, onBack }: { onPick: (w: 0 | 1 | 2) => void; onBack: () => void }) {
  return (
    <div class="screen seat">
      <button class="back-btn" onClick={onBack}>← もどる</button>
      <h2>あなたの席は？</h2>
      <p class="muted">画面に表示されている自分の風をタップしてください</p>
      <div class="seat-grid">
        {SEATS.map(s => (
          <button class={`seat-btn w${s.wind}`} onClick={() => onPick(s.wind)}>
            <span class="seat-kanji">{s.label}</span>
            <span class="seat-note">{s.note}</span>
          </button>
        ))}
      </div>
      <p class="muted small">三人麻雀なので「北」の席はありません。</p>
    </div>
  );
}

// ------------------------------------------------------------------ countdown

export const PALETTE_ROWS: TileKey[][] = [
  [0, 8, 27, 28, 29, 30, 31, 32, 33],
  [9, 10, 11, 12, 13, RED_5P, 14, 15, 16, 17],
  [18, 19, 20, 21, 22, RED_5S, 23, 24, 25, 26],
];

export function CountdownScreen({ st, windName, roundName, onTile, onUndo, onDone }: {
  st: HandState; windName: string; roundName: string;
  onTile: (t: TileKey) => void; onUndo: () => void; onDone: () => void;
}) {
  const startRef = useRef(performance.now());
  const [now, setNow] = useState(startRef.current);
  const doneRef = useRef(false);
  const cd = countdownState(startRef.current, now);
  const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone(); } };
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (cd.done) finish(); }, [cd.done]);
  // Complete hand entered → no need to wait.
  const dealerMe = st.match.dealer === 0;
  useEffect(() => {
    if (st.phase === 'play' && (!dealerMe || st.stage === 'discard')) finish();
  }, [st.phase, st.stage]);
  const counts = new Array(34).fill(0);
  for (const t of st.myHand) counts[kindOf(t)]++;
  const need = dealerMe ? 14 : 13;
  const entered = st.myHand.length;
  return (
    <div class="screen countdown">
      <div class="cd-head">
        <div class="cd-meta"><span class="chip">{roundName}</span><span class="chip">あなた：{windName}家</span></div>
        <div class={`cd-ring ${cd.secondsLeft <= 1 ? 'last' : ''}`} style={{ '--p': cd.fraction } as any} role="timer" aria-live="off" aria-label={`残り${cd.secondsLeft}秒`}>
          <span>{cd.secondsLeft}</span>
        </div>
        <div class="cd-text">
          <b>わかる配牌をタップ！</b>
          <span>{entered}／{need}枚　（全部でなくても大丈夫）</span>
        </div>
        <div class="cd-btns">
          <button class="nav" onClick={onUndo} disabled={!entered}>↶ 1枚戻す</button>
          <button class="cta small" onClick={finish}>すぐ始める</button>
        </div>
      </div>
      <div class="cd-hand">
        {sortTiles(st.myHand).map(t => <Tile t={t} size="md" />)}
        {Array.from({ length: Math.max(0, need - entered) }, () => <span class="tile tile-md back" aria-hidden="true" />)}
      </div>
      <section class="palette big" aria-label="牌の選択">
        {PALETTE_ROWS.map(row => (
          <div class="prow">
            {row.map(t => {
              const left = 4 - counts[kindOf(t)];
              return <Tile t={t} size="xl" code={tileCode(t)} title={tileLabel(t)} onClick={() => onTile(t)} dim={left <= 0} />;
            })}
          </div>
        ))}
      </section>
      <div class="cd-bar" style={{ transform: `scaleX(${cd.fraction})` }} aria-hidden="true" />
      <p class="sr-only">{`カウントダウン ${Math.round(COUNTDOWN_MS / 1000)}秒`}</p>
    </div>
  );
}
