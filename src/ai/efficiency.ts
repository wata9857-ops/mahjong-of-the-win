// Offense evaluator: expectimax over future draws with memoised hand states.
//
// For a 3k+1 hand H, curve(H)[k] gives the probability of winning within k of
// my draws (p) and the expected points gained (e). Transitions follow the
// standard "shanten-advancing" model: a draw that lowers shanten is kept and
// the best discard (by e + winBonus·p) is chosen; other draws are discarded.
// Tenpai states are solved in closed form with the real waits, real yaku
// (via the scoring engine), furiten, and a ron multiplier.
//
// States deeper than `maxShantenDP` fall back to a calibrated heuristic so
// the evaluator stays within its time budget.

import { basePoints, payments, scoreHand, totalFor, type Meld } from '../core/scoring';
import { shanten } from '../core/shanten';
import { NORTH, SANMA_KINDS, countsKey, doraFromIndicator, indicatorForDora } from '../core/tiles';
import { akaFor, type EvalCtx, type RiichiPolicy } from './context';

export interface Curve {
  p: Float64Array;
  e: Float64Array;
}

export interface EvalOptions {
  maxShantenDP: number;
  budgetMs: number;
  policy: RiichiPolicy;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Evaluator {
  readonly ctx: EvalCtx;
  readonly opts: EvalOptions;
  readonly T: number;
  private memo = new Map<string, Curve>();
  private valueMemo = new Map<string, number>();
  private deadline: number;
  states = 0;
  timedOut = false;
  meldCount: number;
  closedHand: boolean;

  constructor(ctx: EvalCtx, opts: EvalOptions, melds: Meld[] = ctx.melds) {
    this.ctx = ctx;
    this.opts = opts;
    this.T = Math.max(0, ctx.turns);
    this.deadline = now() + opts.budgetMs;
    this.meldCount = melds.length;
    this.closedHand = melds.every(m => m.type === 'ankan');
    this.melds = melds;
  }
  private melds: Meld[];

  /** Expected points for completing `c` (14-equivalent) with `win`. 0 if no yaku. */
  winValue(c: number[], win: number, policy: RiichiPolicy): { ron: number; tsumo: number } {
    const key = countsKey(c) + ':' + win + policy;
    const cached = this.valueMemo.get(key);
    if (cached !== undefined) return { ron: cached, tsumo: this.valueMemo.get(key + 't')! };
    const ctx = this.ctx;
    const riichi = this.closedHand && (ctx.inRiichi || policy !== 'dama');
    const base = {
      closed: c, melds: this.melds, winTile: win, seatWind: ctx.seatWind, roundWind: ctx.roundWind,
      dealer: ctx.dealer, riichi, doraIndicators: ctx.doraInd, aka: akaFor(ctx, c), kita: ctx.kita,
    };
    const ron = scoreHand({ ...base, tsumo: false });
    const tsumo = scoreHand({ ...base, tsumo: true });
    let ronV = ron.valid ? ron.total : 0;
    let tsuV = tsumo.valid ? tsumo.total : 0;
    if (riichi) {
      const ura = this.expectedUra(c);
      if (ron.valid && !ron.yakuman) ronV += ura * (this.pointsAt(ron.han + 1, ron.fu, false) - ronV);
      if (tsumo.valid && !tsumo.yakuman) tsuV += ura * (this.pointsAt(tsumo.han + 1, tsumo.fu, true) - tsuV);
      // ippatsu adds roughly +0.1 han on average
      if (ron.valid && !ron.yakuman) ronV *= 1.03;
    }
    this.valueMemo.set(key, ronV);
    this.valueMemo.set(key + 't', tsuV);
    return { ron: ronV, tsumo: tsuV };
  }

  private pointsAt(han: number, fu: number, tsumo: boolean): number {
    const { base } = basePoints(han, fu, 0);
    return totalFor(payments(base, this.ctx.dealer), this.ctx.dealer, tsumo);
  }

  /** Expected number of ura dora (capped to a probability-like factor). */
  private expectedUra(c: number[]): number {
    const ctx = this.ctx;
    let e = 0;
    for (let k = 0; k < 34; k++) {
      const n = c[k] + this.meldTiles(k) + (k === NORTH ? ctx.kita : 0);
      if (!n) continue;
      const ind = indicatorForDora(k);
      if (ind >= 0) e += n * (ctx.unseen[ind] + 0.5) / ctx.unseenTotal;
    }
    return Math.min(1.5, e * Math.max(1, ctx.doraInd.length));
  }

  private meldTiles(k: number): number {
    let n = 0;
    for (const m of this.melds) if (m.kind === k) n += m.type === 'pon' ? 3 : 4;
    return n;
  }

  /** Closed-form tenpai curve. */
  tenpaiCurve(c: number[], policy: RiichiPolicy, furitenOverride?: boolean): Curve & { waits: number[]; waitCount: number; avgValue: number; q: number } {
    const ctx = this.ctx;
    const T = this.T;
    const waits: number[] = [];
    let uDraw = 0, uRon = 0, ev = 0, waitCount = 0;
    let furiten = !!furitenOverride;
    for (const k of SANMA_KINDS) {
      if (c[k] >= 4) continue;
      c[k]++;
      const complete = shanten(c, this.meldCount) === -1;
      if (complete) {
        waits.push(k);
        if (ctx.myDiscardKinds.has(k)) furiten = true;
        const u = ctx.unseen[k];
        waitCount += u;
        if (u > 0) {
          const v = this.winValue(c, k, policy);
          if (v.tsumo > 0) { uDraw += u; ev += u * v.tsumo * 0.45; }
          if (v.ron > 0) { uRon += u; ev += u * v.ron * 0.55; }
        }
      }
      c[k]--;
    }
    const riichi = this.closedHand && (ctx.inRiichi || policy !== 'dama');
    const ronF = furiten ? 0 : riichi ? ctx.ronFactorRiichi : ctx.ronFactorDama;
    const U = ctx.unseenTotal;
    let q = (uDraw + uRon * ronF) / U;
    q = Math.min(0.9, q);
    const totalU = uDraw * 0.45 + uRon * 0.55;
    const avgValue = totalU > 0 ? ev / totalU : 0;
    const p = new Float64Array(T + 1), e = new Float64Array(T + 1);
    for (let k = 1; k <= T; k++) {
      p[k] = q + (1 - q) * p[k - 1];
      e[k] = p[k] * avgValue;
    }
    return { p, e, waits, waitCount, avgValue, q };
  }

  /** Main entry: curve for a 3k+1 hand. */
  curve(c: number[]): Curve {
    const key = countsKey(c);
    const hit = this.memo.get(key);
    if (hit) return hit;
    const s = shanten(c, this.meldCount);
    if (!this.timedOut && (this.states & 63) === 0 && now() > this.deadline) this.timedOut = true;
    let res: Curve;
    if (s === 0) res = this.tenpaiCurve(c, this.opts.policy);
    else if (s > this.opts.maxShantenDP || this.timedOut) res = this.heuristicCurve(c, s);
    else res = this.dpCurve(c, s);
    this.states++;
    this.memo.set(key, res);
    return res;
  }

  private dpCurve(c: number[], s: number): Curve {
    const T = this.T, ctx = this.ctx, U = ctx.unseenTotal, bonus = ctx.winBonus;
    const p = new Float64Array(T + 1), e = new Float64Array(T + 1);
    // collect transitions
    const trans: { q: number; curves: Curve[] }[] = [];
    let qAdv = 0;
    for (const x of SANMA_KINDS) {
      const u = ctx.unseen[x];
      if (u <= 0 || c[x] >= 4) continue;
      c[x]++;
      if (shanten(c, this.meldCount) < s) {
        const curves: Curve[] = [];
        for (const d of SANMA_KINDS) {
          if (c[d] === 0 || d === x) continue;
          c[d]--;
          if (shanten(c, this.meldCount) === s - 1) curves.push(this.curve(c));
          c[d]++;
        }
        if (curves.length) { trans.push({ q: u / U, curves }); qAdv += u / U; }
      }
      c[x]--;
    }
    const stay = Math.max(0, 1 - qAdv);
    for (let k = 1; k <= T; k++) {
      let pk = stay * p[k - 1], ek = stay * e[k - 1];
      for (const t of trans) {
        let bestU = -1, bp = 0, be = 0;
        for (const cv of t.curves) {
          const util = cv.e[k - 1] + bonus * cv.p[k - 1];
          if (util > bestU) { bestU = util; bp = cv.p[k - 1]; be = cv.e[k - 1]; }
        }
        pk += t.q * bp; ek += t.q * be;
      }
      p[k] = pk; e[k] = ek;
    }
    return { p, e };
  }

  /** Approximate curve for deep shanten: chain of advancement stages with decaying rates. */
  heuristicCurve(c: number[], s: number): Curve {
    const ctx = this.ctx, T = this.T;
    let adv = 0;
    for (const x of SANMA_KINDS) {
      const u = ctx.unseen[x];
      if (u <= 0 || c[x] >= 4) continue;
      c[x]++;
      if (shanten(c, this.meldCount) < s) adv += u;
      c[x]--;
    }
    const a0 = adv / ctx.unseenTotal;
    const stages = s + 1;
    const rates: number[] = [];
    for (let j = 0; j < stages; j++) {
      // ukeire typically shrinks as the hand narrows; final stage = waiting
      const r = j === stages - 1 ? Math.min(0.9, 0.11 * (this.closedHand ? 1 + ctx.ronFactorRiichi : 1 + ctx.ronFactorDama)) : a0 * Math.pow(0.7, j);
      rates.push(Math.min(0.95, r));
    }
    const p = new Float64Array(T + 1), e = new Float64Array(T + 1);
    let dist = new Float64Array(stages + 1);
    dist[0] = 1;
    const v = this.roughValue(c);
    for (let k = 1; k <= T; k++) {
      const nd = new Float64Array(stages + 1);
      nd[stages] = dist[stages];
      for (let j = 0; j < stages; j++) {
        nd[j] += dist[j] * (1 - rates[j]);
        nd[j + 1] += dist[j] * rates[j];
      }
      dist = nd;
      p[k] = dist[stages];
      e[k] = p[k] * v;
    }
    return { p, e };
  }

  /** Rough expected win value from visible features (dora, honors, openness). */
  roughValue(c: number[]): number {
    const ctx = this.ctx;
    let dora = ctx.kita + akaFor(ctx, c);
    for (const ind of ctx.doraInd) {
      const d = doraFromIndicator(ind);
      dora += c[d] + this.meldTiles(d) + (d === NORTH ? ctx.kita : 0);
    }
    let yakuHan = 0;
    for (const k of [31, 32, 33, ctx.seatWind, ctx.roundWind]) {
      if (c[k] >= 2 || this.meldTiles(k) >= 3) yakuHan += c[k] >= 3 || this.meldTiles(k) >= 3 ? 1 : 0.4;
    }
    const fu = 30;
    const han = this.closedHand
      ? 1 + 0.45 + 0.35 + yakuHan + dora // riichi + tsumo/ura/pinfu etc.
      : Math.max(yakuHan, 0.8) + dora * 0.95; // open hands need a yaku
    const lo = this.pointsAt(Math.max(1, Math.floor(han)), fu, false);
    const hi = this.pointsAt(Math.max(1, Math.ceil(han)), fu, false);
    const frac = han - Math.floor(han);
    let v = lo + (hi - lo) * frac;
    if (!this.closedHand && yakuHan < 0.5) v *= 0.55; // yaku risk
    return v;
  }
}

export interface DiscardEval {
  kind: number;
  shanten: number;
  ukeire: number;
  ukeireKinds: number[];
  p: number;
  e: number;
  curve: Curve;
}

/** Evaluate all discards from a 3k+2 hand. */
export function evaluateDiscards(ev: Evaluator, c: number[], kinds: Iterable<number>): DiscardEval[] {
  const out: DiscardEval[] = [];
  const T = ev.T;
  for (const d of kinds) {
    if (c[d] === 0) continue;
    c[d]--;
    const s = shanten(c, ev.meldCount);
    const uk: number[] = [];
    let ucount = 0;
    for (const x of SANMA_KINDS) {
      if (c[x] >= 4) continue;
      c[x]++;
      if (shanten(c, ev.meldCount) < s) { uk.push(x); ucount += ev.ctx.unseen[x]; }
      c[x]--;
    }
    const cv = ev.curve(c);
    out.push({ kind: d, shanten: s, ukeire: ucount, ukeireKinds: uk, p: cv.p[T], e: cv.e[T], curve: cv });
    c[d]++;
  }
  return out;
}
