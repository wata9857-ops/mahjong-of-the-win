// Mahjong Soul–style table: a central console (round, tiles left, scores and
// seat winds on each side), each player's river laid out in front of them
// facing the centre, and opponent nameplates with one-tap action buttons.

import type { DiscardInfo, HandState, Seat } from '../game/types';
import { roundLabel } from '../game/match';
import { Tile } from './Tile';

const WIND = ['東', '南', '西'];
const MELD_NAME = { pon: 'ポン', minkan: '明槓', ankan: '暗槓', kakan: '加槓' } as const;

export type OppAction = 'riichi' | 'pon' | 'kan' | 'kita' | 'ron' | 'tsumo';

export interface TableProps {
  st: HandState;
  activeSeat: Seat | null;
  opponents?: { seat: number; tenpai: number; riichi: boolean }[];
  riichiArm: [boolean, boolean, boolean];
  kanSeat: Seat | null;
  onSelect: (s: Seat) => void;
  onAction: (s: Seat, a: OppAction) => void;
}

const windOf = (st: HandState, s: Seat) => WIND[(s - st.match.dealer + 3) % 3];

function River({ discards, side }: { discards: DiscardInfo[]; side: 'me' | 'left' | 'right' }) {
  return (
    <div class={`river2 ${side}`}>
      {discards.map(d => (
        <span class={`rv ${d.riichi ? 'riichi-tile' : ''} ${d.called ? 'called' : ''}`}>
          <Tile t={d.tile} size="sm" />
        </span>
      ))}
    </div>
  );
}

export function Table({ st, activeSeat, opponents, riichiArm, kanSeat, onSelect, onAction }: TableProps) {
  const ld = st.lastDiscard;
  const pr = st.pendingRon;
  const scores = st.match.scores;
  const plate = (s: Seat) => {
    const p = st.players[s];
    const o = opponents?.find(x => x.seat === s);
    const active = activeSeat === s;
    const canPon = !!ld && ld.seat !== s && !!pr && pr.kind === 'discard';
    const danger = o && !p.riichi && o.tenpai >= 0.5;
    return (
      <div class={`plate ${s === 2 ? 'left' : 'right'} ${active ? 'active' : ''}`} aria-label={s === 1 ? '下家' : '上家'}>
        <button class="plate-head" onClick={() => onSelect(s)} aria-label={`${s === 1 ? '下家' : '上家'}を入力対象にする`}>
          <span class={`avatar ${st.match.dealer === s ? 'oya' : ''}`}>{windOf(st, s)}</span>
          <span class="plate-name">{s === 1 ? '下家' : '上家'}{active && <em>番</em>}</span>
          <span class="plate-score">{scores[s].toLocaleString('ja-JP')}</span>
          <span class="plate-tags">
            {p.riichi && <i class="tag riichi">リーチ</i>}
            {danger && <i class="tag warn" title="テンパイ（あと1枚でアガれる状態）の可能性が高い">テンパイ気配</i>}
            {p.kita > 0 && <i class="tag">北×{p.kita}</i>}
          </span>
        </button>
        {p.melds.length > 0 && <div class="plate-melds">{p.melds.map(m => <span class="meld">{Array.from({ length: m.type === 'pon' ? 3 : 4 }, () => <Tile t={m.kind} size="xs" />)}<small>{MELD_NAME[m.type]}</small></span>)}</div>}
        <div class="plate-acts">
          <button class={`pa riichi ${riichiArm[s] ? 'on' : ''}`} disabled={p.riichi} onClick={() => onAction(s, 'riichi')}>リーチ</button>
          <button class="pa" disabled={!canPon} onClick={() => onAction(s, 'pon')}>ポン</button>
          <button class={`pa ${kanSeat === s ? 'on' : ''}`} onClick={() => onAction(s, 'kan')}>カン</button>
          <button class="pa" onClick={() => onAction(s, 'kita')}>北抜き</button>
          <button class="pa win" disabled={!pr || pr.seat === s} onClick={() => onAction(s, 'ron')}>ロン</button>
          <button class="pa win" onClick={() => onAction(s, 'tsumo')}>ツモ</button>
        </div>
      </div>
    );
  };
  return (
    <div class="table">
      {plate(2)}
      <div class="felt">
        <River discards={st.players[2].discards} side="left" />
        <div class={`console turn-${activeSeat ?? 'x'}`} aria-label="場の情報">
          <span class="c-wind c-top">{roundLabel(st.match).slice(0, 1)}</span>
          <div class="c-mid">
            <b>{roundLabel(st.match)}</b>
            <span>余 {st.wall}</span>
            {(st.match.honba > 0 || st.match.kyotaku > 0) && <small>{st.match.honba}本場・供託{st.match.kyotaku}</small>}
          </div>
          <span class="c-score c-me"><i>{windOf(st, 0)}</i>{scores[0].toLocaleString('ja-JP')}</span>
          <span class="c-score c-left"><i>{windOf(st, 2)}</i>{scores[2].toLocaleString('ja-JP')}</span>
          <span class="c-score c-right"><i>{windOf(st, 1)}</i>{scores[1].toLocaleString('ja-JP')}</span>
        </div>
        <River discards={st.players[1].discards} side="right" />
        <River discards={st.players[0].discards} side="me" />
      </div>
      {plate(1)}
    </div>
  );
}
