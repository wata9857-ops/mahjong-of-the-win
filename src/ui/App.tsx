import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Analysis, Candidate } from '../ai/types';
import { RED_5P, RED_5S, kindOf, parseTiles, sortTiles, tileCode, tileLabel, toCounts, type TileKey } from '../core/tiles';
import { isTenpaiHand, myLegalActions } from '../game/legal';
import { newMatch, roundLabel, type HandResult, type Settlement } from '../game/match';
import { isMyFuriten, myRonScore, myTsumoScore, visibleCounts } from '../game/rules';
import { replay } from '../game/state';
import type { GameEvent, HandState, MatchInfo, Seat } from '../game/types';
import { EndDialog, FinalDialog, SetupDialog, seatWindName, type EndPreset } from './Dialogs';
import { EngineClient } from './engine';
import { dealerFromMyWind, inputMode, turnInfo } from './flow';
import { CountdownScreen, HomeScreen, PALETTE_ROWS, SeatScreen } from './Screens';
import { load, save, type HistoryEntry, type Settings, type View } from './store';
import { Table, type OppAction } from './Table';
import { THEME_ICON, THEME_LABEL, applyTheme, nextThemePref } from './theme';
import { Tile } from './Tile';

const MODE_NAME = { instant: '瞬速', advanced: '詳細', max: '最強' } as const;
const RESULT_NAME = { ron: 'ロン', tsumo: 'ツモ', draw: '流局', abort: '途中流局' } as const;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const pts = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('ja-JP')}`;

export function App() {
  const initial = useMemo(load, []);
  const [match, setMatch] = useState<MatchInfo>(initial.match);
  const [events, setEvents] = useState<GameEvent[]>(initial.events);
  const [redo, setRedo] = useState<GameEvent[]>(initial.redo);
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const [history, setHistory] = useState<HistoryEntry[]>(initial.history);
  const [started, setStarted] = useState(initial.started);
  const [view, setView] = useState<View>(() => {
    const v = initial.view ?? (initial.started ? 'game' : 'home');
    return v === 'countdown' || v === 'seat' ? (initial.events.length ? 'game' : 'home') : v;
  });
  const [riichiArm, setRiichiArm] = useState<[boolean, boolean, boolean]>([false, false, false]);
  const [doraMode, setDoraMode] = useState(false);
  const [revealMode, setRevealMode] = useState(false);
  const [kanSeat, setKanSeat] = useState<Seat | null>(null);
  const [override, setOverride] = useState<Seat | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [engineErr, setEngineErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'setup' | 'end' | 'options'>(null);
  const [endPreset, setEndPreset] = useState<EndPreset | null>(null);
  const [finalS, setFinalS] = useState<Settlement | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const st = useMemo(() => replay(match, events), [match, events]);
  const legal = useMemo(() => myLegalActions(st), [st]);
  const visible = useMemo(() => visibleCounts(st), [st]);
  const mode = inputMode(st, { dora: doraMode, reveal: revealMode, kanSeat, override });
  const turn = turnInfo(st, mode, legal);

  const engine = useRef<EngineClient | null>(null);
  if (!engine.current) engine.current = new EngineClient(a => { setAnalysis(a); setEngineErr(null); }, e => setEngineErr(e));

  useEffect(() => { save({ v: 1, match, events, redo, settings, history, started, view }); }, [match, events, redo, settings, history, started, view]);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== 'auto' || typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('auto');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [settings.theme]);

  useEffect(() => {
    setAnalysis(null); // never show a recommendation computed for an older state
    if (st.phase !== 'play' || view !== 'game') return;
    engine.current!.request({ mode: settings.mode, objective: settings.objective, match, events });
  }, [match, events, settings.mode, settings.objective, view]);

  // leave fill-in mode automatically once everything is known
  useEffect(() => { if (revealMode && st.unknown === 0) setRevealMode(false); }, [st.unknown, revealMode]);

  const toast = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(f => (f === msg ? null : f)), 2200); };
  const resetModes = () => { setRiichiArm([false, false, false]); setKanSeat(null); setOverride(null); setDoraMode(false); };
  const push = (...evs: GameEvent[]) => {
    setEvents(prev => [...prev, ...evs]);
    setRedo([]);
    resetModes();
  };
  const undo = () => {
    if (!events.length) return;
    setRedo([events[events.length - 1], ...redo]);
    setEvents(events.slice(0, -1));
    resetModes();
  };
  const redoOne = () => {
    if (!redo.length) return;
    setEvents([...events, redo[0]]);
    setRedo(redo.slice(1));
  };
  const cycleTheme = () => setSettings({ ...settings, theme: nextThemePref(settings.theme) });

  // ------------------------------------------------------------ input
  const myTurn = st.turn === 0 && st.stage === 'discard';
  const unknownHand = st.unknown > 0;

  const myDiscard = (tile: TileKey) => {
    if (!legal.discards.includes(tile)) {
      const alt = legal.discards.find(t => kindOf(t) === kindOf(tile));
      if (alt !== undefined) tile = alt;
      else if (!unknownHand) { toast(st.players[0].riichi ? 'リーチ中は、引いた牌しか切れません' : 'その牌は手牌にありません'); return; }
      // otherwise: one of my not-yet-entered tiles
    }
    if (riichiArm[0] && !unknownHand && !legal.riichiDiscards.some(t => kindOf(t) === kindOf(tile))) { toast('その牌を切るとテンパイではなくなるため、リーチできません'); return; }
    push({ t: 'discard', seat: 0, tile, riichi: riichiArm[0] || undefined });
  };

  const onPalette = (tile: TileKey | null) => {
    if (tile === null) { // "？" = I drew a tile I didn't enter
      if (mode.kind === 'draw') push({ t: 'drawUnknown' });
      return;
    }
    const left = 4 - visible[kindOf(tile)];
    const full = () => { toast('この牌はもう4枚とも見えています'); };
    switch (mode.kind) {
      case 'dora': push({ t: 'dora', tile }); return;
      case 'reveal': if (left <= 0) return full(); setEvents(p => [...p, { t: 'reveal', tile }]); setRedo([]); return;
      case 'deal': if (left <= 0) return full(); push({ t: 'deal', tile }); return;
      case 'draw': if (left <= 0) return full(); push({ t: 'draw', tile }); return;
      case 'discard':
        if (mode.seat === 0) { myDiscard(tile); return; }
        if (left <= 0) return full();
        push({ t: 'discard', seat: mode.seat, tile, riichi: riichiArm[mode.seat] || undefined });
        return;
      case 'kan': {
        const s = mode.seat, k = kindOf(tile);
        const ld = st.lastDiscard;
        if (ld && ld.seat !== s && kindOf(ld.tile) === k && st.pendingRon?.kind === 'discard') push({ t: 'daiminkan', seat: s });
        else if (st.players[s].melds.some(m => m.type === 'pon' && m.kind === k)) push({ t: 'kakan', seat: s, kind: k });
        else push({ t: 'ankan', seat: s, kind: k });
        return;
      }
    }
  };

  const openEnd = (p: EndPreset) => { setEndPreset(p); setDialog('end'); };
  const myWinPreset = (kind: 'ron' | 'tsumo'): EndPreset => {
    const pr = st.pendingRon;
    const sc = kind === 'tsumo' ? myTsumoScore(st) : pr ? myRonScore(st, pr.tile, pr.kind === 'chankan', pr.kind === 'kita') : null;
    return {
      kind, winners: [0], loser: pr?.seat ?? 1,
      mine: sc ? { han: sc.han, fu: sc.fu, yakuman: sc.yakuman, text: `${sc.yakuman ? sc.limitName : `${sc.han}翻${sc.fu}符`}（${sc.yaku.map(y => y.name).join('・')}）` } : undefined,
    };
  };

  const apply = (c: Candidate | undefined) => {
    if (!c) return;
    switch (c.kind) {
      case 'discard': case 'fold': if (c.tile !== undefined) push({ t: 'discard', seat: 0, tile: c.tile }); break;
      case 'riichi': if (c.tile !== undefined) push({ t: 'discard', seat: 0, tile: c.tile, riichi: true }); break;
      case 'tsumo': openEnd(myWinPreset('tsumo')); break;
      case 'ron': openEnd(myWinPreset('ron')); break;
      case 'pon': push({ t: 'pon', seat: 0 }, ...(c.tile !== undefined ? [{ t: 'discard' as const, seat: 0 as Seat, tile: c.tile }] : [])); break;
      case 'daiminkan': push({ t: 'daiminkan', seat: 0 }); break;
      case 'ankan': push({ t: 'ankan', seat: 0, kind: c.callKind! }); break;
      case 'kakan': push({ t: 'kakan', seat: 0, kind: c.callKind! }); break;
      case 'kita': push({ t: 'kita', seat: 0 }); break;
      case 'pass': toast('見送りました。続けて入力してください'); break;
    }
  };

  const onOpp = (s: Seat, a: OppAction) => {
    switch (a) {
      case 'riichi': { const r = [...riichiArm] as [boolean, boolean, boolean]; r[s] = !r[s]; setRiichiArm(r); setOverride(s); break; }
      case 'pon': push({ t: 'pon', seat: s }); break;
      case 'kan': setKanSeat(kanSeat === s ? null : s); break;
      case 'kita': push({ t: 'kita', seat: s }); break;
      case 'ron': openEnd({ kind: 'ron', winners: [s], loser: st.pendingRon!.seat }); break;
      case 'tsumo': openEnd({ kind: 'tsumo', winners: [s] }); break;
    }
  };

  // ------------------------------------------------------------ flow
  const beginMatch = (wind: 0 | 1 | 2) => {
    setMatch(newMatch(dealerFromMyWind(wind)));
    setEvents([]); setRedo([]); setHistory([]); setStarted(true); setAnalysis(null);
    setView('countdown');
  };
  const finishCountdown = () => {
    setEvents(evs => (replay(match, evs).phase === 'setup' ? [...evs, { t: 'start' }] : evs));
    setRedo([]);
    setView('game');
  };
  const onEndApply = (r: HandResult, s: Settlement) => {
    setHistory([...history, { label: `${roundLabel(match)} ${match.honba}本場：${RESULT_NAME[r.kind]}`, deltas: s.deltas, reason: s.reason }]);
    setDialog(null);
    if (s.ended) { setFinalS(s); return; }
    setMatch(s.next);
    setEvents([]); setRedo([]); setAnalysis(null); resetModes(); setRevealMode(false);
    setView('countdown'); // next hand: quick entry again
  };
  const startDetailed = (m: MatchInfo) => {
    setMatch(m); setEvents([]); setRedo([]); setDialog(null); setStarted(true); setAnalysis(null);
    setView('countdown');
  };

  // ------------------------------------------------------------ keyboard (PC)
  const keyBuf = useRef('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || (view !== 'game' && view !== 'countdown')) return;
      if ((e.target as HTMLElement)?.tagName === 'SELECT' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoOne(); return; }
      if (e.key === 'Enter') { apply(analysis?.candidates[0]); return; }
      if (e.key === 'Escape') { resetModes(); setRevealMode(false); keyBuf.current = ''; return; }
      const k = e.key.toLowerCase();
      if (/^[0-9]$/.test(k)) { keyBuf.current += k; return; }
      try {
        if ('mpsz'.includes(k) && keyBuf.current) {
          const tiles = parseTiles(keyBuf.current + k);
          keyBuf.current = '';
          for (const t of tiles) onPalette(t);
        } else if (!keyBuf.current && 'eswnpfc'.includes(k)) onPalette(parseTiles(k.toUpperCase())[0]);
        else if (k === '?') onPalette(null);
      } catch { keyBuf.current = ''; toast('牌の入力が正しくありません'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ------------------------------------------------------------ screens
  const dialogs = <>
    {dialog === 'setup' && <SetupDialog match={match} onStart={startDetailed} onCancel={() => setDialog(null)} />}
    {dialog === 'end' && endPreset && <EndDialog match={st.match} preset={endPreset} onApply={onEndApply} onCancel={() => setDialog(null)} />}
    {dialog === 'options' && <OptionsDialog settings={settings} onChange={setSettings} onClose={() => setDialog(null)} onFix={() => setDialog('setup')} />}
    {finalS && <FinalDialog s={finalS} onNew={() => { setFinalS(null); setHistory([]); setStarted(false); setEvents([]); setView('home'); }} />}
  </>;

  if (view === 'home') {
    return <div class="app">
      <HomeScreen canResume={started && events.length > 0} resumeLabel={`${roundLabel(match)}・${match.scores[0].toLocaleString('ja-JP')}点`}
        onStart={() => setView('seat')} onResume={() => setView('game')} onDetailed={() => setDialog('setup')}
        theme={settings.theme} onTheme={cycleTheme} />
      {dialogs}
    </div>;
  }
  if (view === 'seat') return <div class="app"><SeatScreen onPick={beginMatch} onBack={() => setView('home')} />{dialogs}</div>;
  if (view === 'countdown') {
    return <div class="app">
      <CountdownScreen st={st} windName={seatWindName(match, 0)} roundName={`${roundLabel(match)} ${match.honba}本場`}
        onTile={t => onPalette(t)} onUndo={undo} onDone={finishCountdown} />
    </div>;
  }

  // ------------------------------------------------------------ game screen
  const best = analysis?.candidates[0];
  const bestTile = best && (best.kind === 'discard' || best.kind === 'riichi' || best.kind === 'fold') ? best.tile : undefined;
  const drawnIdx = st.myDrawn !== null ? st.myHand.lastIndexOf(st.myDrawn) : -1;
  const handTiles = sortTiles(st.myHand.filter((_, i) => i !== drawnIdx));
  const drawnShown = drawnIdx >= 0 ? st.myDrawn : null;
  const myP = st.players[0];
  const threat = analysis?.opponents.some(o => o.tenpai >= 0.5) ?? false;
  const dangerOf = (t: TileKey) => (myTurn && threat && settings.showDanger && analysis ? analysis.danger[kindOf(t)] : undefined);
  const drawPending = mode.kind === 'draw';
  const activeSeat: Seat | null = turn.seat;
  // Which control the AI recommends — it glows so the best move is instantly visible.
  const sug = (() => {
    if (!best || analysis?.stage === undefined) return '';
    if (best.kind === 'discard' || best.kind === 'fold') return drawnShown !== null && best.tile === drawnShown ? 'tsumogiri' : '';
    if (best.kind === 'ankan' || best.kind === 'kakan' || best.kind === 'daiminkan') return 'kan';
    return best.kind; // riichi / tsumo / ron / pon / kita / pass
  })();
  const glow = (k: string) => (sug === k ? ' suggest' : '');

  const myButtons = {
    riichi: !!legal.riichiDiscards.length || (unknownHand && myTurn && !myP.riichi),
    tsumo: legal.tsumo || (unknownHand && myTurn),
    ron: legal.ron || (unknownHand && !!st.pendingRon && st.pendingRon.seat !== 0),
    pon: legal.pon || (unknownHand && !myP.riichi && !!st.pendingRon && st.pendingRon.kind === 'discard' && st.wall > 0),
    kan: legal.daiminkan || legal.ankan.length > 0 || legal.kakan.length > 0 || (unknownHand && !myP.riichi && (myTurn || !!st.pendingRon)),
    kita: legal.kita || (unknownHand && myTurn && st.wall > 0),
  };

  return (
    <div class="app game-app">
      <header class="gbar">
        <button class="gb home-btn" onClick={() => { resetModes(); setView('home'); }} aria-label="ホームへ戻る">⌂ ホーム</button>
        <div class="dora-box" aria-label="ドラ表示牌">
          <span class="lbl">ドラ</span>
          {st.doraIndicators.map(d => <Tile t={d} size="sm" />)}
          <button class={`dora-add ${doraMode ? 'on' : ''} ${st.doraIndicators.length === 0 ? 'need' : ''}`} onClick={() => { setDoraMode(!doraMode); setRevealMode(false); }}
            aria-label="ドラ表示牌を入力">{st.doraIndicators.length === 0 ? '？ 入力' : '＋'}</button>
        </div>
        <div class="gbar-right">
          <button class="gb" onClick={undo} disabled={!events.length}>↶ 戻す</button>
          <button class="gb" onClick={redoOne} disabled={!redo.length}>やり直す ↷</button>
          <button class="gb" data-testid="theme" aria-label={`テーマ：${THEME_LABEL[settings.theme]}`} onClick={cycleTheme}>{THEME_ICON[settings.theme]} {THEME_LABEL[settings.theme]}</button>
          <button class="gb" onClick={() => setDialog('options')}>設定</button>
          <button class="gb strong" onClick={() => openEnd({ kind: 'draw', tenpai: [!unknownHand && isTenpaiHand(toCounts(st.myHand), myP.melds.length), false, false] })}>局終了</button>
        </div>
      </header>

      <main class="game">
        <div class="g-table">
          <Table st={st} activeSeat={activeSeat} opponents={analysis?.opponents} riichiArm={riichiArm} kanSeat={kanSeat}
            onSelect={s => setOverride(override === s ? null : s)} onAction={onOpp} />
        </div>

        <aside class="g-side">
          <div class={`banner tone-${turn.tone}`} role="status" aria-live="polite">
            <b>{turn.title}</b>
            <span>{turn.sub}</span>
            {(override !== null || mode.kind === 'reveal' || mode.kind === 'dora' || mode.kind === 'kan') &&
              <button class="banner-x" onClick={() => { resetModes(); setRevealMode(false); }}>{mode.kind === 'reveal' ? '入力を終える' : '元に戻す'}</button>}
            {flash && <span class="flash">{flash}</span>}
          </div>
          <Recommendation a={analysis} st={st} onApply={apply} err={engineErr} drawPending={drawPending} />
        </aside>

        <section class={`g-hand ${activeSeat === 0 ? 'active' : ''}`} aria-label="自分の手牌">
          <div class="me-line">
            <span class={`avatar ${st.match.dealer === 0 ? 'oya' : ''}`}>{seatWindName(match, 0)}</span>
            <b>あなた</b>
            {myP.riichi && <i class="tag riichi">リーチ</i>}
            {myP.kita > 0 && <i class="tag">北×{myP.kita}</i>}
            {st.phase === 'play' && isMyFuriten(st) && <i class="tag bad" title="自分の捨て牌に当たり牌があるため、ロンできない状態">フリテン</i>}
            {analysis && !unknownHand && analysis.shanten >= 0 && <i class="tag soft">{analysis.shanten === 0 ? 'テンパイ（あと1枚）' : `テンパイまであと${analysis.shanten}手`}</i>}
            {unknownHand && <button class={`tag fill ${revealMode ? 'on' : ''}`} onClick={() => { setRevealMode(!revealMode); setDoraMode(false); }}>未入力 {st.unknown}枚・タップで入力</button>}
          </div>
          <div class="hand2">
            {handTiles.map(t => (
              <Tile t={t} size="lg" onClick={myTurn ? () => myDiscard(t) : mode.kind === 'kan' && mode.seat === 0 ? () => onPalette(t) : undefined}
                highlight={bestTile !== undefined && t === bestTile} danger={dangerOf(t)}
                dim={myTurn && riichiArm[0] && !unknownHand && !legal.riichiDiscards.includes(t)} />
            ))}
            {Array.from({ length: Math.min(st.unknown, 14) }, () => (
              <button class={`tile tile-lg back ${revealMode ? 'pulse-back' : ''}`} aria-label="未入力の牌（タップで入力）" onClick={() => { setRevealMode(true); setDoraMode(false); }}><span>？</span></button>
            ))}
            <span class="drawn-slot">
              {drawnShown !== null
                ? <><Tile t={drawnShown} size="lg" onClick={myTurn ? () => myDiscard(drawnShown) : undefined} highlight={bestTile === drawnShown} danger={dangerOf(drawnShown)} /><small>ツモ</small></>
                : drawPending ? <><span class="tile tile-lg empty-slot" aria-hidden="true" /><small>ツモ</small></> : null}
            </span>
            {myP.melds.map(m => <span class="meld">{Array.from({ length: m.type === 'pon' ? 3 : 4 }, () => <Tile t={m.kind} size="sm" />)}</span>)}
          </div>
          <div class="my-acts">
            {myTurn && drawnShown !== null && <button class={`ma tsumogiri${glow('tsumogiri')}`} onClick={() => myDiscard(drawnShown)}>ツモ切り</button>}
            <button class={`ma riichi ${riichiArm[0] ? 'on' : ''}${glow('riichi')}`} disabled={!myButtons.riichi} onClick={() => { const r = [...riichiArm] as [boolean, boolean, boolean]; r[0] = !r[0]; setRiichiArm(r); }}>リーチ</button>
            <button class={`ma win${glow('tsumo')}`} disabled={!myButtons.tsumo} onClick={() => openEnd(myWinPreset('tsumo'))}>ツモ</button>
            <button class={`ma win${glow('ron')}`} disabled={!myButtons.ron} onClick={() => openEnd(myWinPreset('ron'))}>ロン</button>
            <button class={`ma${glow('pon')}`} disabled={!myButtons.pon} onClick={() => push({ t: 'pon', seat: 0 })}>ポン</button>
            <button class={`ma ${kanSeat === 0 ? 'on' : ''}${glow('kan')}`} disabled={!myButtons.kan} onClick={() => {
              if (legal.daiminkan && !myTurn) push({ t: 'daiminkan', seat: 0 });
              else if (!unknownHand && legal.ankan.length + legal.kakan.length === 1) push(legal.ankan.length ? { t: 'ankan', seat: 0, kind: legal.ankan[0] } : { t: 'kakan', seat: 0, kind: legal.kakan[0] });
              else setKanSeat(kanSeat === 0 ? null : 0);
            }}>カン</button>
            <button class={`ma${glow('kita')}`} disabled={!myButtons.kita} onClick={() => push({ t: 'kita', seat: 0 })}>北抜き</button>
          </div>
        </section>

        <section class={`palette g-pal ${drawPending ? 'focus' : ''} mode-${mode.kind}`} aria-label="牌の選択">
          {drawPending && <div class="pal-cue">↓ ツモった牌をタップ</div>}
          {PALETTE_ROWS.map((row, ri) => (
            <div class="prow">
              {row.map(t => {
                const k = kindOf(t);
                const left = 4 - visible[k];
                const isRedTile = t === RED_5P || t === RED_5S;
                const redSeen = isRedTile ? st.myHand.includes(t) || st.players.some(p => p.discards.some(d => d.tile === t) || p.melds.some(m => m.kind === k && m.reds > 0)) || st.doraIndicators.includes(t) : false;
                return <Tile t={t} size="xl" code={tileCode(t)} title={tileLabel(t)} badge={isRedTile ? (redSeen ? 0 : 1) : left}
                  onClick={() => onPalette(t)} dim={left <= 0 || redSeen} />;
              })}
              {ri === 0 && <button class={`tile tile-xl back unknown-pick ${drawPending ? '' : 'hidden'}`} data-code="?" aria-label="わからない（不明な牌）" title="ツモった牌がわからない時" onClick={() => onPalette(null)}><span>？</span></button>}
            </div>
          ))}
        </section>
      </main>
      {dialogs}
    </div>
  );
}

function Recommendation({ a, st, onApply, err, drawPending }: { a: Analysis | null; st: HandState; onApply: (c: Candidate) => void; err: string | null; drawPending: boolean }) {
  if (err) return <section class="rec3"><p class="warn">{err}</p></section>;
  if (st.phase !== 'play') return null;
  const callChance = a?.situation === 'call' && a.candidates.some(c => c.kind === 'pon' || c.kind === 'ron' || c.kind === 'daiminkan');
  if (drawPending && !callChance) return <section class="rec3 idle"><p class="rec-wait">ツモった牌を選ぶと、すぐにおすすめを表示します。</p></section>;
  if (!a) return <section class="rec3 idle"><p class="rec-wait thinking">考え中…</p></section>;
  if (!a.candidates.length) return <section class="rec3 idle">{a.notes.map(n => <p class="rec-wait">{n}</p>)}</section>;
  const [b, ...rest] = a.candidates;
  return (
    <section class={`rec3 ${a.stage} ${a.partial ? 'partial-info' : ''}`}>
      <div class="rec-top">
        <span>AIのおすすめ</span>
        {a.partial && <i class="tag warn" title="手牌の一部が未入力のため">参考</i>}
        {a.stage === 'partial' && <i class="tag soft">計算中…</i>}
      </div>
      <button class={`rec-main kind-${b.kind}`} onClick={() => onApply(b)}>
        <span class="rec-say"><small>おすすめ：</small>{b.say ?? b.label}</span>
        {b.tile !== undefined && <span class="rec-tile"><Tile t={b.tile} size="lg" /></span>}
        <span class="rec-tap">タップでこの通りにする</span>
      </button>
      {b.why && <p class="rec-why">{b.why}</p>}
      {b.hint && <p class="rec-hint">{b.hint}</p>}
      {a.notes.map(n => <p class="rec-note">{n}</p>)}
      <details class="more">
        <summary>くわしく見る</summary>
        <div class="stats">
          <div><span>トップになる確率</span><b>{pct(b.pFirst, 1)}</b></div>
          <div><span>アガれる確率</span><b>{pct(b.winProb)}</b></div>
          <div><span>相手に当たる確率</span><b>{pct(b.immediateRisk, 1)}</b></div>
          <div><span>点数の期待値</span><b>{pts(b.evPoints)}</b></div>
        </div>
        <p class="muted small">信頼度 {pct(a.confidence)}・{MODE_NAME[a.mode]}モード・{a.ms.toFixed(0)}ミリ秒</p>
        {rest.length > 0 && <div class="alts2">
          <div class="muted small">ほかの候補</div>
          {rest.slice(0, 4).map(c => (
            <button class="alt2" onClick={() => onApply(c)}>
              {c.tile !== undefined && <Tile t={c.tile} size="xs" />}
              <span class="alt2-say">{c.say ?? c.label}</span>
              <span class="alt2-p">トップ率 {pct(c.pFirst, 1)}</span>
            </button>
          ))}
        </div>}
      </details>
    </section>
  );
}

function OptionsDialog({ settings, onChange, onClose, onFix }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void; onFix: () => void }) {
  return (
    <div class="modal">
      <div class="dialog">
        <h2>設定</h2>
        <div class="row">
          <label>AIの計算</label>
          <div class="seg">
            {(['instant', 'advanced', 'max'] as const).map(m => <button class={settings.mode === m ? 'on' : ''} onClick={() => onChange({ ...settings, mode: m })}>{{ instant: '速さ優先', advanced: 'ふつう', max: '強さ優先' }[m]}</button>)}
          </div>
        </div>
        <div class="row">
          <label>目標</label>
          <div class="seg">
            <button class={settings.objective === 'top' ? 'on' : ''} onClick={() => onChange({ ...settings, objective: 'top' })}>1位をねらう</button>
            <button class={settings.objective === 'rank' ? 'on' : ''} onClick={() => onChange({ ...settings, objective: 'rank' })}>平均順位を上げる</button>
          </div>
        </div>
        <div class="row">
          <label>危険牌の表示</label>
          <div class="seg">
            <button class={settings.showDanger ? 'on' : ''} onClick={() => onChange({ ...settings, showDanger: true })}>表示する</button>
            <button class={!settings.showDanger ? 'on' : ''} onClick={() => onChange({ ...settings, showDanger: false })}>表示しない</button>
          </div>
        </div>
        <div class="row end">
          <button class="btn" onClick={onFix}>点数・局を修正して始め直す</button>
          <button class="btn primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
