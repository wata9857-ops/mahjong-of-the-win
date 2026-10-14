import { describe, expect, it } from 'vitest';
import { finalPoints, newMatch, rankSeats, settleHand } from '../src/game/match';
import type { MatchInfo } from '../src/game/types';

const m0 = (o: Partial<MatchInfo> = {}): MatchInfo => ({ ...newMatch(0), ...o });

describe('settlement', () => {
  it('non-dealer ron with honba and deposits', () => {
    const s = settleHand(m0({ honba: 2, kyotaku: 1 }), { kind: 'ron', loser: 0, winners: [{ seat: 1, han: 3, fu: 30 }] });
    // 3900 + 2000 honba (1000 each in sanma) + 1000 deposit
    expect(s.deltas).toEqual([-5900, 6900, 0]);
    expect(s.next.honba).toBe(0);
    expect(s.next.kyotaku).toBe(0);
  });
  it('non-dealer tsumo uses tsumo loss (only two payers)', () => {
    const s = settleHand(m0(), { kind: 'tsumo', winner: { seat: 1, han: 5, fu: 30 } });
    // mangan: dealer (seat0) pays 4000, other non-dealer pays 2000 -> 6000 total
    expect(s.deltas).toEqual([-4000, 6000, -2000]);
  });
  it('tsumo honba is 500 per payer', () => {
    const s = settleHand(m0({ honba: 1 }), { kind: 'tsumo', winner: { seat: 0, han: 5, fu: 30 } });
    // dealer mangan tsumo 4000 all + 500 each
    expect(s.deltas).toEqual([9000, -4500, -4500]);
    expect(s.next.dealer).toBe(0);
    expect(s.next.honba).toBe(2);
  });
  it('noten payments total 2000', () => {
    const one = settleHand(m0(), { kind: 'draw', tenpai: [true, false, false] });
    expect(one.deltas).toEqual([2000, -1000, -1000]);
    const two = settleHand(m0(), { kind: 'draw', tenpai: [true, true, false] });
    expect(two.deltas).toEqual([1000, 1000, -2000]);
    expect(two.next.dealer).toBe(0); // dealer tenpai continues
  });
  it('dealer noten rotates the deal', () => {
    const s = settleHand(m0(), { kind: 'draw', tenpai: [false, true, false] });
    expect(s.next.dealer).toBe(1);
    expect(s.next.handNumber).toBe(2);
    expect(s.next.honba).toBe(1);
  });
  it('double ron: honba and deposits go to the winner closest to the discarder', () => {
    const s = settleHand(m0({ honba: 1, kyotaku: 2 }), { kind: 'ron', loser: 0, winners: [{ seat: 2, han: 1, fu: 30 }, { seat: 1, han: 1, fu: 30 }] });
    // seat 1 is next after seat 0
    expect(s.deltas[1]).toBe(1000 + 1000 + 2000);
    expect(s.deltas[2]).toBe(1000);
  });
});

describe('match ending', () => {
  it('bankruptcy ends the match; zero continues', () => {
    const s = settleHand(m0({ scores: [3000, 35000, 35000] }), { kind: 'ron', loser: 0, winners: [{ seat: 1, han: 2, fu: 30 }] });
    expect(s.ended).toBe(false); // exactly ... 3000-2000=1000
    const b = settleHand(m0({ scores: [1000, 35000, 35000] }), { kind: 'ron', loser: 0, winners: [{ seat: 1, han: 2, fu: 30 }] });
    expect(b.ended).toBe(true);
    expect(b.reason).toBe('トビ終了');
    const z = settleHand(m0({ scores: [2000, 35000, 35000] }), { kind: 'ron', loser: 0, winners: [{ seat: 1, han: 2, fu: 30 }] });
    expect(z.ended).toBe(false);
  });
  it('end of East with someone >= 40000 ends the match', () => {
    const m = m0({ handNumber: 3, dealer: 2, scores: [45000, 30000, 30000] });
    const s = settleHand(m, { kind: 'draw', tenpai: [false, false, false] });
    expect(s.ended).toBe(true);
  });
  it('end of East with nobody >= 40000 extends into South', () => {
    const m = m0({ handNumber: 3, dealer: 2, scores: [38000, 34000, 33000] });
    const s = settleHand(m, { kind: 'draw', tenpai: [false, false, false] });
    expect(s.ended).toBe(false);
    expect(s.next.roundWind).toBe(1);
    expect(s.next.handNumber).toBe(1);
    expect(s.next.dealer).toBe(0);
  });
  it('sudden death ends as soon as the top reaches 40000', () => {
    const m = m0({ roundWind: 1, handNumber: 1, dealer: 0, scores: [36000, 35000, 34000] });
    const s = settleHand(m, { kind: 'ron', loser: 2, winners: [{ seat: 1, han: 3, fu: 40 }] });
    expect(s.ended).toBe(true);
  });
  it('no West round', () => {
    const m = m0({ roundWind: 1, handNumber: 3, dealer: 2, scores: [36000, 35000, 34000] });
    const s = settleHand(m, { kind: 'draw', tenpai: [false, false, false] });
    expect(s.ended).toBe(true);
  });
  it('agari-yame: final dealer first with >= 40000 ends', () => {
    const m = m0({ handNumber: 3, dealer: 2, scores: [30000, 30000, 39000] });
    const s = settleHand(m, { kind: 'ron', loser: 0, winners: [{ seat: 2, han: 1, fu: 30 }] });
    expect(s.ended).toBe(true);
  });
  it('final dealer continues when not first', () => {
    const m = m0({ handNumber: 3, dealer: 2, scores: [50000, 20000, 30000] });
    const s = settleHand(m, { kind: 'ron', loser: 1, winners: [{ seat: 2, han: 1, fu: 30 }] });
    expect(s.ended).toBe(false);
    expect(s.next.dealer).toBe(2);
  });
  it('leftover deposits go to first; ties broken by initial dealer order', () => {
    expect(rankSeats([40000, 40000, 25000], 1)).toEqual([1, 0, 2]);
    expect(rankSeats([40000, 30000, 40000], 1)).toEqual([2, 0, 1]);
    const m = m0({ handNumber: 3, dealer: 2, kyotaku: 2, scores: [44000, 29000, 30000] });
    const s = settleHand(m, { kind: 'draw', tenpai: [false, false, false] });
    expect(s.ended).toBe(true);
    expect(s.final![0]).toBe(46000);
  });
  it('final points use 15-0-15 uma and 35000 return', () => {
    const fp = finalPoints([50000, 35000, 20000], [0, 1, 2]);
    expect(fp).toEqual([30, 0, -30]);
  });
});
