// Tile model for Mahjong Soul three-player (sanma).
//
// Kinds use the conventional 34-index layout so algorithms stay standard:
//   0..8   = 1m..9m   (only 1m and 9m exist in sanma)
//   9..17  = 1p..9p
//   18..26 = 1s..9s
//   27..33 = East, South, West, North, Haku (white), Hatsu (green), Chun (red)
//
// A "TileKey" identifies a physical tile face: 0..33 for normal tiles,
// 34 = red 5p (0p), 35 = red 5s (0s). Sanma ranked uses exactly two red fives.

export type Kind = number;
export type TileKey = number;

export const EAST = 27, SOUTH = 28, WEST = 29, NORTH = 30, HAKU = 31, HATSU = 32, CHUN = 33;
export const RED_5P = 34, RED_5S = 35;
export const FIVE_P = 13, FIVE_S = 22;

/** All tile kinds that exist in the sanma set (27 kinds × 4 = 108 tiles). */
export const SANMA_KINDS: readonly Kind[] = [
  0, 8,
  9, 10, 11, 12, 13, 14, 15, 16, 17,
  18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33,
];

const SANMA_SET = new Uint8Array(34);
for (const k of SANMA_KINDS) SANMA_SET[k] = 1;
export const isSanmaKind = (k: Kind): boolean => SANMA_SET[k] === 1;

export const kindOf = (t: TileKey): Kind => (t === RED_5P ? FIVE_P : t === RED_5S ? FIVE_S : t);
export const isRed = (t: TileKey): boolean => t === RED_5P || t === RED_5S;
export const redOf = (k: Kind): TileKey | -1 => (k === FIVE_P ? RED_5P : k === FIVE_S ? RED_5S : -1);

/** 0 = man, 1 = pin, 2 = sou, 3 = honor */
export const suitOf = (k: Kind): number => (k < 9 ? 0 : k < 18 ? 1 : k < 27 ? 2 : 3);
/** 1..9 for number tiles, 0 for honors */
export const numOf = (k: Kind): number => (k < 27 ? (k % 9) + 1 : 0);
export const isHonor = (k: Kind): boolean => k >= 27;
export const isTerminal = (k: Kind): boolean => k < 27 && (k % 9 === 0 || k % 9 === 8);
export const isYaochu = (k: Kind): boolean => isHonor(k) || isTerminal(k);
export const isDragon = (k: Kind): boolean => k >= HAKU;
export const isWind = (k: Kind): boolean => k >= EAST && k <= NORTH;
/** In sanma only pinzu and souzu can form sequences. */
export const isSequenceSuit = (k: Kind): boolean => k >= 9 && k < 27;

export const YAOCHU_KINDS: readonly Kind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/**
 * Dora from an indicator, including the sanma manzu rule:
 * 1m indicates 9m, 9m indicates 1m.
 */
export function doraFromIndicator(ind: Kind): Kind {
  if (ind === 0) return 8;
  if (ind === 8) return 0;
  if (ind < 27) {
    const base = ind - (ind % 9);
    return ind % 9 === 8 ? base : ind + 1;
  }
  if (ind <= NORTH) return ind === NORTH ? EAST : ind + 1;
  return ind === CHUN ? HAKU : ind + 1;
}

/** Inverse: the indicator kind that makes `dora` the dora. */
export function indicatorForDora(dora: Kind): Kind {
  for (const k of SANMA_KINDS) if (doraFromIndicator(k) === dora) return k;
  return -1;
}

const HONOR_CHARS = ['E', 'S', 'W', 'N', 'P', 'F', 'C'];
const HONOR_KANJI = ['東', '南', '西', '北', '白', '發', '中'];

/** Compact code: "1m", "0p" (red), "5s", "E", "C"... */
export function tileCode(t: TileKey): string {
  if (t === RED_5P) return '0p';
  if (t === RED_5S) return '0s';
  if (t >= 27) return HONOR_CHARS[t - 27];
  return `${numOf(t)}${'mps'[suitOf(t)]}`;
}

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** Japanese display name: 一萬, 5筒, 赤5索, 東 ... (manzu in kanji numerals as on the tile). */
export function tileLabel(t: TileKey): string {
  const k = kindOf(t);
  if (k >= 27) return HONOR_KANJI[k - 27];
  const n = numOf(k);
  const suit = suitOf(k);
  const body = suit === 0 ? `${KANJI_NUM[n - 1]}萬` : `${n}${suit === 1 ? '筒' : '索'}`;
  return `${isRed(t) ? '赤' : ''}${body}`;
}

/**
 * Parse mpsz notation ("19m123p0s1234567z") or honor letters ("ESWNPFC").
 * 0 means red five. Returns TileKeys in order.
 */
export function parseTiles(s: string): TileKey[] {
  const out: TileKey[] = [];
  let pending: number[] = [];
  for (const ch of s.replace(/\s+/g, '')) {
    if (ch >= '0' && ch <= '9') { pending.push(+ch); continue; }
    const hi = HONOR_CHARS.indexOf(ch);
    if (hi >= 0 && pending.length === 0) { out.push(27 + hi); continue; }
    const suit = 'mpsz'.indexOf(ch);
    if (suit < 0) throw new Error(`Bad tile string: ${s}`);
    for (const n of pending) {
      if (suit === 3) {
        if (n < 1 || n > 7) throw new Error(`Bad honor ${n}z`);
        out.push(26 + n);
      } else if (n === 0) {
        if (suit === 0) throw new Error('No red 5m in sanma');
        out.push(suit === 1 ? RED_5P : RED_5S);
      } else {
        out.push(suit * 9 + n - 1);
      }
    }
    pending = [];
  }
  if (pending.length) throw new Error(`Dangling digits in ${s}`);
  return out;
}

export function toCounts(tiles: readonly TileKey[]): number[] {
  const c = new Array(34).fill(0);
  for (const t of tiles) c[kindOf(t)]++;
  return c;
}

/** Sort order for display: man, pin, sou, honors; red five sorts with its five. */
export function sortKey(t: TileKey): number {
  const k = kindOf(t);
  return k * 2 + (isRed(t) ? 0 : 1);
}

export function sortTiles(tiles: TileKey[]): TileKey[] {
  return tiles.slice().sort((a, b) => sortKey(a) - sortKey(b));
}

export function countsKey(c: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < 34; i++) s += c[i];
  return s;
}

/** Wind kind for a seat wind index 0..2 (East, South, West). */
export const windKind = (seatWindIndex: number): Kind => EAST + seatWindIndex;
