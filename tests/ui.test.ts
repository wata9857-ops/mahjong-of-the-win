import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pinLayout, souLayout } from '../src/ui/TileFace';
import { nextThemePref, resolveTheme, THEME_LABEL } from '../src/ui/theme';
import { defaultSettings, load, save } from '../src/ui/store';
import { tileLabel, parseTiles } from '../src/core/tiles';
import { SEAT_NAMES, SEAT_SHORT } from '../src/game/types';
import { roundLabel, newMatch } from '../src/game/match';

describe('theme', () => {
  it('auto follows the system, explicit choices override it', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('toggle cycles auto → light → dark → auto', () => {
    expect(nextThemePref('auto')).toBe('light');
    expect(nextThemePref('light')).toBe('dark');
    expect(nextThemePref('dark')).toBe('auto');
  });
  it('labels are Japanese', () => {
    expect(Object.values(THEME_LABEL)).toEqual(['自動', 'ライト', 'ダーク']);
  });
});

describe('settings persistence', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => { delete (globalThis as any).localStorage; });

  it('defaults to automatic theme', () => {
    expect(load().settings.theme).toBe('auto');
    expect(defaultSettings.theme).toBe('auto');
  });
  it('saves and restores the theme preference', () => {
    const s = load();
    save({ ...s, settings: { ...s.settings, theme: 'dark' } });
    expect(load().settings.theme).toBe('dark');
  });
  it('older saves without a theme get the default', () => {
    const s = load();
    const { theme: _t, ...old } = s.settings;
    store.set('pon-intended-v1', JSON.stringify({ ...s, settings: old }));
    expect(load().settings.theme).toBe('auto');
  });
});

describe('tile artwork', () => {
  it('pinzu layouts have exactly n circles', () => {
    for (let n = 1; n <= 9; n++) expect(pinLayout(n)).toHaveLength(n);
  });
  it('souzu layouts have exactly n sticks (2-9; 1s is a bird)', () => {
    for (let n = 2; n <= 9; n++) expect(souLayout(n)).toHaveLength(n);
  });
  it('red fives are drawn fully in red', () => {
    const colors = new Set(pinLayout(5, true).map(d => d[3]));
    expect(colors.size).toBe(1);
    expect(new Set(souLayout(5, true).map(s => s[3])).size).toBe(1);
    expect(new Set(pinLayout(5).map(d => d[3])).size).toBeGreaterThan(1);
  });
  it('circles stay inside the tile face', () => {
    for (let n = 1; n <= 9; n++) for (const [x, y, r] of pinLayout(n)) {
      expect(x - r).toBeGreaterThanOrEqual(0); expect(x + r).toBeLessThanOrEqual(60);
      expect(y - r).toBeGreaterThanOrEqual(0); expect(y + r).toBeLessThanOrEqual(80);
    }
  });
});

describe('Japanese labels', () => {
  it('tile names are Japanese', () => {
    expect(parseTiles('1m9m5p0p5s0sECF').map(tileLabel)).toEqual(['一萬', '九萬', '5筒', '赤5筒', '5索', '赤5索', '東', '中', '發']);
  });
  it('seat and round labels contain no Latin letters', () => {
    for (const s of [...SEAT_NAMES, ...SEAT_SHORT, roundLabel(newMatch(0))]) expect(s).not.toMatch(/[A-Za-z]/);
  });
});
