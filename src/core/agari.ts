// Enumerate all standard decompositions of a complete closed portion.

import { isSequenceSuit } from './tiles';

export interface SetBlock {
  type: 'seq' | 'tri';
  /** lowest kind of the set */
  tile: number;
}

export interface Decomposition {
  pair: number;
  sets: SetBlock[];
}

function extract(c: number[], i: number, sets: SetBlock[], out: SetBlock[][]): void {
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) { out.push(sets.slice()); return; }
  if (c[i] >= 3) {
    c[i] -= 3; sets.push({ type: 'tri', tile: i });
    extract(c, i, sets, out);
    sets.pop(); c[i] += 3;
  }
  if (isSequenceSuit(i) && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--; sets.push({ type: 'seq', tile: i });
    extract(c, i, sets, out);
    sets.pop(); c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

/** All (pair + sets) decompositions of counts with 3k+2 tiles. */
export function decompositions(counts: ArrayLike<number>): Decomposition[] {
  const c = Array.from(counts);
  const res: Decomposition[] = [];
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const out: SetBlock[][] = [];
    extract(c, 0, [], out);
    for (const sets of out) res.push({ pair: p, sets });
    c[p] += 2;
  }
  return res;
}

export function isChiitoi(c: ArrayLike<number>): boolean {
  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    if (c[i] === 2) pairs++;
    else if (c[i] !== 0) return false;
  }
  return pairs === 7;
}

const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
export function isKokushi(c: ArrayLike<number>): boolean {
  let pair = false;
  let total = 0;
  for (const k of YAOCHU) {
    if (c[k] === 0) return false;
    if (c[k] === 2) pair = true;
    total += c[k];
  }
  let all = 0;
  for (let i = 0; i < 34; i++) all += c[i];
  return pair && total === 14 && all === 14;
}

export function isComplete(c: ArrayLike<number>, melds: number): boolean {
  if (melds === 0 && (isChiitoi(c) || isKokushi(c))) return true;
  return decompositions(c).length > 0;
}
