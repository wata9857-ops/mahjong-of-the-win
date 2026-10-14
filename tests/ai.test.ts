import { describe, expect, it } from 'vitest';
import { analyze } from '../src/ai/decide';
import { buildCtx } from '../src/ai/context';
import { Evaluator } from '../src/ai/efficiency';
import { modelOpponent, waitDistribution } from '../src/ai/opponents';
import { placement } from '../src/ai/placement';
import { kindOf, parseTiles, toCounts } from '../src/core/tiles';
import { myLegalActions } from '../src/game/legal';
import { newMatch } from '../src/game/match';
import type { GameEvent } from '../src/game/types';
import { T, stateFrom } from './helpers';

const best = (a: ReturnType<typeof analyze>) => a.candidates[0];

describe('recommendations', () => {
  it('discards the isolated honor from a good 1-shanten hand', () => {
    const { st } = stateFrom('123456p789p23s5s7z', [{ t: 'draw', tile: T('6s') }]);
    const a = analyze(st, { mode: 'advanced', objective: 'top' });
    expect(best(a).tile).toBe(T('C'));
  });
  it('declares Tsumo when complete', () => {
    const { st } = stateFrom('123456p789p23s55s', [{ t: 'draw', tile: T('4s') }]);
    const a = analyze(st, { mode: 'instant', objective: 'top' });
    expect(best(a).kind).toBe('tsumo');
  });
  it('only recommends legal actions', () => {
    const { st } = stateFrom('19m159p159s1357z', [{ t: 'draw', tile: T('2p') }]);
    const legal = myLegalActions(st);
    const a = analyze(st, { mode: 'advanced', objective: 'top' });
    for (const c of a.candidates) {
      if (c.kind === 'discard' || c.kind === 'fold') expect(legal.discards).toContain(c.tile);
      if (c.kind === 'riichi') expect(legal.riichiDiscards).toContain(c.tile);
    }
  });
  it('riichi with a good early ryanmen tenpai and no yaku', () => {
    // tenpai after discarding E: 123p 456p 789s 23s 99s (no yaku without riichi; dama only tsumo)
    const { st } = stateFrom('123p456p789s23s99s', [{ t: 'draw', tile: T('E') }]);
    const a = analyze(st, { mode: 'advanced', objective: 'top' });
    expect(best(a).kind).toBe('riichi');
    expect(best(a).tile).toBe(T('E'));
  });
  it('recommends Kita for a useless North', () => {
    const { st } = stateFrom('19m12345678p11s4z', [{ t: 'draw', tile: T('9p') }]);
    const a = analyze(st, { mode: 'advanced', objective: 'top' });
    expect(best(a).kind).toBe('kita');
  });
  it('folds against riichi with a hopeless hand, using genbutsu', () => {
    const ev: GameEvent[] = [
      { t: 'draw', tile: T('2s') },
      { t: 'discard', seat: 0, tile: T('2s') },
      { t: 'discard', seat: 1, tile: T('5p'), riichi: true },
      { t: 'discard', seat: 2, tile: T('S') },
      { t: 'draw', tile: T('W') },
    ];
    // 4-shanten mess; 5p is genbutsu against the riichi
    const { st } = stateFrom('19m159p48s1357z55p', ev, { dealer: 0 });
    const a = analyze(st, { mode: 'advanced', objective: 'top' });
    const top = best(a);
    expect(top.immediateRisk).toBeLessThan(0.01);
    expect(kindOf(top.tile!)).toBe(kindOf(T('5p'))); // the only genbutsu in hand
  });
  it('pon decision is offered and yakuhai pon is preferred', () => {
    const ev: GameEvent[] = [
      { t: 'draw', tile: T('1m') },
      { t: 'discard', seat: 0, tile: T('1m') },
      { t: 'discard', seat: 1, tile: T('C') },
    ];
    const { st } = stateFrom('77z234p678p345s19m', ev);
    expect(myLegalActions(st).pon).toBe(true);
    const a = analyze(st, { mode: 'advanced', objective: 'top' });
    expect(best(a).kind).toBe('pon');
  });
  it('declines a yakuless pon that destroys a closed hand', () => {
    const ev: GameEvent[] = [
      { t: 'draw', tile: T('1m') },
      { t: 'discard', seat: 0, tile: T('1m') },
      { t: 'discard', seat: 1, tile: T('9p') },
    ];
    const { st } = stateFrom('99p123s456s789s34p', ev);
    const a = analyze(st, { mode: 'advanced', objective: 'top' });
    expect(best(a).kind).toBe('pass');
  });
  it('produces calibrated confidence and top-3', () => {
    const { st } = stateFrom('123456p789p23s5s7z', [{ t: 'draw', tile: T('6s') }]);
    const a = analyze(st, { mode: 'instant', objective: 'top' });
    expect(a.candidates.length).toBeGreaterThanOrEqual(3);
    expect(a.confidence).toBeGreaterThan(0.3);
    expect(a.confidence).toBeLessThanOrEqual(0.99);
  });
  it('is deterministic (same input, same ranking)', () => {
    const { st } = stateFrom('19m2468p13579s12z', [{ t: 'draw', tile: T('5p') }]);
    const a = analyze(st, { mode: 'advanced', objective: 'top' });
    const b = analyze(st, { mode: 'advanced', objective: 'top' });
    expect(a.candidates.map(c => c.label)).toEqual(b.candidates.map(c => c.label));
  });
});

describe('danger model', () => {
  it('genbutsu is zero, suji is safer than non-suji middle, live honor moderate', () => {
    const unseen = new Array(34).fill(0);
    for (const k of [0, 8, ...Array.from({ length: 25 }, (_, i) => i + 9)]) unseen[k] = 3;
    const safe = new Set([kindOf(T('4p'))]);
    const w = waitDistribution(unseen, safe, new Float64Array(34).fill(1), new Set());
    expect(w[kindOf(T('4p'))]).toBe(0);
    expect(w[kindOf(T('1p'))]).toBeLessThan(w[kindOf(T('5s'))]); // suji 1p vs non-suji 5s
    expect(w[kindOf(T('7p'))]).toBeLessThan(w[kindOf(T('6s'))]); // half-suji 7p
    expect(w[kindOf(T('5s'))]).toBeGreaterThan(0.08);
    expect(w[kindOf(T('5s'))]).toBeLessThan(0.2);
  });
  it('riichi opponent has tenpai 1', () => {
    const { st } = stateFrom('19m159p48s1357z55p', [
      { t: 'draw', tile: T('2s') }, { t: 'discard', seat: 0, tile: T('2s') },
      { t: 'discard', seat: 1, tile: T('5p'), riichi: true },
    ]);
    expect(modelOpponent(st, 1).tenpai).toBe(1);
    expect(modelOpponent(st, 2).tenpai).toBeLessThan(0.2);
  });
});

describe('placement model', () => {
  it('a big lead late gives high P(1st)', () => {
    const lead = placement({ ...newMatch(0), handNumber: 3, dealer: 2, scores: [55000, 25000, 25000] }, 1500);
    const behind = placement({ ...newMatch(0), handNumber: 3, dealer: 2, scores: [20000, 45000, 40000] }, 1500);
    expect(lead.ranks[0]).toBeGreaterThan(0.75);
    expect(behind.ranks[0]).toBeLessThan(0.2);
  });
  it('probabilities sum to 1', () => {
    const p = placement(newMatch(0), 800);
    expect(p.ranks.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

describe('performance', () => {
  it('instant mode answers fast', () => {
    const { st } = stateFrom('19m2468p13579s12z', [{ t: 'draw', tile: T('5p') }]);
    analyze(st, { mode: 'instant', objective: 'top' }); // warm caches
    const t0 = performance.now();
    analyze(st, { mode: 'instant', objective: 'top' });
    expect(performance.now() - t0).toBeLessThan(400);
  });
  it('advanced mode on a 2-shanten hand stays within budget', () => {
    const { st } = stateFrom('123p468p2356s19m1z', [{ t: 'draw', tile: T('7s') }]);
    const t0 = performance.now();
    const a = analyze(st, { mode: 'advanced', objective: 'top' });
    expect(performance.now() - t0).toBeLessThan(4000);
    expect(a.candidates.length).toBeGreaterThan(0);
  });
  it('max-strength mode on a deep-shanten hand stays within its budget', () => {
    const { st } = stateFrom('13p468p2357s19m12z', [{ t: 'draw', tile: T('7s') }]);
    const t0 = performance.now();
    const a = analyze(st, { mode: 'max', objective: 'top' });
    expect(performance.now() - t0).toBeLessThan(9000);
    expect(a.candidates.length).toBeGreaterThan(5);
  });
  it('DP evaluator: tenpai win probability increases with turns', () => {
    const { st } = stateFrom('123p456p789s23s99s', [{ t: 'draw', tile: T('E') }]);
    const ctx = buildCtx(st);
    const ev = new Evaluator(ctx, { maxShantenDP: 2, budgetMs: 1000, policy: 'auto' });
    const c = toCounts(parseTiles('123p456p789s23s99s'));
    const cv = ev.curve(c);
    for (let k = 1; k <= ev.T; k++) expect(cv.p[k]).toBeGreaterThanOrEqual(cv.p[k - 1]);
    expect(cv.p[ev.T]).toBeGreaterThan(0.4);
  });
});
