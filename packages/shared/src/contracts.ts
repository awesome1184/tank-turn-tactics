export const BOARD_SIZE = 16;
export const MAP_SIZES = [16, 20, 24, 32] as const;
export const MAX_PLAYERS = 64;
export const DAILY_AP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STARTING_HP = 3;
export const STARTING_AP = 0;
export const STARTING_RANGE = 2;
export const MAX_HP = 3;
export const RANGE_UPGRADE_COST = 3;
export type MatchPhase = "lobby" | "active" | "ended";
export type PlayerLabel = "ally" | "enemy" | "unmarked";
export interface Player { id:string; token:string; name:string; hp:number; ap:number; range:number; x:number|null; y:number|null; alive:boolean; host:boolean; joinedAt:number; nextApAt:number|null; online:boolean; }
export interface GameState { phase:MatchPhase; hostId:string; createdAt:number; startedAt:number|null; updatedAt:number; boardSize:number; obstacles:Array<[number,number]>; players:Player[]; winnerId:string|null; juryCycleEndsAt:number|null; juryVotes:Record<string,{targetId:string;invalidated:boolean}>; }
export interface PublicPlayer { id:string; name:string; hp:number; range:number; x:number|null; y:number|null; alive:boolean; host:boolean; online:boolean; }
export interface PublicGameState { phase:MatchPhase; createdAt:number; startedAt:number|null; boardSize:number; obstacles:Array<[number,number]>; players:PublicPlayer[]; winnerId:string|null; jury:{memberCount:number;cycleEndsAt:number|null}; me:{id:string;ap:number;nextApAt:number|null;isJuryMember:boolean;hasVoted:boolean}; }
export interface ClientAction { type:"sync"|"start"|"reset"|"setMapSize"|"move"|"attack"|"heal"|"upgradeRange"|"giftAp"|"giftHp"|"juryVote"; x?:number; y?:number; targetId?:string; amount?:number; mapSize?:number; }
export function chebyshevDistance(ax:number,ay:number,bx:number,by:number):number { return Math.max(Math.abs(ax-bx),Math.abs(ay-by)); }
