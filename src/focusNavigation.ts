export type FocusDirection = 'left' | 'right' | 'up' | 'down';

export interface FocusCell {
  id: string;
  row: number;
  column: number;
  disabled?: boolean;
}

/** Row zero is the TV's horizontal navigation; all other rows are page content. */
export function moveTvFocus(
  currentId: string,
  direction: FocusDirection,
  cells: FocusCell[],
  activeNavigationId: string,
): string {
  const current = cells.find((cell) => cell.id === currentId);
  if (!current) return currentId;
  const content = cells.filter((cell) => cell.row > 0 && !cell.disabled);
  if (current.row === 0) {
    if (direction === 'down') {
      return [...content].sort((a, b) => a.row - b.row || a.column - b.column)[0]?.id ?? currentId;
    }
    return moveFocus(currentId, direction, cells.filter((cell) => cell.row === 0));
  }
  if (direction === 'up' && !content.some((cell) => cell.row < current.row)) {
    return cells.find((cell) => cell.id === activeNavigationId && !cell.disabled)?.id ?? currentId;
  }
  return moveFocus(currentId, direction, content);
}

export function canLeaveTextInput(
  direction: FocusDirection,
  selectionStart: number,
  selectionEnd: number,
  valueLength: number,
): boolean {
  if (direction === 'left') return selectionStart === 0 && selectionEnd === 0;
  if (direction === 'right') return selectionStart === valueLength && selectionEnd === valueLength;
  return true;
}

export function moveFocus(
  currentId: string,
  direction: FocusDirection,
  cells: FocusCell[],
): string {
  const current = cells.find((cell) => cell.id === currentId);
  if (!current) return currentId;

  const candidates = cells
    .filter((cell) => !cell.disabled && cell.id !== currentId)
    .map((cell, order) => {
      const rowDelta = cell.row - current.row;
      const columnDelta = cell.column - current.column;
      const primaryDistance =
        direction === 'left'
          ? -columnDelta
          : direction === 'right'
            ? columnDelta
            : direction === 'up'
              ? -rowDelta
              : rowDelta;

      if (primaryDistance <= 0) return null;

      const secondaryDistance =
        direction === 'left' || direction === 'right'
          ? Math.abs(rowDelta)
          : Math.abs(columnDelta);

      return {
        id: cell.id,
        primaryDistance,
        secondaryDistance,
        score: primaryDistance + secondaryDistance * 2,
        order,
      };
    })
    .filter((candidate) => candidate !== null)
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.primaryDistance - right.primaryDistance ||
        left.secondaryDistance - right.secondaryDistance ||
        left.order - right.order,
    );

  return candidates[0]?.id ?? currentId;
}
