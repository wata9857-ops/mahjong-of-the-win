// Scalable SVG artwork for mahjong tile faces (viewBox 60×80).
// Pinzu: traditional circle layouts; Souzu: bamboo sticks (1s = bird);
// Manzu: kanji numeral over red 萬; honors in calligraphic kanji.
// Red fives are drawn entirely in vermilion.

import { isRed, kindOf, numOf, suitOf, type TileKey } from '../core/tiles';

const BLUE = '#1d4fa3';
const GREEN = '#1f7a45';
const RED = '#c8322a';
const INK = '#1c1c22';

type Dot = [number, number, number, string];
type Stick = [number, number, number, string, number?];

/** Circle layouts for 1p..9p: [cx, cy, r, color]. */
export function pinLayout(n: number, red = false): Dot[] {
  const B = BLUE, G = GREEN, R = RED;
  const L: Record<number, Dot[]> = {
    1: [[30, 40, 19, R]],
    2: [[30, 22, 11.5, G], [30, 58, 11.5, B]],
    3: [[15, 17, 9.5, B], [30, 40, 9.5, R], [45, 63, 9.5, G]],
    4: [[18, 23, 10.5, B], [42, 23, 10.5, G], [18, 57, 10.5, G], [42, 57, 10.5, B]],
    5: [[16, 19, 9.5, B], [44, 19, 9.5, G], [30, 40, 9.5, R], [16, 61, 9.5, G], [44, 61, 9.5, B]],
    6: [[19, 15, 9, G], [41, 15, 9, G], [19, 43, 9, R], [41, 43, 9, R], [19, 65, 9, R], [41, 65, 9, R]],
    7: [[13, 12, 7.5, G], [30, 21, 7.5, G], [47, 30, 7.5, G], [19, 50, 7.8, R], [41, 50, 7.8, R], [19, 68, 7.8, R], [41, 68, 7.8, R]],
    8: [[19, 12, 8, B], [41, 12, 8, B], [19, 30.5, 8, B], [41, 30.5, 8, B], [19, 49.5, 8, B], [41, 49.5, 8, B], [19, 68, 8, B], [41, 68, 8, B]],
    9: [[13, 16, 7.8, B], [30, 16, 7.8, B], [47, 16, 7.8, B], [13, 40, 7.8, R], [30, 40, 7.8, R], [47, 40, 7.8, R], [13, 64, 7.8, G], [30, 64, 7.8, G], [47, 64, 7.8, G]],
  };
  const dots = L[n] ?? [];
  return red ? dots.map(([x, y, r]) => [x, y, r, RED]) : dots;
}

/** Bamboo layouts for 2s..9s: [cx, cy, length, color, angleDeg]. */
export function souLayout(n: number, red = false): Stick[] {
  const G = GREEN, R = RED;
  const L: Record<number, Stick[]> = {
    2: [[30, 22, 28, G], [30, 58, 28, G]],
    3: [[30, 22, 26, G], [18, 58, 26, G], [42, 58, 26, G]],
    4: [[18, 22, 28, G], [42, 22, 28, G], [18, 58, 28, G], [42, 58, 28, G]],
    5: [[15, 22, 26, G], [45, 22, 26, G], [30, 40, 26, R], [15, 58, 26, G], [45, 58, 26, G]],
    6: [[15, 22, 28, G], [30, 22, 28, G], [45, 22, 28, G], [15, 58, 28, G], [30, 58, 28, G], [45, 58, 28, G]],
    7: [[30, 13, 18, R], [15, 39, 20, G], [30, 39, 20, G], [45, 39, 20, G], [15, 65, 20, G], [30, 65, 20, G], [45, 65, 20, G]],
    8: [[11, 22, 27, G], [23, 22, 27, G, -24], [37, 22, 27, G, 24], [49, 22, 27, G], [11, 58, 27, G], [23, 58, 27, G, 24], [37, 58, 27, G, -24], [49, 58, 27, G]],
    9: [[15, 15, 21, G], [30, 15, 21, R], [45, 15, 21, G], [15, 40, 21, G], [30, 40, 21, R], [45, 40, 21, G], [15, 65, 21, G], [30, 65, 21, R], [45, 65, 21, G]],
  };
  const s = L[n] ?? [];
  return red ? s.map(([x, y, l, , a]) => [x, y, l, RED, a]) : s;
}

function Circle({ d: [x, y, r, c], big }: { d: Dot; big?: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#fff" stroke={c} stroke-width={r * 0.3} />
      <circle cx={x} cy={y} r={r * 0.52} fill={c} />
      <circle cx={x} cy={y} r={r * 0.2} fill="#fff" />
      {big && <>
        <circle cx={x} cy={y} r={r * 0.78} fill="none" stroke={GREEN} stroke-width={r * 0.08} stroke-dasharray={`${r * 0.25} ${r * 0.18}`} />
        <circle cx={x} cy={y} r={r * 1.12} fill="none" stroke={BLUE} stroke-width={r * 0.07} />
      </>}
    </g>
  );
}

function Bamboo({ s: [x, y, len, c, a = 0] }: { s: Stick }) {
  const w = 7.2;
  const top = y - len / 2;
  return (
    <g transform={a ? `rotate(${a} ${x} ${y})` : undefined}>
      <rect x={x - w / 2} y={top} width={w} height={len} rx={w / 2} fill={c} />
      <rect x={x - w / 2 + 1.4} y={top + 2} width={1.6} height={len - 4} rx={0.8} fill="#fff" opacity={0.45} />
      <rect x={x - w / 2 - 0.6} y={y - 1} width={w + 1.2} height={2} rx={1} fill={c} stroke="#fff" stroke-width={0.6} />
      <rect x={x - w / 2 - 0.4} y={top + len * 0.18} width={w + 0.8} height={1.4} rx={0.7} fill="#fff" opacity={0.6} />
      <rect x={x - w / 2 - 0.4} y={top + len * 0.82 - 1.4} width={w + 0.8} height={1.4} rx={0.7} fill="#fff" opacity={0.6} />
    </g>
  );
}

function Bird() {
  return (
    <g>
      {/* tail feathers */}
      <path d="M30 50 C 18 58, 12 70, 16 76 C 22 68, 26 62, 31 56 Z" fill={GREEN} />
      <path d="M31 52 C 30 62, 30 70, 34 77 C 37 68, 36 60, 34 52 Z" fill={BLUE} />
      <path d="M33 50 C 42 58, 48 66, 47 74 C 41 68, 37 61, 33 55 Z" fill={GREEN} />
      {/* body */}
      <ellipse cx={31} cy={40} rx={11} ry={14} fill={GREEN} />
      <path d="M24 38 C 28 46, 36 48, 40 42 C 36 44, 30 43, 24 38 Z" fill={BLUE} />
      {/* head + beak + crest */}
      <circle cx={33} cy={21} r={7} fill={GREEN} />
      <path d="M39 20 L 47 22 L 39 24 Z" fill="#d99a1e" />
      <path d="M30 15 C 28 9, 31 6, 34 8 C 33 10, 33 12, 34 15 Z" fill={RED} />
      <circle cx={35} cy={20} r={1.6} fill="#fff" />
      <circle cx={35.3} cy={20} r={0.8} fill={INK} />
      {/* legs */}
      <path d="M28 53 L 26 58 M34 53 L 35 58" stroke={RED} stroke-width={1.6} stroke-linecap="round" />
    </g>
  );
}

const SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", "MS Mincho", serif';
const HONOR = ['東', '南', '西', '北', '白', '發', '中'];
const MAN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function TileFace({ t }: { t: TileKey }) {
  const k = kindOf(t);
  const red = isRed(t);
  let body;
  if (k >= 27) {
    const h = k - 27;
    if (h === 4) {
      body = <rect x={11} y={13} width={38} height={54} rx={4} fill="none" stroke={BLUE} stroke-width={3.2} />;
    } else {
      const color = h === 5 ? GREEN : h === 6 ? RED : h === 3 ? '#21306b' : INK;
      body = <text x={30} y={55} text-anchor="middle" font-size={40} font-weight={700} font-family={SERIF} fill={color}>{HONOR[h]}</text>;
    }
  } else {
    const s = suitOf(k), n = numOf(k);
    if (s === 0) {
      body = <>
        <text x={30} y={33} text-anchor="middle" font-size={27} font-weight={700} font-family={SERIF} fill={INK}>{MAN_NUM[n - 1]}</text>
        <text x={30} y={69} text-anchor="middle" font-size={29} font-weight={700} font-family={SERIF} fill={RED}>萬</text>
      </>;
    } else if (s === 1) {
      body = <>{pinLayout(n, red).map(d => <Circle d={d} big={n === 1} />)}</>;
    } else {
      body = n === 1 ? <Bird /> : <>{souLayout(n, red).map(st => <Bamboo s={st} />)}</>;
    }
  }
  return (
    <svg class="face" viewBox="0 0 60 80" aria-hidden="true" focusable="false">
      {body}
      {red && <circle cx={52} cy={8} r={4} fill={RED} stroke="#fff" stroke-width={1} />}
    </svg>
  );
}
