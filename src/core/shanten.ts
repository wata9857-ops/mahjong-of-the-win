// Exact shanten calculation (regular / chiitoitsu / kokushi) tuned for sanma.
//
// Regular-hand shanten uses per-segment decomposition memoised by a base-5
// key of the segment's counts. Each segment yields the set of reachable
// (mentsu, taatsu, head) triples; the four segments are then combined.
// Manzu (only 1m/9m) and honors cannot form sequences, so they use the
// "no-sequence" decomposer — this matters: 1m-9m can never be a taatsu in sanma.

import { YAOCHU_KINDS } from './tiles';

type Opts = Int32Array; // encoded m*32 + t*2 + p

const seqCache = new Map<number, Opts>();
const noSeqCache = new Map<number, Opts>();

function decompose(c: number[], orig: number[], n: number, seq: boolean, i: number, m: number, t: number, p: number, out: Set<number>): void {
  while (i < n && c[i] === 0) i++;
  if (i === n) { out.add(m * 32 + t * 2 + p); return; }
  // triplet
  if (c[i] >= 3) { c[i] -= 3; decompose(c, orig, n, seq, i, m + 1, t, p, out); c[i] += 3; }
  // sequence
  if (seq && i + 2 < n && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    decompose(c, orig, n, seq, i, m + 1, t, p, out);
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
  if (c[i] >= 2) {
    c[i] -= 2;
    if (p === 0) decompose(c, orig, n, seq, i, m, t, 1, out);
    // a pair used as a taatsu needs a 5th copy if we hold all four
    if (orig[i] < 4) decompose(c, orig, n, seq, i, m, t + 1, p, out);
    c[i] += 2;
  }
  if (seq) {
    if (i + 1 < n && c[i + 1] > 0) {
      c[i]--; c[i + 1]--; decompose(c, orig, n, seq, i, m, t + 1, p, out); c[i]++; c[i + 1]++;
    }
    if (i + 2 < n && c[i + 2] > 0) {
      c[i]--; c[i + 2]--; decompose(c, orig, n, seq, i, m, t + 1, p, out); c[i]++; c[i + 2]++;
    }
  }
  // leave tile isolated
  c[i]--; decompose(c, orig, n, seq, i, m, t, p, out); c[i]++;
}

// Option b dominates a when m_b >= m_a, m_b + t_b >= m_a + t_a and p_b >= p_a:
// the combined score is (M) + min(M + T, 4) + P, monotone in M, M+T and P.
function prune(set: Set<number>): Opts {
  const arr = [...set];
  const keep: number[] = [];
  for (const a of arr) {
    const am = a >> 5, at = (a >> 1) & 15, ap = a & 1;
    let dominated = false;
    for (const b of arr) {
      if (b === a) continue;
      const bm = b >> 5, bt = (b >> 1) & 15, bp = b & 1;
      if (bm >= am && bm + bt >= am + at && bp >= ap) { dominated = true; break; }
    }
    if (!dominated) keep.push(a);
  }
  return Int32Array.from(keep);
}

function segOpts(c: ArrayLike<number>, start: number, n: number, seq: boolean): Opts {
  let key = 0;
  for (let i = 0; i < n; i++) key = key * 5 + c[start + i];
  const cache = seq ? seqCache : noSeqCache;
  let r = cache.get(key);
  if (r) return r;
  const arr: number[] = [];
  for (let i = 0; i < n; i++) arr.push(c[start + i]);
  const set = new Set<number>();
  decompose(arr, arr.slice(), n, seq, 0, 0, 0, 0, set);
  r = prune(set);
  cache.set(key, r);
  return r;
}

const MAN_SEG = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Regular-hand shanten. `melds` = number of called/declared sets. */
export function shantenRegular(c: ArrayLike<number>, melds: number): number {
  // Manzu: only 1m and 9m; treat as a 2-tile no-sequence segment.
  MAN_SEG[0] = c[0]; MAN_SEG[1] = c[8];
  const a = segOpts(MAN_SEG, 0, 2, false);
  const b = segOpts(c, 9, 9, true);
  const d = segOpts(c, 18, 9, true);
  const h = segOpts(c, 27, 7, false);
  let best = 8;
  for (let i = 0; i < a.length; i++) {
    const am = a[i] >> 5, at = (a[i] >> 1) & 15, ap = a[i] & 1;
    for (let j = 0; j < b.length; j++) {
      const bm = am + (b[j] >> 5), bt = at + ((b[j] >> 1) & 15), bp = ap + (b[j] & 1);
      if (bp > 1) continue;
      for (let k = 0; k < d.length; k++) {
        const dm = bm + (d[k] >> 5), dt = bt + ((d[k] >> 1) & 15), dp = bp + (d[k] & 1);
        if (dp > 1) continue;
        for (let l = 0; l < h.length; l++) {
          const p = dp + (h[l] & 1);
          if (p > 1) continue;
          const m = dm + (h[l] >> 5) + melds;
          let t = dt + ((h[l] >> 1) & 15);
          if (m + t > 4) t = 4 - m;
          const s = 8 - 2 * m - t - p;
          if (s < best) best = s;
        }
      }
    }
  }
  return best;
}

export function shantenChiitoi(c: ArrayLike<number>): number {
  let pairs = 0, kinds = 0;
  for (let i = 0; i < 34; i++) {
    if (c[i] >= 1) kinds++;
    if (c[i] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function shantenKokushi(c: ArrayLike<number>): number {
  let kinds = 0, pair = 0;
  for (const k of YAOCHU_KINDS) {
    if (c[k] >= 1) kinds++;
    if (c[k] >= 2) pair = 1;
  }
  return 13 - kinds - pair;
}

export function tileCount(c: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < 34; i++) n += c[i];
  return n;
}

/** Overall shanten. -1 means a complete hand. Closed-only forms apply when melds === 0. */
export function shanten(c: ArrayLike<number>, melds = 0): number {
  let s = shantenRegular(c, melds);
  if (melds === 0) {
    const n = tileCount(c);
    if (n >= 13) {
      s = Math.min(s, shantenChiitoi(c), shantenKokushi(c));
    }
  }
  return s;
}

export interface Ukeire {
  /** kinds that reduce shanten */
  tiles: number[];
  /** total unseen copies of those kinds */
  count: number;
}

/**
 * Tiles that reduce shanten for a 3k+1 hand.
 * `unseen` = per-kind copies not visible to us (if omitted, 4 - held).
 */
export function ukeire(c: number[], melds: number, unseen?: ArrayLike<number>, base?: number): Ukeire {
  const s = base ?? shanten(c, melds);
  const tiles: number[] = [];
  let count = 0;
  for (let k = 0; k < 34; k++) {
    if (k > 0 && k < 8) continue; // 2m-8m don't exist
    const left = unseen ? unseen[k] : 4 - c[k];
    if (c[k] >= 4) continue;
    c[k]++;
    const ns = shanten(c, melds);
    c[k]--;
    if (ns < s) { tiles.push(k); count += Math.max(0, left); }
  }
  return { tiles, count };
}
