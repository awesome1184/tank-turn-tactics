export const BOARD_SIZE = 16;
export const MAX_PLAYERS = 16;
export const DAILY_AP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STARTING_HP = 3;
export const STARTING_AP = 0;
export const STARTING_RANGE = 2;
export const MAX_HP = 3;
export const RANGE_UPGRADE_COST = 3;
export const HEAL_COST = 3;
export const HEART_GIFT_COST = 3;
export const AP_GIFT_MAX = 3;

export function manhattanDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}