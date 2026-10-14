import type { Kind, TileKey } from '../core/tiles';
import type { Objective } from './placement';

export type Mode = 'instant' | 'advanced' | 'max';

export type ActionKind = 'discard' | 'riichi' | 'tsumo' | 'ron' | 'pon' | 'daiminkan' | 'ankan' | 'kakan' | 'kita' | 'pass' | 'fold';

export interface Candidate {
  kind: ActionKind;
  /** tile to discard (discard / riichi / fold / after pon) */
  tile?: TileKey;
  /** kan / kita tile kind */
  callKind?: Kind;
  label: string;
  /** objective utility (P(1st) based) */
  utility: number;
  pFirst: number;
  pLast: number;
  /** expected change of my score this hand (points) */
  evPoints: number;
  /** probability I win this hand under this plan */
  winProb: number;
  /** average value when I win */
  winValue: number;
  /** probability the action itself deals in immediately */
  immediateRisk: number;
  /** probability I deal in at any point this hand under this plan */
  totalDealIn: number;
  shanten?: number;
  ukeire?: number;
  waits?: Kind[];
  reason: string;
  /** short imperative for the UI, e.g. 「五筒を切る」 */
  say?: string;
  /** beginner-friendly one-line explanation */
  why?: string;
  /** glossary hint for the key term, if any */
  hint?: string;
}

export interface Analysis {
  id: number;
  mode: Mode;
  stage: 'final' | 'partial';
  situation: 'my-turn' | 'call' | 'idle';
  candidates: Candidate[];
  confidence: number;
  ms: number;
  shanten: number;
  /** combined deal-in probability per kind (for hand tile danger shading) */
  danger: number[];
  opponents: { seat: number; tenpai: number; value: number; riichi: boolean; notes: string[] }[];
  notes: string[];
  placementNow: { pFirst: number; pSecond: number; pThird: number };
  /** number of my concealed tiles that are still unknown */
  unknown: number;
  /** true when the recommendation is based on partial information */
  partial: boolean;
}

export interface AnalyzeRequest {
  id: number;
  mode: Mode;
  objective: Objective;
  /** events + match to rebuild state inside the worker */
  match: import('../game/types').MatchInfo;
  events: import('../game/types').GameEvent[];
}
