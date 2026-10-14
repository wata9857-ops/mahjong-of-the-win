// Match-level rules for sanma East-only ranked (Mahjong Soul):
// 35000 start, 40000 to finish, sudden-death South extension (no West),
// bankruptcy below zero, agari-yame / tenpai-yame for the final dealer,
// leftover deposits to first place, ties broken by initial-dealer order.

import { HONBA_RON, HONBA_TSUMO_EACH, scoreFromHanFu } from '../core/scoring';
import { RETURN_POINTS, TARGET_POINTS, UMA, nextSeat, type MatchInfo, type Seat } from './types';

export interface WinEntry {
  seat: Seat;
  han: number;
  fu: number;
  yakuman?: number;
}

export type HandResult =
  | { kind: 'ron'; loser: Seat; winners: WinEntry[] }
  | { kind: 'tsumo'; winner: WinEntry }
  | { kind: 'draw'; tenpai: [boolean, boolean, boolean]; nagashi?: Seat[] }
  | { kind: 'abort' };

export interface Settlement {
  deltas: [number, number, number];
  next: MatchInfo;
  ended: boolean;
  reason: string;
  /** final scores after leftover deposits, when ended */
  final?: [number, number, number];
  ranks?: Seat[];
}

/** Seats ordered by rank. Ties: the seat closer to the initial dealer (in turn order) ranks higher. */
export function rankSeats(scores: readonly number[], initialDealer: Seat): Seat[] {
  const dist = (s: Seat) => (s - initialDealer + 3) % 3;
  return ([0, 1, 2] as Seat[]).sort((a, b) => scores[b] - scores[a] || dist(a) - dist(b));
}

export function handPoints(e: WinEntry, dealer: boolean) {
  return scoreFromHanFu(e.han, e.fu, dealer, e.yakuman ?? 0);
}

/** Closest player to `from` in turn order among `cands`. */
function closest(from: Seat, cands: Seat[]): Seat {
  let s = nextSeat(from);
  for (let i = 0; i < 3; i++) { if (cands.includes(s)) return s; s = nextSeat(s); }
  return cands[0];
}

export function settleHand(m: MatchInfo, r: HandResult): Settlement {
  const d: [number, number, number] = [0, 0, 0];
  let renchan = false;
  let won = false;
  if (r.kind === 'ron') {
    won = true;
    const first = closest(r.loser, r.winners.map(w => w.seat));
    for (const w of r.winners) {
      const p = handPoints(w, w.seat === m.dealer);
      let pay = p.ron;
      if (w.seat === first) pay += HONBA_RON * m.honba;
      d[w.seat] += pay; d[r.loser] -= pay;
      if (w.seat === m.dealer) renchan = true;
    }
    d[first] += m.kyotaku * 1000;
  } else if (r.kind === 'tsumo') {
    won = true;
    const w = r.winner;
    const dealerWin = w.seat === m.dealer;
    const p = handPoints(w, dealerWin);
    for (const s of [0, 1, 2] as Seat[]) {
      if (s === w.seat) continue;
      const pay = (dealerWin ? p.tsumoFromNonDealer : s === m.dealer ? p.tsumoFromDealer : p.tsumoFromNonDealer) + HONBA_TSUMO_EACH * m.honba;
      d[s] -= pay; d[w.seat] += pay;
    }
    d[w.seat] += m.kyotaku * 1000;
    renchan = dealerWin;
  } else if (r.kind === 'draw') {
    if (r.nagashi && r.nagashi.length) {
      for (const ns of r.nagashi) {
        const p = scoreFromHanFu(5, 30, ns === m.dealer);
        for (const s of [0, 1, 2] as Seat[]) {
          if (s === ns) continue;
          const pay = ns === m.dealer ? p.tsumoFromNonDealer : s === m.dealer ? p.tsumoFromDealer : p.tsumoFromNonDealer;
          d[s] -= pay; d[ns] += pay;
        }
      }
    } else {
      const t = r.tenpai.filter(Boolean).length;
      if (t === 1 || t === 2) {
        for (const s of [0, 1, 2] as Seat[]) {
          if (r.tenpai[s]) d[s] += t === 1 ? 2000 : 1000;
          else d[s] -= t === 1 ? 1000 : 2000;
        }
      }
    }
    renchan = r.tenpai[m.dealer];
  } else {
    renchan = true;
  }

  return finishHand(m, d, renchan, won);
}

/**
 * Apply score deltas (deposits/honba already included in `d`) and advance the
 * match. `won` = the hand ended in a win (deposits claimed, honba reset unless renchan).
 */
export function finishHand(m: MatchInfo, d: [number, number, number], renchan: boolean, won: boolean): Settlement {
  const scores = m.scores.map((v, i) => v + d[i]) as [number, number, number];
  const next: MatchInfo = { ...m, scores, kyotaku: won ? 0 : m.kyotaku, honba: renchan || !won ? m.honba + 1 : 0 };
  return progress(m, next, d, renchan);
}

function progress(prev: MatchInfo, next: MatchInfo, d: [number, number, number], renchan: boolean): Settlement {
  const finish = (reason: string): Settlement => {
    const final = [...next.scores] as [number, number, number];
    const ranks = rankSeats(final, next.initialDealer);
    final[ranks[0]] += next.kyotaku * 1000;
    return { deltas: d, next: { ...next, kyotaku: 0 }, ended: true, reason, final, ranks };
  };
  if (next.scores.some(s => s < 0)) return finish('トビ終了');
  const ranks = rankSeats(next.scores, next.initialDealer);
  const topScore = next.scores[ranks[0]];
  const lateGame = prev.roundWind === 1 || prev.handNumber === 3;
  if (renchan) {
    if (lateGame && ranks[0] === prev.dealer && next.scores[prev.dealer] >= TARGET_POINTS) return finish('アガリやめ・テンパイやめ');
    return { deltas: d, next, ended: false, reason: '親の連荘' };
  }
  if (prev.roundWind === 1 && topScore >= TARGET_POINTS) return finish('サドンデス：トップが40,000点に到達');
  let hand = prev.handNumber + 1;
  let wind = prev.roundWind;
  if (hand > 3) {
    if (wind === 1) return finish('南場終了（西入なし）');
    if (topScore >= TARGET_POINTS) return finish('東場終了');
    wind = 1; hand = 1;
  }
  const dealer = ((next.initialDealer + hand - 1) % 3) as Seat;
  return {
    deltas: d,
    next: { ...next, roundWind: wind as 0 | 1, handNumber: hand as 1 | 2 | 3, dealer },
    ended: false,
    reason: wind === 1 && prev.roundWind === 0 ? '南入（サドンデス）' : '次局へ',
  };
}

/** Final placement points: (score - return)/1000 + uma. */
export function finalPoints(final: readonly number[], ranks: readonly Seat[]): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  ranks.forEach((s, i) => { out[s] = (final[s] - RETURN_POINTS) / 1000 + UMA[i]; });
  return out;
}

export function newMatch(dealer: Seat): MatchInfo {
  return { roundWind: 0, handNumber: 1, honba: 0, kyotaku: 0, dealer, initialDealer: dealer, scores: [35000, 35000, 35000] };
}

export function roundLabel(m: MatchInfo): string {
  return `${m.roundWind === 0 ? '東' : '南'}${m.handNumber}局`;
}
