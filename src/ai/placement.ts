// Placement model: Monte Carlo simulation of the remainder of the match under
// the real sanma ranked match rules (sudden-death South extension, bankruptcy,
// agari-yame, deposits, tie-breaks). Converts any post-hand score situation into
// P(1st/2nd/3rd) and expected final points for me (seat 0).
// Common random numbers (fixed seed) make comparisons between actions low-noise.

import { rankSeats } from '../game/match';
import { RETURN_POINTS, TARGET_POINTS, UMA, type MatchInfo, type Seat } from '../game/types';

export type Objective = 'top' | 'rank';

export interface PlacementResult {
  ranks: [number, number, number]; // P(me 1st), P(2nd), P(3rd)
  expPoints: number; // expected (score-35000)/1000 + uma
}

const RON_TABLE: [number, number][] = [
  [1000, 0.03], [1300, 0.02], [2000, 0.08], [2600, 0.08], [3900, 0.12], [5200, 0.08], [6400, 0.05],
  [7700, 0.06], [8000, 0.24], [12000, 0.14], [16000, 0.07], [24000, 0.025], [32000, 0.015],
];
const CUM: number[] = [];
{
  const tot = RON_TABLE.reduce((a, b) => a + b[1], 0);
  let acc = 0;
  for (const [, w] of RON_TABLE) { acc += w / tot; CUM.push(acc); }
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ceil100 = (x: number) => Math.ceil(x / 100) * 100;

export const P_DRAW = 0.13;
export const P_TSUMO = 0.42;

/** Simulate to the end of the match; returns final scores (deposits awarded) and ranks. */
function simulate(m0: MatchInfo, rnd: () => number): { final: number[]; ranks: Seat[] } {
  const s = [...m0.scores];
  let dealer = m0.dealer;
  let hand = m0.handNumber as number;
  let wind = m0.roundWind as number;
  let honba = m0.honba, kyotaku = m0.kyotaku;
  const initial = m0.initialDealer;
  for (let guard = 0; guard < 40; guard++) {
    let renchan = false;
    const r = rnd();
    if (r < P_DRAW) {
      const t = [rnd() < 0.45, rnd() < 0.45, rnd() < 0.45];
      const n = t.filter(Boolean).length;
      if (n === 1 || n === 2) for (let i = 0; i < 3; i++) s[i] += t[i] ? (n === 1 ? 2000 : 1000) : (n === 1 ? -1000 : -2000);
      renchan = t[dealer];
      honba++;
    } else {
      const wr = rnd() * 3.15;
      const winner = (wr < 1.15 ? dealer : wr < 2.15 ? (dealer + 1) % 3 : (dealer + 2) % 3) as Seat;
      const vr = rnd();
      let idx = 0;
      while (CUM[idx] < vr) idx++;
      const v = RON_TABLE[idx][0];
      const isDealer = winner === dealer;
      if (rnd() < P_TSUMO) {
        const b = v / 4;
        for (let i = 0; i < 3; i++) {
          if (i === winner) continue;
          const pay = (isDealer ? ceil100(2 * b) : i === dealer ? ceil100(2 * b) : ceil100(b)) + 500 * honba;
          s[i] -= pay; s[winner] += pay;
        }
      } else {
        const loser = (winner + (rnd() < 0.5 ? 1 : 2)) % 3;
        const pay = (isDealer ? ceil100(v * 1.5) : v) + 1000 * honba;
        s[loser] -= pay; s[winner] += pay;
      }
      s[winner] += kyotaku * 1000;
      kyotaku = 0;
      renchan = isDealer;
      honba = renchan ? honba + 1 : 0;
    }
    // --- match progression (mirrors game/match.ts) ---
    if (s[0] < 0 || s[1] < 0 || s[2] < 0) break;
    const ranks = rankSeats(s, initial);
    const top = s[ranks[0]];
    const late = wind === 1 || hand === 3;
    if (renchan) {
      if (late && ranks[0] === dealer && s[dealer] >= TARGET_POINTS) break;
      continue;
    }
    if (wind === 1 && top >= TARGET_POINTS) break;
    hand++;
    if (hand > 3) {
      if (wind === 1 || top >= TARGET_POINTS) break;
      wind = 1; hand = 1;
    }
    dealer = ((initial + hand - 1) % 3) as Seat;
  }
  const ranks = rankSeats(s, initial);
  s[ranks[0]] += kyotaku * 1000;
  return { final: s, ranks };
}

const cache = new Map<string, PlacementResult>();

export function placement(m: MatchInfo, sims: number, ended = false): PlacementResult {
  if (ended) {
    const ranks = rankSeats(m.scores, m.initialDealer);
    const final = [...m.scores];
    final[ranks[0]] += m.kyotaku * 1000;
    const r: [number, number, number] = [0, 0, 0];
    const pos = ranks.indexOf(0);
    r[pos] = 1;
    return { ranks: r, expPoints: (final[0] - RETURN_POINTS) / 1000 + UMA[pos] };
  }
  const key = `${m.scores.map(x => Math.round(x / 100)).join(',')}|${m.roundWind}${m.handNumber}|${m.dealer}${m.initialDealer}|${m.honba}|${m.kyotaku}|${sims}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rnd = mulberry32(0x5eed1234);
  const r: [number, number, number] = [0, 0, 0];
  let pts = 0;
  for (let i = 0; i < sims; i++) {
    const { final, ranks } = simulate(m, rnd);
    const pos = ranks.indexOf(0);
    r[pos]++;
    pts += (final[0] - RETURN_POINTS) / 1000 + UMA[pos];
  }
  const res: PlacementResult = { ranks: [r[0] / sims, r[1] / sims, r[2] / sims], expPoints: pts / sims };
  if (cache.size > 5000) cache.clear();
  cache.set(key, res);
  return res;
}

export function utilityOf(p: PlacementResult, objective: Objective): number {
  if (objective === 'rank') return p.expPoints / 100 + p.ranks[0] * 0.05;
  // maximise P(1st); tiny tie-breaker toward avoiding last
  return p.ranks[0] + 0.03 * (p.ranks[1] - p.ranks[2]);
}
