// Decision engine.
//
// 1. Enumerate only LEGAL actions (game/legal.ts).
// 2. For each, build a "plan": my win-probability curve and value (efficiency.ts),
//    the immediate deal-in risk of the discarded tile, the risk of future
//    discards, and whether I can still fold later.
// 3. Run a turn-by-turn race against both opponents (tenpai growth, win hazard,
//    deal-ins, tsumo, ron between opponents, exhaustive draw with noten payments).
// 4. Turn each resulting score outcome into match-level utility with the
//    placement model (P(1st) under the real match-ending rules) and rank.

import { HONBA_RON, HONBA_TSUMO_EACH, type Meld } from '../core/scoring';
import { shanten } from '../core/shanten';
import { NORTH, SANMA_KINDS, isRed, kindOf, redOf, tileLabel, toCounts, type Kind, type TileKey } from '../core/tiles';
import { myLegalActions } from '../game/legal';
import { finishHand } from '../game/match';
import { isMyFuriten, myRonScore, myTsumoScore } from '../game/rules';
import type { HandState, MatchInfo, Seat } from '../game/types';
import { buildCtx, remainingDraws, type EvalCtx, type RiichiPolicy } from './context';
import { Evaluator, type Curve } from './efficiency';
import { dealInProb, modelOpponent, type OpponentModel } from './opponents';
import { placement, utilityOf, type Objective, type PlacementResult } from './placement';
import type { Analysis, Candidate, Mode } from './types';

export interface ModeConfig {
  maxShantenDP: number;
  budgetMs: number;
  sims: number;
}

export const MODES: Record<Mode, ModeConfig> = {
  instant: { maxShantenDP: 2, budgetMs: 80, sims: 250 },
  advanced: { maxShantenDP: 3, budgetMs: 900, sims: 1000 },
  max: { maxShantenDP: 4, budgetMs: 5000, sims: 3000 },
};

interface Plan {
  kind: Candidate['kind'];
  tile?: TileKey;
  callKind?: Kind;
  label: string;
  curve: Curve | null; // null = folding (no offense)
  T: number;
  avgValue: number;
  tsumoShare: number;
  immediate: [number, number, number];
  /** per-opponent danger factor of future pushing discards (multiplied by tenpai) */
  pushDanger: [number, number, number];
  /** fold: wait-probability of the j-th safest remaining tile, per opponent seat */
  foldDanger?: [number, number, number][];
  riichi: boolean;
  tenpaiNow: boolean;
  shanten: number;
  ukeire?: number;
  waits?: Kind[];
  extraNotes?: string[];
  /** value multiplier for opponents (kan dora) */
  oppValueMul?: number;
}

interface Outcome { p: number; d: [number, number, number]; renchan: boolean; won: boolean; mine: number }

const OPP: Seat[] = [1, 2];

/**
 * A certain win is preferred unless declining it is clearly better for
 * placement (e.g. a cheap win that would end the match in 2nd). Guards
 * against model noise talking us out of a real win.
 */
const WIN_BIAS = 0.04;

function avgDangerOfDraws(ctx: EvalCtx, m: OpponentModel): number {
  let s = 0;
  for (const k of SANMA_KINDS) if (!m.safe.has(k)) s += ctx.unseen[k] * m.waitProb[k];
  return s / ctx.unseenTotal;
}

/** Remaining hand tiles ordered safest-first, with each opponent's wait probability. */
function foldSequence(hand: TileKey[], models: OpponentModel[]): [number, number, number][] {
  return hand.map(t => {
    const k = kindOf(t);
    const w = models.map(m => (m.safe.has(k) ? 0 : m.waitProb[k]));
    return { combined: dealInProb(models[0], k) + dealInProb(models[1], k), w: [0, w[0], w[1]] as [number, number, number] };
  }).sort((a, b) => a.combined - b.combined).map(x => x.w);
}

interface RaceResult { outcomes: Outcome[]; pWin: number; pDealIn: number }

/** Build the outcome distribution of a plan via a turn-by-turn race. */
function race(st: HandState, plan: Plan, models: OpponentModel[]): RaceResult {
  const m = st.match;
  const honba = m.honba;
  const kyo = (m.kyotaku + (plan.riichi ? 1 : 0)) * 1000;
  const iAmDealer = m.dealer === 0;
  const outcomes: Outcome[] = [];
  const T = plan.T;
  const mod = (s: Seat) => models[s - 1];
  // opponent dynamic tenpai: grows each turn toward 1
  const tenp = (s: Seat, j: number) => {
    const mm = mod(s);
    if (mm.riichi) return 1;
    return 1 - (1 - mm.tenpai) * Math.pow(0.93, j);
  };
  const oppFoldFactor = plan.riichi ? 0.7 : 1;
  let alive = 1;
  let pMeWin = 0;
  const pDealIn = [0, 0, 0];
  const pOppTsumo = [0, 0, 0];
  const pOppRonOpp = [0, 0, 0]; // indexed by winner
  // immediate deal-in on the action's tile
  for (const s of OPP) {
    const p = alive * plan.immediate[s];
    pDealIn[s] += p;
  }
  alive -= plan.immediate[1] + plan.immediate[2];
  alive = Math.max(0, alive);
  let prevP = 0;
  for (let j = 1; j <= Math.max(T, 1); j++) {
    // opponents' turns
    for (const s of OPP) {
      const mm = mod(s);
      const h = tenp(s, j) * mm.hazard * (mm.riichi ? 1 : oppFoldFactor);
      const win = alive * h;
      pOppTsumo[s] += win * 0.5;
      pOppRonOpp[s] += win * 0.5;
      alive -= win;
    }
    if (j > T) break;
    // my draw: win?
    if (plan.curve) {
      const pj = plan.curve.p[Math.min(j, plan.curve.p.length - 1)];
      const hz = prevP < 1 ? Math.max(0, (pj - prevP) / (1 - prevP)) : 0;
      prevP = pj;
      const w = alive * hz;
      pMeWin += w;
      alive -= w;
    }
    // my discard: deal-in risk
    for (const s of OPP) {
      const fd = plan.foldDanger ? (plan.foldDanger[j - 1]?.[s] ?? 0.05) : 0;
      const dz = tenp(s, j) * (plan.curve ? plan.pushDanger[s] : fd);
      const p = alive * Math.min(0.5, dz);
      pDealIn[s] += p;
      alive -= p;
    }
  }
  alive = Math.max(0, alive);

  const meVal = Math.round(plan.avgValue / 100) * 100;
  // my wins: tsumo / ron from each opponent
  if (pMeWin > 0 && meVal > 0) {
    const tShare = plan.tsumoShare;
    // tsumo with tsumo loss
    {
      const d: [number, number, number] = [0, 0, 0];
      const b = meVal / (iAmDealer ? 6 : 4);
      for (const s of OPP) {
        const pay = Math.ceil((iAmDealer || s === m.dealer ? 2 * b : b) / 100) * 100 + HONBA_TSUMO_EACH * honba;
        d[s] -= pay; d[0] += pay;
      }
      d[0] += kyo;
      outcomes.push({ p: pMeWin * tShare, d, renchan: iAmDealer, won: true, mine: d[0] });
    }
    for (const s of OPP) {
      const d: [number, number, number] = [0, 0, 0];
      const pay = meVal + HONBA_RON * honba;
      d[s] -= pay; d[0] += pay + kyo;
      outcomes.push({ p: pMeWin * (1 - tShare) / 2, d, renchan: iAmDealer, won: true, mine: d[0] });
    }
  } else if (pMeWin > 0) {
    alive += pMeWin;
  }
  for (const s of OPP) {
    const mm = mod(s);
    const v = Math.round(mm.ronValue * (plan.oppValueMul ?? 1) / 100) * 100;
    const oppDealer = m.dealer === s;
    const other = (3 - s) as Seat;
    // deal-in by me
    if (pDealIn[s] > 0) {
      const d: [number, number, number] = [0, 0, 0];
      const pay = v + HONBA_RON * honba;
      d[0] -= pay; d[s] += pay + kyo;
      outcomes.push({ p: pDealIn[s], d, renchan: oppDealer, won: true, mine: d[0] });
    }
    // tsumo
    if (pOppTsumo[s] > 0) {
      const d: [number, number, number] = [0, 0, 0];
      const b = v / (oppDealer ? 6 : 4);
      for (const payer of [0, other] as Seat[]) {
        const pay = Math.ceil((oppDealer || payer === m.dealer ? 2 * b : b) / 100) * 100 + HONBA_TSUMO_EACH * honba;
        d[payer] -= pay; d[s] += pay;
      }
      d[s] += kyo;
      outcomes.push({ p: pOppTsumo[s], d, renchan: oppDealer, won: true, mine: d[0] });
    }
    // ron from the other opponent
    if (pOppRonOpp[s] > 0) {
      const d: [number, number, number] = [0, 0, 0];
      const pay = v + HONBA_RON * honba;
      d[other] -= pay; d[s] += pay + kyo;
      outcomes.push({ p: pOppRonOpp[s], d, renchan: oppDealer, won: true, mine: 0 });
    }
  }
  // exhaustive draw
  if (alive > 0) {
    let meT: number;
    if (!plan.curve) meT = plan.tenpaiNow ? 0.15 : 0;
    else if (plan.tenpaiNow) meT = 0.92;
    else meT = [0.92, 0.6, 0.3, 0.12, 0.05, 0.02, 0.01][Math.min(6, plan.shanten)];
    const t1 = tenp(1, T), t2 = tenp(2, T);
    for (const a of [true, false]) for (const b1 of [true, false]) for (const c of [true, false]) {
      const p = alive * (a ? meT : 1 - meT) * (b1 ? t1 : 1 - t1) * (c ? t2 : 1 - t2);
      if (p < 1e-6) continue;
      const tp = [a, b1, c];
      const n = tp.filter(Boolean).length;
      const d: [number, number, number] = [0, 0, 0];
      if (n === 1 || n === 2) for (let i = 0; i < 3; i++) d[i] = tp[i] ? (n === 1 ? 2000 : 1000) : (n === 1 ? -1000 : -2000);
      outcomes.push({ p, d, renchan: tp[m.dealer], won: false, mine: d[0] });
    }
  }
  return { outcomes, pWin: meVal > 0 ? pMeWin : 0, pDealIn: pDealIn[1] + pDealIn[2] };
}

function evalOutcomes(m: MatchInfo, plan: Plan, outs: Outcome[], sims: number, objective: Objective) {
  const base: MatchInfo = plan.riichi
    ? { ...m, scores: [m.scores[0] - 1000, m.scores[1], m.scores[2]], kyotaku: m.kyotaku + 1 }
    : m;
  let u = 0, p1 = 0, p3 = 0, ev = 0, tot = 0;
  for (const o of outs) {
    const s = finishHand(base, o.d, o.renchan, o.won);
    const pl = placement(s.next, sims, s.ended);
    u += o.p * utilityOf(pl, objective);
    p1 += o.p * pl.ranks[0];
    p3 += o.p * pl.ranks[2];
    ev += o.p * o.mine;
    tot += o.p;
  }
  if (tot <= 0) return { u: 0, p1: 0, p3: 0, ev: 0 };
  return { u: u / tot, p1: p1 / tot, p3: p3 / tot, ev: ev / tot - (plan.riichi ? 1000 : 0) };
}

function deterministicWin(m: MatchInfo, d: [number, number, number], renchan: boolean, sims: number, objective: Objective) {
  const s = finishHand(m, d, renchan, true);
  const pl: PlacementResult = placement(s.next, sims, s.ended);
  return { u: utilityOf(pl, objective), p1: pl.ranks[0], p3: pl.ranks[2], ended: s.ended };
}

export interface AnalyzeOptions {
  mode: Mode;
  objective: Objective;
  id?: number;
}

function removeTiles(hand: TileKey[], kind: Kind, n: number): TileKey[] {
  const h = [...hand];
  for (let i = 0; i < n; i++) {
    let idx = h.indexOf(kind);
    if (idx < 0) idx = h.indexOf(redOf(kind) as TileKey);
    if (idx >= 0) h.splice(idx, 1);
  }
  return h;
}

export function analyze(st: HandState, opt: AnalyzeOptions): Analysis {
  const t0 = performance.now();
  const cfg = MODES[opt.mode];
  const models = [modelOpponent(st, 1), modelOpponent(st, 2)];
  const danger = new Array(34).fill(0);
  for (const k of SANMA_KINDS) for (const mm of models) danger[k] += dealInProb(mm, k);
  const now = placement(st.match, cfg.sims);
  const base: Omit<Analysis, 'candidates' | 'confidence' | 'situation' | 'shanten'> = {
    id: opt.id ?? 0, mode: opt.mode, stage: 'final', ms: 0, danger,
    opponents: models.map(m => ({ seat: m.seat, tenpai: m.tenpai, value: m.ronValue, riichi: m.riichi, notes: m.notes })),
    notes: [],
    placementNow: { pFirst: now.ranks[0], pSecond: now.ranks[1], pThird: now.ranks[2] },
  };
  const counts = toCounts(st.myHand);
  const me = st.players[0];
  const myMelds = me.melds.length;
  const hs = st.phase === 'play' ? shanten(counts, myMelds) : 8;

  if (st.phase !== 'play') {
    return { ...base, candidates: [], confidence: 0, situation: 'idle', shanten: hs, ms: performance.now() - t0 };
  }
  const legal = myLegalActions(st);
  const ctx = buildCtx(st);
  const notes: string[] = [];
  const plans: Plan[] = [];
  const fixed: Candidate[] = [];
  const pushDangerFor = (hand: TileKey[], tenpai: boolean): [number, number, number] => {
    const out: [number, number, number] = [0, 0, 0];
    for (const s of OPP) {
      const mm = models[s - 1];
      const drawAvg = avgDangerOfDraws(ctx, mm);
      if (tenpai) { out[s] = drawAvg; continue; }
      let handAvg = 0;
      for (const t of hand) handAvg += mm.safe.has(kindOf(t)) ? 0 : mm.waitProb[kindOf(t)];
      handAvg /= Math.max(1, hand.length);
      out[s] = 0.5 * drawAvg + 0.5 * handAvg;
    }
    return out;
  };
  const immediateFor = (k: Kind): [number, number, number] => [0, dealInProb(models[0], k), dealInProb(models[1], k)];
  const anyThreat = models.some(m => m.tenpai > 0.45);

  const makeEvaluator = (policy: RiichiPolicy, melds: Meld[] = me.melds, turns = ctx.turns, extra?: Partial<EvalCtx>) => {
    const c2: EvalCtx = { ...ctx, turns, melds, ...extra };
    return new Evaluator(c2, { maxShantenDP: cfg.maxShantenDP, budgetMs: cfg.budgetMs, policy }, melds);
  };

  /** Plans for discarding each tile from a 3k+2 hand `hand`. */
  const discardPlans = (hand: TileKey[], allowed: TileKey[], melds: Meld[], turns: number, kindLabel: 'discard' | 'pon', ponKind?: Kind) => {
    const closed = melds.every(m => m.type === 'ankan');
    const ev = makeEvaluator(closed ? 'auto' : 'dama', melds, turns, {
      redP: hand.includes(34), redS: hand.includes(35),
      meldReds: melds.reduce((a, m) => a + m.reds, 0),
    });
    const c = toCounts(hand);
    const res: Plan[] = [];
    for (const tile of allowed) {
      const k = kindOf(tile);
      // keep red fives: when both red and normal exist the normal one is listed separately
      const after = [...hand];
      after.splice(after.indexOf(tile), 1);
      const evx = isRed(tile) ? makeEvaluator(closed ? 'auto' : 'dama', melds, turns, { redP: after.includes(34), redS: after.includes(35), meldReds: melds.reduce((a, m) => a + m.reds, 0) }) : ev;
      c[k]--;
      const s = shanten(c, melds.length);
      const cv = evx.curve(c);
      let uk = 0;
      for (const x of SANMA_KINDS) {
        if (c[x] >= 4) continue;
        c[x]++;
        if (shanten(c, melds.length) < s) uk += ctx.unseen[x];
        c[x]--;
      }
      const tenpai = s === 0;
      const label = kindLabel === 'pon' ? `ポン ${tileLabel(ponKind!)} → ${tileLabel(tile)}切り` : `${tileLabel(tile)}切り`;
      if (tenpai) {
        const dama = evx.tenpaiCurve(c, 'dama');
        // discarding one of my own waits makes the hand furiten
        const furiten = st.myFuritenRiichi || dama.waits.some(w => ctx.myDiscardKinds.has(w) || w === k);
        const damaCurve = furiten ? evx.tenpaiCurve(c, 'dama', true) : dama;
        res.push({
          kind: kindLabel === 'pon' ? 'pon' : 'discard', tile, callKind: ponKind, label: closed && legal.riichiDiscards.includes(tile) ? `${label}（ダマ）` : label,
          curve: damaCurve, T: turns, avgValue: damaCurve.avgValue, tsumoShare: 0.4,
          immediate: immediateFor(k), pushDanger: pushDangerFor(after, true), riichi: false, tenpaiNow: true, shanten: 0,
          ukeire: dama.waitCount, waits: dama.waits,
          extraNotes: dama.avgValue === 0 ? ['役なし：ロン和了不可'] : furiten ? ['フリテン'] : [],
        });
        if (kindLabel === 'discard' && closed && legal.riichiDiscards.includes(tile)) {
          const rc = evx.tenpaiCurve(c, 'riichi', furiten);
          res.push({
            kind: 'riichi', tile, label: `リーチ（${tileLabel(tile)}切り）`, curve: rc, T: turns, avgValue: rc.avgValue, tsumoShare: 0.47,
            immediate: immediateFor(k), pushDanger: pushDangerFor(after, true), riichi: true, tenpaiNow: true, shanten: 0,
            ukeire: rc.waitCount, waits: rc.waits, extraNotes: furiten ? ['フリテンリーチ（ツモのみ）'] : [],
          });
        }
      } else {
        res.push({
          kind: kindLabel === 'pon' ? 'pon' : 'discard', tile, callKind: ponKind, label,
          curve: cv, T: turns, avgValue: cv.p[turns] > 0 ? cv.e[turns] / cv.p[turns] : 0, tsumoShare: closed ? 0.42 : 0.35,
          immediate: immediateFor(k), pushDanger: pushDangerFor(after, false), riichi: false, tenpaiNow: false, shanten: s, ukeire: uk,
        });
      }
      c[k]++;
    }
    if (ev.timedOut) notes.push('深い探索が時間上限に達したため、一部は近似評価です。');
    return res;
  };

  const foldPlan = (hand: TileKey[], allowed: TileKey[], label = 'ベタオリ'): Plan | null => {
    if (!anyThreat) return null;
    let best: TileKey | null = null, bestD = Infinity;
    for (const t of allowed) {
      const k = kindOf(t);
      const d = dealInProb(models[0], k) + dealInProb(models[1], k);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best === null) return null;
    const rest = [...hand];
    rest.splice(rest.indexOf(best), 1);
    const seq = foldSequence(rest, models);
    const k = kindOf(best);
    const c = toCounts(rest);
    return {
      kind: 'fold', tile: best, label: `${label}：${tileLabel(best)}切り（最も安全）`, curve: null, T: ctx.turns, avgValue: 0, tsumoShare: 0,
      immediate: immediateFor(k), pushDanger: [0, 0, 0], foldDanger: seq, riichi: false,
      tenpaiNow: shanten(c, myMelds) === 0, shanten: shanten(c, myMelds),
    };
  };

  let situation: Analysis['situation'] = 'idle';

  if (st.turn === 0 && st.stage === 'discard') {
    situation = 'my-turn';
    // --- tsumo ---
    const ts = legal.tsumo ? myTsumoScore(st) : null;
    if (ts) {
      const m = st.match;
      const d: [number, number, number] = [0, 0, 0];
      for (const s of OPP) {
        const pay = (m.dealer === 0 ? ts.tsumoFromNonDealer : s === m.dealer ? ts.tsumoFromDealer : ts.tsumoFromNonDealer) + HONBA_TSUMO_EACH * m.honba;
        d[s] -= pay; d[0] += pay;
      }
      d[0] += m.kyotaku * 1000;
      const r = deterministicWin(m, d, m.dealer === 0, cfg.sims, opt.objective);
      fixed.push({
        kind: 'tsumo', label: `ツモ！ ${ts.yakuman ? '' : `${ts.han}翻${ts.fu}符`} ${ts.limitName}（+${d[0]}点）`, utility: r.u + WIN_BIAS, pFirst: r.p1, pLast: r.p3,
        evPoints: d[0], winProb: 1, winValue: d[0], immediateRisk: 0, totalDealIn: 0,
        reason: `${ts.yaku.map(y => `${y.name}${y.yakuman ? '' : ` ${y.han}翻`}`).join('・')}${r.ended ? '（この和了で終局）' : ''}`,
      });
    }
    plans.push(...discardPlans(st.myHand, legal.discards, me.melds, ctx.turns, 'discard'));
    const fp = foldPlan(st.myHand, legal.discards);
    if (fp && !me.riichi) plans.push(fp);
    // --- kita ---
    if (legal.kita) {
      const after = removeTiles(st.myHand, NORTH, 1);
      const ev = makeEvaluator(me.melds.every(m => m.type === 'ankan') ? 'auto' : 'dama', me.melds, ctx.turns + 1, { kita: ctx.kita + 1 });
      const c = toCounts(after);
      const cv = ev.curve(c);
      const s = shanten(c, myMelds);
      const robRisk = models.reduce((a, mm) => a + dealInProb(mm, NORTH) * 0.3, 0);
      plans.push({
        kind: 'kita', callKind: NORTH, label: '北抜き', curve: cv, T: ctx.turns + 1,
        avgValue: cv.p[ctx.turns + 1] > 0 ? cv.e[ctx.turns + 1] / cv.p[ctx.turns + 1] : 0, tsumoShare: 0.45,
        immediate: [0, robRisk / 2, robRisk / 2], pushDanger: pushDangerFor(after, s === 0), riichi: false, tenpaiNow: s === 0, shanten: s,
        extraNotes: ['抜きドラ+1・嶺上牌をツモ・打牌なし'],
      });
    }
    // --- ankan / kakan ---
    for (const k of [...legal.ankan, ...legal.kakan]) {
      const isAn = legal.ankan.includes(k);
      const after = removeTiles(st.myHand, k, isAn ? 4 : 1);
      const newMelds: Meld[] = isAn ? [...me.melds, { type: 'ankan', kind: k, reds: 0 }] : me.melds.map(m => m.kind === k ? { ...m, type: 'kakan' as const } : m);
      const ev = makeEvaluator(newMelds.every(m => m.type === 'ankan') ? 'auto' : 'dama', newMelds, ctx.turns + 1);
      const c = toCounts(after);
      const cv = ev.curve(c);
      const s = shanten(c, newMelds.length);
      const chankan = isAn ? 0 : models.reduce((a, mm) => a + dealInProb(mm, k), 0);
      plans.push({
        kind: isAn ? 'ankan' : 'kakan', callKind: k, label: `${isAn ? '暗槓' : '加槓'} ${tileLabel(k)}`, curve: cv, T: ctx.turns + 1,
        avgValue: cv.p[ctx.turns + 1] > 0 ? cv.e[ctx.turns + 1] / cv.p[ctx.turns + 1] : 0, tsumoShare: 0.45,
        immediate: [0, chankan / 2, chankan / 2], pushDanger: pushDangerFor(after, s === 0), riichi: false, tenpaiNow: s === 0, shanten: s,
        oppValueMul: 1.08, extraNotes: ['新ドラ（カンドラ）は全員に有効'],
      });
    }
  } else if (st.pendingRon || (st.lastDiscard && st.lastDiscard.seat !== 0)) {
    situation = 'call';
    const pr = st.pendingRon;
    if (legal.ron && pr) {
      const sc = myRonScore(st, pr.tile, pr.kind === 'chankan', pr.kind === 'kita')!;
      const m = st.match;
      const d: [number, number, number] = [0, 0, 0];
      const pay = sc.ron + HONBA_RON * m.honba;
      d[pr.seat] -= pay; d[0] += pay + m.kyotaku * 1000;
      const r = deterministicWin(m, d, m.dealer === 0, cfg.sims, opt.objective);
      fixed.push({
        kind: 'ron', label: `ロン！ ${sc.yakuman ? '' : `${sc.han}翻${sc.fu}符`} ${sc.limitName}（+${d[0]}点）`, utility: r.u + WIN_BIAS, pFirst: r.p1, pLast: r.p3,
        evPoints: d[0], winProb: 1, winValue: d[0], immediateRisk: 0, totalDealIn: 0,
        reason: `${sc.yaku.map(y => `${y.name}${y.yakuman ? '' : ` ${y.han}翻`}`).join('・')}${r.ended ? '（この和了で終局）' : ''}`,
      });
    } else if (pr && !legal.ron && myRonScore(st, pr.tile, pr.kind === 'chankan', pr.kind === 'kita') && isMyFuriten(st)) {
      notes.push('和了牌ですがフリテンのためロンできません。');
    }
    // pass: keep the 13-tile hand
    const passTurns = remainingDraws(st.wall, st.turn === 1 ? 1 : 0);
    {
      const closed = me.melds.every(m => m.type === 'ankan');
      const ev = makeEvaluator(me.riichi ? 'riichi' : closed ? 'auto' : 'dama', me.melds, passTurns);
      const c = toCounts(st.myHand);
      const s = shanten(c, myMelds);
      // passing a winning tile in riichi = permanent furiten
      const furiten = st.myFuritenRiichi || (me.riichi && legal.ron);
      const cv = s === 0 ? ev.tenpaiCurve(c, me.riichi ? 'riichi' : closed ? 'auto' : 'dama', furiten) : ev.curve(c);
      plans.push({
        kind: 'pass', label: legal.ron ? '見逃し（ロンしない）' : '鳴かない（スルー）', curve: cv, T: passTurns,
        avgValue: cv.p[passTurns] > 0 ? cv.e[passTurns] / cv.p[passTurns] : 0, tsumoShare: 0.45,
        immediate: [0, 0, 0], pushDanger: pushDangerFor(st.myHand, s === 0), riichi: false, tenpaiNow: s === 0, shanten: s,
      });
    }
    // pon / daiminkan
    const ld = st.lastDiscard;
    if (ld && (legal.pon || legal.daiminkan)) {
      const k = kindOf(ld.tile);
      const wallAfter = st.wall + (ld.seat === 1 ? 1 : 0);
      const ponTurns = remainingDraws(wallAfter, 2);
      if (legal.pon) {
        const hand = removeTiles(st.myHand, k, 2);
        const melds: Meld[] = [...me.melds, { type: 'pon', kind: k, reds: 0, from: ld.seat }];
        const allowed = [...new Set(hand)].filter(t => kindOf(t) !== k);
        if (allowed.length) plans.push(...discardPlans(hand, allowed, melds, ponTurns, 'pon', k));
      }
      if (legal.daiminkan) {
        const hand = removeTiles(st.myHand, k, 3);
        const melds: Meld[] = [...me.melds, { type: 'minkan', kind: k, reds: 0, from: ld.seat }];
        const ev = makeEvaluator('dama', melds, ponTurns + 1);
        const c = toCounts(hand);
        const cv = ev.curve(c);
        const s = shanten(c, melds.length);
        plans.push({
          kind: 'daiminkan', callKind: k, label: `大明槓 ${tileLabel(k)}`, curve: cv, T: ponTurns + 1,
          avgValue: cv.p[ponTurns + 1] > 0 ? cv.e[ponTurns + 1] / cv.p[ponTurns + 1] : 0, tsumoShare: 0.4,
          immediate: [0, 0, 0], pushDanger: pushDangerFor(hand, s === 0), riichi: false, tenpaiNow: s === 0, shanten: s,
          oppValueMul: 1.08, extraNotes: ['門前が崩れる・新ドラは全員に有効'],
        });
      }
    }
  } else {
    return {
      ...base, candidates: [], confidence: 0, situation: 'idle', shanten: hs, ms: performance.now() - t0,
      notes: st.turn === 0 && st.stage === 'draw' ? ['ツモった牌を入力してください。'] : ['相手の行動を待っています。'],
    };
  }

  // --- evaluate plans through the race + placement model ---
  const cands: Candidate[] = [...fixed];
  for (const plan of plans) {
    const { outcomes, pWin, pDealIn: pDeal } = race(st, plan, models);
    const r = evalOutcomes(st.match, plan, outcomes, cfg.sims, opt.objective);
    const imm = plan.immediate[1] + plan.immediate[2];
    cands.push({
      kind: plan.kind, tile: plan.tile, callKind: plan.callKind, label: plan.label,
      utility: r.u, pFirst: r.p1, pLast: r.p3, evPoints: r.ev, winProb: pWin, winValue: plan.avgValue,
      immediateRisk: imm, totalDealIn: pDeal, shanten: plan.shanten, ukeire: plan.ukeire, waits: plan.waits,
      reason: reasonFor(plan, pWin, imm, models, plan.extraNotes),
    });
  }
  // stable ordering: utility, then EV, then lower risk
  cands.sort((a, b) => b.utility - a.utility || b.evPoints - a.evPoints || a.immediateRisk - b.immediateRisk);
  const confidence = confidenceOf(cands, notes.length > 0, opt.mode);
  if (me.riichi) notes.push('リーチ中：ツモ切り・ツモ／ロン・北抜き・待ちが変わらない暗槓のみ可能です。');
  if (isMyFuriten(st)) notes.push('フリテンです（ロン不可、ツモ和了は可）。');
  return {
    ...base, candidates: cands, confidence, situation, shanten: hs, notes: [...notes],
    ms: performance.now() - t0,
  };
}

function reasonFor(plan: Plan, pWin: number, imm: number, models: OpponentModel[], extra?: string[]): string {
  const parts: string[] = [];
  if (plan.kind === 'fold') parts.push('守備：和了の見込みが薄く、相手の脅威が大きい');
  else if (plan.shanten === 0) parts.push(`聴牌${plan.waits?.length ? `（${plan.waits.map(tileLabel).join('・')}待ち）` : ''} 残り${plan.ukeire ?? 0}枚`);
  else parts.push(plan.ukeire !== undefined ? `${plan.shanten}向聴・受け入れ${plan.ukeire}枚` : `${plan.shanten}向聴`);
  if (plan.curve) parts.push(`和了率${(pWin * 100).toFixed(0)}%・打点約${Math.round(plan.avgValue)}点`);
  if (imm > 0.005) {
    const who = models.filter(m => m.tenpai > 0.3).map(m => (m.seat === 1 ? '下家' : '上家')).join('/');
    parts.push(`この打牌の放銃率${(imm * 100).toFixed(1)}%${who ? `（${who}）` : ''}`);
  } else if (models.some(m => m.tenpai > 0.4)) parts.push('現状安全牌');
  if (plan.riichi) parts.push('1翻＋裏ドラ期待・手牌固定');
  if (extra?.length) parts.push(...extra);
  return parts.join(' · ');
}

function confidenceOf(c: Candidate[], approximated: boolean, mode: Mode): number {
  if (c.length < 2) return 0.97;
  const gap = c[0].utility - c[1].utility;
  // utility units are P(1st); a 1% gap is decisive, 0.1% is a coin flip
  let conf = 0.5 + 0.48 * Math.tanh(gap / 0.006);
  if (approximated) conf *= 0.9;
  if (mode === 'instant') conf *= 0.92;
  return Math.max(0.3, Math.min(0.99, conf));
}
