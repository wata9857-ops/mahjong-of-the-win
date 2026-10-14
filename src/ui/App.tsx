import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Analysis, Candidate } from '../ai/types';
import { RED_5P, RED_5S, kindOf, parseTiles, sortTiles, tileCode, toCounts, type TileKey } from '../core/tiles';
import { isTenpaiHand, myLegalActions } from '../game/legal';
import { newMatch, roundLabel, type HandResult, type Settlement } from '../game/match';
import { isMyFuriten, myRonScore, myTsumoScore, visibleCounts } from '../game/rules';
import { replay } from '../game/state';
import { SEAT_NAMES, SEAT_SHORT, type GameEvent, type HandState, type MatchInfo, type Seat } from '../game/types';
import { EndDialog, FinalDialog, SetupDialog, seatWindName, type EndPreset } from './Dialogs';
import { EngineClient } from './engine';
import { load, save, type HistoryEntry, type Settings } from './store';
import { Tile } from './Tile';

type Target = { kind: 'dora' } | { kind: 'deal' } | { kind: 'draw' } | { kind: 'discard'; seat: Seat } | { kind: 'kan'; seat: Seat } | { kind: 'none' };

const PALETTE_ROWS: TileKey[][] = [
  [0, 8, 27, 28, 29, 30, 31, 32, 33],
  [9, 10, 11, 12, 13, RED_5P, 14, 15, 16, 17],
  [18, 19, 20, 21, 22, RED_5S, 23, 24, 25, 26],
];

function inputTarget(st: HandState, doraMode: boolean, kanSeat: Seat | null, override: Seat | null): Target {
  if (doraMode) return { kind: 'dora' };
  if (st.phase === 'setup') return st.doraIndicators.length === 0 ? { kind: 'dora' } : { kind: 'deal' };
  if (kanSeat !== null) return { kind: 'kan', seat: kanSeat };
  const seat = override ?? st.turn;
  if (seat === 0) {
    if (override === null && st.turn === 0 && st.stage === 'draw') return { kind: 'draw' };
    if (st.turn === 0 && st.stage === 'discard') return { kind: 'discard', seat: 0 };
    return { kind: 'draw' };
  }
  return { kind: 'discard', seat };
}

function targetText(t: Target, st: HandState): string {
  switch (t.kind) {
    case 'dora': return 'Tap the DORA INDICATOR';
    case 'deal': return `Tap your starting hand (${st.myHand.length}/13)`;
    case 'draw': return st.rinshanNext ? 'Tap your REPLACEMENT draw' : 'Tap the tile YOU DREW';
    case 'discard': return t.seat === 0 ? 'Your discard: tap a tile in your hand' : `${SEAT_NAMES[t.seat]} (${SEAT_SHORT[t.seat]}) discards…`;
    case 'kan': return `${SEAT_NAMES[t.seat]}: tap the KAN tile`;
    default: return '';
  }
}

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

  const st = useMemo(() => replay(match, events), [match, events]);
  const legal = useMemo(() => myLegalActions(st), [st]);
  const visible = useMemo(() => visibleCounts(st), [st]);
  const target = inputTarget(st, doraMode, kanSeat, override);

  const engine = useRef<EngineClient | null>(null);
  if (!engine.current) engine.current = new EngineClient(a => { setAnalysis(a); setEngineErr(null); }, e => setEngineErr(e));

  useEffect(() => { save({ v: 1, match, events, redo, settings, history, started }); }, [match, events, redo, settings, history, started]);

  useEffect(() => {
    if (st.phase !== 'play') { setAnalysis(null); return; }
    engine.current!.request({ mode: settings.mode, objective: settings.objective, match, events });
  }, [match, events, settings.mode, settings.objective]);

  const toast = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(f => (f === msg ? null : f)), 1800); };

  const push = (...evs: GameEvent[]) => {
    setEvents(prev => [...prev, ...evs]);
    setRedo([]);
    setRiichiArm([false, false, false]);
    setKanSeat(null);
    setOverride(null);
    setDoraMode(false);
  };
  const undo = () => {
    if (!events.length) return;
    setRedo([events[events.length - 1], ...redo]);
    setEvents(events.slice(0, -1));
    setRiichiArm([false, false, false]); setKanSeat(null); setOverride(null); setDoraMode(false);
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
      if (alt === undefined) { toast(st.players[0].riichi ? 'In riichi you must discard the drawn tile' : 'Not a legal discard'); return; }
      tile = alt;
    }
    if (riichiArm[0] && !legal.riichiDiscards.some(t => kindOf(t) === kindOf(tile))) { toast('That discard does not keep tenpai'); return; }
    push({ t: 'discard', seat: 0, tile, riichi: riichiArm[0] || undefined });
  };

  const onPalette = (tile: TileKey) => {
    const left = 4 - visible[kindOf(tile)];
    switch (target.kind) {
      case 'dora': push({ t: 'dora', tile }); return;
      case 'deal':
        if (left <= 0) { toast('All 4 copies already visible'); return; }
        push({ t: 'deal', tile }); return;
      case 'draw':
        if (left <= 0) { toast('All 4 copies already visible'); return; }
        push({ t: 'draw', tile }); return;
      case 'discard':
        if (target.seat === 0) { myDiscard(tile); return; }
        if (left <= 0) { toast('All 4 copies already visible'); return; }
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
      mine: sc ? { han: sc.han, fu: sc.fu, yakuman: sc.yakuman, text: `${sc.yakuman ? sc.limitName : `${sc.han} han ${sc.fu} fu`} (${sc.yaku.map(y => y.name).join(', ')})` } : undefined,
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
      case 'pass': toast('Passed — continue entering'); break;
    }
  };

  const onEndApply = (r: HandResult, s: Settlement) => {
    const label = `${roundLabel(match)}-${match.honba}: ${r.kind}`;
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoOne(); return; }
      if (e.key === 'Enter') { apply(analysis?.candidates[0]); return; }
      if (e.key === 'Escape') { setKanSeat(null); setDoraMode(false); setOverride(null); setRiichiArm([false, false, false]); keyBuf.current = ''; return; }
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
      } catch { keyBuf.current = ''; toast('Unknown tile'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ------------------------------------------------------------ render helpers
  const rec = analysis?.candidates ?? [];
  const best = rec[0];
  const bestTile = best && (best.kind === 'discard' || best.kind === 'riichi' || best.kind === 'fold') ? best.tile : undefined;
  const myTurn = st.turn === 0 && st.stage === 'discard';
  const ld = st.lastDiscard;
  const callableBy = (s: Seat) => !!ld && ld.seat !== s && !!st.pendingRon && st.pendingRon.kind === 'discard';

  // show the drawn tile separately on the right, like the real client
  const drawnIdx = st.myDrawn !== null ? st.myHand.lastIndexOf(st.myDrawn) : -1;
  const handTiles = sortTiles(st.myHand.filter((_, i) => i !== drawnIdx));
  const drawnShown = drawnIdx >= 0 ? st.myDrawn : null;

  const oppPanel = (s: Seat) => {
    const p = st.players[s];
    const o = analysis?.opponents.find(x => x.seat === s);
    const active = target.kind === 'discard' && target.seat === s || target.kind === 'kan' && target.seat === s;
    return (
      <section class={`opp ${active ? 'active' : ''} ${p.riichi ? 'in-riichi' : ''}`} onPointerDown={() => st.phase === 'play' && setOverride(s)}>
        <header>
          <span class="seatname">{SEAT_SHORT[s]} <small>{seatWindName(match, s)}{match.dealer === s ? ' (dealer)' : ''}</small></span>
          <span class="score">{st.match.scores[s]}</span>
          {p.riichi && <span class="pill riichi">RIICHI</span>}
          {p.kita > 0 && <span class="pill kita">北×{p.kita}</span>}
          {o && <span class={`pill ${o.tenpai > 0.6 ? 'hot' : o.tenpai > 0.3 ? 'warm' : ''}`} title="estimated tenpai probability / hand value">T {(o.tenpai * 100).toFixed(0)}% · ~{Math.round(o.value / 100) * 100}</span>}
        </header>
        <div class="river">
          {p.discards.map(d => <Tile t={d.tile} size="sm" rotated={d.riichi} dim={d.called} />)}
        </div>
        {p.melds.length > 0 && <div class="melds">{p.melds.map(m => <span class="meld">{Array.from({ length: m.type === 'pon' ? 3 : 4 }, (_, i) => <Tile t={m.kind} size="xs" dim={m.type === 'ankan' && (i === 0 || i === 3)} />)}<small>{m.type}</small></span>)}</div>}
        <div class="actions" onPointerDown={e => e.stopPropagation()}>
          <button class={`act ${riichiArm[s] ? 'on' : ''}`} disabled={p.riichi} onClick={() => { const a = [...riichiArm] as [boolean, boolean, boolean]; a[s] = !a[s]; setRiichiArm(a); setOverride(s); }}>Riichi</button>
          <button class="act" disabled={!callableBy(s)} onClick={() => push({ t: 'pon', seat: s })}>Pon</button>
          <button class={`act ${kanSeat === s ? 'on' : ''}`} onClick={() => setKanSeat(kanSeat === s ? null : s)}>Kan</button>
          <button class="act" onClick={() => push({ t: 'kita', seat: s })}>Kita</button>
          <button class="act win" disabled={!st.pendingRon || st.pendingRon.seat === s} onClick={() => openEnd({ kind: 'ron', winners: [s], loser: st.pendingRon!.seat })}>Ron</button>
          <button class="act win" onClick={() => openEnd({ kind: 'tsumo', winners: [s] })}>Tsumo</button>
        </div>
      </section>
    );
  };

  const dangerOf = (t: TileKey) => (settings.showDanger && analysis ? analysis.danger[kindOf(t)] : undefined);
  const myP = st.players[0];

  return (
    <div class="app">
      <header class="top">
        <div class="brand" title="Mahjong of the Win">Pon Intended</div>
        <div class="round">{roundLabel(match)} · {match.honba} honba · {match.kyotaku} dep. · wall <b>{st.wall}</b>
          <span class="wallbtns"><button onClick={() => push({ t: 'wall', delta: -1 })}>−</button><button onClick={() => push({ t: 'wall', delta: 1 })}>+</button></span>
        </div>
        <div class="dora">
          <span>Dora ind.</span>
          {st.doraIndicators.map(d => <Tile t={d} size="sm" />)}
          <button class={`act small ${doraMode ? 'on' : ''}`} onClick={() => setDoraMode(!doraMode)}>+</button>
        </div>
        <div class="tools">
          <button class="act" onClick={undo} disabled={!events.length}>↶ Undo</button>
          <button class="act" onClick={redoOne} disabled={!redo.length}>↷</button>
          <select value={settings.mode} onChange={e => setSettings({ ...settings, mode: (e.target as HTMLSelectElement).value as Settings['mode'] })}>
            <option value="instant">Instant</option>
            <option value="advanced">Advanced</option>
            <option value="max">Max strength</option>
          </select>
          <select value={settings.objective} onChange={e => setSettings({ ...settings, objective: (e.target as HTMLSelectElement).value as Settings['objective'] })}>
            <option value="top">Goal: 1st place</option>
            <option value="rank">Goal: rank points</option>
          </select>
          <button class="act" onClick={() => openEnd({ kind: 'draw', tenpai: [isTenpaiHand(toCounts(st.myHand), myP.melds.length), false, false] })}>End hand</button>
          <button class="act" onClick={() => setDialog('setup')}>Setup</button>
        </div>
      </header>

      <main class="board">
        <div class="left">
          <div class="opps">
            {oppPanel(2)}
            {oppPanel(1)}
          </div>

          <section class={`me ${target.kind === 'draw' || (target.kind === 'discard' && target.seat === 0) || target.kind === 'deal' ? 'active' : ''}`}>
            <header>
              <span class="seatname">You <small>{seatWindName(match, 0)}{match.dealer === 0 ? ' (dealer)' : ''}</small></span>
              <span class="score">{st.match.scores[0]}</span>
              {myP.riichi && <span class="pill riichi">RIICHI</span>}
              {myP.kita > 0 && <span class="pill kita">北×{myP.kita}</span>}
              {st.phase === 'play' && isMyFuriten(st) && <span class="pill hot">FURITEN</span>}
              {analysis && <span class="pill">{analysis.shanten <= 0 ? (analysis.shanten < 0 ? 'Complete' : 'Tenpai') : `${analysis.shanten}-shanten`}</span>}
            </header>
            <div class="hand">
              {handTiles.map(t => (
                <Tile t={t} size="lg" onClick={() => (st.phase === 'setup' ? setEvents(evs => { const i = evs.map(e => e.t === 'deal' && e.tile === t).lastIndexOf(true); return i < 0 ? evs : [...evs.slice(0, i), ...evs.slice(i + 1)]; }) : myTurn ? myDiscard(t) : kanSeat === 0 ? onPalette(t) : undefined)}
                  highlight={bestTile !== undefined && t === bestTile} danger={myTurn ? dangerOf(t) : undefined}
                  dim={myTurn && (riichiArm[0] ? !legal.riichiDiscards.includes(t) : !legal.discards.includes(t))} />
              ))}
              {drawnShown !== null && <span class="drawn"><Tile t={drawnShown} size="lg" onClick={() => myTurn && myDiscard(drawnShown)} highlight={bestTile === drawnShown} danger={myTurn ? dangerOf(drawnShown) : undefined} /></span>}
              {myP.melds.map(m => <span class="meld">{Array.from({ length: m.type === 'pon' ? 3 : 4 }, () => <Tile t={m.kind} size="sm" />)}</span>)}
            </div>
            <div class="actions">
              <button class={`act ${riichiArm[0] ? 'on' : ''}`} disabled={!legal.riichiDiscards.length} onClick={() => { const a = [...riichiArm] as [boolean, boolean, boolean]; a[0] = !a[0]; setRiichiArm(a); }}>Riichi</button>
              <button class="act win" disabled={!legal.tsumo} onClick={() => openEnd(myWinPreset('tsumo'))}>Tsumo</button>
              <button class="act win" disabled={!legal.ron} onClick={() => openEnd(myWinPreset('ron'))}>Ron</button>
              <button class="act" disabled={!legal.pon} onClick={() => push({ t: 'pon', seat: 0 })}>Pon</button>
              <button class="act" disabled={!legal.daiminkan && !legal.ankan.length && !legal.kakan.length} onClick={() => {
                if (legal.daiminkan && !myTurn) push({ t: 'daiminkan', seat: 0 });
                else if (legal.ankan.length + legal.kakan.length === 1) push(legal.ankan.length ? { t: 'ankan', seat: 0, kind: legal.ankan[0] } : { t: 'kakan', seat: 0, kind: legal.kakan[0] });
                else setKanSeat(0);
              }}>Kan</button>
              <button class="act" disabled={!legal.kita} onClick={() => push({ t: 'kita', seat: 0 })}>Kita 北</button>
              {override !== null && <button class="act" onClick={() => setOverride(null)}>Auto turn</button>}
            </div>
            {myP.discards.length > 0 && <div class="river mine">{myP.discards.map(d => <Tile t={d.tile} size="xs" rotated={d.riichi} dim={d.called} />)}</div>}
          </section>

          <div class={`prompt ${target.kind}`}>{targetText(target, st)}{flash && <span class="flash">{flash}</span>}</div>

          <section class="palette">
            {PALETTE_ROWS.map(row => (
              <div class="prow">
                {row.map(t => {
                  const k = kindOf(t);
                  const left = 4 - visible[k];
                  const redSeen = t === RED_5P || t === RED_5S ? st.myHand.includes(t) || st.players.some(p => p.discards.some(d => d.tile === t) || p.melds.some(m => m.kind === k && m.reds > 0)) || st.doraIndicators.includes(t) : false;
                  return <Tile t={t} size="lg" title={tileCode(t)} badge={t === RED_5P || t === RED_5S ? (redSeen ? 0 : 1) : left} onClick={() => onPalette(t)} dim={left <= 0 || redSeen} />;
                })}
              </div>
            ))}
          </section>
        </div>

        <aside class="right">
          <Recommendation a={analysis} st={st} onApply={apply} err={engineErr} />
          <PlacementBox a={analysis} />
          {history.length > 0 && <details class="hist"><summary>History ({history.length})</summary>{history.map(h => <div>{h.label}: {h.deltas.join(' / ')}</div>)}</details>}
          <p class="muted tiny">Keys: type <code>5p</code>, <code>e</code>… · Enter = apply · Ctrl+Z undo · R riichi. Tap an opponent panel to redirect input.</p>
        </aside>
      </main>

      {dialog === 'setup' && <SetupDialog match={match} onStart={startHand} onCancel={started ? () => setDialog(null) : undefined} />}
      {dialog === 'end' && endPreset && <EndDialog match={st.match} preset={endPreset} onApply={onEndApply} onCancel={() => setDialog(null)} />}
      {finalS && <FinalDialog s={finalS} onNew={() => { setFinalS(null); setHistory([]); startHand(newMatch(0)); setDialog('setup'); }} />}
    </div>
  );
}

function pct(x: number, d = 0) { return `${(x * 100).toFixed(d)}%`; }

function Recommendation({ a, st, onApply, err }: { a: Analysis | null; st: HandState; onApply: (c: Candidate) => void; err: string | null }) {
  if (err) return <section class="rec"><h3>Engine error</h3><p class="warn">{err}</p></section>;
  if (st.phase !== 'play') return <section class="rec"><h3>Recommendation</h3><p class="muted">Enter the dora indicator and your hand to start.</p></section>;
  if (!a) return <section class="rec"><h3>Thinking…</h3></section>;
  if (!a.candidates.length) return <section class="rec"><h3>Recommendation</h3>{a.notes.map(n => <p class="muted">{n}</p>)}</section>;
  const [b, ...rest] = a.candidates;
  const riskCls = (r: number) => (r < 0.01 ? 'safe' : r < 0.04 ? 'mid' : 'risky');
  return (
    <section class={`rec ${a.stage}`}>
      <div class="rec-head">
        <h3>{a.situation === 'call' ? 'Call decision' : 'Best action'}</h3>
        <span class="muted tiny">{a.mode}{a.stage === 'partial' ? ' (refining…)' : ''} · {a.ms.toFixed(0)} ms</span>
      </div>
      <button class={`best kind-${b.kind}`} onClick={() => onApply(b)}>
        <div class="best-label">{b.label}</div>
        {b.tile !== undefined && <Tile t={b.tile} size="lg" />}
        <div class="best-sub">tap to apply · confidence {pct(a.confidence)}</div>
      </button>
      <div class="stats">
        <div><span>P(1st)</span><b>{pct(b.pFirst, 1)}</b></div>
        <div><span>EV</span><b>{b.evPoints > 0 ? '+' : ''}{Math.round(b.evPoints)}</b></div>
        <div><span>Win</span><b>{pct(b.winProb)}</b></div>
        <div><span>Risk now</span><b class={riskCls(b.immediateRisk)}>{pct(b.immediateRisk, 1)}</b></div>
      </div>
      <p class="reason">{b.reason}</p>
      <table class="alts">
        <thead><tr><th>Alternative</th><th>P1</th><th>EV</th><th>Win</th><th>Risk</th></tr></thead>
        <tbody>
          {rest.slice(0, 5).map(c => (
            <tr onClick={() => onApply(c)} title={c.reason}>
              <td>{c.label}</td><td>{pct(c.pFirst, 1)}</td><td>{Math.round(c.evPoints)}</td><td>{pct(c.winProb)}</td>
              <td class={riskCls(c.immediateRisk)}>{pct(c.immediateRisk, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {a.notes.map(n => <p class="note">{n}</p>)}
    </section>
  );
}

function PlacementBox({ a }: { a: Analysis | null }) {
  if (!a) return null;
  const p = a.placementNow;
  return (
    <section class="place">
      <div><span>Now: 1st</span><b>{pct(p.pFirst)}</b></div>
      <div><span>2nd</span><b>{pct(p.pSecond)}</b></div>
      <div><span>3rd</span><b>{pct(p.pThird)}</b></div>
      {a.opponents.map(o => <div><span>{o.seat === 1 ? 'Right' : 'Left'} tenpai</span><b class={o.tenpai > 0.6 ? 'risky' : ''}>{pct(o.tenpai)}</b></div>)}
    </section>
  );
}
