export const MAX_TERMINALS = 99;
export const validTerminalSlot = slot => Number.isInteger(slot) && slot >= 1 && slot <= MAX_TERMINALS;
