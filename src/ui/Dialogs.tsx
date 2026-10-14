import { useState } from 'preact/hooks';
import { finalPoints, newMatch, rankSeats, roundLabel, settleHand, type HandResult, type Settlement, type WinEntry } from '../game/match';
import { SEAT_SHORT, type MatchInfo, type Seat } from '../game/types';

const WINDS = ['東', '南', '西'];

export function seatWindName(m: MatchInfo, s: Seat): string {
  return WINDS[(s - m.dealer + 3) % 3];
}

const fmt = (n: number) => n.toLocaleString('ja-JP');

// ---------------------------------------------------------------- setup

export function SetupDialog({ match, onStart, onCancel }: { match: MatchInfo; onStart: (m: MatchInfo) => void; onCancel?: () => void }) {
  const [dealer, setDealer] = useState<Seat>(match.dealer);
  const [wind, setWind] = useState<0 | 1>(match.roundWind);
  const [hand, setHand] = useState<1 | 2 | 3>(match.handNumber);
  const [honba, setHonba] = useState(match.honba);
  const [kyotaku, setKyotaku] = useState(match.kyotaku);
  const [scores, setScores] = useState<[number, number, number]>([...match.scores] as [number, number, number]);
  const setScore = (i: number, v: number) => { const s = [...scores] as [number, number, number]; s[i] = v; setScores(s); };
  const initialDealer = ((dealer - (hand - 1) + 3) % 3) as Seat;
  const total = scores[0] + scores[1] + scores[2] + kyotaku * 1000;
  return (
    <div class="modal">
      <div class="dialog">
        <h2>対局設定</h2>
        <div class="row">
          <label>親（東家）</label>
          <div class="seg">
            {([0, 1, 2] as Seat[]).map(s => <button class={dealer === s ? 'on' : ''} onClick={() => setDealer(s)}>{SEAT_SHORT[s]}</button>)}
          </div>
        </div>
        <div class="row">
          <label>局</label>
          <div class="seg">
            <button class={wind === 0 ? 'on' : ''} onClick={() => setWind(0)}>東場</button>
            <button class={wind === 1 ? 'on' : ''} onClick={() => setWind(1)}>南場（延長）</button>
          </div>
          <div class="seg">
            {([1, 2, 3] as const).map(n => <button class={hand === n ? 'on' : ''} onClick={() => setHand(n)}>{n}局</button>)}
          </div>
        </div>
        <div class="row">
          <label>本場</label>
          <Stepper v={honba} set={setHonba} />
          <label class="short">供託</label>
          <Stepper v={kyotaku} set={setKyotaku} />
        </div>
        {([0, 1, 2] as Seat[]).map(s => (
          <div class="row">
            <label>{SEAT_SHORT[s]}（{WINDS[(s - dealer + 3) % 3]}家）</label>
            <input type="number" inputMode="numeric" step={100} value={scores[s]} aria-label={`${SEAT_SHORT[s]}の持ち点`} onInput={e => setScore(s, +(e.target as HTMLInputElement).value)} />
            <div class="seg small">
              {[-1000, -100, 100, 1000].map(d => <button onClick={() => setScore(s, scores[s] + d)}>{d > 0 ? '+' : '−'}{fmt(Math.abs(d))}</button>)}
            </div>
          </div>
        ))}
        <p class={total === 105000 ? 'muted' : 'warn'}>合計（供託込み）：{fmt(total)}点{total !== 105000 && '（本来は105,000点）'}</p>
        <div class="row end">
          {onCancel && <button class="btn" onClick={onCancel}>キャンセル</button>}
          <button class="btn" onClick={() => { const m = newMatch(0); setScores(m.scores); setHonba(0); setKyotaku(0); setWind(0); setHand(1); }}>35,000点に戻す</button>
          <button class="btn primary" onClick={() => onStart({ roundWind: wind, handNumber: hand, honba, kyotaku, dealer, initialDealer, scores })}>この局を開始</button>
        </div>
        <p class="muted">開始すると4秒間の配牌入力になります。わかる牌だけタップすればOKです。</p>
      </div>
    </div>
  );
}

function Stepper({ v, set }: { v: number; set: (n: number) => void }) {
  return (
    <div class="seg small">
      <button onClick={() => set(Math.max(0, v - 1))}>−</button>
      <span class="val">{v}</span>
      <button onClick={() => set(v + 1)}>+</button>
    </div>
  );
}

// ---------------------------------------------------------------- hand end

export interface EndPreset {
  kind: 'ron' | 'tsumo' | 'draw';
  winners?: Seat[];
  loser?: Seat;
  /** precomputed values for my own win */
  mine?: { han: number; fu: number; yakuman: number; text: string };
  tenpai?: [boolean, boolean, boolean];
}

const HAN_OPTS: { label: string; han: number; yakuman?: number }[] = [
  { label: '1翻', han: 1 }, { label: '2翻', han: 2 }, { label: '3翻', han: 3 }, { label: '4翻', han: 4 },
  { label: '満貫', han: 5 }, { label: '跳満', han: 6 }, { label: '倍満', han: 8 },
  { label: '三倍満', han: 11 }, { label: '役満', han: 13, yakuman: 1 }, { label: 'ダブル役満', han: 26, yakuman: 2 },
];
const FU_OPTS = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];

/** The han button that represents a value (limit hands map to their limit button). */
function activeHanLabel(v: { han: number; yakuman: number }): string {
  if (v.yakuman) return HAN_OPTS.find(o => o.yakuman === Math.min(2, v.yakuman))!.label;
  if (v.han >= 13) return '役満';
  let label = '1翻';
  for (const o of HAN_OPTS) if (!o.yakuman && v.han >= o.han) label = o.label;
  return label;
}

const KIND_LABEL = { ron: 'ロン', tsumo: 'ツモ', draw: '流局（荒牌）', abort: '途中流局' } as const;

export function EndDialog({ match, preset, onApply, onCancel }: {
  match: MatchInfo; preset: EndPreset; onApply: (r: HandResult, s: Settlement) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<'ron' | 'tsumo' | 'draw' | 'abort'>(preset.kind);
  const [winners, setWinners] = useState<Seat[]>(preset.winners ?? [0]);
  const [loser, setLoser] = useState<Seat>(preset.loser ?? 1);
  const [vals, setVals] = useState<Record<number, { han: number; fu: number; yakuman: number }>>(() => {
    const v: Record<number, { han: number; fu: number; yakuman: number }> = {};
    for (const s of [0, 1, 2]) v[s] = { han: 3, fu: 30, yakuman: 0 };
    if (preset.mine) v[0] = { han: preset.mine.han, fu: preset.mine.fu, yakuman: preset.mine.yakuman };
    return v;
  });
  const [tenpai, setTenpai] = useState<[boolean, boolean, boolean]>(preset.tenpai ?? [false, false, false]);

  const result: HandResult = kind === 'ron'
    ? { kind: 'ron', loser, winners: winners.filter(w => w !== loser).map(w => ({ seat: w, ...vals[w] }) as WinEntry) }
    : kind === 'tsumo'
      ? { kind: 'tsumo', winner: { seat: winners[0], ...vals[winners[0]] } }
      : kind === 'draw' ? { kind: 'draw', tenpai } : { kind: 'abort' };
  const valid = kind !== 'ron' || (result.kind === 'ron' && result.winners.length > 0);
  const settlement = valid ? settleHand(match, result) : null;

  const toggleWinner = (s: Seat) => {
    if (kind === 'tsumo') { setWinners([s]); return; }
    setWinners(winners.includes(s) ? winners.filter(x => x !== s) : [...winners, s].slice(-2));
  };
  const setVal = (s: Seat, p: Partial<{ han: number; fu: number; yakuman: number }>) => setVals({ ...vals, [s]: { ...vals[s], ...p } });

  return (
    <div class="modal">
      <div class="dialog">
        <h2>局の終了 — {roundLabel(match)}</h2>
        <div class="seg">
          {(['ron', 'tsumo', 'draw', 'abort'] as const).map(k => <button class={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
        </div>
        {(kind === 'ron' || kind === 'tsumo') && <>
          <div class="row">
            <label>和了者{kind === 'ron' ? '（ダブロン可）' : ''}</label>
            <div class="seg">{([0, 1, 2] as Seat[]).map(s => <button class={winners.includes(s) ? 'on' : ''} onClick={() => toggleWinner(s)}>{SEAT_SHORT[s]}</button>)}</div>
          </div>
          {kind === 'ron' && <div class="row">
            <label>放銃者</label>
            <div class="seg">{([0, 1, 2] as Seat[]).map(s => <button class={loser === s ? 'on bad' : ''} onClick={() => setLoser(s)}>{SEAT_SHORT[s]}</button>)}</div>
          </div>}
          {(kind === 'ron' ? winners.filter(w => w !== loser) : winners.slice(0, 1)).map(w => (
            <div class="winbox">
              <b>{SEAT_SHORT[w]}の打点</b>{w === 0 && preset.mine && <span class="muted">（自動計算：{preset.mine.text}）</span>}
              <div class="seg wrap">{HAN_OPTS.map(o => (
                <button class={activeHanLabel(vals[w]) === o.label ? 'on' : ''}
                  onClick={() => setVal(w, { han: o.han, yakuman: o.yakuman ?? 0 })}>{o.label}</button>
              ))}</div>
              {vals[w].yakuman === 0 && vals[w].han < 5 && <div class="seg wrap">{FU_OPTS.map(f => <button class={vals[w].fu === f ? 'on' : ''} onClick={() => setVal(w, { fu: f })}>{f}符</button>)}</div>}
            </div>
          ))}
        </>}
        {kind === 'draw' && <div class="row">
          <label>聴牌者</label>
          <div class="seg">{([0, 1, 2] as Seat[]).map(s => <button class={tenpai[s] ? 'on' : ''} onClick={() => { const t = [...tenpai] as [boolean, boolean, boolean]; t[s] = !t[s]; setTenpai(t); }}>{SEAT_SHORT[s]}</button>)}</div>
        </div>}
        {kind === 'abort' && <p class="muted">九種九牌・四槓散了など。親の連荘となり、精算はありません。</p>}
        {settlement && <div class="summary">
          {([0, 1, 2] as Seat[]).map(s => <div><span>{SEAT_SHORT[s]}</span> <b class={settlement.deltas[s] > 0 ? 'pos' : settlement.deltas[s] < 0 ? 'neg' : ''}>{settlement.deltas[s] > 0 ? '+' : ''}{fmt(settlement.deltas[s])}</b> → {fmt(match.scores[s] + settlement.deltas[s])}点</div>)}
          <div class="muted">{settlement.reason}{settlement.ended ? ' — 終局' : `（次：${roundLabel(settlement.next)} ${settlement.next.honba}本場）`}</div>
        </div>}
        <div class="row end">
          <button class="btn" onClick={onCancel}>キャンセル</button>
          <button class="btn primary" disabled={!settlement} onClick={() => settlement && onApply(result, settlement)}>確定</button>
        </div>
      </div>
    </div>
  );
}

export function FinalDialog({ s, onNew }: { s: Settlement; onNew: () => void }) {
  const final = s.final!, ranks = s.ranks ?? rankSeats(final, s.next.initialDealer);
  const pts = finalPoints(final, ranks);
  return (
    <div class="modal">
      <div class="dialog">
        <h2>{ranks[0] === 0 ? '🏆 トップ獲得！ おめでとうございます！' : '対局終了'}</h2>
        <p class="muted">{s.reason}</p>
        {ranks.map((seat, i) => <div class="final-row"><b>{i + 1}位</b> {SEAT_SHORT[seat]} — {fmt(final[seat])}点（{pts[seat] > 0 ? '+' : ''}{pts[seat].toFixed(1)}）</div>)}
        <div class="row end"><button class="btn primary" onClick={onNew}>新しい対局</button></div>
      </div>
    </div>
  );
}
