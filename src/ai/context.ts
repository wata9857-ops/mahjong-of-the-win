// Evaluation context extracted from the game state (my perspective only:
// nothing about opponents' concealed tiles is ever assumed).

import type { Meld } from '../core/scoring';
import { FIVE_P, FIVE_S, RED_5P, RED_5S, kindOf, type Kind } from '../core/tiles';
import { roundWindKind, seatWind, unseenCounts } from '../game/rules';
import type { HandState } from '../game/types';

export type RiichiPolicy = 'auto' | 'riichi' | 'dama';

export interface EvalCtx {
  melds: Meld[];
  kita: number;
  seatWind: number;
  roundWind: number;
  dealer: boolean;
  doraInd: Kind[];
  unseen: number[];
  unseenTotal: number;
  /** my remaining draws */
  turns: number;
  /** red fives currently held in the closed hand */
  redP: boolean;
  redS: boolean;
  /** reds inside my melds */
  meldReds: number;
  /** kinds I already discarded (discard furiten) */
  myDiscardKinds: Set<Kind>;
  /** already in riichi (hand is fixed) */
  inRiichi: boolean;
  /** objective-independent bonus (points) for a win, used to rank paths inside the DP */
  winBonus: number;
  /** multiplier on draw-based win rate representing ron chances when dama/open, and when riichi */
  ronFactorDama: number;
  ronFactorRiichi: number;
}

/**
 * My remaining draws given the live wall and how many other players draw
 * before my next draw (2 right after my discard, 0 if I'm next).
 */
export function remainingDraws(wall: number, othersBeforeMe: number): number {
  if (wall < othersBeforeMe + 1) return 0;
  return Math.floor((wall - othersBeforeMe - 1) / 3) + 1;
}

export function othersBeforeMyDraw(st: HandState): number {
  if (st.turn === 0) return st.stage === 'discard' ? 2 : 0;
  return st.turn === 2 ? 0 : 1;
}

export function buildCtx(st: HandState, opts?: Partial<EvalCtx>): EvalCtx {
  const me = st.players[0];
  const unseen = unseenCounts(st);
  return {
    melds: me.melds,
    kita: me.kita,
    seatWind: seatWind(st, 0),
    roundWind: roundWindKind(st),
    dealer: st.match.dealer === 0,
    doraInd: st.doraIndicators.map(kindOf),
    unseen,
    unseenTotal: Math.max(1, unseen.reduce((a, b) => a + b, 0)),
    turns: remainingDraws(st.wall, othersBeforeMyDraw(st)),
    redP: st.myHand.includes(RED_5P),
    redS: st.myHand.includes(RED_5S),
    meldReds: me.melds.reduce((a, m) => a + m.reds, 0),
    myDiscardKinds: new Set(me.discards.map(d => kindOf(d.tile))),
    inRiichi: me.riichi,
    winBonus: 1500,
    ronFactorDama: 1.0,
    ronFactorRiichi: 0.55,
    ...opts,
  };
}

export const akaFor = (ctx: EvalCtx, c: ArrayLike<number>): number =>
  ctx.meldReds + (ctx.redP && c[FIVE_P] > 0 ? 1 : 0) + (ctx.redS && c[FIVE_S] > 0 ? 1 : 0);
