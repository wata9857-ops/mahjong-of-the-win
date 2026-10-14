import { describe, expect, it } from 'vitest';
import { scoreHand, type Meld, type WinContext, basePoints, payments } from '../src/core/scoring';
import { EAST, NORTH, SOUTH, WEST, parseTiles, toCounts, kindOf } from '../src/core/tiles';

function ctx(hand: string, win: string, o: Partial<WinContext> = {}): WinContext {
  return {
    closed: toCounts(parseTiles(hand)),
    melds: [],
    winTile: kindOf(parseTiles(win)[0]),
    tsumo: false,
    seatWind: SOUTH,
    roundWind: EAST,
    dealer: false,
    doraIndicators: [],
    aka: 0,
    kita: 0,
    ...o,
  };
}

describe('scoring', () => {
  it('riichi pinfu ron 30fu 2han = 2000', () => {
    const r = scoreHand(ctx('123456p234789s55s', '4s', { riichi: true }));
    expect(r.valid).toBe(true);
    expect(r.yaku.map(y => y.name)).toContain('平和');
    expect(r.fu).toBe(30);
    expect(r.han).toBe(2);
    expect(r.ron).toBe(2000);
  });
  it('pinfu tsumo is 20fu and uses sanma tsumo loss', () => {
    const r = scoreHand(ctx('123456p234789s55s', '4s', { riichi: true, tsumo: true }));
    expect(r.fu).toBe(20);
    expect(r.han).toBe(3); // riichi, tsumo, pinfu
    // non-dealer 3han20fu: base 640 -> dealer pays 1300, other pays 700; total 2000 (no North player)
    expect(r.tsumoFromDealer).toBe(1300);
    expect(r.tsumoFromNonDealer).toBe(700);
    expect(r.total).toBe(2000);
  });
  it('no yaku = invalid (open, no yakuhai)', () => {
    const melds: Meld[] = [{ type: 'pon', kind: 9, reds: 0 }];
    const r = scoreHand(ctx('456p234s789s55s', '4s', { melds }));
    expect(r.valid).toBe(false);
  });
  it('dora alone is not a yaku', () => {
    const melds: Meld[] = [{ type: 'pon', kind: 9, reds: 0 }];
    const r = scoreHand(ctx('456p234s789s55s', '4s', { melds, doraIndicators: [17] }));
    expect(r.valid).toBe(false);
  });
  it('kuitan is allowed', () => {
    const melds: Meld[] = [{ type: 'pon', kind: 10, reds: 0 }];
    const r = scoreHand(ctx('456p234s678s55s', '4s', { melds }));
    expect(r.valid).toBe(true);
    expect(r.yaku.map(y => y.name)).toEqual(['断幺九']);
    expect(r.fu).toBe(30);
    expect(r.ron).toBe(1000);
  });
  it('kita counts as nuki dora and North is dora when West indicates', () => {
    const r = scoreHand(ctx('123456p234789s55s', '4s', { riichi: true, kita: 2, doraIndicators: [WEST] }));
    // riichi + pinfu + kita 2 + North-as-dora 2 = 6 han -> haneman 12000
    expect(r.han).toBe(6);
    expect(r.ron).toBe(12000);
  });
  it('North used in hand is otakaze: pair gives no fu, triplet is no yakuhai', () => {
    const r = scoreHand(ctx('123p456p789s444z55s', '5s', { tsumo: true }));
    expect(r.yaku.map(y => y.name)).toEqual(['門前清自摸和']);
  });
  it('double wind pair is 4 fu', () => {
    // East seat in East round, pair of East, kanchan wait
    const r = scoreHand(ctx('123p456p789s11z123s', '2s', { seatWind: EAST, dealer: true, riichi: true }));
    // 20 + 10 menzen ron + 4 pair + 2 kanchan = 36 -> 40
    expect(r.fu).toBe(40);
  });
  it('red fives count', () => {
    const tiles = '123406p234789s55s';
    const r = scoreHand(ctx(tiles, '4s', { riichi: true, aka: 1 }));
    expect(r.han).toBe(3);
  });
  it('honitsu / chinitsu', () => {
    const r = scoreHand(ctx('1112345678999p1p', '1p', { tsumo: false }));
    // this is chuuren (yakuman)
    expect(r.yakuman).toBeGreaterThanOrEqual(1);
    const r2 = scoreHand(ctx('123456789p11z55z5z', '5z'));
    expect(r2.yaku.map(y => y.name)).toContain('混一色');
  });
  it('kokushi 13-wait is double yakuman', () => {
    const r = scoreHand(ctx('19m19p19s12345677z', '7z'));
    expect(r.yakuman).toBe(2);
    expect(r.ron).toBe(64000);
  });
  it('dealer yakuman tsumo with tsumo loss: 2 x 16000', () => {
    const r = scoreHand(ctx('111p999p111s999s11z', '1z', { tsumo: true, dealer: true, seatWind: EAST }));
    expect(r.yakuman).toBeGreaterThanOrEqual(1);
    expect(r.tsumoFromNonDealer).toBe(16000 * r.yakuman);
  });
  it('no kiriage mangan: 4han30fu = 7700', () => {
    const { base } = basePoints(4, 30, 0);
    expect(payments(base, false).ron).toBe(7700);
  });
  it('kazoe yakuman at 13 han', () => {
    expect(basePoints(13, 30, 0).base).toBe(8000);
  });
  it('kan fu and sankantsu', () => {
    const melds: Meld[] = [
      { type: 'ankan', kind: 31, reds: 0 },
      { type: 'minkan', kind: 9, reds: 0 },
      { type: 'minkan', kind: 18, reds: 0 },
    ];
    const r = scoreHand(ctx('234p55p', '5p', { melds, tsumo: true }));
    expect(r.yaku.map(y => y.name)).toEqual(expect.arrayContaining(['三槓子', '役牌 白']));
    // 20 + 2 tsumo + 32 (haku ankan) + 16 + 16 (yaochu minkan) + 2 tanki = 88 -> 90
    expect(r.fu).toBe(90);
  });
  it('rinshan after kita', () => {
    const r = scoreHand(ctx('123456p234789s55s', '4s', { tsumo: true, rinshan: true, kita: 1 }));
    expect(r.yaku.map(y => y.name)).toContain('嶺上開花');
    expect(r.yaku.map(y => y.name)).toContain('抜きドラ');
  });
  it('robbing kita does not give chankan (caller sets chankan=false)', () => {
    const r = scoreHand(ctx('19m19p19s12345677z', '4z', { chankan: false }));
    expect(r.yaku.some(y => y.name === '槍槓')).toBe(false);
    void NORTH;
  });
});
