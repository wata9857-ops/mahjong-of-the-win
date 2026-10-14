// Recommendations when part of my hand is unknown.
//
// Unknown tiles are never guessed. We rank only the tiles I actually entered,
// using the structure of the known part (partial shanten + acceptance), tile
// safety against each opponent, and keeping dora / red fives / yakuhai pairs.
// Wins and riichi are never recommended because they cannot be verified.

import { shanten } from '../core/shanten';
import { HAKU, HATSU, CHUN, NORTH, SANMA_KINDS, doraFromIndicator, isRed, kindOf, tileLabel, toCounts, type TileKey } from '../core/tiles';
import { roundWindKind, seatWind, unseenCounts } from '../game/rules';
import type { HandState } from '../game/types';
import { dealInProb, type OpponentModel } from './opponents';
import type { Candidate } from './types';

export interface PartialResult {
  candidates: Candidate[];
  notes: string[];
  confidence: number;
  situation: 'my-turn' | 'call' | 'idle';
}

export function analyzePartial(st: HandState, models: OpponentModel[], pFirst: number, pLast: number): PartialResult {
  const known = st.myHand;
  const total = known.length + st.unknown;
  const me = st.players[0];
  const melds = me.melds.length;
  const unseen = unseenCounts(st);
  const threat = models.some(m => m.tenpai >= 0.5);
  const doraKinds = st.doraIndicators.map(t => doraFromIndicator(kindOf(t)));
  const valueKinds = new Set([HAKU, HATSU, CHUN, seatWind(st, 0), roundWindKind(st)]);
  const notes = [
    `手牌のうち${st.unknown}枚が未入力です。わかっている${known.length}枚だけで判断しているので、参考程度にしてください。`,
    '手牌の「？」をタップすると、あとから牌を入力できます。',
  ];
  const confidence = Math.max(0.2, Math.min(0.75, 0.2 + 0.55 * (known.length / Math.max(1, total))));
  const base = { pFirst, pLast, evPoints: 0, winProb: 0, winValue: 0, totalDealIn: 0 };

  const rankDiscards = (hand: TileKey[], allowed: TileKey[], meldCount: number) => {
    const c = toCounts(hand);
    const out: Candidate[] = [];
    for (const t of allowed) {
      const k = kindOf(t);
      if (c[k] === 0) continue;
      c[k]--;
      const s = shanten(c, meldCount);
      let uk = 0;
      for (const x of SANMA_KINDS) {
        if (c[x] >= 4 || !unseen[x]) continue;
        c[x]++;
        if (shanten(c, meldCount) < s) uk += unseen[x];
        c[x]--;
      }
      c[k]++;
      const risk = dealInProb(models[0], k) + dealInProb(models[1], k);
      let keep = doraKinds.filter(d => d === k).length * 2 + (isRed(t) ? 2 : 0);
      if (valueKinds.has(k) && c[k] >= 2) keep += 2;
      const score = -s * 100 + uk - keep * 15 - risk * (threat ? 3000 : 600);
      out.push({
        ...base, kind: 'discard', tile: t, label: `${tileLabel(t)}切り`, utility: score, immediateRisk: risk, totalDealIn: risk,
        shanten: s, ukeire: uk, reason: `わかっている牌（${known.length}枚）だけでの判断`,
        why: `わかっている牌の中で、いちばん不要な牌です。${risk >= 0.05 ? ' ⚠ 相手に当たる危険があります。' : threat && risk < 0.01 ? ' 相手に当たりにくい安全な牌です。' : ''}`,
      });
    }
    return out.sort((a, b) => b.utility - a.utility);
  };

  if (st.turn === 0 && st.stage === 'discard') {
    if (me.riichi) {
      return { candidates: [], notes: ['リーチ中は、引いた牌をそのまま切ります（ツモ切り）。', ...notes], confidence, situation: 'my-turn' };
    }
    const allowed = [...new Set(known)].filter(t => st.kuikaeKind === null || kindOf(t) !== st.kuikaeKind);
    const cands = rankDiscards(known, allowed, melds);
    if (known.includes(NORTH) && st.wall > 0) {
      cands.unshift({
        ...base, kind: 'kita', callKind: NORTH, label: '北抜き', utility: 1e6, immediateRisk: 0,
        reason: '北はドラとして抜くのが基本', why: 'ドラが1枚増え、牌を1枚補充できます。',
      });
    }
    if (!cands.length) {
      return { candidates: [], notes: ['手牌がまだ入力されていません。切った牌をタップして進めてください。', '手牌の「？」をタップすると牌を入力できます。'], confidence: 0, situation: 'my-turn' };
    }
    return { candidates: cands, notes, confidence, situation: 'my-turn' };
  }

  const pr = st.pendingRon;
  const ld = st.lastDiscard;
  if (pr && pr.kind === 'discard' && ld && ld.seat !== 0 && !me.riichi && st.wall > 0) {
    const k = kindOf(ld.tile);
    const c = toCounts(known);
    if (c[k] >= 2) {
      const yakuhai = valueKinds.has(k);
      const pass: Candidate = { ...base, kind: 'pass', label: '鳴かない', utility: yakuhai ? 0 : 1, immediateRisk: 0, reason: '', why: yakuhai ? '' : '役のない牌のポンは、手が安くなりやすいので見送りましょう。' };
      const cands: Candidate[] = [pass];
      if (yakuhai) {
        const rest = [...known];
        for (let i = 0; i < 2; i++) rest.splice(rest.findIndex(t => kindOf(t) === k), 1);
        const best = rankDiscards(rest, [...new Set(rest)].filter(t => kindOf(t) !== k), melds + 1)[0];
        cands.unshift({
          ...base, kind: 'pon', tile: best?.tile, label: `ポン ${tileLabel(k)}`, utility: 1, immediateRisk: best?.immediateRisk ?? 0,
          reason: '役牌のポン', why: `${tileLabel(k)}は役牌なので、ポンするだけでアガリの条件（役）がつきます。`,
        });
      }
      return { candidates: cands, notes, confidence, situation: 'call' };
    }
  }
  return { candidates: [], notes, confidence, situation: 'idle' };
}
