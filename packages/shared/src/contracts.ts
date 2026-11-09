export const BOARD_SIZE=16;
export const MAP_SIZES=[10,16,20,24,32] as const;
export const MAX_PLAYERS=64;
export const DAILY_AP_INTERVAL_MS=24*60*60*1000;
export const STARTING_HP=3;
export const STARTING_AP=0;
export const STARTING_RANGE=2;
export const MAX_HP=3;
export const RANGE_UPGRADE_COST=3;
export type MatchPhase="lobby"|"active"|"ended";
export type PlayerLabel="ally"|"enemy"|"unmarked";
export type MatchEventType="player-join"|"player-kick"|"match-start"|"move"|"attack"|"heal"|"range-upgrade"|"gift-ap"|"gift-heart"|"daily-ap"|"match-end";
export interface ReplayMapPlayer{id:string;name:string;color:string;x:number|null;y:number|null;alive:boolean;}
export interface ReplayMapSnapshot{boardSize:number;obstacles:Array<[number,number]>;players:ReplayMapPlayer[];}
export interface MatchEvent{id:number;at:number;type:MatchEventType;actorId:string|null;actorName:string|null;targetId?:string;targetName?:string;x?:number;y?:number;amount?:number;killed?:boolean;mapSnapshot?:ReplayMapSnapshot;}
export interface PublicReplayEvent{id:number;at:number;message:string;type?:MatchEventType;actorId?:string|null;targetId?:string;x?:number;y?:number;killed?:boolean;mapSnapshot?:ReplayMapSnapshot;}
export interface PublicEventLogEntry{id:number;at:number;message:string;}
export interface NoteHistoryEntry{id:string;playerId:string;playerName:string;text:string;at:number;}
export interface Player{id:string;token:string;name:string;color:string;notes:string;killedByName:string|null;hp:number;ap:number;range:number;x:number|null;y:number|null;alive:boolean;host:boolean;joinedAt:number;lastConnectedAt?:number;nextApAt:number|null;online:boolean;lastSeenEventId:number;replayEvents?:MatchEvent[];replayMapSnapshot?:ReplayMapSnapshot;}
export interface GameState{saveVersion?:number;phase:MatchPhase;hostId:string;createdAt:number;startedAt:number|null;updatedAt:number;boardSize:number;obstacles:Array<[number,number]>;players:Player[];winnerId:string|null;endReason:string|null;juryCycleEndsAt:number|null;juryVotes:Record<string,{targetId:string;invalidated:boolean}>;notesHistory:NoteHistoryEntry[];events:MatchEvent[];nextEventId:number;webSocketTickets?:Record<string,{playerId:string;expiresAt:number}>;}
export interface PublicPlayer{id:string;name:string;color:string;hp:number;x:number|null;y:number|null;alive:boolean;host:boolean;}
export interface PublicGameState{phase:MatchPhase;createdAt:number;startedAt:number|null;boardSize:number;obstacles:Array<[number,number]>;players:PublicPlayer[];winnerId:string|null;endReason:string|null;onlineCount:number;hostOnline:boolean;hostLastConnectedAt:number|null;eventLog:PublicEventLogEntry[];jury:{memberCount:number;cycleEndsAt:number|null};me:{id:string;ap:number;nextApAt:number|null;range:number;notes:string;killerName:string|null;isJuryMember:boolean;hasVoted:boolean;replayEvents:PublicReplayEvent[]};}
export interface ClientAction{type:"sync"|"ackReplay"|"start"|"claimHost"|"kick"|"setColor"|"saveNotes"|"setMapSize"|"move"|"attack"|"heal"|"upgradeRange"|"giftAp"|"giftHp"|"juryVote";x?:number;y?:number;targetId?:string;amount?:number;mapSize?:number;color?:string;notes?:string;lastEventId?:number;}
export function chebyshevDistance(ax:number,ay:number,bx:number,by:number):number{return Math.max(Math.abs(ax-bx),Math.abs(ay-by));}
