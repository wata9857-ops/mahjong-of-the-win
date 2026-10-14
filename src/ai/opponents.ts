// Opponent modelling from public information only.
//
// Danger: enumerate every wait shape an opponent could hold (ryanmen,
// kanchan, penchan, shanpon, tanki), weight it by an empirical shape prior
// times the number of unseen tile combinations that could form it, and remove
// shapes the opponent cannot ron on (furiten: genbutsu, tiles passed after
// riichi or since their last discard). This single model naturally captures
// genbutsu, suji, kabe / no-chance, one-chance and honor visibility.
// Sanma specific: 1m/9m cannot be in sequences, so they behave like honors.

import { NORTH, SANMA_KINDS, doraFromIndicator, isDragon, isHonor, kindOf, numOf, suitOf, type Kind } from '../core/tiles';
import { seatWind, roundWindKind, unseenCounts } from '../game/rules';
import { safeKindsAgainst } from '../game/state';
import type { HandState, Seat } from '../game/types';

const W_RYANMEN = 1.0, W_KANCHAN = 0.22, W_PENCHAN = 0.26, W_SHANPON = 0.3, W_TANKI = 0.23;

export interface OpponentModel {
  seat: Seat;
  tenpai: number;
  /** P(tile kind wins for them | tenpai), index by kind */
  waitProb: Float64Array;
  /** expected points they gain on ron against me */
  ronValue: number;
  /** expected total they gain on tsumo */
  tsumoValue: number;
  riichi: boolean;
  dealer: boolean;
  safe: Set<Kind>;
  /** per-turn win hazard when tenpai */
  hazard: number;
  /** notes for the UI */
  notes: string[];
}

/** Tenpai probability for a non-riichi opponent from turn count and melds. */
export function tenpaiEstimate(discards: number, melds: number, riichi: boolean): number {
  if (riichi) return 1;
  const t = discards;
  let p: number;
  if (melds === 0) p = 0.02 + 0.028 * Math.max(0, t - 3); // dama tenpai grows slowly
  else if (melds === 1) p = 0.1 + 0.045 * Math.max(0, t - 2);
  else if (melds === 2) p = 0.3 + 0.05 * Math.max(0, t - 2);
  else p = 0.7 + 0.04 * t;
  return Math.max(0, Math.min(melds >= 4 ? 0.97 : 0.9, p));
}

function suitBias(st: HandState, s: Seat): Float64Array {
  // Honitsu/chinitsu detection: melds concentrated in one number suit and few discards from it.
  const bias = new Float64Array(34).fill(1);
  const p = st.players[s];
  const meldSuits = new Set(p.melds.filter(m => !isHonor(m.kind)).map(m => suitOf(m.kind)));
  if (meldSuits.size === 1 && p.melds.length >= 1) {
    const suit = [...meldSuits][0];
    const disc = p.discards.map(d => kindOf(d.tile));
    const inSuit = disc.filter(k => !isHonor(k) && suitOf(k) === suit).length;
    const other = disc.filter(k => !isHonor(k) && suitOf(k) !== suit).length;
    if (other >= 3 && inSuit <= 1) {
      for (const k of SANMA_KINDS) {
        if (isHonor(k)) bias[k] = 1.3;
        else if (suitOf(k) === suit) bias[k] = 2.2;
        else bias[k] = 0.15;
      }
    }
  }
  return bias;
}

/** P(kind is a winning tile | opponent tenpai). */
export function waitDistribution(unseen: readonly number[], safe: Set<Kind>, bias: Float64Array, early: Set<Kind>): Float64Array {
  const w = new Float64Array(34);
  let total = 0;
  const add = (kinds: Kind[], weight: number) => {
    if (weight <= 0) return;
    for (const k of kinds) if (safe.has(k)) return; // furiten shape: cannot ron
    let b = 1;
    for (const k of kinds) b = Math.min(b, bias[k]);
    weight *= b;
    for (const k of kinds) w[k] += weight;
    total += weight;
  };
  const u = unseen;
  for (const base of [9, 18]) {
    for (let n = 1; n <= 9; n++) {
      const k = base + n - 1;
      // ryanmen n,n+1 waiting n-1 and n+2 (n = 2..7)
      if (n >= 2 && n <= 7) {
        let wt = W_RYANMEN * u[k] * u[k + 1];
        // soto-suji of early discards: slightly less likely
        if (early.has(k - 1) || early.has(k + 2)) wt *= 0.7;
        add([k - 1, k + 2], wt);
      }
      if (n === 1) add([k + 2], W_PENCHAN * u[k] * u[k + 1]);
      if (n === 8) add([k - 1], W_PENCHAN * u[k] * u[k + 1]);
      if (n <= 7) add([k + 1], W_KANCHAN * u[k] * u[k + 2]);
    }
  }
  for (const k of SANMA_KINDS) {
    const uk = u[k];
    // Honors and (in sanma) 1m/9m only appear in shanpon/tanki waits, which are
    // chosen deliberately more often for these tiles (hell-waits, yakuhai).
    const honorLike = isHonor(k) || k === 0 || k === 8;
    if (uk >= 2) add([k], W_SHANPON * (uk * (uk - 1)) / 2 * (honorLike ? 2.0 : 1));
    if (uk >= 1) add([k], W_TANKI * uk * (honorLike ? 2.5 : 0.8));
  }
  if (total > 0) {
    // ~1.15 winning kinds on average (nobetan / multi-waits)
    for (let k = 0; k < 34; k++) w[k] = Math.min(0.95, (w[k] / total) * 1.15);
  }
  return w;
}

const HAN_TO_POINTS_ND = [0, 1500, 2900, 5600, 8000, 8000, 12000, 12000, 16000, 16000, 16000, 24000, 24000, 32000];

function handValueFromHan(han: number, dealer: boolean): number {
  const h = Math.max(1, Math.min(13, han));
  const lo = HAN_TO_POINTS_ND[Math.floor(h)];
  const hi = HAN_TO_POINTS_ND[Math.min(13, Math.ceil(h))];
  const v = lo + (hi - lo) * (h - Math.floor(h));
  return dealer ? v * 1.5 : v;
}

export function modelOpponent(st: HandState, s: Seat): OpponentModel {
  const p = st.players[s];
  const unseen = unseenCounts(st);
  const safe = safeKindsAgainst(st, s);
  const notes: string[] = [];
  const dealer = st.match.dealer === s;
  const openMelds = p.melds.filter(m => m.type !== 'ankan').length;
  const tenpai = tenpaiEstimate(p.discards.length, openMelds, p.riichi);
  const bias = suitBias(st, s);
  if (bias[9] !== 1 || bias[18] !== 1) notes.push('染め手の気配');
  const early = new Set<Kind>();
  p.discards.slice(0, 5).forEach(d => early.add(kindOf(d.tile)));
  const waitProb = waitDistribution(unseen, safe, bias, p.riichi ? early : new Set());

  // value: visible dora (melds, kita) + yakuhai melds + riichi
  let visDora = p.kita;
  for (const ind of st.doraIndicators) {
    const d = doraFromIndicator(kindOf(ind));
    for (const m of p.melds) if (m.kind === d) visDora += m.type === 'pon' ? 3 : 4;
    if (d === NORTH) visDora += p.kita;
  }
  for (const m of p.melds) visDora += m.reds;
  let yakuHan = 0;
  const sw = seatWind(st, s), rw = roundWindKind(st);
  for (const m of p.melds) {
    if (isDragon(m.kind)) yakuHan++;
    if (m.kind === sw) yakuHan++;
    if (m.kind === rw) yakuHan++;
  }
  let han: number;
  if (p.riichi) han = 1 + 0.5 /*tsumo/ippatsu*/ + 0.45 /*ura*/ + 0.6 /*other yaku*/ + 0.9 /*hidden dora+aka*/ + visDora;
  else if (openMelds === 0) han = 1.6 + 0.9 + visDora;
  else han = Math.max(1, yakuHan) + 0.6 + 0.5 + visDora;
  if (bias[9] !== 1 || bias[18] !== 1) han += 2;
  if (visDora >= 2) notes.push(`見えているドラ${visDora}枚`);
  const ronValue = handValueFromHan(han, dealer);
  // tsumo loss: non-dealer tsumo ≈ 3/4 of ron value, dealer tsumo ≈ 2/3
  const tsumoValue = ronValue * (dealer ? 0.67 : 0.75);
  const hazard = p.riichi ? 0.12 : 0.1;
  return { seat: s, tenpai, waitProb, ronValue, tsumoValue, riichi: p.riichi, dealer, safe, hazard, notes };
}

/** Probability that discarding `kind` deals in to this opponent right now. */
export function dealInProb(m: OpponentModel, kind: Kind): number {
  if (m.safe.has(kind)) return 0;
  return m.tenpai * m.waitProb[kind];
}

export function numberCategory(kind: Kind): string {
  if (isHonor(kind)) return 'honor';
  const n = numOf(kind);
  return n === 1 || n === 9 ? 'terminal' : n === 2 || n === 8 ? '2/8' : n === 3 || n === 7 ? '3/7' : 'middle';
}
