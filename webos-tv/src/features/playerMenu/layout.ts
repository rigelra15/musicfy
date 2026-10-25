/**
 * The player's quick actions, ported from Android's PlayerMenuAction: four slots in the menu and
 * one side button, each set to one of these. An action can only sit in one place; putting it
 * somewhere else swaps it with whatever was there.
 */
export const MENU_ACTIONS = [
  'LIKE', 'OTHER_MENU', 'SLEEP_TIMER', 'SEE_VIDEO', 'REPEAT', 'SHUFFLE', 'LYRICS', 'QUEUE', 'SPEED', 'OUTPUT',
  'KEEP_AWAKE', 'TRANSLATE_LYRICS', 'DOWNLOAD', 'ADD_TO_PLAYLIST',
] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

export const DEFAULT_SLOTS: readonly MenuAction[] = ['OTHER_MENU', 'SLEEP_TIMER', 'SEE_VIDEO', 'REPEAT'];
export const DEFAULT_SIDE: MenuAction = 'LIKE';
/** Index of the side button when slots and side are handled as one list. */
export const SIDE_SLOT = 4;

export const PREF_MENU_SLOTS = 'player.menuSlots';
export const PREF_MENU_SIDE = 'player.sideButton';

const isAction = (value: unknown): value is MenuAction => typeof value === 'string' && (MENU_ACTIONS as readonly string[]).includes(value);

export interface MenuLayout { slots: MenuAction[]; side: MenuAction }

/** Anything stored that is not exactly four known, distinct actions falls back to the defaults. */
export function parseSlots(stored: unknown): MenuAction[] {
  const parsed = typeof stored === 'string' ? stored.split(',').filter(isAction) : [];
  return parsed.length === DEFAULT_SLOTS.length && new Set(parsed).size === parsed.length ? parsed : [...DEFAULT_SLOTS];
}

export function parseSide(stored: unknown): MenuAction {
  return isAction(stored) ? stored : DEFAULT_SIDE;
}

export function readLayout(slotsStored: unknown, sideStored: unknown): MenuLayout {
  const slots = parseSlots(slotsStored);
  const side = parseSide(sideStored);
  // A side button that duplicates a slot (hand-edited storage) would break the one-place rule.
  return slots.includes(side) ? { slots, side: firstUnused(slots) } : { slots, side };
}

function firstUnused(slots: readonly MenuAction[]): MenuAction {
  return MENU_ACTIONS.find((action) => !slots.includes(action)) ?? DEFAULT_SIDE;
}

export function actionAt(layout: MenuLayout, slot: number): MenuAction {
  return slot === SIDE_SLOT ? layout.side : layout.slots[slot];
}

/** Puts `action` at `slot` (0-3, or SIDE_SLOT); the action it replaces moves to where `action` was, if it was in use. */
export function assign(layout: MenuLayout, slot: number, action: MenuAction): MenuLayout {
  if (slot < 0 || slot > SIDE_SLOT) return layout;
  const all = [...layout.slots, layout.side];
  const previous = all[slot];
  if (previous === action) return layout;
  const elsewhere = all.indexOf(action);
  all[slot] = action;
  if (elsewhere >= 0) all[elsewhere] = previous;
  return { slots: all.slice(0, SIDE_SLOT), side: all[SIDE_SLOT] };
}

export const serializeSlots = (slots: readonly MenuAction[]) => slots.join(',');
