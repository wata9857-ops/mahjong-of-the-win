import { describe, expect, it } from 'vitest';
import { shanten, shantenChiitoi, shantenKokushi, shantenRegular, ukeire } from '../src/core/shanten';
import { parseTiles, toCounts } from '../src/core/tiles';

const c = (s: string) => toCounts(parseTiles(s));

describe('shanten', () => {
  it('complete hand is -1', () => {
    expect(shanten(c('123456789p123s11z'))).toBe(-1);
  });
  it('tenpai is 0', () => {
    expect(shanten(c('123456789p12s11z'))).toBe(0);
    expect(shanten(c('123456789p13s11z'))).toBe(0);
  });
  it('1m-9m never form a sequence or taatsu in sanma', () => {
    // 1m 9m are isolated honors-like tiles
    expect(shantenRegular(c('19m123456789p11s'), 0)).toBe(1);
  });
  it('counts chiitoitsu', () => {
    expect(shantenChiitoi(c('1122p3344s5566s7z'))).toBe(0);
    expect(shanten(c('1122p3344s5566s7z'))).toBe(0);
  });
  it('four of a kind is not two pairs for chiitoitsu', () => {
    // 5 distinct pairs but only 6 kinds -> still needs a 7th kind
    expect(shantenChiitoi(c('1111p2233s4455s6z'))).toBe(2);
  });
  it('counts kokushi in sanma', () => {
    expect(shantenKokushi(c('19m19p19s1234567z'))).toBe(0);
    expect(shanten(c('19m19p19s12345677z'))).toBe(-1);
  });
  it('works with melds', () => {
    // 1 meld called, 10 tiles closed
    expect(shanten(c('123p456s789s1z'), 1)).toBe(0);
    expect(shanten(c('123p456s789s11z'), 1)).toBe(-1);
  });
  it('isolated hands', () => {
    expect(shanten(c('19m159p159s1357z'))).toBeGreaterThanOrEqual(3);
  });
  it('honor quad cannot be pair + taatsu', () => {
    // 1111z + 123p456p789p : the quad can only give a set + 1 floating
    expect(shanten(c('1111z123456789p'))).toBe(0);
  });
});

describe('ukeire', () => {
  it('ryanmen tenpai has two waits', () => {
    const u = ukeire(c('123456789p23s11z'), 0);
    expect(u.tiles.sort()).toEqual([18, 21]); // 1s, 4s
    expect(u.count).toBe(8);
  });
  it('no 2m-8m waits ever', () => {
    const u = ukeire(c('19m123456789p55s'), 0);
    for (const t of u.tiles) expect(t === 0 || t === 8 || t >= 9).toBe(true);
  });
});
