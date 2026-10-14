import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Analysis, Candidate } from '../ai/types';
import { RED_5P, RED_5S, kindOf, parseTiles, sortTiles, tileCode, tileLabel, toCounts, type TileKey } from '../core/tiles';
import { isTenpaiHand, myLegalActions } from '../game/legal';
import { newMatch, roundLabel, type HandResult, type Settlement } from '../game/match';
import { isMyFuriten, myRonScore, myTsumoScore, visibleCounts } from '../game/rules';
import { replay } from '../game/state';
import { SEAT_NAMES, SEAT_SHORT, type GameEvent, type HandState, type MatchInfo, type Seat } from '../game/types';
import { EndDialog, FinalDialog, SetupDialog, seatWindName, type EndPreset } from './Dialogs';
import { EngineClient } from './engine';
import { load, save, type HistoryEntry, type Settings } from './store';
import { THEME_ICON, THEME_LABEL, applyTheme, nextThemePref } from './theme';
import { Tile } from './Tile';

type Target = { kind: 'dora' } | { kind: 'deal' } | { kind: 'draw' } | { kind: 'discard'; seat: Seat } | { kind: 'kan'; seat: Seat } | { kind: 'none' };

const PALETTE_ROWS: TileKey[][] = [
  [0, 8, 27, 28, 29, 30, 31, 32, 33],
  [9, 10, 11, 12, 13, RED_5P, 14, 15, 16, 17],
  [18, 19, 20, 21, 22, RED_5S, 23, 24, 25, 26],
];

const MODE_NAME = { instant: '瞬速', advanced: '詳細', max: '最強' } as const;
const MELD_NAME = { pon: 'ポン', minkan: '明槓', ankan: '暗槓', kakan: '加槓' } as const;
const RESULT_NAME = { ron: 'ロン', tsumo: 'ツモ', draw: '流局', abort: '途中流局' } as const;
const ACTION_TAG: Partial<Record<Candidate['kind'], string>> = { tsumo: 'ツモ', ron: 'ロン', riichi: 'リーチ', pon: 'ポン', kita: '北抜き', ankan: 'カン', kakan: 'カン', daiminkan: 'カン', fold: 'オリ', pass: 'スルー', discard: '打牌' };

function inputTarget(st: HandState, doraMode: boolean, kanSeat: Seat | null, override: Seat | null): Target {
  if (doraMode) return { kind: 'dora' };
  if (st.phase === 'setup') return st.doraIndicators.length === 0 ? { kind: 'dora' } : { kind: 'deal' };
  if (kanSeat !== null) return { kind: 'kan', seat: kanSeat };
  const seat = override ?? st.turn;
  if (seat === 0) {
    if (st.turn === 0 && st.stage === 'discard') return { kind: 'discard', seat: 0 };
    return { kind: 'draw' };
  }
  return { kind: 'discard', seat };
}

function targetText(t: Target, st: HandState): string {
  switch (t.kind) {
    case 'dora': return 'ドラ表示牌をタップしてください';
    case 'deal': return `配牌をタップしてください（${st.myHand.length}／13枚）`;
    case 'draw': return st.rinshanNext ? '嶺上牌（補充牌）をタップしてください' : '自分のツモ牌をタップしてください';
    case 'discard': return t.seat === 0 ? 'あなたの打牌：手牌から切る牌をタップ' : `${SEAT_NAMES[t.seat]}の打牌を入力してください`;
    case 'kan': return `${SEAT_NAMES[t.seat]}：カンした牌をタップしてください`;
    default: return '';
  }
}

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
  const [riichiArm, setRiichiArm] = useState<[boolean, boolean, boolean]>([false, false, false]);
  const [doraMode, setDoraMode] = useState(false);
  const [kanSeat, setKanSeat] = useState<Seat | null>(null);
  const [override, setOverride] = useState<Seat | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [engineErr, setEngineErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'setup' | 'end'>(initial.started ? null : 'setup');
  const [endPreset, setEndPreset] = useState<EndPreset | null>(null);
  const [finalS, setFinalS] = useState<Settlement | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [lastTap, setLastTap] = useState<{ code: string; n: number } | null>(null);

  const st = useMemo(() => replay(match, events), [match, events]);
  const legal = useMemo(() => myLegalActions(st), [st]);
  const visible = useMemo(() => visibleCounts(st), [st]);
  const target = inputTarget(st, doraMode, kanSeat, override);

  const engine = useRef<EngineClient | null>(null);
  if (!engine.current) engine.current = new EngineClient(a => { setAnalysis(a); setEngineErr(null); }, e => setEngineErr(e));

  useEffect(() => { save({ v: 1, match, events, redo, settings, history, started }); }, [match, events, redo, settings, history, started]);

  // theme: apply now and follow the OS while set to auto
  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== 'auto' || typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('auto');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [settings.theme]);

  useEffect(() => {
    if (st.phase !== 'play') { setAnalysis(null); return; }
    engine.current!.request({ mode: settings.mode, objective: settings.objective, match, events });
  }, [match, events, settings.mode, settings.objective]);

  const toast = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(f => (f === msg ? null : f)), 2000); };

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

  const myDiscard = (tile: TileKey) => {
    if (!legal.discards.includes(tile)) {
      // allow tapping a normal five when only the red is in hand etc.
      const alt = legal.discards.find(t => kindOf(t) === kindOf(tile));
      if (alt === undefined) { toast(st.players[0].riichi ? 'リーチ中はツモ切りのみです' : 'その牌は切れません'); return; }
      tile = alt;
    }
    if (riichiArm[0] && !legal.riichiDiscards.some(t => kindOf(t) === kindOf(tile))) { toast('その打牌ではリーチできません（聴牌が崩れます）'); return; }
    push({ t: 'discard', seat: 0, tile, riichi: riichiArm[0] || undefined });
  };

  const onPalette = (tile: TileKey) => {
    const left = 4 - visible[kindOf(tile)];
    setLastTap(p => ({ code: tileCode(tile), n: (p?.n ?? 0) + 1 }));
    switch (target.kind) {
      case 'dora': push({ t: 'dora', tile }); return;
      case 'deal':
        if (left <= 0) { toast('この牌は4枚とも見えています'); return; }
        push({ t: 'deal', tile }); return;
      case 'draw':
        if (left <= 0) { toast('この牌は4枚とも見えています'); return; }
        push({ t: 'draw', tile }); return;
      case 'discard':
        if (target.seat === 0) { myDiscard(tile); return; }
        if (left <= 0) { toast('この牌は4枚とも見えています'); return; }
        push({ t: 'discard', seat: target.seat, tile, riichi: riichiArm[target.seat] || undefined });
        return;
      case 'kan': {
        const s = target.seat, k = kindOf(tile);
        const ld = st.lastDiscard;
        if (s !== 0 && ld && ld.seat !== s && kindOf(ld.tile) === k && st.pendingRon?.kind === 'discard') push({ t: 'daiminkan', seat: s });
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
      case 'pass': toast('スルーしました。続けて入力してください'); break;
    }
  };

  const onEndApply = (r: HandResult, s: Settlement) => {
    const label = `${roundLabel(match)} ${match.honba}本場：${RESULT_NAME[r.kind]}`;
    setHistory([...history, { label, deltas: s.deltas, reason: s.reason }]);
    setDialog(null);
    if (s.ended) { setFinalS(s); return; }
    setMatch(s.next);
    setEvents([]); setRedo([]);
  };

  const startHand = (m: MatchInfo) => {
    setMatch(m); setEvents([]); setRedo([]); setDialog(null); setStarted(true); setAnalysis(null);
  };

  // ------------------------------------------------------------ keyboard (PC)
  const keyBuf = useRef('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      if ((e.target as HTMLElement)?.tagName === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoOne(); return; }
      if (e.key === 'Enter') { apply(analysis?.candidates[0]); return; }
      if (e.key === 'Escape') { resetModes(); keyBuf.current = ''; return; }
      const k = e.key.toLowerCase();
      if (/^[0-9]$/.test(k)) { keyBuf.current += k; return; }
      try {
        if ('mpsz'.includes(k) && keyBuf.current) {
          const tiles = parseTiles(keyBuf.current + k);
          keyBuf.current = '';
          for (const t of tiles) onPalette(t);
        } else if (!keyBuf.current && 'eswnpfc'.includes(k)) {
          onPalette(parseTiles(k.toUpperCase())[0]);
        } else if (k === 'r') {
          const s = target.kind === 'discard' ? target.seat : 0;
          const a = [...riichiArm] as [boolean, boolean, boolean]; a[s] = !a[s]; setRiichiArm(a);
        }
      } catch { keyBuf.current = ''; toast('牌の入力が正しくありません'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ------------------------------------------------------------ render helpers
  const best = analysis?.candidates[0];
  const bestTile = best && (best.kind === 'discard' || best.kind === 'riichi' || best.kind === 'fold') ? best.tile : undefined;
  const myTurn = st.turn === 0 && st.stage === 'discard';
  const ld = st.lastDiscard;
  const callableBy = (s: Seat) => !!ld && ld.seat !== s && !!st.pendingRon && st.pendingRon.kind === 'discard';
  const toggleRiichi = (s: Seat) => { const a = [...riichiArm] as [boolean, boolean, boolean]; a[s] = !a[s]; setRiichiArm(a); if (s !== 0) setOverride(s); };

  // show the drawn tile separately on the right, like the real client
  const drawnIdx = st.myDrawn !== null ? st.myHand.lastIndexOf(st.myDrawn) : -1;
  const handTiles = sortTiles(st.myHand.filter((_, i) => i !== drawnIdx));
  const drawnShown = drawnIdx >= 0 ? st.myDrawn : null;
  const dangerOf = (t: TileKey) => (settings.showDanger && analysis ? analysis.danger[kindOf(t)] : undefined);
  const myP = st.players[0];
  const meActive = target.kind === 'draw' || target.kind === 'deal' || (target.kind === 'discard' && target.seat === 0) || (target.kind === 'kan' && target.seat === 0);

  const seatHead = (s: Seat) => {
    const p = st.players[s];
    return <>
      <span class="who">{SEAT_SHORT[s]}</span>
      <span class={`wind ${match.dealer === s ? 'oya' : ''}`}>{seatWindName(match, s)}{match.dealer === s && <small>親</small>}</span>
      <span class="score">{st.match.scores[s].toLocaleString('ja-JP')}</span>
      {p.riichi && <span class="chip riichi">リーチ</span>}
      {p.kita > 0 && <span class="chip kita">北×{p.kita}</span>}
    </>;
  };

  const oppPanel = (s: Seat) => {
    const p = st.players[s];
    const o = analysis?.opponents.find(x => x.seat === s);
    const active = (target.kind === 'discard' || target.kind === 'kan') && target.seat === s;
    return (
      <section class={`card opp ${active ? 'active' : ''} ${p.riichi ? 'in-riichi' : ''}`} aria-label={SEAT_NAMES[s]}
        onPointerDown={() => st.phase === 'play' && setOverride(s)}>
        <header>
          {seatHead(s)}
          {active && <span class="chip now">入力中</span>}
          {o && <span class={`chip threat ${o.tenpai > 0.6 ? 'hot' : o.tenpai > 0.3 ? 'warm' : ''}`} title="推定聴牌率／推定打点">聴牌{pct(o.tenpai)}・{(Math.round(o.value / 100) * 100).toLocaleString('ja-JP')}点</span>}
        </header>
        <div class="river">
          {p.discards.length === 0 && <span class="empty">捨て牌なし</span>}
          {p.discards.map(d => <Tile t={d.tile} size="sm" rotated={d.riichi} dim={d.called} />)}
        </div>
        {p.melds.length > 0 && <div class="melds">{p.melds.map(m => <span class="meld">{Array.from({ length: m.type === 'pon' ? 3 : 4 }, () => <Tile t={m.kind} size="xs" />)}<small>{MELD_NAME[m.type]}</small></span>)}</div>}
        <div class="actions six" onPointerDown={e => e.stopPropagation()}>
          <button class={`act riichi ${riichiArm[s] ? 'on' : ''}`} disabled={p.riichi} onClick={() => toggleRiichi(s)}>リーチ</button>
          <button class="act" disabled={!callableBy(s)} onClick={() => push({ t: 'pon', seat: s })}>ポン</button>
          <button class={`act ${kanSeat === s ? 'on' : ''}`} onClick={() => setKanSeat(kanSeat === s ? null : s)}>カン</button>
          <button class="act" onClick={() => push({ t: 'kita', seat: s })}>北抜き</button>
          <button class="act win" disabled={!st.pendingRon || st.pendingRon.seat === s} onClick={() => openEnd({ kind: 'ron', winners: [s], loser: st.pendingRon!.seat })}>ロン</button>
          <button class="act win" onClick={() => openEnd({ kind: 'tsumo', winners: [s] })}>ツモ</button>
        </div>
      </section>
    );
  };

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand"><span class="logo" aria-hidden="true">中</span><span class="brand-name">勝ちポン</span><span class="brand-sub">三麻東風戦 勝利支援AI</span></div>
        <div class="roundinfo">
          <span class="round-main">{roundLabel(match)}</span>
          <span class="mini">{match.honba}本場</span>
          <span class="mini">供託{match.kyotaku}</span>
          <span class="mini wall">残り<b>{st.wall}</b>枚
            <button class="tiny-btn" aria-label="残り枚数を減らす" onClick={() => push({ t: 'wall', delta: -1 })}>−</button>
            <button class="tiny-btn" aria-label="残り枚数を増やす" onClick={() => push({ t: 'wall', delta: 1 })}>+</button>
          </span>
        </div>
        <div class="dora">
          <span class="lbl">ドラ表示</span>
          {st.doraIndicators.map(d => <Tile t={d} size="sm" />)}
          <button class={`tiny-btn add ${doraMode ? 'on' : ''}`} aria-label="ドラ表示牌を追加" onClick={() => setDoraMode(!doraMode)}>＋</button>
        </div>
        <div class="tools">
          <select aria-label="計算モード" value={settings.mode} onChange={e => setSettings({ ...settings, mode: (e.target as HTMLSelectElement).value as Settings['mode'] })}>
            <option value="instant">瞬速モード</option>
            <option value="advanced">詳細モード</option>
            <option value="max">最強モード</option>
          </select>
          <select aria-label="目標" value={settings.objective} onChange={e => setSettings({ ...settings, objective: (e.target as HTMLSelectElement).value as Settings['objective'] })}>
            <option value="top">目標：トップ率</option>
            <option value="rank">目標：順位点</option>
          </select>
          <button class="tool" data-testid="theme" aria-label={`テーマ：${THEME_LABEL[settings.theme]}`} onClick={() => setSettings({ ...settings, theme: nextThemePref(settings.theme) })}>
            <span aria-hidden="true">{THEME_ICON[settings.theme]}</span> {THEME_LABEL[settings.theme]}
          </button>
          <button class="tool" onClick={() => setDialog('setup')}>設定</button>
          <button class="tool strong" onClick={() => openEnd({ kind: 'draw', tenpai: [isTenpaiHand(toCounts(st.myHand), myP.melds.length), false, false] })}>局終了</button>
        </div>
      </header>

      <main class="board">
        <div class="play">
          <div class="opps">
            {oppPanel(2)}
            {oppPanel(1)}
          </div>

          <section class={`card me ${meActive ? 'active' : ''} ${myP.riichi ? 'in-riichi' : ''}`} aria-label="自分">
            <header>
              {seatHead(0)}
              {meActive && <span class="chip now">入力中</span>}
              {st.phase === 'play' && isMyFuriten(st) && <span class="chip hot">フリテン</span>}
              {analysis && <span class="chip shanten">{analysis.shanten <= 0 ? (analysis.shanten < 0 ? '和了形' : '聴牌') : `${analysis.shanten}向聴`}</span>}
              {myP.discards.length > 0 && <span class="my-river" aria-label="自分の捨て牌">{myP.discards.map(d => <Tile t={d.tile} size="xs" rotated={d.riichi} dim={d.called} />)}</span>}
            </header>
            <div class="hand">
              {handTiles.length === 0 && <span class="empty">配牌を入力してください</span>}
              {handTiles.map(t => (
                <Tile t={t} size="lg" onClick={() => (st.phase === 'setup' ? setEvents(evs => { const i = evs.map(e => e.t === 'deal' && e.tile === t).lastIndexOf(true); return i < 0 ? evs : [...evs.slice(0, i), ...evs.slice(i + 1)]; }) : myTurn ? myDiscard(t) : kanSeat === 0 ? onPalette(t) : undefined)}
                  highlight={bestTile !== undefined && t === bestTile} danger={myTurn ? dangerOf(t) : undefined}
                  dim={myTurn && (riichiArm[0] ? !legal.riichiDiscards.includes(t) : !legal.discards.includes(t))} />
              ))}
              {drawnShown !== null && <span class="drawn"><Tile t={drawnShown} size="lg" onClick={() => myTurn && myDiscard(drawnShown)} highlight={bestTile === drawnShown} danger={myTurn ? dangerOf(drawnShown) : undefined} /></span>}
              {myP.melds.map(m => <span class="meld">{Array.from({ length: m.type === 'pon' ? 3 : 4 }, () => <Tile t={m.kind} size="sm" />)}</span>)}
            </div>
            <div class="actions six">
              <button class={`act riichi ${riichiArm[0] ? 'on' : ''}`} disabled={!legal.riichiDiscards.length} onClick={() => toggleRiichi(0)}>リーチ</button>
              <button class="act win" disabled={!legal.tsumo} onClick={() => openEnd(myWinPreset('tsumo'))}>ツモ</button>
              <button class="act win" disabled={!legal.ron} onClick={() => openEnd(myWinPreset('ron'))}>ロン</button>
              <button class="act" disabled={!legal.pon} onClick={() => push({ t: 'pon', seat: 0 })}>ポン</button>
              <button class={`act ${kanSeat === 0 ? 'on' : ''}`} disabled={!legal.daiminkan && !legal.ankan.length && !legal.kakan.length} onClick={() => {
                if (legal.daiminkan && !myTurn) push({ t: 'daiminkan', seat: 0 });
                else if (legal.ankan.length + legal.kakan.length === 1) push(legal.ankan.length ? { t: 'ankan', seat: 0, kind: legal.ankan[0] } : { t: 'kakan', seat: 0, kind: legal.kakan[0] });
                else setKanSeat(0);
              }}>カン</button>
              <button class="act" disabled={!legal.kita} onClick={() => push({ t: 'kita', seat: 0 })}>北抜き</button>
            </div>
          </section>

          <div class={`promptbar ${target.kind}`}>
            <button class="nav" onClick={undo} disabled={!events.length}><span aria-hidden="true">↶</span> 戻す</button>
            <div class="prompt" role="status" aria-live="polite">
              <span class="ptext">{targetText(target, st)}</span>
              {override !== null && <button class="mini-link" onClick={() => setOverride(null)}>手番を自動に戻す</button>}
              {flash && <span class="flash">{flash}</span>}
            </div>
            <button class="nav" onClick={redoOne} disabled={!redo.length}>やり直す <span aria-hidden="true">↷</span></button>
          </div>

          <section class="palette" aria-label="牌の選択">
            {PALETTE_ROWS.map(row => (
              <div class="prow">
                {row.map(t => {
                  const k = kindOf(t);
                  const left = 4 - visible[k];
                  const isRedTile = t === RED_5P || t === RED_5S;
                  const redSeen = isRedTile ? st.myHand.includes(t) || st.players.some(p => p.discards.some(d => d.tile === t) || p.melds.some(m => m.kind === k && m.reds > 0)) || st.doraIndicators.includes(t) : false;
                  const code = tileCode(t);
                  return <span class={`pcell ${lastTap?.code === code ? `pulse p${lastTap.n % 2}` : ''}`}>
                    <Tile t={t} size="xl" code={code} title={tileLabel(t)} badge={isRedTile ? (redSeen ? 0 : 1) : left} onClick={() => onPalette(t)} dim={left <= 0 || redSeen} />
                  </span>;
                })}
              </div>
            ))}
          </section>
        </div>

        <aside class="side">
          <Recommendation a={analysis} st={st} onApply={apply} err={engineErr} />
          <PlacementBox a={analysis} />
          {history.length > 0 && <details class="card hist"><summary>局の履歴（{history.length}局）</summary>{history.map(h => <div class="hrow"><span>{h.label}</span><span>{h.deltas.map(d => pts(d)).join('／')}</span></div>)}</details>}
          <div class="help">
            <p class="pc-only">キーボード操作：<kbd>5p</kbd>・<kbd>19m</kbd>・<kbd>e</kbd>（東）で牌を入力／<kbd>Enter</kbd>で推奨手を実行／<kbd>Ctrl</kbd>+<kbd>Z</kbd>で戻す／<kbd>R</kbd>でリーチ</p>
            <p>手番がずれた時は、相手の枠をタップすると入力先を切り替えられます。</p>
          </div>
        </aside>
      </main>

      {dialog === 'setup' && <SetupDialog match={match} onStart={startHand} onCancel={started ? () => setDialog(null) : undefined} />}
      {dialog === 'end' && endPreset && <EndDialog match={st.match} preset={endPreset} onApply={onEndApply} onCancel={() => setDialog(null)} />}
      {finalS && <FinalDialog s={finalS} onNew={() => { setFinalS(null); setHistory([]); startHand(newMatch(0)); setDialog('setup'); }} />}
    </div>
  );
}

const riskCls = (r: number) => (r < 0.01 ? 'safe' : r < 0.04 ? 'mid' : 'risky');

function Recommendation({ a, st, onApply, err }: { a: Analysis | null; st: HandState; onApply: (c: Candidate) => void; err: string | null }) {
  if (err) return <section class="card rec"><h3>解析エラー</h3><p class="warn">{err}</p></section>;
  if (st.phase !== 'play') return <section class="card rec"><h3>AIの推奨</h3><p class="muted">ドラ表示牌と配牌を入力すると解析を開始します。</p></section>;
  if (!a) return <section class="card rec"><h3>AIの推奨</h3><p class="muted thinking">思考中…</p></section>;
  if (!a.candidates.length) return <section class="card rec"><h3>AIの推奨</h3>{a.notes.map(n => <p class="muted">{n}</p>)}</section>;
  const [b, ...rest] = a.candidates;
  return (
    <section class={`card rec ${a.stage}`}>
      <div class="rec-head">
        <h3>{a.situation === 'call' ? '鳴き・和了の判断' : '最善手'}</h3>
        <span class="meta">{MODE_NAME[a.mode]}{a.stage === 'partial' ? '・精密計算中…' : ''}・{a.ms.toFixed(0)}ミリ秒</span>
      </div>
      <button class={`best kind-${b.kind}`} onClick={() => onApply(b)}>
        <span class="best-kind">{ACTION_TAG[b.kind] ?? ''}</span>
        <span class="best-label">{b.label}</span>
        {b.tile !== undefined && <span class="best-tile"><Tile t={b.tile} size="lg" /></span>}
        <span class="best-sub">タップで実行・信頼度 {pct(a.confidence)}</span>
      </button>
      <div class="stats">
        <div><span>トップ率</span><b>{pct(b.pFirst, 1)}</b></div>
        <div><span>期待値</span><b>{pts(b.evPoints)}</b></div>
        <div><span>和了率</span><b>{pct(b.winProb)}</b></div>
        <div><span>放銃率</span><b class={riskCls(b.immediateRisk)}>{pct(b.immediateRisk, 1)}</b></div>
      </div>
      <p class="reason">{b.reason}</p>
      {rest.length > 0 && <div class="alts" aria-label="他の候補">
        <div class="alt head"><span>他の候補</span><span>トップ率</span><span>期待値</span><span>放銃率</span></div>
        {rest.slice(0, 4).map(c => (
          <button class="alt" onClick={() => onApply(c)} title={c.reason}>
            <span class="alt-label">{c.tile !== undefined && <Tile t={c.tile} size="xs" />}<span>{c.label}</span></span>
            <span>{pct(c.pFirst, 1)}</span><span>{pts(c.evPoints)}</span>
            <span class={riskCls(c.immediateRisk)}>{pct(c.immediateRisk, 1)}</span>
          </button>
        ))}
      </div>}
      {a.notes.map(n => <p class="note">{n}</p>)}
    </section>
  );
}

function PlacementBox({ a }: { a: Analysis | null }) {
  if (!a) return null;
  const p = a.placementNow;
  return (
    <section class="card place" aria-label="着順予測">
      <h3>現在の着順予測</h3>
      <div class="bars">
        <div class="bar"><span>1着</span><i class="b1" style={{ width: pct(p.pFirst) }} /><b>{pct(p.pFirst)}</b></div>
        <div class="bar"><span>2着</span><i class="b2" style={{ width: pct(p.pSecond) }} /><b>{pct(p.pSecond)}</b></div>
        <div class="bar"><span>3着</span><i class="b3" style={{ width: pct(p.pThird) }} /><b>{pct(p.pThird)}</b></div>
      </div>
    </section>
  );
}
