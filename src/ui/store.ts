import type { Objective } from '../ai/placement';
import type { Mode } from '../ai/types';
import { newMatch } from '../game/match';
import type { GameEvent, MatchInfo } from '../game/types';

export interface Settings {
  mode: Mode;
  objective: Objective;
  showDanger: boolean;
}

export interface HistoryEntry {
  label: string;
  deltas: [number, number, number];
  reason: string;
}

export interface Saved {
  v: 1;
  match: MatchInfo;
  events: GameEvent[];
  redo: GameEvent[];
  settings: Settings;
  history: HistoryEntry[];
  started: boolean;
}

const KEY = 'pon-intended-v1';

export const defaultSettings: Settings = { mode: 'advanced', objective: 'top', showDanger: true };

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s.v === 1) return { ...s, settings: { ...defaultSettings, ...s.settings } };
    }
  } catch { /* ignore corrupt storage */ }
  return { v: 1, match: newMatch(0), events: [], redo: [], settings: defaultSettings, history: [], started: false };
}

export function save(s: Saved): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}
