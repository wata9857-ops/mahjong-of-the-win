// Turns engine candidates into short, beginner-friendly Japanese.

import { tileLabel, type TileKey } from '../core/tiles';
import type { Candidate } from './types';

export const GLOSSARY = {
  riichi: 'リーチ：あと1枚でアガれる形（テンパイ）を宣言すると、点数が上がります。宣言後は手牌を変えられません。',
  tenpai: 'テンパイ：あと1枚でアガれる形のことです。',
  fold: 'オリ：自分のアガリをあきらめて、相手に当たらない牌を切る守り方です。',
  pon: 'ポン：他の人が捨てた牌をもらって、同じ牌3枚をそろえることです。',
  kan: 'カン：同じ牌4枚をそろえることです。ドラ（ボーナス牌）が1枚増えます。',
  kita: '北抜き：三人麻雀では北を横に出すとドラ扱いになり、牌を1枚補充できます。',
  dama: 'ダマ：テンパイしてもリーチせずに待つことです。',
  tsumogiri: 'ツモ切り：引いてきた牌をそのまま捨てることです。',
} as const;

const L = (t: TileKey | undefined) => (t === undefined ? '' : tileLabel(t));

/** Fill say / why / hint for one candidate. */
export function humanize(c: Candidate, ctx: { drawn: TileKey | null; threat: boolean }): Candidate {
  const tsumogiri = c.tile !== undefined && ctx.drawn !== null && c.tile === ctx.drawn;
  const waits = c.waits?.length ? `待ち：${c.waits.map(w => tileLabel(w)).join('・')}` : '';
  let say = c.label, why = '', hint: string | undefined;
  switch (c.kind) {
    case 'tsumo':
      say = 'ツモ（アガリ）'; why = `アガれます！ ${c.reason}`; break;
    case 'ron':
      say = 'ロン（アガリ）'; why = `アガれます！ ${c.reason}`; break;
    case 'riichi':
      say = tsumogiri ? 'リーチしてツモ切り' : `リーチして${L(c.tile)}を切る`;
      why = `テンパイです。リーチで点数アップを狙いましょう。${waits}`; hint = GLOSSARY.riichi; break;
    case 'discard':
      say = tsumogiri ? 'ツモ切り' : `${L(c.tile)}を切る`;
      if (c.shanten === 0) {
        const dama = c.label.includes('ダマ');
        why = dama ? `テンパイです。リーチせずに待つほうが有利です。${waits}` : `これでテンパイ（あと1枚でアガリ）です。${waits}`;
        hint = dama ? GLOSSARY.dama : GLOSSARY.tenpai;
      } else if (c.shanten !== undefined) {
        why = `いちばん不要な牌です。テンパイまであと${c.shanten}手。`;
      }
      if (tsumogiri && !hint) hint = GLOSSARY.tsumogiri;
      break;
    case 'fold':
      say = tsumogiri ? 'ツモ切りで守る' : `${L(c.tile)}を切って守る`;
      why = '相手のアガリが近いので、アガリはあきらめて安全な牌を切りましょう。'; hint = GLOSSARY.fold; break;
    case 'pon':
      say = c.tile !== undefined ? `ポンして${L(c.tile)}を切る` : 'ポン';
      why = 'ポンすると早くアガリに近づけます。'; hint = GLOSSARY.pon; break;
    case 'pass':
      if (c.label.includes('見逃し')) { say = 'ロンしないで見送る'; why = 'ここでアガるより、続けたほうが順位的に有利です。'; }
      else { say = '鳴かない'; why = '鳴かずに自分の手で進めるほうが有利です。'; }
      break;
    case 'kita':
      say = '北抜き'; why = 'ドラが1枚増え、牌を1枚補充できます。'; hint = GLOSSARY.kita; break;
    case 'ankan':
      say = `暗槓（${L(c.callKind)}）`; why = 'カンしてもアガリやすさが落ちず、ドラが増えます。'; hint = GLOSSARY.kan; break;
    case 'kakan':
      say = `加槓（${L(c.callKind)}）`; why = 'ポンした牌に4枚目を加えてカンします。ドラが増えます。'; hint = GLOSSARY.kan; break;
    case 'daiminkan':
      say = `カン（${L(c.callKind)}）`; why = '捨て牌をもらってカンします。ドラが増えます。'; hint = GLOSSARY.kan; break;
  }
  if (c.tile !== undefined && c.kind !== 'tsumo' && c.kind !== 'ron') {
    if (c.immediateRisk >= 0.05) why += ` ⚠ 相手に当たる危険があります。`;
    else if (ctx.threat && c.immediateRisk < 0.01) why += ' 相手に当たりにくい安全な牌です。';
  }
  return { ...c, say, why: why.trim(), hint };
}
