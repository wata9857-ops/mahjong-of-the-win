import type { Kind, TileKey } from '../core/tiles';
import type { Meld } from '../core/scoring';

/** Relative seats: 0 = me, 1 = shimocha (plays after me), 2 = kamicha (plays before me). */
export type Seat = 0 | 1 | 2;
export const nextSeat = (s: Seat): Seat => ((s + 1) % 3) as Seat;
export const SEAT_NAMES = ['自家', '下家', '上家'] as const;
export const SEAT_SHORT = ['自分', '下家', '上家'] as const;

export const START_POINTS = 35000;
export const TARGET_POINTS = 40000;
export const RETURN_POINTS = 35000;
export const UMA = [15, 0, -15];
/** Live wall at deal: 108 tiles - 39 dealt - 14 dead wall. */
export const LIVE_WALL_START = 55;

export interface MatchInfo {
  /** 0 = East round, 1 = South (sudden-death extension) */
  roundWind: 0 | 1;
  handNumber: 1 | 2 | 3;
  honba: number;
  kyotaku: number;
  dealer: Seat;
  /** seat that was East in East-1 (tie-break: closer to this seat ranks higher) */
  initialDealer: Seat;
  scores: [number, number, number];
}

export type GameEvent =
  | { t: 'dora'; tile: TileKey }
  | { t: 'deal'; tile: TileKey }
  | { t: 'draw'; tile: TileKey }
  | { t: 'discard'; seat: Seat; tile: TileKey; riichi?: boolean }
  | { t: 'pon'; seat: Seat }
  | { t: 'daiminkan'; seat: Seat }
  | { t: 'ankan'; seat: Seat; kind: Kind }
  | { t: 'kakan'; seat: Seat; kind: Kind }
  | { t: 'kita'; seat: Seat }
  | { t: 'wall'; delta: number }
  /** begin play with whatever part of the starting hand was entered */
  | { t: 'start' }
  /** I drew a tile but did not enter which one */
  | { t: 'drawUnknown' }
  /** identify one of my unknown concealed tiles */
  | { t: 'reveal'; tile: TileKey };

export interface DiscardInfo {
  tile: TileKey;
  riichi: boolean;
  called: boolean;
  /** global discard counter (for riichi-pass safety and ordering) */
  idx: number;
  tsumogiri?: boolean;
}

export interface PlayerState {
  discards: DiscardInfo[];
  melds: Meld[];
  kita: number;
  riichi: boolean;
  doubleRiichi: boolean;
  /** global idx of the riichi declaration discard (-1 if none) */
  riichiIdx: number;
  ippatsu: boolean;
}

export interface PendingRon {
  seat: Seat;
  tile: TileKey;
  kind: 'discard' | 'chankan' | 'kita';
}

export interface HandState {
  phase: 'setup' | 'play';
  match: MatchInfo;
  doraIndicators: TileKey[];
  myHand: TileKey[];
  myDrawn: TileKey | null;
  players: [PlayerState, PlayerState, PlayerState];
  turn: Seat;
  /** for my turn: waiting for the draw tile or for a discard */
  stage: 'draw' | 'discard';
  /** the most recent discard, still callable (null once the next action happened) */
  lastDiscard: { seat: Seat; tile: TileKey; idx: number } | null;
  /** a tile currently robbable by me (discard, kakan or kita) */
  pendingRon: PendingRon | null;
  wall: number;
  discardCounter: number;
  rinshanNext: boolean;
  /** my previous draw was a rinshan draw (for Rinshan Kaihou) */
  lastDrawRinshan: boolean;
  myFuritenTemp: boolean;
  myFuritenRiichi: boolean;
  /** no call / kan / kita has happened yet (double riichi / tenhou / chiihou / kyuushu) */
  uninterrupted: boolean;
  /** I ponned this turn — swap-calling (kuikae) of this kind is prohibited */
  kuikaeKind: Kind | null;
  /** turn began via a call (no draw) */
  turnByCall: boolean;
  /** my concealed tiles whose identity was never entered */
  unknown: number;
  warnings: string[];
}
