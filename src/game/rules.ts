// Rule helpers that read a HandState from my perspective.

import { isComplete } from '../core/agari';
import { scoreHand, type ScoreResult, type WinContext } from '../core/scoring';
import { shanten } from '../core/shanten';
import { EAST, NORTH, SANMA_KINDS, isRed, kindOf, toCounts, type Kind, type TileKey } from '../core/tiles';
import type { HandState, Seat } from './types';

/** Seat wind kind (27..29) for a relative seat. */
export function seatWind(st: HandState, seat: Seat): number {
  return EAST + ((seat - st.match.dealer + 3) % 3);
}
export const roundWindKind = (st: HandState): number => EAST + st.match.roundWind;

export function myCounts(st: HandState): number[] {
  return toCounts(st.myHand);
}

export function myAka(st: HandState): number {
  let n = st.myHand.filter(isRed).length;
  for (const m of st.players[0].melds) n += m.reds;
  return n;
}

/** Counts of every tile visible to me (hand, all rivers, melds, kita, dora indicators). */
export function visibleCounts(st: HandState): number[] {
  const c = toCounts(st.myHand);
  for (const p of st.players) {
    for (const d of p.discards) if (!d.called) c[kindOf(d.tile)]++;
    for (const m of p.melds) c[m.kind] += m.type === 'pon' ? 3 : 4;
    c[NORTH] += p.kita;
  }
  for (const d of st.doraIndicators) c[kindOf(d)]++;
  return c;
}

/** Unseen copies per kind (0 for kinds absent in sanma). */
export function unseenCounts(st: HandState): number[] {
  const v = visibleCounts(st);
  const u = new Array(34).fill(0);
  for (const k of SANMA_KINDS) u[k] = Math.max(0, 4 - v[k]);
  return u;
}

export function myMeldCount(st: HandState): number {
  return st.players[0].melds.length;
}

/** Winning kinds for my current 3k+1 hand (shape only). */
export function myWaits(st: HandState): Kind[] {
  const c = myCounts(st);
  const melds = myMeldCount(st);
  if (c.reduce((a, b) => a + b, 0) % 3 !== 1) return [];
  if (shanten(c, melds) !== 0) return [];
  const w: Kind[] = [];
  for (const k of SANMA_KINDS) {
    if (c[k] >= 4) continue;
    c[k]++;
    if (isComplete(c, melds)) w.push(k);
    c[k]--;
  }
  return w;
}

export function myDiscardFuriten(st: HandState): boolean {
  if (st.unknown > 0) return false; // waits of a partially known hand are meaningless
  const waits = myWaits(st);
  if (!waits.length) return false;
  const discarded = new Set(st.players[0].discards.map(d => kindOf(d.tile)));
  return waits.some(k => discarded.has(k));
}

export function isMyFuriten(st: HandState): boolean {
  return st.myFuritenTemp || st.myFuritenRiichi || myDiscardFuriten(st);
}

export interface WinOpts {
  tsumo: boolean;
  tile: TileKey;
  chankan?: boolean;
  /** robbing a kita: chankan yaku is NOT awarded */
  robKita?: boolean;
  uraIndicators?: number[];
}

/** Build a WinContext for me. For tsumo the tile must already be in myHand. */
export function myWinContext(st: HandState, o: WinOpts): WinContext {
  const me = st.players[0];
  const c = toCounts(st.myHand);
  let aka = myAka(st);
  if (!o.tsumo) { c[kindOf(o.tile)]++; if (isRed(o.tile)) aka++; }
  const dealer = st.match.dealer === 0;
  const firstDraw = st.uninterrupted && me.discards.length === 0;
  return {
    closed: c,
    melds: me.melds,
    winTile: kindOf(o.tile),
    tsumo: o.tsumo,
    seatWind: seatWind(st, 0),
    roundWind: roundWindKind(st),
    dealer,
    riichi: me.riichi && !me.doubleRiichi,
    doubleRiichi: me.doubleRiichi,
    ippatsu: me.ippatsu,
    haitei: o.tsumo && st.wall === 0 && !st.lastDrawRinshan,
    houtei: !o.tsumo && st.wall === 0,
    rinshan: o.tsumo && st.lastDrawRinshan,
    chankan: !!o.chankan && !o.robKita,
    tenhou: o.tsumo && firstDraw && dealer,
    chiihou: o.tsumo && firstDraw && !dealer,
    doraIndicators: st.doraIndicators.map(kindOf),
    uraIndicators: o.uraIndicators,
    aka,
    kita: me.kita,
  };
}

/** Score if I can win on `tile` (ron) — ignores furiten; caller checks. */
export function myRonScore(st: HandState, tile: TileKey, chankan = false, robKita = false): ScoreResult | null {
  if (st.unknown > 0) return null; // cannot verify a win with unentered tiles
  const c = toCounts(st.myHand);
  c[kindOf(tile)]++;
  if (!isComplete(c, myMeldCount(st))) return null;
  const r = scoreHand(myWinContext(st, { tsumo: false, tile, chankan, robKita }));
  return r.valid ? r : null;
}

export function myTsumoScore(st: HandState): ScoreResult | null {
  if (st.turn !== 0 || st.stage !== 'discard' || st.myDrawn === null || st.unknown > 0) return null;
  const c = toCounts(st.myHand);
  if (!isComplete(c, myMeldCount(st))) return null;
  const r = scoreHand(myWinContext(st, { tsumo: true, tile: st.myDrawn }));
  return r.valid ? r : null;
}
