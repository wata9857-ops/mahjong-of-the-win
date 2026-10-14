// Event-sourced hand state. The state is always rebuilt by folding events over
// the initial hand configuration, which makes undo/redo exact and trivial.

import { NORTH, isRed, kindOf, redOf, sortTiles, type Kind, type TileKey } from '../core/tiles';
import { myRonScore } from './rules';
import { LIVE_WALL_START, nextSeat, type GameEvent, type HandState, type MatchInfo, type PlayerState, type Seat } from './types';

function newPlayer(): PlayerState {
  return { discards: [], melds: [], kita: 0, riichi: false, doubleRiichi: false, riichiIdx: -1, ippatsu: false };
}

export function initialHandState(match: MatchInfo): HandState {
  return {
    phase: 'setup',
    match: { ...match, scores: [...match.scores] as [number, number, number] },
    doraIndicators: [],
    myHand: [],
    myDrawn: null,
    players: [newPlayer(), newPlayer(), newPlayer()],
    turn: match.dealer,
    stage: 'draw',
    lastDiscard: null,
    pendingRon: null,
    wall: LIVE_WALL_START,
    discardCounter: 0,
    rinshanNext: false,
    lastDrawRinshan: false,
    myFuritenTemp: false,
    myFuritenRiichi: false,
    uninterrupted: true,
    kuikaeKind: null,
    turnByCall: false,
    warnings: [],
  };
}

function clone(st: HandState): HandState {
  return {
    ...st,
    match: { ...st.match, scores: [...st.match.scores] as [number, number, number] },
    doraIndicators: [...st.doraIndicators],
    myHand: [...st.myHand],
    players: st.players.map(p => ({ ...p, discards: [...p.discards], melds: p.melds.map(m => ({ ...m })) })) as HandState['players'],
    warnings: [],
  };
}

/** Remove `n` tiles of `kind` from my hand, preferring non-red copies unless `preferRed`. Returns reds removed. */
function takeFromHand(st: HandState, kind: Kind, n: number, preferRed = false): number {
  let reds = 0;
  for (let i = 0; i < n; i++) {
    let idx = -1;
    const red = redOf(kind);
    if (preferRed && red >= 0) idx = st.myHand.indexOf(red);
    if (idx < 0) idx = st.myHand.indexOf(kind);
    if (idx < 0 && red >= 0) idx = st.myHand.indexOf(red);
    if (idx < 0) { st.warnings.push(`Missing tile in hand for kind ${kind}`); return reds; }
    if (isRed(st.myHand[idx])) reds++;
    st.myHand.splice(idx, 1);
  }
  return reds;
}

/** Called before every event: if I could have ronned the pending tile and didn't, apply furiten. */
function resolvePass(st: HandState): void {
  const p = st.pendingRon;
  if (!p) return;
  st.pendingRon = null;
  const score = myRonScore(st, p.tile, p.kind === 'chankan', p.kind === 'kita');
  if (score) {
    st.myFuritenTemp = true;
    if (st.players[0].riichi) st.myFuritenRiichi = true;
  }
}

function breakIppatsu(st: HandState): void {
  for (const p of st.players) p.ippatsu = false;
  st.uninterrupted = false;
}

/** Advance the turn to `s` after a normal discard (the next player draws). */
function passTurnTo(st: HandState, s: Seat): void {
  st.turn = s;
  st.turnByCall = false;
  st.kuikaeKind = null;
  if (s === 0) {
    st.stage = 'draw';
  } else {
    st.wall--; // opponent's draw is implied
    st.stage = 'discard';
  }
}

export function applyEvent(prev: HandState, ev: GameEvent): HandState {
  const st = clone(prev);
  if (ev.t !== 'dora' && ev.t !== 'deal' && ev.t !== 'wall') resolvePass(st);
  switch (ev.t) {
    case 'dora':
      st.doraIndicators.push(ev.tile);
      break;
    case 'wall':
      st.wall = Math.max(0, st.wall + ev.delta);
      break;
    case 'deal': {
      if (st.phase !== 'setup') { st.warnings.push('Hand already dealt'); break; }
      st.myHand.push(ev.tile);
      st.myHand = sortTiles(st.myHand);
      if (st.myHand.length >= 13) {
        st.phase = 'play';
        st.turn = st.match.dealer;
        if (st.turn === 0) st.stage = 'draw';
        else { st.stage = 'discard'; st.wall--; }
      }
      break;
    }
    case 'draw': {
      if (st.turn !== 0 || st.stage !== 'draw') st.warnings.push('Draw recorded out of turn');
      st.turn = 0;
      st.myHand.push(ev.tile);
      st.myHand = sortTiles(st.myHand);
      st.myDrawn = ev.tile;
      st.stage = 'discard';
      st.wall--;
      st.lastDrawRinshan = st.rinshanNext;
      st.rinshanNext = false;
      st.myFuritenTemp = false;
      st.lastDiscard = null;
      break;
    }
    case 'discard': {
      const p = st.players[ev.seat];
      if (ev.seat === 0) {
        const idx = st.myHand.indexOf(ev.tile);
        if (idx < 0) { st.warnings.push('Discarded tile not in hand'); break; }
        st.myHand.splice(idx, 1);
      } else if (st.turn !== ev.seat) {
        // Out-of-order opponent discard: accept it but realign the turn.
        st.warnings.push('Turn order adjusted');
      }
      const tsumogiri = ev.seat === 0 && st.myDrawn !== null && ev.tile === st.myDrawn;
      const idx = st.discardCounter++;
      if (p.ippatsu && !ev.riichi) p.ippatsu = false;
      if (ev.riichi && !p.riichi) {
        p.riichi = true;
        p.riichiIdx = idx;
        p.ippatsu = true;
        p.doubleRiichi = st.uninterrupted && p.discards.length === 0;
        st.match.scores[ev.seat] -= 1000;
        st.match.kyotaku += 1;
      }
      p.discards.push({ tile: ev.tile, riichi: !!ev.riichi, called: false, idx, tsumogiri });
      st.myDrawn = null;
      st.lastDrawRinshan = false;
      st.lastDiscard = { seat: ev.seat, tile: ev.tile, idx };
      if (ev.seat !== 0) st.pendingRon = { seat: ev.seat, tile: ev.tile, kind: 'discard' };
      // The first go-around ends once every player has discarded.
      if (st.players.every(pl => pl.discards.length >= 1)) st.uninterrupted = false;
      passTurnTo(st, nextSeat(ev.seat));
      break;
    }
    case 'pon':
    case 'daiminkan': {
      const ld = st.lastDiscard;
      if (!ld || ld.seat === ev.seat) { st.warnings.push('Nothing to call'); break; }
      const kind = kindOf(ld.tile);
      // undo the implied draw of the player who would have drawn
      if (nextSeat(ld.seat) !== 0) st.wall++;
      const discarder = st.players[ld.seat];
      const di = discarder.discards[discarder.discards.length - 1];
      if (di) di.called = true;
      const need = ev.t === 'pon' ? 2 : 3;
      let reds = isRed(ld.tile) ? 1 : 0;
      if (ev.seat === 0) reds += takeFromHand(st, kind, need, true);
      const from = ((ld.seat - ev.seat + 3) % 3) as Seat;
      st.players[ev.seat].melds.push({ type: ev.t === 'pon' ? 'pon' : 'minkan', kind, reds, from });
      breakIppatsu(st);
      st.turn = ev.seat;
      st.turnByCall = true;
      st.lastDiscard = null;
      st.pendingRon = null;
      if (ev.t === 'pon') {
        st.stage = 'discard';
        st.kuikaeKind = ev.seat === 0 ? kind : null;
      } else {
        // rinshan draw
        if (ev.seat === 0) { st.stage = 'draw'; st.rinshanNext = true; }
        else { st.stage = 'discard'; st.wall--; }
      }
      break;
    }
    case 'ankan':
    case 'kakan': {
      const pl = st.players[ev.seat];
      if (ev.t === 'ankan') {
        let reds = 0;
        if (ev.seat === 0) reds = takeFromHand(st, ev.kind, 4);
        else reds = redOf(ev.kind) >= 0 ? 1 : 0;
        pl.melds.push({ type: 'ankan', kind: ev.kind, reds });
      } else {
        const m = pl.melds.find(x => x.type === 'pon' && x.kind === ev.kind);
        if (!m) { st.warnings.push('Kakan without matching pon'); break; }
        if (ev.seat === 0) m.reds += takeFromHand(st, ev.kind, 1);
        m.type = 'kakan';
        if (ev.seat !== 0) st.pendingRon = { seat: ev.seat, tile: ev.kind, kind: 'chankan' };
      }
      breakIppatsu(st);
      st.turn = ev.seat;
      st.lastDiscard = null;
      st.myDrawn = null;
      if (ev.seat === 0) { st.stage = 'draw'; st.rinshanNext = true; }
      else { st.stage = 'discard'; st.wall--; }
      break;
    }
    case 'kita': {
      const pl = st.players[ev.seat];
      if (ev.seat === 0) {
        const idx = st.myHand.indexOf(NORTH);
        if (idx < 0) { st.warnings.push('No North in hand'); break; }
        st.myHand.splice(idx, 1);
        st.myDrawn = null;
        st.stage = 'draw';
        st.rinshanNext = true;
      } else {
        st.wall--; // replacement draw
        st.pendingRon = { seat: ev.seat, tile: NORTH, kind: 'kita' };
      }
      pl.kita++;
      // Kita cancels ippatsu, double riichi and kyuushu eligibility.
      breakIppatsu(st);
      st.turn = ev.seat;
      st.lastDiscard = null;
      break;
    }
  }
  return st;
}

export function replay(match: MatchInfo, events: readonly GameEvent[]): HandState {
  let st = initialHandState(match);
  for (const e of events) st = applyEvent(st, e);
  return st;
}

/** Safe tiles against seat `s` (absolutely safe kinds): own discards, plus anything passed after riichi or since their last discard. */
export function safeKindsAgainst(st: HandState, s: Seat): Set<Kind> {
  const p = st.players[s];
  const safe = new Set<Kind>();
  for (const d of p.discards) safe.add(kindOf(d.tile));
  const lastOwn = p.discards.length ? p.discards[p.discards.length - 1].idx : -1;
  const from = p.riichi ? Math.min(p.riichiIdx, lastOwn) : lastOwn;
  for (let o = 0; o < 3; o++) {
    if (o === s) continue;
    for (const d of st.players[o].discards) if (d.idx > from && from >= 0) safe.add(kindOf(d.tile));
  }
  return safe;
}

export function tilesInWall(st: HandState): number {
  return st.wall;
}

export const describeEvent = (e: GameEvent): string => {
  switch (e.t) {
    case 'discard': return `discard ${e.seat}:${e.tile}${e.riichi ? ' riichi' : ''}`;
    case 'draw': return `draw ${e.tile}`;
    case 'deal': return `deal ${e.tile}`;
    case 'dora': return `dora ${e.tile}`;
    case 'pon': case 'daiminkan': case 'kita': return `${e.t} ${e.seat}`;
    case 'ankan': case 'kakan': return `${e.t} ${e.seat}:${e.kind}`;
    case 'wall': return `wall ${e.delta}`;
  }
};

export type { TileKey };
