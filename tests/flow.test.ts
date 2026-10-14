import { describe, expect, it } from 'vitest';
import { analyze } from '../src/ai/decide';
import { humanize } from '../src/ai/humanize';
import { kindOf, parseTiles } from '../src/core/tiles';
import { myLegalActions } from '../src/game/legal';
import { newMatch } from '../src/game/match';
import { isMyFuriten, myTsumoScore } from '../src/game/rules';
import { replay } from '../src/game/state';
import { LIVE_WALL_START, type GameEvent, type Seat } from '../src/game/types';
import { COUNTDOWN_MS, countdownState, dealerFromMyWind, inputMode, turnInfo } from '../src/ui/flow';

const T = (s: string) => parseTiles(s)[0];
const deal = (hand: string): GameEvent[] => parseTiles(hand).map(tile => ({ t: 'deal' as const, tile }));
const run = (dealer: Seat, evs: GameEvent[]) => replay(newMatch(dealer), evs);
const noModes = { dora: false, reveal: false, kanSeat: null, override: null };
const banner = (st: ReturnType<typeof run>) => turnInfo(st, inputMode(st, noModes), myLegalActions(st));

describe('4-second countdown', () => {
  it('counts down 4,3,2,1 then finishes', () => {
    expect(COUNTDOWN_MS).toBe(4000);
    expect(countdownState(0, 0).secondsLeft).toBe(4);
    expect(countdownState(0, 1).secondsLeft).toBe(4);
    expect(countdownState(0, 1500).secondsLeft).toBe(3);
    expect(countdownState(0, 3999).secondsLeft).toBe(1);
    expect(countdownState(0, 3999).done).toBe(false);
    expect(countdownState(0, 4000).done).toBe(true);
    expect(countdownState(0, 9000).secondsLeft).toBe(0);
  });
  it('fraction runs from 1 to 0', () => {
    expect(countdownState(0, 0).fraction).toBe(1);
    expect(countdownState(0, 2000).fraction).toBeCloseTo(0.5);
  });
});

describe('seat selection', () => {
  it('maps my wind to the dealer seat (sanma: no North seat)', () => {
    expect(dealerFromMyWind(0)).toBe(0); // I am East = dealer
    expect(dealerFromMyWind(1)).toBe(2); // I am South: East is the player before me (kamicha)
    expect(dealerFromMyWind(2)).toBe(1); // I am West: East plays after me (shimocha)
  });
});

describe('partial hand entry', () => {
  it('starting with 8 of 13 tiles leaves 5 unknown (non-dealer)', () => {
    const st = run(1, [...deal('19m123456p'), { t: 'start' }]);
    expect(st.phase).toBe('play');
    expect(st.myHand.length).toBe(8);
    expect(st.unknown).toBe(5);
    expect(st.turn).toBe(1);
    expect(st.wall).toBe(LIVE_WALL_START - 1);
  });
  it('dealer start includes the unknown 14th tile and waits for my discard', () => {
    const st = run(0, [...deal('123p'), { t: 'start' }]);
    expect(st.unknown).toBe(11);
    expect(st.turn).toBe(0);
    expect(st.stage).toBe('discard');
  });
  it('starting with zero tiles still works', () => {
    const st = run(2, [{ t: 'start' }]);
    expect(st.phase).toBe('play');
    expect(st.unknown).toBe(13);
  });
  it('discarding a tile I never entered consumes an unknown tile', () => {
    const st = run(0, [...deal('123p'), { t: 'start' }, { t: 'discard', seat: 0, tile: T('C') }]);
    expect(st.unknown).toBe(10);
    expect(st.myHand.length).toBe(3);
    expect(st.players[0].discards[0].tile).toBe(T('C'));
    expect(st.warnings).toEqual([]);
  });
  it('filling in later converts unknown tiles into known ones', () => {
    const st = run(1, [...deal('123p'), { t: 'start' }, { t: 'reveal', tile: T('E') }, { t: 'reveal', tile: T('E') }]);
    expect(st.unknown).toBe(8);
    expect(st.myHand.filter(t => t === T('E')).length).toBe(2);
  });
  it('an unknown draw adds an unknown tile', () => {
    const st = run(2, [...deal('123p'), { t: 'start' }, { t: 'discard', seat: 2, tile: T('S') }, { t: 'drawUnknown' }]);
    expect(st.stage).toBe('discard');
    expect(st.unknown).toBe(11);
  });
  it('pon with unentered tiles takes them from the unknown pool', () => {
    const st = run(1, [...deal('5p'), { t: 'start' }, { t: 'discard', seat: 1, tile: T('C') }, { t: 'pon', seat: 0 }]);
    expect(st.players[0].melds[0].kind).toBe(kindOf(T('C')));
    expect(st.unknown).toBe(10);
  });
});

describe('unknown tiles are never treated as known', () => {
  const partial = () => run(0, [...deal('19m159p1357z'), { t: 'start' }]);
  it('no riichi, tsumo or furiten claims with unknown tiles', () => {
    const st = partial();
    const legal = myLegalActions(st);
    expect(legal.riichiDiscards).toEqual([]);
    expect(legal.tsumo).toBe(false);
    expect(myTsumoScore(st)).toBeNull();
    expect(isMyFuriten(st)).toBe(false);
  });
  it('recommends only tiles that were actually entered and flags it as partial', () => {
    const st = partial();
    const a = analyze(st, { mode: 'instant', objective: 'top' });
    expect(a.partial).toBe(true);
    expect(a.unknown).toBe(st.unknown);
    expect(a.candidates.length).toBeGreaterThan(0);
    for (const c of a.candidates) {
      expect(['discard', 'kita']).toContain(c.kind);
      if (c.tile !== undefined) expect(st.myHand).toContain(c.tile);
    }
    expect(a.confidence).toBeLessThan(0.8);
    expect(a.notes.join('')).toContain('未入力');
  });
  it('says so when nothing is known', () => {
    const st = run(0, [{ t: 'start' }]);
    const a = analyze(st, { mode: 'instant', objective: 'top' });
    expect(a.candidates).toEqual([]);
    expect(a.notes.join('')).toContain('入力');
  });
  it('becomes a full analysis once every tile is filled in', () => {
    const evs: GameEvent[] = [...deal('123456p789p23s'), { t: 'start' }];
    let st = run(0, evs);
    expect(st.unknown).toBe(3); // 2 missing + the dealer's unentered 14th tile
    st = run(0, [...evs, { t: 'reveal', tile: T('5s') }, { t: 'reveal', tile: T('5s') }, { t: 'reveal', tile: T('E') }]);
    expect(st.unknown).toBe(0);
    const a = analyze(st, { mode: 'instant', objective: 'top' });
    expect(a.partial).toBe(false);
  });
});

describe('delayed dora entry', () => {
  it('play can start without a dora indicator and add it later', () => {
    const evs: GameEvent[] = [...deal('123456p789p23s5s'), { t: 'start' }];
    const before = run(0, evs);
    expect(before.doraIndicators).toEqual([]);
    const a1 = analyze(before, { mode: 'instant', objective: 'top' });
    expect(a1.notes.join('')).toContain('ドラ表示牌');
    const after = run(0, [...evs, { t: 'dora', tile: T('W') }]);
    expect(after.doraIndicators).toEqual([T('W')]);
    const a2 = analyze(after, { mode: 'instant', objective: 'top' });
    expect(a2.notes.join('')).not.toContain('ドラ表示牌がまだ');
  });
});

describe('automatic turn tracking banner', () => {
  it('follows the turn order and states whose turn it is', () => {
    const base: GameEvent[] = [...deal('19m123456789p11s')];
    let st = run(0, base);
    expect(banner(st)).toMatchObject({ seat: 0, title: 'あなたの番です', sub: 'ツモった牌を選んでください' });
    st = run(0, [...base, { t: 'draw', tile: T('E') }]);
    expect(banner(st)).toMatchObject({ seat: 0, sub: '切る牌を選んでください' });
    st = run(0, [...base, { t: 'draw', tile: T('E') }, { t: 'discard', seat: 0, tile: T('E') }]);
    expect(banner(st)).toMatchObject({ seat: 1, title: '下家の番です' });
    st = run(0, [...base, { t: 'draw', tile: T('E') }, { t: 'discard', seat: 0, tile: T('E') }, { t: 'discard', seat: 1, tile: T('S') }]);
    expect(banner(st)).toMatchObject({ seat: 2, title: '上家の番です' });
  });
  it('offers calls when possible and switches turn after a pon', () => {
    const base: GameEvent[] = [...deal('19m123456789p11s'), { t: 'draw', tile: T('E') }, { t: 'discard', seat: 0, tile: T('E') }, { t: 'discard', seat: 1, tile: T('1s') }];
    let st = run(0, base);
    expect(banner(st).title).toContain('ポン');
    st = run(0, [...base, { t: 'pon', seat: 0 }]);
    expect(banner(st)).toMatchObject({ seat: 0, sub: '切る牌を選んでください' });
    st = run(0, [...base, { t: 'pon', seat: 2 }]);
    expect(banner(st)).toMatchObject({ seat: 2, title: '上家の番です' });
  });
  it('after an opponent kita the same player is still to discard; after my kita I enter the replacement', () => {
    let st = run(0, [...deal('19m123456789p11s'), { t: 'draw', tile: T('E') }, { t: 'discard', seat: 0, tile: T('E') }, { t: 'kita', seat: 1 }]);
    expect(banner(st)).toMatchObject({ seat: 1, title: '下家の番です' });
    st = run(0, [...deal('19m12345678p11s4z'), { t: 'draw', tile: T('9p') }, { t: 'kita', seat: 0 }]);
    expect(banner(st)).toMatchObject({ seat: 0, sub: '補充した牌（嶺上牌）を選んでください' });
  });
});

describe('plain-language recommendations', () => {
  it('discarding the drawn tile is called ツモ切り', () => {
    const c = humanize({ kind: 'discard', tile: T('E'), label: '東切り', utility: 0, pFirst: 0, pLast: 0, evPoints: 0, winProb: 0, winValue: 0, immediateRisk: 0, totalDealIn: 0, reason: '', shanten: 1 }, { drawn: T('E'), threat: false });
    expect(c.say).toBe('ツモ切り');
  });
  it('riichi reads 「リーチして三索を切る」', () => {
    const c = humanize({ kind: 'riichi', tile: T('3s'), label: '', utility: 0, pFirst: 0, pLast: 0, evPoints: 0, winProb: 0, winValue: 0, immediateRisk: 0, totalDealIn: 0, reason: '', shanten: 0, waits: [kindOf(T('1s'))] }, { drawn: T('E'), threat: false });
    expect(c.say).toBe('リーチして三索を切る');
    expect(c.hint).toContain('リーチ');
  });
  it('every recommendation in a real position has plain Japanese text', () => {
    const st = run(0, [...deal('123456p789p23s5s7z'), { t: 'draw', tile: T('6s') }]);
    const a = analyze(st, { mode: 'instant', objective: 'top' });
    for (const c of a.candidates) {
      expect(c.say).toBeTruthy();
      expect(c.say).not.toMatch(/[A-Za-z]/);
      expect(c.why ?? '').not.toMatch(/[A-Za-z]/);
    }
    expect(a.candidates[0].say).toBe('中を切る');
  });
});
