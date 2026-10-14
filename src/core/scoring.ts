// Scoring engine for Mahjong Soul three-player ranked rules.
// - No kiriage mangan; kazoe yakuman at 13 han; yakuman stack; double yakuman for
//   kokushi 13-wait, suuankou tanki, junsei chuuren, daisuushii.
// - North is an otakaze (non-value wind) when used in the hand.
// - Nuki dora (kita) count as dora, and count again if North is the (ura) dora.
// - Tsumo loss: a non-dealer tsumo collects only from the two existing players.
// - Honba: 1000 per stack (ron); tsumo 500 from each payer.

import { decompositions, isChiitoi, isKokushi, type Decomposition } from './agari';
import {
  CHUN, EAST, HAKU, HATSU, NORTH, SOUTH, WEST, YAOCHU_KINDS,
  doraFromIndicator, isDragon, isHonor, isTerminal, isYaochu, numOf, suitOf,
} from './tiles';

export type MeldType = 'pon' | 'minkan' | 'ankan' | 'kakan';

export interface Meld {
  type: MeldType;
  kind: number;
  /** number of red fives inside the meld */
  reds: number;
  /** seat the called tile came from (relative), undefined for ankan */
  from?: number;
}

export const meldIsOpen = (m: Meld): boolean => m.type !== 'ankan';
export const meldIsKan = (m: Meld): boolean => m.type !== 'pon';

export interface WinContext {
  /** closed-hand counts INCLUDING the winning tile */
  closed: ArrayLike<number>;
  melds: readonly Meld[];
  winTile: number;
  tsumo: boolean;
  /** 27..29 */
  seatWind: number;
  /** 27 (East) or 28 (South) */
  roundWind: number;
  dealer: boolean;
  riichi?: boolean;
  doubleRiichi?: boolean;
  ippatsu?: boolean;
  haitei?: boolean;
  houtei?: boolean;
  rinshan?: boolean;
  chankan?: boolean;
  tenhou?: boolean;
  chiihou?: boolean;
  doraIndicators: readonly number[];
  uraIndicators?: readonly number[];
  /** red fives held (closed + melds) */
  aka: number;
  /** extracted north tiles */
  kita: number;
}

export interface YakuItem { name: string; han: number; yakuman?: boolean }

export interface ScoreResult {
  valid: boolean;
  yaku: YakuItem[];
  han: number;
  fu: number;
  dora: number;
  /** number of yakuman multiples (0 if not yakuman) */
  yakuman: number;
  /** basic points (before multipliers) */
  base: number;
  /** points paid by discarder on ron (no honba) */
  ron: number;
  /** tsumo payments (no honba): dealer pays / non-dealer pays. For dealer wins both are equal */
  tsumoFromDealer: number;
  tsumoFromNonDealer: number;
  /** total gained by the winner from hand value only, given tsumo/ron in ctx */
  total: number;
  limitName: string;
}

const ceil100 = (x: number) => Math.ceil(x / 100) * 100;

export function basePoints(han: number, fu: number, yakuman: number): { base: number; limitName: string } {
  if (yakuman > 0) return { base: 8000 * yakuman, limitName: yakuman > 1 ? `${yakuman}x Yakuman` : 'Yakuman' };
  if (han >= 13) return { base: 8000, limitName: 'Kazoe Yakuman' };
  if (han >= 11) return { base: 6000, limitName: 'Sanbaiman' };
  if (han >= 8) return { base: 4000, limitName: 'Baiman' };
  if (han >= 6) return { base: 3000, limitName: 'Haneman' };
  const b = fu * Math.pow(2, han + 2);
  if (han >= 5 || b >= 2000) return { base: 2000, limitName: 'Mangan' };
  return { base: b, limitName: '' };
}

export interface Payments {
  ron: number;
  tsumoFromDealer: number;
  tsumoFromNonDealer: number;
}

export function payments(base: number, dealer: boolean): Payments {
  if (dealer) {
    return { ron: ceil100(base * 6), tsumoFromDealer: 0, tsumoFromNonDealer: ceil100(base * 2) };
  }
  return { ron: ceil100(base * 4), tsumoFromDealer: ceil100(base * 2), tsumoFromNonDealer: ceil100(base) };
}

/** Total collected by winner from hand value (without honba/kyotaku) under sanma tsumo loss. */
export function totalFor(p: Payments, dealer: boolean, tsumo: boolean): number {
  if (!tsumo) return p.ron;
  return dealer ? p.tsumoFromNonDealer * 2 : p.tsumoFromDealer + p.tsumoFromNonDealer;
}

export const HONBA_RON = 1000;
export const HONBA_TSUMO_EACH = 500;

/** Sum of dora for a hand (closed + melds + kita) from the given indicators. */
export function countDora(closed: ArrayLike<number>, melds: readonly Meld[], kita: number, indicators: readonly number[]): number {
  let n = 0;
  for (const ind of indicators) {
    const d = doraFromIndicator(ind);
    n += closed[d];
    for (const m of melds) if (m.kind === d) n += meldIsKan(m) ? 4 : 3;
    if (d === NORTH) n += kita;
  }
  return n;
}

interface SetInfo {
  type: 'seq' | 'tri';
  tile: number;
  open: boolean; // open for fu/sanankou purposes
  kan: boolean;
  concealedKan: boolean;
  fromMeld: boolean;
}

const isGreen = (k: number) => k === HATSU || k === 19 || k === 20 || k === 21 || k === 23 || k === 25; // 2,3,4,6,8s + hatsu

function yakuhaiCount(k: number, seatWind: number, roundWind: number): number {
  let n = 0;
  if (isDragon(k)) n++;
  if (k === seatWind) n++;
  if (k === roundWind) n++;
  return n;
}

interface Candidate { yaku: YakuItem[]; han: number; fu: number; yakuman: number }

function situationalYaku(ctx: WinContext, closedHand: boolean, out: YakuItem[]): void {
  if (ctx.doubleRiichi) out.push({ name: 'Double Riichi', han: 2 });
  else if (ctx.riichi) out.push({ name: 'Riichi', han: 1 });
  if (ctx.ippatsu && (ctx.riichi || ctx.doubleRiichi)) out.push({ name: 'Ippatsu', han: 1 });
  if (closedHand && ctx.tsumo) out.push({ name: 'Menzen Tsumo', han: 1 });
  if (ctx.haitei && ctx.tsumo && !ctx.rinshan) out.push({ name: 'Haitei', han: 1 });
  if (ctx.houtei && !ctx.tsumo) out.push({ name: 'Houtei', han: 1 });
  if (ctx.rinshan && ctx.tsumo) out.push({ name: 'Rinshan Kaihou', han: 1 });
  if (ctx.chankan && !ctx.tsumo) out.push({ name: 'Chankan', han: 1 });
}

function situationalYakuman(ctx: WinContext): YakuItem[] {
  const y: YakuItem[] = [];
  if (ctx.tenhou) y.push({ name: 'Tenhou', han: 1, yakuman: true });
  if (ctx.chiihou) y.push({ name: 'Chiihou', han: 1, yakuman: true });
  return y;
}

function allTilesKinds(ctx: WinContext): number[] {
  const c = Array.from(ctx.closed);
  for (const m of ctx.melds) c[m.kind] += meldIsKan(m) ? 4 : 3;
  return c;
}

function colorYaku(all: number[], closedHand: boolean, out: YakuItem[]): void {
  const suits = new Set<number>();
  let honors = false;
  for (let k = 0; k < 34; k++) {
    if (!all[k]) continue;
    if (k >= 27) honors = true; else suits.add(suitOf(k));
  }
  if (suits.size === 1) {
    if (honors) out.push({ name: 'Honitsu', han: closedHand ? 3 : 2 });
    else out.push({ name: 'Chinitsu', han: closedHand ? 6 : 5 });
  }
}

function evalRegular(ctx: WinContext, d: Decomposition, winIdx: number, closedHand: boolean): Candidate | null {
  // winIdx: -1 = pair (tanki), otherwise index into d.sets which contains winTile
  const sets: SetInfo[] = d.sets.map((s, i) => ({
    type: s.type, tile: s.tile,
    open: s.type === 'tri' && !ctx.tsumo && i === winIdx, // ron-completed triplet counts as minkou
    kan: false, concealedKan: false, fromMeld: false,
  }));
  for (const m of ctx.melds) {
    sets.push({ type: 'tri', tile: m.kind, open: meldIsOpen(m), kan: meldIsKan(m), concealedKan: m.type === 'ankan', fromMeld: true });
  }
  const w = ctx.winTile;
  let wait: 'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki';
  if (winIdx === -1) wait = 'tanki';
  else {
    const s = d.sets[winIdx];
    if (s.type === 'tri') wait = 'shanpon';
    else {
      const pos = w - s.tile;
      const n = numOf(s.tile);
      if (pos === 1) wait = 'kanchan';
      else if ((pos === 0 && n === 7) || (pos === 2 && n === 1)) wait = 'penchan';
      else wait = 'ryanmen';
    }
  }

  const yakuman: YakuItem[] = situationalYakuman(ctx);
  const all = allTilesKinds(ctx);
  const tris = sets.filter(s => s.type === 'tri');
  const seqs = sets.filter(s => s.type === 'seq');
  const ankou = tris.filter(s => !s.open).length;
  const kans = sets.filter(s => s.kan).length;
  const pair = d.pair;

  // --- yakuman ---
  if (ankou === 4) yakuman.push(wait === 'tanki' ? { name: 'Suuankou Tanki', han: 2, yakuman: true } : { name: 'Suuankou', han: 1, yakuman: true });
  const dragonTris = tris.filter(s => isDragon(s.tile)).length;
  if (dragonTris === 3) yakuman.push({ name: 'Daisangen', han: 1, yakuman: true });
  const windTris = tris.filter(s => s.tile >= EAST && s.tile <= NORTH).length;
  if (windTris === 4) yakuman.push({ name: 'Daisuushii', han: 2, yakuman: true });
  else if (windTris === 3 && pair >= EAST && pair <= NORTH) yakuman.push({ name: 'Shousuushii', han: 1, yakuman: true });
  let allHonor = true, allTerm = true, allGreen = true;
  for (let k = 0; k < 34; k++) {
    if (!all[k]) continue;
    if (!isHonor(k)) allHonor = false;
    if (!isTerminal(k)) allTerm = false;
    if (!isGreen(k)) allGreen = false;
  }
  if (allHonor) yakuman.push({ name: 'Tsuuiisou', han: 1, yakuman: true });
  if (allTerm) yakuman.push({ name: 'Chinroutou', han: 1, yakuman: true });
  if (allGreen) yakuman.push({ name: 'Ryuuiisou', han: 1, yakuman: true });
  if (kans === 4) yakuman.push({ name: 'Suukantsu', han: 1, yakuman: true });
  if (closedHand && ctx.melds.length === 0) {
    const ch = chuuren(ctx.closed, ctx.winTile);
    if (ch) yakuman.push(ch);
  }
  if (yakuman.length) {
    return { yaku: yakuman, han: 0, fu: 0, yakuman: yakuman.reduce((a, y) => a + y.han, 0) };
  }

  // --- regular yaku ---
  const yaku: YakuItem[] = [];
  situationalYaku(ctx, closedHand, yaku);

  const isPinfuShape = closedHand && tris.length === 0 && yakuhaiCount(pair, ctx.seatWind, ctx.roundWind) === 0 && wait === 'ryanmen';
  if (isPinfuShape) yaku.push({ name: 'Pinfu', han: 1 });

  let tanyao = true;
  for (let k = 0; k < 34; k++) if (all[k] && isYaochu(k)) { tanyao = false; break; }
  if (tanyao) yaku.push({ name: 'Tanyao', han: 1 });

  if (closedHand) {
    const seqKeys = seqs.map(s => s.tile).sort((a, b) => a - b);
    let dup = 0;
    const cnt = new Map<number, number>();
    for (const k of seqKeys) cnt.set(k, (cnt.get(k) ?? 0) + 1);
    for (const v of cnt.values()) dup += Math.floor(v / 2);
    if (dup >= 2) yaku.push({ name: 'Ryanpeikou', han: 3 });
    else if (dup === 1) yaku.push({ name: 'Iipeikou', han: 1 });
  }

  for (const s of tris) {
    const k = s.tile;
    if (k === HAKU) yaku.push({ name: 'Yakuhai: Haku', han: 1 });
    if (k === HATSU) yaku.push({ name: 'Yakuhai: Hatsu', han: 1 });
    if (k === CHUN) yaku.push({ name: 'Yakuhai: Chun', han: 1 });
    if (k === ctx.seatWind) yaku.push({ name: `Seat Wind: ${windName(k)}`, han: 1 });
    if (k === ctx.roundWind) yaku.push({ name: `Round Wind: ${windName(k)}`, han: 1 });
  }

  if (tris.length === 4) yaku.push({ name: 'Toitoi', han: 2 });
  if (ankou === 3) yaku.push({ name: 'Sanankou', han: 2 });
  if (kans === 3) yaku.push({ name: 'Sankantsu', han: 2 });
  // Sanshoku doukou (possible in sanma only with 1s or 9s across m/p/s)
  for (let n = 0; n < 9; n++) {
    if (tris.some(s => s.tile === n) && tris.some(s => s.tile === 9 + n) && tris.some(s => s.tile === 18 + n)) {
      yaku.push({ name: 'Sanshoku Doukou', han: 2 });
    }
  }
  // Sanshoku doujun is impossible in sanma (no manzu sequences).
  if (dragonTris === 2 && isDragon(pair)) yaku.push({ name: 'Shousangen', han: 2 });

  const allYaochu = YAOCHU_KINDS.reduce((a, k) => a + all[k], 0) === all.reduce((a, b) => a + b, 0);
  if (allYaochu) yaku.push({ name: 'Honroutou', han: 2 });
  else if (seqs.length > 0) {
    const setHasYaochu = (s: SetInfo) => (s.type === 'seq' ? numOf(s.tile) === 1 || numOf(s.tile) === 7 : isYaochu(s.tile));
    if (sets.every(setHasYaochu) && isYaochu(pair)) {
      const anyHonor = sets.some(s => isHonor(s.tile)) || isHonor(pair);
      if (anyHonor) yaku.push({ name: 'Chanta', han: closedHand ? 2 : 1 });
      else yaku.push({ name: 'Junchan', han: closedHand ? 3 : 2 });
    }
  }
  // Ittsu
  for (const base of [9, 18]) {
    if ([0, 3, 6].every(o => seqs.some(s => s.tile === base + o))) yaku.push({ name: 'Ittsu', han: closedHand ? 2 : 1 });
  }
  colorYaku(all, closedHand, yaku);

  // --- fu ---
  let fu: number;
  if (isPinfuShape) {
    fu = ctx.tsumo ? 20 : 30;
  } else {
    fu = 20;
    if (closedHand && !ctx.tsumo) fu += 10;
    if (ctx.tsumo) fu += 2;
    for (const s of tris) {
      let f = 2;
      if (isYaochu(s.tile)) f *= 2;
      if (!s.open) f *= 2;
      if (s.kan) f *= 4;
      fu += f;
    }
    fu += 2 * yakuhaiCount(pair, ctx.seatWind, ctx.roundWind); // double wind pair = 4 fu
    if (wait === 'kanchan' || wait === 'penchan' || wait === 'tanki') fu += 2;
    if (!closedHand && fu === 20) fu = 30;
    fu = Math.ceil(fu / 10) * 10;
  }
  const han = yaku.reduce((a, y) => a + y.han, 0);
  return { yaku, han, fu, yakuman: 0 };
}

function windName(k: number): string {
  return k === EAST ? 'East' : k === SOUTH ? 'South' : k === WEST ? 'West' : 'North';
}

function chuuren(c: ArrayLike<number>, win: number): YakuItem | null {
  for (const base of [9, 18]) {
    let tot = 0;
    for (let k = 0; k < 34; k++) if (c[k] && (k < base || k >= base + 9)) return null;
    const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
    let extra = -1;
    let ok = true;
    for (let i = 0; i < 9; i++) {
      const v = c[base + i];
      tot += v;
      if (v < need[i]) { ok = false; break; }
      if (v > need[i]) extra = base + i;
    }
    if (!ok || tot !== 14) continue;
    if (extra === win) return { name: 'Junsei Chuuren Poutou', han: 2, yakuman: true };
    return { name: 'Chuuren Poutou', han: 1, yakuman: true };
  }
  return null;
}

function evalChiitoi(ctx: WinContext): Candidate {
  const yakuman = situationalYakuman(ctx);
  let allHonor = true;
  for (let k = 0; k < 27; k++) if (ctx.closed[k]) allHonor = false;
  if (allHonor) yakuman.push({ name: 'Tsuuiisou', han: 1, yakuman: true });
  if (yakuman.length) return { yaku: yakuman, han: 0, fu: 0, yakuman: yakuman.reduce((a, y) => a + y.han, 0) };
  const yaku: YakuItem[] = [];
  situationalYaku(ctx, true, yaku);
  yaku.push({ name: 'Chiitoitsu', han: 2 });
  const all = Array.from(ctx.closed);
  let tanyao = true, allYaochu = true;
  for (let k = 0; k < 34; k++) {
    if (!all[k]) continue;
    if (isYaochu(k)) tanyao = false; else allYaochu = false;
  }
  if (tanyao) yaku.push({ name: 'Tanyao', han: 1 });
  if (allYaochu) yaku.push({ name: 'Honroutou', han: 2 });
  colorYaku(all, true, yaku);
  return { yaku, han: yaku.reduce((a, y) => a + y.han, 0), fu: 25, yakuman: 0 };
}

function evalKokushi(ctx: WinContext): Candidate {
  const y = situationalYakuman(ctx);
  // 13-sided: the winning tile is the pair tile
  if (ctx.closed[ctx.winTile] === 2) y.push({ name: 'Kokushi Musou 13-wait', han: 2, yakuman: true });
  else y.push({ name: 'Kokushi Musou', han: 1, yakuman: true });
  return { yaku: y, han: 0, fu: 0, yakuman: y.reduce((a, x) => a + x.han, 0) };
}

const INVALID: ScoreResult = {
  valid: false, yaku: [], han: 0, fu: 0, dora: 0, yakuman: 0, base: 0, ron: 0,
  tsumoFromDealer: 0, tsumoFromNonDealer: 0, total: 0, limitName: '',
};

/** Score a complete hand. Returns valid=false if the hand is incomplete or has no yaku. */
export function scoreHand(ctx: WinContext): ScoreResult {
  const closedHand = ctx.melds.every(m => m.type === 'ankan');
  const cands: Candidate[] = [];
  if (ctx.melds.length === 0 && isKokushi(ctx.closed)) cands.push(evalKokushi(ctx));
  if (ctx.melds.length === 0 && isChiitoi(ctx.closed)) cands.push(evalChiitoi(ctx));
  for (const d of decompositions(ctx.closed)) {
    if (d.pair === ctx.winTile) {
      const c = evalRegular(ctx, d, -1, closedHand);
      if (c) cands.push(c);
    }
    const seen = new Set<string>();
    d.sets.forEach((s, i) => {
      const contains = s.type === 'tri' ? s.tile === ctx.winTile : ctx.winTile >= s.tile && ctx.winTile <= s.tile + 2;
      if (!contains) return;
      const key = `${s.type}${s.tile}${s.type === 'seq' ? ctx.winTile - s.tile : ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const c = evalRegular(ctx, d, i, closedHand);
      if (c) cands.push(c);
    });
  }
  if (!cands.length) return INVALID;

  const doraBase = countDora(ctx.closed, ctx.melds, ctx.kita, ctx.doraIndicators);
  const ura = (ctx.riichi || ctx.doubleRiichi) && ctx.uraIndicators ? countDora(ctx.closed, ctx.melds, ctx.kita, ctx.uraIndicators) : 0;
  const dora = doraBase + ura + ctx.aka + ctx.kita;

  let best: ScoreResult = INVALID;
  for (const c of cands) {
    if (c.yakuman === 0 && c.han === 0) continue; // no yaku
    const yaku = c.yaku.slice();
    let han = c.han;
    if (c.yakuman === 0) {
      if (doraBase) yaku.push({ name: 'Dora', han: doraBase });
      if (ctx.aka) yaku.push({ name: 'Aka Dora', han: ctx.aka });
      if (ctx.kita) yaku.push({ name: 'Nuki Dora (Kita)', han: ctx.kita });
      if (ura) yaku.push({ name: 'Ura Dora', han: ura });
      han += dora;
    }
    const { base, limitName } = basePoints(han, c.fu, c.yakuman);
    const p = payments(base, ctx.dealer);
    const r: ScoreResult = {
      valid: true, yaku, han, fu: c.fu, dora: c.yakuman ? 0 : dora, yakuman: c.yakuman, base,
      ron: p.ron, tsumoFromDealer: p.tsumoFromDealer, tsumoFromNonDealer: p.tsumoFromNonDealer,
      total: totalFor(p, ctx.dealer, ctx.tsumo), limitName,
    };
    if (!best.valid || r.total > best.total || (r.total === best.total && r.han > best.han)) best = r;
  }
  return best;
}

/** Score table lookup for han/fu entry from the UI (non-yakuman). */
export function scoreFromHanFu(han: number, fu: number, dealer: boolean, yakuman = 0): Payments & { base: number } {
  const { base } = basePoints(han, fu, yakuman);
  return { base, ...payments(base, dealer) };
}
