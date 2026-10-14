import { isRed, kindOf, tileLabel, type TileKey } from '../core/tiles';
import { TileFace } from './TileFace';

export interface TileProps {
  t: TileKey;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  onClick?: () => void;
  dim?: boolean;
  badge?: string | number;
  highlight?: boolean;
  rotated?: boolean;
  danger?: number;
  title?: string;
  disabled?: boolean;
  /** stable tile code for automation (data-code) */
  code?: string;
}

export function Tile({ t, size = 'md', onClick, dim, badge, highlight, rotated, danger, title, disabled, code }: TileProps) {
  const cls = ['tile', `tile-${size}`];
  if (isRed(t)) cls.push('red5');
  if (dim) cls.push('dim');
  if (highlight) cls.push('hl');
  if (rotated) cls.push('rot');
  if (onClick && !disabled) cls.push('tap');
  if (disabled) cls.push('disabled');
  let dangerCls = '';
  if (danger !== undefined) dangerCls = danger < 0.005 ? 'd0' : danger < 0.03 ? 'd1' : danger < 0.07 ? 'd2' : 'd3';
  const label = title ?? tileLabel(t);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      class={cls.join(' ')}
      onPointerDown={onClick && !disabled ? (e: PointerEvent) => { e.preventDefault(); onClick(); } : undefined}
      title={onClick ? label : undefined}
      data-code={code}
      data-kind={kindOf(t)}
      aria-label={label}
      role={(onClick ? undefined : 'img') as any}
      tabIndex={-1}
    >
      <TileFace t={t} />
      {badge !== undefined && <span class={`badge ${badge === 0 ? 'zero' : ''}`}>{badge}</span>}
      {danger !== undefined && <span class={`danger ${dangerCls}`} />}
    </Tag>
  );
}
