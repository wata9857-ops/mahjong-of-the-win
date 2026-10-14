import { describe, expect, it } from 'vitest';
import { RED_5P, RED_5S, doraFromIndicator, kindOf, parseTiles, sortTiles, tileCode, SANMA_KINDS, NORTH, EAST, HAKU, CHUN } from '../src/core/tiles';

describe('tile parsing', () => {
  it('parses mpsz with red fives and honors', () => {
    const t = parseTiles('19m0p5p0s1234567z');
    expect(t.map(tileCode)).toEqual(['1m', '9m', '0p', '5p', '0s', 'E', 'S', 'W', 'N', 'P', 'F', 'C']);
    expect(kindOf(RED_5P)).toBe(13);
    expect(kindOf(RED_5S)).toBe(22);
  });
  it('parses honor letters', () => {
    expect(parseTiles('ESWNPFC')).toEqual([27, 28, 29, 30, 31, 32, 33]);
  });
  it('rejects red 5m (not in sanma)', () => {
    expect(() => parseTiles('0m')).toThrow();
  });
  it('sanma has 27 kinds = 108 tiles', () => {
    expect(SANMA_KINDS.length).toBe(27);
    expect(SANMA_KINDS.includes(1)).toBe(false); // 2m
  });
  it('sorts red five next to its five', () => {
    expect(sortTiles(parseTiles('6p5p0p4p')).map(tileCode)).toEqual(['4p', '0p', '5p', '6p']);
  });
});

describe('dora indicators (sanma)', () => {
  it('1m indicates 9m and 9m indicates 1m', () => {
    expect(doraFromIndicator(0)).toBe(8);
    expect(doraFromIndicator(8)).toBe(0);
  });
  it('wraps suits and honors', () => {
    expect(doraFromIndicator(17)).toBe(9); // 9p -> 1p
    expect(doraFromIndicator(26)).toBe(18);
    expect(doraFromIndicator(NORTH)).toBe(EAST);
    expect(doraFromIndicator(CHUN)).toBe(HAKU);
    expect(doraFromIndicator(29)).toBe(NORTH); // West -> North
  });
});
