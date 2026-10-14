import { isRed, kindOf, numOf, suitOf, type TileKey } from '../core/tiles';

const HONOR = ['東', '南', '西', '北', '白', '發', '中'];
const SUIT_CHAR = ['萬', '筒', '索'];

export interface TileProps {
  t: TileKey;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  dim?: boolean;
  badge?: string | number;
  highlight?: boolean;
  rotated?: boolean;
  danger?: number;
  title?: string;
  disabled?: boolean;
}

export function Tile({ t, size = 'md', onClick, dim, badge, highlight, rotated, danger, title, disabled }: TileProps) {
  const k = kindOf(t);
  const red = isRed(t);
  const cls = ['tile', `tile-${size}`];
  if (k >= 27) cls.push(`honor h${k - 27}`);
  else cls.push(`suit-${'mps'[suitOf(k)]}`);
  if (red) cls.push('red5');
  if (dim) cls.push('dim');
  if (highlight) cls.push('hl');
  if (rotated) cls.push('rot');
  if (onClick && !disabled) cls.push('tap');
  if (disabled) cls.push('disabled');
  const content = k >= 27
    ? <span class="glyph">{HONOR[k - 27]}</span>
    : <>
        <span class="num">{numOf(k)}</span>
        <span class="suit">{SUIT_CHAR[suitOf(k)]}</span>
      </>;
  let dangerCls = '';
  if (danger !== undefined) dangerCls = danger < 0.005 ? 'd0' : danger < 0.03 ? 'd1' : danger < 0.07 ? 'd2' : 'd3';
  return (
    <button
      type="button"
      class={cls.join(' ')}
      onPointerDown={onClick && !disabled ? (e) => { e.preventDefault(); onClick(); } : undefined}
      title={title}
      aria-label={title}
      tabIndex={-1}
    >
      {content}
      {badge !== undefined && <span class="badge">{badge}</span>}
      {danger !== undefined && <span class={`danger ${dangerCls}`} />}
    </button>
  );
}
