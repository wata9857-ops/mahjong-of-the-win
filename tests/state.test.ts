import { describe, expect, it } from 'vitest';
import { NORTH } from '../src/core/tiles';
import { myLegalActions } from '../src/game/legal';
import { isMyFuriten } from '../src/game/rules';
import { replay } from '../src/game/state';
import { LIVE_WALL_START, type GameEvent } from '../src/game/types';
import { T, stateFrom } from './helpers';

describe('game-state transitions', () => {
  it('setup -> play after 13 tiles; dealer me waits for draw', () => {
    const { st } = stateFrom('19m123456789p11s');
    expect(st.phase).toBe('play');
    expect(st.turn).toBe(0);
    expect(st.stage).toBe('draw');
    expect(st.wall).toBe(LIVE_WALL_START);
  });
  it('turn order me -> right -> left -> me, wall decrements per draw', () => {
    const { st } = stateFrom('19m123456789p11s', [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E') },
      { t: 'discard', seat: 1, tile: T('S') },
      { t: 'discard', seat: 2, tile: T('W') },
    ]);
    expect(st.turn).toBe(0);
    expect(st.stage).toBe('draw');
    expect(st.wall).toBe(LIVE_WALL_START - 3);
    expect(st.players[1].discards.length).toBe(1);
  });
  it('non-dealer start: dealer opponent already drew', () => {
    const { st } = stateFrom('19m123456789p11s', [], { dealer: 1 });
    expect(st.turn).toBe(1);
    expect(st.wall).toBe(LIVE_WALL_START - 1);
  });
  it('pon by me skips the left player and keeps wall consistent', () => {
    // Right discards 1s, I pon; left's implied draw is undone.
    const { st } = stateFrom('19m123456789p11s', [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E') },
      { t: 'discard', seat: 1, tile: T('1s') },
      { t: 'pon', seat: 0 },
    ]);
    expect(st.turn).toBe(0);
    expect(st.stage).toBe('discard');
    expect(st.players[0].melds[0]).toMatchObject({ type: 'pon', kind: 18 });
    expect(st.myHand.length).toBe(11);
    expect(st.wall).toBe(LIVE_WALL_START - 2);
    expect(st.players[1].discards[0].called).toBe(true);
    // kuikae: cannot discard 1s... (none left) and legal discards exclude the pon kind
    expect(myLegalActions(st).discards.every(t => t !== T('1s'))).toBe(true);
  });
  it('opponent riichi pays 1000 into deposits and marks the river', () => {
    const { st } = stateFrom('19m123456789p11s', [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E') },
      { t: 'discard', seat: 1, tile: T('S'), riichi: true },
    ]);
    expect(st.players[1].riichi).toBe(true);
    expect(st.match.scores[1]).toBe(34000);
    expect(st.match.kyotaku).toBe(1);
  });
  it('kita: removes North, adds nuki dora, gives a rinshan draw, no discard', () => {
    const { st } = stateFrom('19m12345678p11s4z', [
      { t: 'draw', tile: T('9p') },
      { t: 'kita', seat: 0 },
    ]);
    expect(st.players[0].kita).toBe(1);
    expect(st.myHand.includes(NORTH)).toBe(false);
    expect(st.stage).toBe('draw');
    expect(st.rinshanNext).toBe(true);
    expect(st.players[0].discards.length).toBe(0);
    const st2 = replay(stateFrom('19m12345678p11s4z').match, [
      ...stateFrom('19m12345678p11s4z').events,
      { t: 'draw', tile: T('9p') }, { t: 'kita', seat: 0 }, { t: 'draw', tile: T('1z') },
    ]);
    expect(st2.lastDrawRinshan).toBe(true);
  });
  it('opponent kita reduces the wall and keeps their turn', () => {
    const { st } = stateFrom('19m123456789p11s', [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E') },
      { t: 'kita', seat: 1 },
    ]);
    expect(st.turn).toBe(1);
    expect(st.players[1].kita).toBe(1);
    expect(st.wall).toBe(LIVE_WALL_START - 3);
  });
  it('undo = replay of a prefix', () => {
    const { match, events } = stateFrom('19m123456789p11s', [{ t: 'draw', tile: T('E') }]);
    const a = replay(match, events.slice(0, -1));
    expect(a.stage).toBe('draw');
    expect(a.myHand.length).toBe(13);
  });
});

describe('furiten', () => {
  // Tenpai on 1s/4s (ryanmen 23s) with pinfu-able hand
  const hand = '123456p789p23s55s';
  it('discard furiten', () => {
    const { st } = stateFrom(hand, [
      { t: 'draw', tile: T('4s') },
      { t: 'discard', seat: 0, tile: T('4s') },
    ]);
    expect(isMyFuriten(st)).toBe(true);
  });
  it('temporary furiten after passing a winning tile; cleared by my draw', () => {
    const ev: GameEvent[] = [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E') },
      { t: 'discard', seat: 1, tile: T('1s') }, // I could ron
    ];
    const { st, match, events } = stateFrom(hand, ev);
    expect(myLegalActions(st).ron).toBe(true);
    const passed = replay(match, [...events, { t: 'discard', seat: 2, tile: T('4s') }]);
    expect(passed.myFuritenTemp).toBe(true);
    expect(myLegalActions(passed).ron).toBe(false);
    const drawn = replay(match, [...events, { t: 'discard', seat: 2, tile: T('S') }, { t: 'draw', tile: T('W') }]);
    expect(drawn.myFuritenTemp).toBe(false);
  });
  it('riichi furiten is permanent', () => {
    const ev: GameEvent[] = [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E'), riichi: true },
      { t: 'discard', seat: 1, tile: T('1s') },
      { t: 'discard', seat: 2, tile: T('S') },
      { t: 'draw', tile: T('W') },
      { t: 'discard', seat: 0, tile: T('W') },
      { t: 'discard', seat: 1, tile: T('4s') },
    ];
    const { st } = stateFrom(hand, ev);
    expect(st.myFuritenRiichi).toBe(true);
    expect(myLegalActions(st).ron).toBe(false);
  });
});

describe('legal actions', () => {
  it('riichi requires closed tenpai, 1000 points and wall >= 3', () => {
    const { st } = stateFrom('123456p789p23s55s', [{ t: 'draw', tile: T('E') }]);
    const l = myLegalActions(st);
    expect(l.riichiDiscards).toContain(T('E'));
    const poor = stateFrom('123456p789p23s55s', [{ t: 'draw', tile: T('E') }], { match: { scores: [900, 35000, 35000] } }).st;
    expect(myLegalActions(poor).riichiDiscards.length).toBe(0);
    const late = stateFrom('123456p789p23s55s', [{ t: 'draw', tile: T('E') }, { t: 'wall', delta: -53 }]).st;
    expect(late.wall).toBe(1);
    expect(myLegalActions(late).riichiDiscards.length).toBe(0);
  });
  it('in riichi only the drawn tile may be discarded', () => {
    const { st } = stateFrom('123456p789p23s55s', [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E'), riichi: true },
      { t: 'discard', seat: 1, tile: T('S') },
      { t: 'discard', seat: 2, tile: T('S') },
      { t: 'draw', tile: T('W') },
    ]);
    expect(myLegalActions(st).discards).toEqual([T('W')]);
  });
  it('tsumo legal only with a yaku', () => {
    const { st } = stateFrom('123456p789p23s55s', [{ t: 'draw', tile: T('1s') }]);
    expect(myLegalActions(st).tsumo).toBe(true); // menzen tsumo
  });
  it('kita legal when holding North and the wall is not empty', () => {
    const { st } = stateFrom('19m12345678p11s4z', [{ t: 'draw', tile: T('9p') }]);
    expect(myLegalActions(st).kita).toBe(true);
  });
  it('pon and daiminkan detection', () => {
    const { st } = stateFrom('111s19m1234567p9p', [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E') },
      { t: 'discard', seat: 1, tile: T('1s') },
    ]);
    const l = myLegalActions(st);
    expect(l.pon).toBe(true);
    expect(l.daiminkan).toBe(true);
  });
  it('riichi ankan only if waits unchanged and with the drawn tile', () => {
    // 111p is an isolated triplet; waiting on East tanki -> ankan keeps waits
    const base = '111p456p567s789s1z';
    const { st } = stateFrom(base, [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E'), riichi: true },
      { t: 'discard', seat: 1, tile: T('S') },
      { t: 'discard', seat: 2, tile: T('S') },
      { t: 'draw', tile: T('1p') },
    ]);
    expect(myLegalActions(st).ankan).toContain(9);
    // 1112p shape: kan of 1p would change waits
    const { st: st2 } = stateFrom('1112p567s789s567p', [
      { t: 'draw', tile: T('E') },
      { t: 'discard', seat: 0, tile: T('E'), riichi: true },
      { t: 'discard', seat: 1, tile: T('S') },
      { t: 'discard', seat: 2, tile: T('S') },
      { t: 'draw', tile: T('1p') },
    ]);
    expect(myLegalActions(st2).ankan).not.toContain(9);
  });
});
