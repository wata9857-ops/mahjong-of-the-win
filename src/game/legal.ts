// Legal actions for me. The AI only ever considers actions produced here,
// which is how "never recommend an illegal move" is enforced.

import { isComplete } from '../core/agari';
import { shanten } from '../core/shanten';
import { NORTH, SANMA_KINDS, kindOf, toCounts, type Kind, type TileKey } from '../core/tiles';
import { isMyFuriten, myMeldCount, myRonScore, myTsumoScore } from './rules';
import type { HandState } from './types';

export interface MyLegal {
  /** distinct physical tiles I may discard (red and normal five are separate) */
  discards: TileKey[];
  /** discards after which riichi may be declared */
  riichiDiscards: TileKey[];
  tsumo: boolean;
  ankan: Kind[];
  kakan: Kind[];
  kita: boolean;
  /** reaction to an opponent tile */
  ron: boolean;
  pon: boolean;
  daiminkan: boolean;
}

const EMPTY: MyLegal = { discards: [], riichiDiscards: [], tsumo: false, ankan: [], kakan: [], kita: false, ron: false, pon: false, daiminkan: false };

function waitsOf(c: number[], melds: number): Kind[] {
  const w: Kind[] = [];
  for (const k of SANMA_KINDS) {
    if (c[k] >= 4) continue;
    c[k]++;
    if (isComplete(c, melds)) w.push(k);
    c[k]--;
  }
  return w;
}

/** Tenpai per Mahjong Soul formal-tenpai rule: not tenpai only if every wait is a kind I hold all 4 of. */
export function isTenpaiHand(c: number[], melds: number): boolean {
  if (shanten(c, melds) !== 0) return false;
  return waitsOf(c, melds).length > 0;
}

/** Ankan after riichi: only with the drawn tile, and the winning kinds must stay identical. */
function riichiAnkanOk(st: HandState, kind: Kind): boolean {
  if (st.myDrawn === null || kindOf(st.myDrawn) !== kind) return false; // no okuri-kan
  const c = toCounts(st.myHand);
  const melds = myMeldCount(st);
  c[kind]--; // the 13-tile riichi hand
  const before = waitsOf(c.slice(), melds).join(',');
  c[kind] -= 3;
  const after = waitsOf(c, melds + 1).join(',');
  return before.length > 0 && before === after;
}

export function myLegalActions(st: HandState): MyLegal {
  if (st.phase !== 'play') return EMPTY;
  const me = st.players[0];
  const res: MyLegal = { ...EMPTY, discards: [], riichiDiscards: [], ankan: [], kakan: [] };
  const c = toCounts(st.myHand);
  const melds = myMeldCount(st);

  if (st.turn === 0 && st.stage === 'discard') {
    if (me.riichi) {
      if (st.myDrawn !== null) res.discards = [st.myDrawn];
    } else {
      const seen = new Set<TileKey>();
      for (const t of st.myHand) {
        if (seen.has(t)) continue;
        seen.add(t);
        if (st.kuikaeKind !== null && kindOf(t) === st.kuikaeKind) continue;
        res.discards.push(t);
      }
      if (res.discards.length === 0) res.discards = [...seen]; // safety: never leave no legal discard
      const closed = me.melds.every(m => m.type === 'ankan');
      if (closed && st.unknown === 0 && st.match.scores[0] >= 1000 && st.wall >= 3) {
        for (const t of res.discards) {
          const k = kindOf(t);
          c[k]--;
          if (isTenpaiHand(c, melds)) res.riichiDiscards.push(t);
          c[k]++;
        }
      }
    }
    res.tsumo = !!myTsumoScore(st);
    if (st.wall > 0) {
      for (const k of SANMA_KINDS) {
        if (c[k] === 4 && (!me.riichi || riichiAnkanOk(st, k))) res.ankan.push(k);
        if (c[k] >= 1 && !me.riichi && me.melds.some(m => m.type === 'pon' && m.kind === k)) res.kakan.push(k);
      }
      if (c[NORTH] > 0) {
        // During riichi, only a kita that leaves the waits unchanged (i.e. the drawn North) is allowed.
        res.kita = !me.riichi || (st.myDrawn !== null && kindOf(st.myDrawn) === NORTH);
      }
    }
    return res;
  }

  // Reaction window to another player's tile.
  const pr = st.pendingRon;
  if (pr) {
    res.ron = !isMyFuriten(st) && !!myRonScore(st, pr.tile, pr.kind === 'chankan', pr.kind === 'kita');
  }
  const ld = st.lastDiscard;
  if (ld && ld.seat !== 0 && pr && pr.kind === 'discard' && !me.riichi && st.wall > 0) {
    const k = kindOf(ld.tile);
    res.pon = c[k] >= 2;
    res.daiminkan = c[k] >= 3;
  }
  return res;
}
