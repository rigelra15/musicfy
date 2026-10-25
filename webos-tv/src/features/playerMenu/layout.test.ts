import { describe, expect, it } from 'vitest';
import { DEFAULT_SIDE, DEFAULT_SLOTS, MENU_ACTIONS, SIDE_SLOT, actionAt, assign, parseSide, parseSlots, readLayout, serializeSlots } from './layout';

const base = { slots: [...DEFAULT_SLOTS], side: DEFAULT_SIDE };

describe('menu layout', () => {
  it('knows the fourteen Android actions and the Android defaults', () => {
    expect(MENU_ACTIONS).toHaveLength(14);
    expect(base.slots).toEqual(['OTHER_MENU', 'SLEEP_TIMER', 'SEE_VIDEO', 'REPEAT']);
    expect(base.side).toBe('LIKE');
  });

  it('falls back to the defaults for anything that is not four known distinct actions', () => {
    expect(parseSlots(undefined)).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('SHUFFLE,QUEUE,SPEED')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('SHUFFLE,QUEUE,SPEED,NOPE')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('SHUFFLE,SHUFFLE,SPEED,QUEUE')).toEqual(DEFAULT_SLOTS);
    expect(parseSlots('SHUFFLE,QUEUE,SPEED,OUTPUT')).toEqual(['SHUFFLE', 'QUEUE', 'SPEED', 'OUTPUT']);
    expect(parseSide('nope')).toBe('LIKE');
    expect(parseSide('SHUFFLE')).toBe('SHUFFLE');
  });

  it('putting a free action in a slot replaces what was there', () => {
    const next = assign(base, 1, 'SHUFFLE');
    expect(next.slots).toEqual(['OTHER_MENU', 'SHUFFLE', 'SEE_VIDEO', 'REPEAT']);
    expect(next.side).toBe('LIKE');
  });

  it('putting an action that is already used swaps the two places, so nothing is duplicated', () => {
    const next = assign(base, 0, 'REPEAT');
    expect(next.slots).toEqual(['REPEAT', 'SLEEP_TIMER', 'SEE_VIDEO', 'OTHER_MENU']);
    const toSide = assign(base, SIDE_SLOT, 'SLEEP_TIMER');
    expect(toSide.side).toBe('SLEEP_TIMER');
    expect(toSide.slots).toEqual(['OTHER_MENU', 'LIKE', 'SEE_VIDEO', 'REPEAT']);
    const all = [...next.slots, next.side];
    expect(new Set(all).size).toBe(5);
  });

  it('assigning what is already there, or to a slot that does not exist, changes nothing', () => {
    expect(assign(base, 2, 'SEE_VIDEO')).toBe(base);
    expect(assign(base, 9, 'QUEUE')).toBe(base);
  });

  it('survives any sequence of assignments without a duplicate', () => {
    let layout = base;
    for (let i = 0; i < 200; i += 1) layout = assign(layout, (i * 7) % 5, MENU_ACTIONS[(i * 11) % MENU_ACTIONS.length]);
    const all = [...layout.slots, layout.side];
    expect(new Set(all).size).toBe(5);
    expect(layout.slots).toHaveLength(4);
    expect(actionAt(layout, SIDE_SLOT)).toBe(layout.side);
  });

  it('a stored side button that repeats a slot is repaired instead of showing the action twice', () => {
    const layout = readLayout('SHUFFLE,QUEUE,SPEED,OUTPUT', 'QUEUE');
    expect(new Set([...layout.slots, layout.side]).size).toBe(5);
    expect(serializeSlots(layout.slots)).toBe('SHUFFLE,QUEUE,SPEED,OUTPUT');
  });
});
