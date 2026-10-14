// Pure helpers for the quick-start flow and the turn banner (unit-tested).

import type { MyLegal } from '../game/legal';
import type { HandState, Seat } from '../game/types';

export const COUNTDOWN_MS = 4000;

/** Remaining whole seconds to display (4,3,2,1) and whether the countdown is over. */
export function countdownState(startedAt: number, now: number, total = COUNTDOWN_MS): { secondsLeft: number; fraction: number; done: boolean } {
  const left = Math.max(0, total - (now - startedAt));
  return { secondsLeft: Math.ceil(left / 1000), fraction: left / total, done: left <= 0 };
}

/** My seat wind (0 = 東, 1 = 南, 2 = 西) → relative seat of the dealer. */
export function dealerFromMyWind(wind: 0 | 1 | 2): Seat {
  return ((3 - wind) % 3) as Seat;
}

export type InputMode =
  | { kind: 'dora' }
  | { kind: 'reveal' }
  | { kind: 'deal' }
  | { kind: 'draw' }
  | { kind: 'discard'; seat: Seat }
  | { kind: 'kan'; seat: Seat };

export function inputMode(st: HandState, o: { dora: boolean; reveal: boolean; kanSeat: Seat | null; override: Seat | null }): InputMode {
  if (o.dora) return { kind: 'dora' };
  if (o.reveal && st.unknown > 0) return { kind: 'reveal' };
  if (st.phase === 'setup') return { kind: 'deal' };
  if (o.kanSeat !== null) return { kind: 'kan', seat: o.kanSeat };
  const seat = o.override ?? st.turn;
  if (seat === 0) return st.turn === 0 && st.stage === 'discard' ? { kind: 'discard', seat: 0 } : { kind: 'draw' };
  return { kind: 'discard', seat };
}

const NAME = ['あなた', '下家', '上家'] as const;

export interface TurnInfo {
  /** whose area to highlight */
  seat: Seat;
  title: string;
  sub: string;
  tone: 'me' | 'opp' | 'info' | 'call';
}

/** The big “whose turn is it” banner. */
export function turnInfo(st: HandState, mode: InputMode, legal: Pick<MyLegal, 'pon' | 'ron' | 'daiminkan'>): TurnInfo {
  switch (mode.kind) {
    case 'dora': return { seat: st.turn, title: 'ドラ表示牌の入力', sub: 'ドラ表示牌（王牌でめくられている牌）をタップしてください', tone: 'info' };
    case 'reveal': return { seat: 0, title: '手牌の追加入力', sub: `わからなかった手牌をタップしてください（残り${st.unknown}枚）`, tone: 'info' };
    case 'deal': return { seat: 0, title: '配牌の入力', sub: `わかる牌をタップしてください（${st.myHand.length}枚入力済み）`, tone: 'info' };
    case 'kan': return { seat: mode.seat, title: `${NAME[mode.seat]}のカン`, sub: 'カンした牌をタップしてください', tone: 'info' };
    case 'draw': return { seat: 0, title: 'あなたの番です', sub: st.rinshanNext ? '補充した牌（嶺上牌）を選んでください' : 'ツモった牌を選んでください', tone: 'me' };
    case 'discard':
      if (mode.seat === 0) return { seat: 0, title: 'あなたの番です', sub: '切る牌を選んでください', tone: 'me' };
      if ((legal.ron || legal.pon || legal.daiminkan) && st.pendingRon) {
        const what = [legal.ron && 'ロン', legal.pon && 'ポン', legal.daiminkan && 'カン'].filter(Boolean).join('・');
        return { seat: mode.seat, title: `${what}できます`, sub: `しない場合は、そのまま${NAME[mode.seat]}の捨て牌をタップ`, tone: 'call' };
      }
      return { seat: mode.seat, title: `${NAME[mode.seat]}の番です`, sub: `${NAME[mode.seat]}が捨てた牌をタップしてください`, tone: 'opp' };
  }
}
