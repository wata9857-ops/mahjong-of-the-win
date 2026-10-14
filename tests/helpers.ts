import { parseTiles } from '../src/core/tiles';
import { newMatch } from '../src/game/match';
import { replay } from '../src/game/state';
import type { GameEvent, MatchInfo, Seat } from '../src/game/types';

/** Build events: dora indicator + 13 dealt tiles. */
export function dealEvents(hand: string, dora = '1z'): GameEvent[] {
  return [
    { t: 'dora', tile: parseTiles(dora)[0] },
    ...parseTiles(hand).map(tile => ({ t: 'deal' as const, tile })),
  ];
}

export const T = (s: string) => parseTiles(s)[0];

export function stateFrom(hand: string, extra: GameEvent[] = [], opts: { dealer?: Seat; match?: Partial<MatchInfo>; dora?: string } = {}) {
  const match = { ...newMatch(opts.dealer ?? 0), ...opts.match };
  const events = [...dealEvents(hand, opts.dora), ...extra];
  return { match, events, st: replay(match, events) };
}
