import {
  BOARD_SIZE, MAP_SIZES, DAILY_AP_INTERVAL_MS, MAX_HP, MAX_PLAYERS,
  RANGE_UPGRADE_COST, STARTING_AP, STARTING_HP, STARTING_RANGE, chebyshevDistance,
} from "../../../packages/shared/src/contracts";
import type { ClientAction, GameState, MatchEvent, Player, PublicEventLogEntry, PublicGameState, PublicReplayEvent, ReplayMapSnapshot } from "../../../packages/shared/src/contracts";

export interface Env { ROOMS: DurableObjectNamespace; TURNSTILE_SECRET_KEY?: string; }
class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const MAX_HTTP_BODY_BYTES = 32 * 1024;
const MAX_WS_MESSAGE_BYTES = 24 * 1024;
const ALLOWED_WS_ORIGINS = new Set([
  "https://awesome1184.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
async function readJsonBody<T>(request: Request): Promise<T> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HTTP_BODY_BYTES) {
    throw new RequestError("Request body is too large.", 413);
  }
  if (!request.body) throw new RequestError("A JSON request body is required.", 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let source = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTTP_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError("Request body is too large.", 413);
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    return JSON.parse(source) as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("Invalid JSON request body.", 400);
  } finally {
    reader.releaseLock();
  }
}
async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  if (!token || token.length > 4096) return false;
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip && ip !== "unknown") form.set("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: form,
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const cors = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(response.body, { status: response.status, headers });
};
const stubFor = (env: Env) => env.ROOMS.get(env.ROOMS.idFromName("shared-game-v1"));
const GAME_SAVE_VERSION = 2;
const PLAYER_COLORS=["#57a6e8","#ef7373","#65c98c","#e5b85c","#b18ae8","#4bc8c8","#ed9560","#d47bc1"];
function playerColor(index:number):string{return PLAYER_COLORS[index%PLAYER_COLORS.length];}
function makeToken(): string { return crypto.randomUUID() + crypto.randomUUID().replaceAll("-", ""); }
function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a player name.");
  const name = value.trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 18);
  if (!name) throw new Error("Player name cannot be empty.");
  return name;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const url = new URL(request.url);
    try {
      const stub = stubFor(env);
      if (url.pathname === "/api/game/reset" && request.method === "POST") {
        const body = await readJsonBody<{ playerId?: unknown; token?: unknown }>(request);
        return cors(await stub.fetch("https://game.internal/reset", {
          method: "POST", body: JSON.stringify(body),
        }));
      }
      if (url.pathname === "/api/game/join" && request.method === "POST") {
        const body = await readJsonBody<{ name?: unknown; turnstileToken?: unknown }>(request);
        const ip = request.headers.get("cf-connecting-ip") || "unknown";
        if (env.TURNSTILE_SECRET_KEY) {
          const challenge = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
          if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, challenge, ip))) {
            return cors(json({ error: "Complete the anti-bot check and try again." }, 403));
          }
        }
        return cors(await stub.fetch("https://game.internal/join", {
          method: "POST",
          headers: { "content-type": "application/json", "x-client-ip": ip },
          body: JSON.stringify({ name: cleanName(body.name) }),
        }));
      }
      if (url.pathname === "/api/game/recover" && request.method === "POST") {
        const body = await readJsonBody<{ playerId?: unknown; token?: unknown }>(request);
        return cors(await stub.fetch("https://game.internal/recover", {
          method: "POST", body: JSON.stringify(body),
        }));
      }
      if (url.pathname === "/api/game/ws-ticket" && request.method === "POST") {
        const body = await readJsonBody<{ playerId?: unknown; token?: unknown }>(request);
        return cors(await stub.fetch("https://game.internal/ticket", {
          method: "POST", body: JSON.stringify(body),
        }));
      }
      if (url.pathname === "/api/game/ws") {
        return stub.fetch(new Request("https://game.internal/ws" + url.search, request));
      }
      if (url.pathname === "/api/game/notes" && request.method === "POST") {
        const body = await readJsonBody<{ playerId?: string; token?: string }>(request);
        return cors(await stub.fetch("https://game.internal/notes", {method:"POST",body:JSON.stringify(body)}));
      }
      return cors(json({ error: "Not found." }, 404));
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 400;
      return cors(json({ error: error instanceof Error ? error.message : "Unexpected server error." }, status));
    }
  },
};

export class GameRoom {
  private state: DurableObjectState;
  constructor(state: DurableObjectState, _env: Env) { this.state = state; }

  private queue: Promise<void> = Promise.resolve();
  private messageLimits = new Map<string, { windowStart: number; total: number; actions: number; lastSyncAt: number; violationStart: number; violations: number }>();
  private joinAttempts = new Map<string, number[]>();

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async fetch(request: Request): Promise<Response> {
    return this.exclusive(() => this.route(request));
  }

  private async route(request: Request): Promise<Response> {
    const routeUrl=new URL(request.url);
    const path=routeUrl.pathname;
    if (path === "/ws") return this.connect(request);
    if (path === "/reset" && request.method === "POST") return this.reset(request);
    if (path === "/ticket" && request.method === "POST") return this.issueSocketTicket(request);
    if (path === "/join" && request.method === "POST") return this.join(request);
    if (path === "/recover" && request.method === "POST") return this.recover(request);
    if (path === "/notes" && request.method === "POST") return this.notesArchive(request);
    return json({ error: "Not found." }, 404);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.exclusive(() => this.handleSocketMessage(socket, message));
  }

  private allowSocketMessage(socket: WebSocket, playerId: string, category: "raw" | "sync" | "action", now: number): boolean {
    let limit = this.messageLimits.get(playerId);
    if (!limit) {
      limit = { windowStart: now, total: 0, actions: 0, lastSyncAt: 0, violationStart: now, violations: 0 };
      this.messageLimits.set(playerId, limit);
    }
    if (now - limit.windowStart >= 1000) {
      limit.windowStart = now;
      limit.total = 0;
      limit.actions = 0;
    }
    if (now - limit.violationStart >= 10000) {
      limit.violationStart = now;
      limit.violations = 0;
    }

    let rejected = false;
    if (category === "raw") {
      if (limit.total >= 20) rejected = true;
      else limit.total += 1;
    } else if (category === "sync") {
      if (now - limit.lastSyncAt < 2000) rejected = true;
      else limit.lastSyncAt = now;
    } else {
      if (limit.actions >= 5) rejected = true;
      else limit.actions += 1;
    }

    if (!rejected) return true;
    limit.violations += 1;
    if (limit.violations >= 12) {
      try { socket.close(1013, "Rate limit exceeded."); } catch { /* closed socket */ }
    } else {
      this.sendError(socket, "You're sending messages too quickly. Please slow down.");
    }
    return false;
  }

  private async handleSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const session = socket.deserializeAttachment() as { playerId: string; token: string } | null;
      if (!session) return socket.close(1008, "Missing session");
      const game = await this.getGame();
      if (!game) return socket.close(1008, "Lobby not found");
      const player = game.players.find((p) => p.id === session.playerId && p.token === session.token);
      if (!player) return socket.close(1008, "Invalid session");
      const byteLength = typeof message === "string" ? new TextEncoder().encode(message).byteLength : message.byteLength;
      if (byteLength > MAX_WS_MESSAGE_BYTES) return socket.close(1009, "Message too large.");
      const now = Date.now();
      if (!this.allowSocketMessage(socket, player.id, "raw", now)) return;
      let action: ClientAction;
      try {
        action = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as ClientAction;
      } catch { return this.sendError(socket, "Invalid message format."); }
      if (!action || typeof action !== "object" || typeof action.type !== "string") {
        return this.sendError(socket, "Invalid action.");
      }
      const isSync = action.type === "sync";
      if (!this.allowSocketMessage(socket, player.id, isSync ? "sync" : "action", now)) return;

      const dailyChanged = this.applyDailyAp(game, now);
      if (dailyChanged) {
        game.updatedAt = now;
        this.updateOnlineCursors(game);
        await this.save(game);
      }
      if (isSync) {
        if (dailyChanged) this.broadcast(game);
        else {
          try { socket.send(JSON.stringify({ type: "state", state: this.publicState(game, player) })); }
          catch { /* closed socket */ }
        }
        return;
      }

      this.applyAction(game, player, action, now);
      game.updatedAt = now;
      this.updateOnlineCursors(game);
      await this.save(game);
      this.broadcast(game);
    } catch (error) {
      this.sendError(socket, error instanceof Error ? error.message : "Action failed.");
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.exclusive(() => this.handleSocketClose(socket));
  }

  private async handleSocketClose(socket: WebSocket): Promise<void> {
    const session = socket.deserializeAttachment() as { playerId: string; token: string } | null;
    if (!session) return;
    const game = await this.getGame();
    if (!game) return;
    const player = game.players.find((p) => p.id === session.playerId && p.token === session.token);
    if (player) {
      const stillConnected=this.state.getWebSockets().some(candidate=>{
        if(candidate.readyState!==WebSocket.OPEN)return false;
        const attachment=candidate.deserializeAttachment() as {playerId?:string}|null;
        return attachment?.playerId===player.id;
      });
      player.online=stillConnected;
      game.updatedAt = Date.now();
      await this.save(game);
      this.broadcast(game);
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> { await this.webSocketClose(socket); }

  private async issueSocketTicket(request: Request): Promise<Response> {
    const body = await request.json() as { playerId?: unknown; token?: unknown };
    if (typeof body.playerId !== "string" || typeof body.token !== "string") {
      return json({ error: "That recovery key does not match a saved player." }, 400);
    }
    const game = await this.getGame();
    const player = game?.players.find(p => p.id === body.playerId && p.token === body.token);
    if (!game || !player) return json({ error: "That recovery key does not match a saved player." }, 403);

    const now = Date.now();
    const tickets = game.webSocketTickets || {};
    for (const [key, ticket] of Object.entries(tickets)) {
      if (ticket.expiresAt <= now || !game.players.some(candidate => candidate.id === ticket.playerId)) delete tickets[key];
    }
    const activeTickets = Object.entries(tickets);
    if (activeTickets.length >= 128) {
      activeTickets.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      for (const [key] of activeTickets.slice(0, activeTickets.length - 127)) delete tickets[key];
    }
    const ticket = makeToken();
    tickets[ticket] = { playerId: player.id, expiresAt: now + 60_000 };
    game.webSocketTickets = tickets;
    await this.save(game);
    return json({ ticket, expiresAt: now + 60_000 });
  }

  // Only the host may restart a match. The private session token prevents
  // unauthenticated visitors from resetting the shared game. Keep every player
  // record and credential so connected and returning players retain their seats.
  private async reset(request: Request): Promise<Response> {
    const body = await request.json() as { playerId?: unknown; token?: unknown };
    if (typeof body.playerId !== "string" || typeof body.token !== "string") {
      return json({ error: "A valid host session is required to restart the match." }, 400);
    }
    const game = await this.getGame();
    if (!game) return json({ error: "There is no shared match to restart." }, 409);
    const actor = game.players.find(player => player.id === body.playerId && player.token === body.token);
    if (!actor) return json({ error: "That player session is not valid for this match." }, 403);
    if (!actor.host) return json({ error: "Only the match host can restart the shared match." }, 403);
    if (game.phase === "lobby") return json({ error: "The shared match is already in the lobby." }, 409);

    const now = Date.now();
    const hostId = game.hostId || actor.id;
    game.phase = "lobby";
    game.startedAt = null;
    game.updatedAt = now;
    game.winnerId = null;
    game.endReason = null;
    game.obstacles = [];
    game.juryCycleEndsAt = null;
    game.juryVotes = {};
    game.notesHistory = [];
    game.events = [];
    game.nextEventId = 1;

    for (const player of game.players) {
      player.host = player.id === hostId;
      player.hp = STARTING_HP;
      player.ap = STARTING_AP;
      player.range = STARTING_RANGE;
      player.x = null;
      player.y = null;
      player.alive = true;
      player.killedByName = null;
      player.nextApAt = null;
      player.lastSeenEventId = 0;
      player.replayEvents = [];
      delete player.replayMapSnapshot;
    }

    // Keep WebSockets open and broadcast the lobby state to everyone. Offline
    // players will also return to this lobby when they reconnect with the same key.
    await this.save(game);
    this.broadcast(game);
    return json({ success: true, reset: true, playerCount: game.players.length });
  }

  private async getGame(): Promise<GameState | null> {
    const game = (await this.state.storage.get<GameState>("game")) || null;
    if (game) {
      let migrated = false;

      // Version 2 adds 10x10 as a supported map size. This is an additive
      // migration: keep every existing player, credential, stat, note, and
      // match record. Existing supported map sizes remain unchanged.
      if (game.saveVersion !== GAME_SAVE_VERSION) {
        game.saveVersion = GAME_SAVE_VERSION;
        migrated = true;
      }
      const savedBoardSize = Number(game.boardSize);
      const supportedBoardSize = MAP_SIZES.find((size) => size === savedBoardSize) ?? BOARD_SIZE;
      if (game.boardSize !== supportedBoardSize) {
        game.boardSize = supportedBoardSize;
        migrated = true;
      }

      // Initialize fields introduced by earlier updates without replacing
      // the saved game or its player records.
      if (!game.juryVotes) { game.juryVotes = {}; migrated = true; }
      if (game.juryCycleEndsAt === undefined) {
        game.juryCycleEndsAt = game.startedAt === null ? null : game.startedAt + DAILY_AP_INTERVAL_MS;
        migrated = true;
      }
      if (!game.notesHistory) { game.notesHistory = []; migrated = true; }
      if (game.endReason === undefined) { game.endReason = null; migrated = true; }
      if (!game.events) { game.events = []; migrated = true; }
      if (!game.nextEventId) {
        game.nextEventId = game.events.reduce((max, event) => Math.max(max, event.id), 0) + 1;
        migrated = true;
      }
      if (!game.webSocketTickets) { game.webSocketTickets = {}; migrated = true; }
      for (const [index, player] of game.players.entries()) {
        if (!player.color) { player.color = playerColor(index); migrated = true; }
        if (player.notes === undefined) { player.notes = ""; migrated = true; }
        if (player.killedByName === undefined) { player.killedByName = null; migrated = true; }
        if (player.lastSeenEventId === undefined) { player.lastSeenEventId = game.nextEventId - 1; migrated = true; }
        if (player.replayEvents === undefined) { player.replayEvents = []; migrated = true; }
        if (player.lastConnectedAt === undefined) { player.lastConnectedAt = player.joinedAt; migrated = true; }
      }

      // Persist once so existing saves are upgraded automatically on first read.
      if (migrated) await this.save(game);
    }
    return game;
  }
  private async save(game: GameState): Promise<void> { await this.state.storage.put("game", game); }
  private sendError(socket: WebSocket, message: string): void {
    try { socket.send(JSON.stringify({ type: "error", message })); } catch { /* closed socket */ }
  }

  private recordEvent(game:GameState,type:MatchEvent["type"],actor:Player|null,target?:Player,extra:Partial<MatchEvent>={}):void {
    const id=game.nextEventId||1;
    const event:MatchEvent={id,at:Date.now(),type,actorId:actor?.id??null,actorName:actor?.name??null,...(target?{targetId:target.id,targetName:target.name}:{}),...extra};
    game.nextEventId=id+1;
    game.events.push(event);
    if(game.events.length>3000){
      const start=game.events.find(item=>item.type==="match-start");
      const recent=game.events.filter(item=>item!==start);
      recent.splice(0,Math.max(0,recent.length-(start?2999:3000)));
      game.events=start?[start,...recent]:recent;
    }
  }

  private publicEventLog(game:GameState):PublicEventLogEntry[] {
    return game.events.slice(-500).flatMap(event=>{
      const actor=event.actorName||"A player", target=event.targetName||"A player";
      let message:string|null=null;
      switch(event.type){
        case "player-join": message=`${target} joined the lobby.`; break;
        case "player-kick": message=`${actor} kicked ${target}.`; break;
        case "match-start": message="The match started."; break;
        case "move": message=`${actor} moved to (${(event.x??-1)+1}, ${(event.y??-1)+1}).`; break;
        case "attack": message=event.killed?`${target} was eliminated.`:`${target} was hit.`; break;
        case "heal": message=`${actor} repaired their tank.`; break;
        case "range-upgrade": message=`${actor} upgraded their range.`; break;
        case "gift-ap": message=`${actor} sent 1 AP to ${target}.`; break;
        case "gift-heart": message=`${actor} gave a heart to ${target}.`; break;
        case "match-end": message=event.targetName?`${target} wins!`:"The match ended."; break;
        default: message=null;
      }
      return message?[{id:event.id,at:event.at,message}]:[];
    });
  }

  private captureReplayMap(game:GameState):ReplayMapSnapshot {
    return {
      boardSize:game.boardSize,
      obstacles:game.obstacles.map(([x,y]):[number,number]=>[x,y]),
      players:game.players.map(({id,name,color,x,y,alive})=>({id,name,color,x,y,alive})),
    };
  }

  private applyReplayMapEvent(snapshot:ReplayMapSnapshot,event:MatchEvent):void {
    if(event.type==="move"&&event.actorId&&event.x!==undefined&&event.y!==undefined){
      const player=snapshot.players.find(item=>item.id===event.actorId);
      if(player){player.x=event.x;player.y=event.y;}
    } else if(event.type==="attack"&&event.killed&&event.targetId){
      const target=snapshot.players.find(item=>item.id===event.targetId);
      if(target)target.alive=false;
    } else if(event.type==="gift-heart"&&event.targetId){
      const target=snapshot.players.find(item=>item.id===event.targetId);
      if(target)target.alive=true;
    } else if(event.type==="player-kick"&&event.targetId){
      snapshot.players=snapshot.players.filter(item=>item.id!==event.targetId);
    }
  }

  private replayMapAt(game:GameState,eventId:number):ReplayMapSnapshot|undefined {
    const start=game.events.find(item=>item.type==="match-start"&&item.mapSnapshot);
    if(!start?.mapSnapshot)return undefined;
    const snapshot:ReplayMapSnapshot={
      boardSize:start.mapSnapshot.boardSize,
      obstacles:start.mapSnapshot.obstacles.map(([x,y]):[number,number]=>[x,y]),
      players:start.mapSnapshot.players.map(player=>({...player})),
    };
    for(const event of game.events){
      if(event.id<=start.id)continue;
      if(event.id>eventId)break;
      this.applyReplayMapEvent(snapshot,event);
    }
    return snapshot;
  }

  private replayFor(player:Player):PublicReplayEvent[] {
    const output:PublicReplayEvent[]=[];
    let initialMap=player.replayMapSnapshot;
    for(const event of player.replayEvents||[]){
      const actor=event.actorName||"A player", target=event.targetName||"A player";
      let message:string|null=null;
      switch(event.type){
        case "player-join": message=`${target} joined the lobby.`; break;
        case "player-kick": message=`${actor} kicked ${target}.`; break;
        case "match-start": message="The match started."; break;
        case "move": message=`${actor} moved to (${(event.x??-1)+1}, ${(event.y??-1)+1}).`; break;
        case "attack":
          if(event.actorId===player.id) message=event.killed?`You eliminated ${target}.`:`You hit ${target}.`;
          else if(event.targetId===player.id) message=event.killed?`You were eliminated by ${actor}.`:"You were hit.";
          else message=event.killed?`${target} was eliminated.`:`${target} was hit.`;
          break;
        case "heal": message=event.actorId===player.id?"You repaired 1 HP.":`${actor} repaired 1 HP.`; break;
        case "range-upgrade": message=event.actorId===player.id?"You upgraded your range.":null; break;
        case "gift-ap": message=`${actor} sent 1 AP to ${target}.`; break;
        case "gift-heart": message=`${actor} gave a heart to ${target}.`; break;
        case "daily-ap": message=event.actorId===player.id?`You received ${event.amount||1} AP from the daily timer.`:null; break;
        case "match-end": message=event.targetName?`${target} wins!`:"The match ended."; break;
      }
      if(!message)continue;
      output.push({
        id:event.id,at:event.at,message,type:event.type,actorId:event.actorId,
        ...(event.targetId?{targetId:event.targetId}:{}),
        ...(event.x!==undefined?{x:event.x}:{}),
        ...(event.y!==undefined?{y:event.y}:{}),
        ...(event.killed!==undefined?{killed:event.killed}:{}),
        ...(initialMap?{mapSnapshot:initialMap}:event.mapSnapshot?{mapSnapshot:event.mapSnapshot}:{}),
      });
      initialMap=undefined;
    }
    return output;
  }

  private updateOnlineCursors(game:GameState):void {
    const latest=(game.nextEventId||1)-1;
    for(const player of game.players) {
      if(player.online && this.replayFor(player).length===0) player.lastSeenEventId=latest;
    }
  }

  private async notesArchive(request:Request):Promise<Response>{
    const body=await request.json() as {playerId?:unknown;token?:unknown};
    if(typeof body.playerId!=="string"||typeof body.token!=="string")return json({error:"Invalid session."},400);
    const game=await this.getGame();
    const actor=game?.players.find(p=>p.id===body.playerId&&p.token===body.token);
    if(!game||!actor)return json({error:"Invalid session."},403);
    if(!actor.host)return json({error:"Only the host can view the notes archive."},403);
    if(game.phase!=="ended")return json({error:"The notes archive is available after the match ends."},409);
    return json({entries:game.notesHistory||[]});
  }

  private async join(request: Request): Promise<Response> {
    const body = await request.json() as { name: string };
    const now = Date.now();
    const ip = (request.headers.get("x-client-ip") || "unknown").slice(0, 64);
    const attempts = (this.joinAttempts.get(ip) || []).filter(at => now - at < 60_000);
    if (attempts.length >= 30) return json({ error: "Too many players have joined from this network. Please try again in a minute." }, 429);
    attempts.push(now);
    this.joinAttempts.set(ip, attempts);
    if (this.joinAttempts.size > 1024) {
      for (const [key, times] of this.joinAttempts) if (!times.length || now - times[times.length - 1] > 60_000) this.joinAttempts.delete(key);
      while (this.joinAttempts.size > 1024) this.joinAttempts.delete(this.joinAttempts.keys().next().value as string);
    }
    let game = await this.getGame();

    // The first tab to join creates the shared lobby and becomes its host.
    if (!game) {
      const player: Player = {
        id: crypto.randomUUID(), token: makeToken(), name: cleanName(body.name),
        color:playerColor(0),notes:"",killedByName:null,lastSeenEventId:0,replayEvents:[],
        hp: STARTING_HP, ap: STARTING_AP, range: STARTING_RANGE, x: null, y: null,
        alive: true, host: true, joinedAt: now, lastConnectedAt: now, nextApAt: null, online: false,
      };
      game = {
        saveVersion: GAME_SAVE_VERSION,
        phase: "lobby", hostId: player.id, createdAt: now, startedAt: null,
        updatedAt: now, boardSize: BOARD_SIZE, obstacles: [], players: [player],
        winnerId:null,endReason:null,juryCycleEndsAt:null,juryVotes:{},notesHistory:[],events:[],nextEventId:1,
      };
      this.recordEvent(game,"player-join",null,player);
      await this.save(game);
      return json({ playerId: player.id, token: player.token, name: player.name });
    }
    if (game.phase !== "lobby") {
      return json({ error: "The shared match has already started. New players cannot join this match." }, 409);
    }
    if (game.players.length >= MAX_PLAYERS) return json({ error: "The shared match is full." }, 409);
    const firstPlayer = game.players.length === 0;
    const player: Player = {
      id: crypto.randomUUID(), token: makeToken(), name: cleanName(body.name),
      color:playerColor(game.players.length),notes:"",killedByName:null,lastSeenEventId:(game.nextEventId||1)-1,replayEvents:[],
      hp: STARTING_HP, ap: STARTING_AP, range: STARTING_RANGE, x: null, y: null,
      alive: true, host: firstPlayer, joinedAt: now, lastConnectedAt: now, nextApAt: null, online: false,
    };
    if (firstPlayer) game.hostId = player.id;
    game.players.push(player);
    this.recordEvent(game,"player-join",null,player);
    game.updatedAt = now;
    await this.save(game);
    return json({ playerId: player.id, token: player.token, name: player.name });
  }

  private async recover(request: Request): Promise<Response> {
    const body = await request.json() as { playerId?: unknown; token?: unknown };
    if (typeof body.playerId !== "string" || typeof body.token !== "string") {
      return json({ error: "That recovery key is invalid." }, 400);
    }
    const game = await this.getGame();
    const player = game?.players.find((p) => p.id === body.playerId && p.token === body.token);
    if (!game || !player) return json({ error: "That recovery key does not match a saved player." }, 403);
    return json({ playerId: player.id, name: player.name });
  }

  private async connect(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (!ALLOWED_WS_ORIGINS.has(origin)) return new Response("Origin not allowed", { status: 403 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const ticketKey = url.searchParams.get("ticket") || "";
    const game = await this.getGame();
    if (!game) return new Response("Lobby not found", { status: 404 });
    const ticket = game.webSocketTickets?.[ticketKey];
    if (!ticket || ticket.expiresAt <= Date.now()) {
      if (ticket && game.webSocketTickets) {
        delete game.webSocketTickets[ticketKey];
        await this.save(game);
      }
      return new Response("Connection ticket is invalid or expired", { status: 403 });
    }
    const player = game.players.find((p) => p.id === ticket.playerId);
    delete game.webSocketTickets![ticketKey];
    if (!player) {
      await this.save(game);
      return new Response("Player session no longer exists", { status: 403 });
    }
    const activeConnections = this.state.getWebSockets().filter(candidate => {
      if (candidate.readyState !== WebSocket.OPEN) return false;
      const attachment = candidate.deserializeAttachment() as { playerId?: string } | null;
      return attachment?.playerId === player.id;
    }).length;
    if (activeConnections >= 3) {
      await this.save(game);
      return new Response("Too many connections for this player", { status: 429 });
    }
    const connectedAt=Date.now();
    this.applyDailyAp(game,connectedAt);
    const wasOnline=player.online;
    if(!wasOnline){
      const lastSeen=player.lastSeenEventId||0;
      player.replayEvents=game.events.filter(event=>event.id>lastSeen);
      player.replayMapSnapshot=player.replayEvents.length?this.replayMapAt(game,lastSeen):undefined;
    } else {
      player.replayEvents=[];
      player.replayMapSnapshot=undefined;
    }
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server, [player.id]);
    server.serializeAttachment({ playerId: player.id, token: player.token });
    player.online = true;
    player.lastConnectedAt = connectedAt;
    player.lastSeenEventId=player.replayEvents.length?player.lastSeenEventId:(game.nextEventId||1)-1;
    this.updateOnlineCursors(game);
    game.updatedAt = connectedAt;
    await this.save(game);
    this.broadcast(game);
    return new Response(null, { status: 101, webSocket: client });
  }

  private applyDailyAp(game: GameState, now: number): boolean {
    if (game.phase !== "active") return false;
    let changed = false;

    // The jury ballot closes on the same 24-hour boundary as daily AP income.
    if (game.juryCycleEndsAt == null && game.startedAt !== null) {
      game.juryCycleEndsAt = game.startedAt + DAILY_AP_INTERVAL_MS;
      changed = true;
    }
    if (game.juryCycleEndsAt !== null && now >= game.juryCycleEndsAt) {
      const votesByTarget = new Map<string, number>();
      for (const [voterId, vote] of Object.entries(game.juryVotes)) {
        const voter = game.players.find((p) => p.id === voterId);
        const target = game.players.find((p) => p.id === vote.targetId);
        if (vote.invalidated || !voter || voter.alive || !target || !target.alive) continue;
        votesByTarget.set(vote.targetId, (votesByTarget.get(vote.targetId) || 0) + 1);
      }
      for (const [targetId, voteCount] of votesByTarget) {
        if (voteCount >= 3) {
          const recipient = game.players.find((p) => p.id === targetId);
          if (recipient?.alive) recipient.ap += 1;
        }
      }
      // Resolve stored votes once even if the room was offline for several days.
      const elapsedCycles = Math.floor((now - game.juryCycleEndsAt) / DAILY_AP_INTERVAL_MS) + 1;
      game.juryCycleEndsAt += elapsedCycles * DAILY_AP_INTERVAL_MS;
      game.juryVotes = {};
      changed = true;
    }

    for (const player of game.players) {
      if (!player.alive || player.nextApAt === null || now < player.nextApAt) continue;
      const firstDueAt=player.nextApAt;
      const earned = Math.floor((now - player.nextApAt) / DAILY_AP_INTERVAL_MS) + 1;
      player.ap += earned;
      player.nextApAt += earned * DAILY_AP_INTERVAL_MS;
      this.recordEvent(game,"daily-ap",player,undefined,{amount:earned,at:firstDueAt});
      changed = true;
    }
    return changed;
  }

  private applyAction(game: GameState, actor: Player, action: ClientAction, now: number): void {
    if (action.type === "claimHost") {
      if (game.phase !== "lobby") throw new Error("Host can only be changed before the match starts.");
      if (actor.host) return;
      const currentHost = game.players.find(player => player.id === game.hostId) || game.players.find(player => player.host);
      const lastConnectedAt = currentHost?.lastConnectedAt ?? currentHost?.joinedAt ?? now;
      if (currentHost?.online || now - lastConnectedAt < 5 * 60 * 1000) {
        throw new Error("The current host must be offline for five minutes before another player can take over.");
      }
      if (currentHost) currentHost.host = false;
      actor.host = true;
      game.hostId = actor.id;
      return;
    }
    if (action.type === "ackReplay") {
      const latest=(game.nextEventId||1)-1;
      const last=Number(action.lastEventId);
      if(Number.isInteger(last)) actor.lastSeenEventId=Math.max(actor.lastSeenEventId,Math.min(last,latest));
      actor.replayEvents=[];
      actor.replayMapSnapshot=undefined;
      return;
    }
    if (action.type === "kick") {
      if (!actor.host) throw new Error("Only the host can remove players.");
      if (game.phase !== "lobby") throw new Error("Players can only be removed before the match starts.");
      if (typeof action.targetId !== "string" || action.targetId === actor.id) throw new Error("Choose another player to remove.");
      const targetIndex=game.players.findIndex(player=>player.id===action.targetId);
      if(targetIndex<0)throw new Error("That player is no longer in the match.");
      const target=game.players[targetIndex];
      this.recordEvent(game,"player-kick",actor,target);
      game.players.splice(targetIndex,1);
      delete game.juryVotes[target.id];
      for(const vote of Object.values(game.juryVotes))if(vote.targetId===target.id)vote.invalidated=true;
      game.notesHistory=game.notesHistory.filter(entry=>entry.playerId!==target.id);
      return;
    }
    if (action.type === "setColor") {
      if(game.phase!=="lobby")throw new Error("Tank colors can only be changed in the lobby.");
      if(typeof action.color!=="string"||!/^#[0-9a-fA-F]{6}$/.test(action.color))throw new Error("Choose a valid player color.");
      actor.color=action.color.toLowerCase();return;
    }
    if (action.type === "saveNotes") {
      if(game.phase==="ended")throw new Error("The match has ended; notes are read-only.");
      if(typeof action.notes!=="string"||action.notes.length>5000)throw new Error("Notes must be 5,000 characters or fewer.");
      const nextNotes=action.notes;
      if(nextNotes!==(actor.notes||"")){
        const own=game.notesHistory.filter(entry=>entry.playerId===actor.id);
        if(own.length>=30){const oldest=own[0].id;game.notesHistory=game.notesHistory.filter(entry=>entry.id!==oldest);}
        actor.notes=nextNotes;
        game.notesHistory.push({id:crypto.randomUUID(),playerId:actor.id,playerName:actor.name,text:nextNotes,at:now});
      }
      return;
    }
    if (action.type === "setMapSize") {
      if (game.phase !== "lobby") throw new Error("Map size can only be changed before the match starts.");
      if (!actor.host) throw new Error("Only the host can change lobby settings.");
      const requestedSize = Number(action.mapSize);
      if (!MAP_SIZES.some((size) => size === requestedSize)) throw new Error("Choose a supported map size.");
      game.boardSize = requestedSize;
      return;
    }
    if (action.type === "start") {
      if (game.phase !== "lobby") throw new Error("The match has already started.");
      if (!actor.host) throw new Error("Only the host can start the match.");
      if (game.players.length < 2) throw new Error("Invite at least one more player first.");
      this.startGame(game, now);
      return;
    }
    if (action.type === "sync") return;
    if (game.phase !== "active") throw new Error("The match is not active.");
    if (!actor.alive && action.type !== "juryVote") throw new Error("Eliminated players can only cast jury votes.");

    switch (action.type) {
      case "move": {
        const x = Number(action.x), y = Number(action.y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= game.boardSize || y >= game.boardSize) throw new Error("Choose a tile on the board.");
        if (x === actor.x && y === actor.y) throw new Error("Your tank is already there.");
        const path = this.findPath(game, actor, x, y);
        if (!path || path.length < 2) throw new Error("That tile cannot be reached.");
        const cost = path.length - 1;
        this.spend(actor, cost);
        actor.x = x;
        actor.y = y;
        this.recordEvent(game,"move",actor,undefined,{x,y});
        return;
      }
      case "attack": {
        const target = this.target(game, actor, action.targetId);
        if (!target.alive) throw new Error("That tank is already eliminated.");
        this.requireRange(actor, target);
        this.spend(actor, 1);
        target.hp -= 1;
        if (target.hp <= 0) {
          target.hp=0;target.alive=false;target.nextApAt=null;target.killedByName=actor.name;
          actor.ap+=target.ap;target.ap=0;
          this.recordEvent(game,"attack",actor,target,{killed:true});
          const alive=game.players.filter(p=>p.alive);
          if(alive.length===1){
            game.phase="ended";game.winnerId=alive[0].id;game.endReason="last-player-standing";
            this.recordEvent(game,"match-end",null,alive[0]);
          }
        } else {
          this.recordEvent(game,"attack",actor,target,{killed:false});
        }
        return;
      }
      case "heal":
        if (actor.hp >= MAX_HP) throw new Error("Your tank is already at full health.");
        this.spend(actor, 3); actor.hp = Math.min(MAX_HP, actor.hp + 1);
        this.recordEvent(game,"heal",actor);return;
      case "upgradeRange":
        this.spend(actor, RANGE_UPGRADE_COST); actor.range += 1;
        this.recordEvent(game,"range-upgrade",actor);return;
      case "giftAp": {
        const target = this.target(game, actor, action.targetId);
        if (!target.alive) throw new Error("You can only gift AP to a living player.");
        this.requireRange(actor, target);
        const amount = Number(action.amount);
        if (!Number.isInteger(amount) || amount !== 1) throw new Error("AP gifts transfer exactly 1 AP per click.");
        this.spend(actor, 1); target.ap += 1;
        this.recordEvent(game,"gift-ap",actor,target);return;
      }
      case "giftHp": {
        const target = this.target(game, actor, action.targetId);
        this.requireRange(actor, target);
        if (actor.hp <= 1) throw new Error("You must keep at least 1 HP to give a heart.");
        if (target.alive && target.hp >= MAX_HP) throw new Error("That player is already at full health.");
        actor.hp -= 1;
        if (!target.alive) {
          target.alive = true; target.hp = 1; target.ap = 0; target.killedByName=null;
          if (game.juryVotes[target.id]) game.juryVotes[target.id].invalidated = true;
          target.nextApAt = now + DAILY_AP_INTERVAL_MS;
        } else target.hp = Math.min(MAX_HP, target.hp + 1);
        this.recordEvent(game,"gift-heart",actor,target);return;
      }
      case "juryVote": {
        if (actor.alive) throw new Error("Only eliminated players can vote in the jury.");
        if (game.juryCycleEndsAt === null || now >= game.juryCycleEndsAt) throw new Error("The jury vote is closed. The next daily cycle is opening.");
        if (game.juryVotes[actor.id]) throw new Error("You have already cast your jury vote this cycle.");
        const target = this.target(game, actor, action.targetId);
        if (!target.alive) throw new Error("The jury can only support a living player.");
        game.juryVotes[actor.id] = { targetId: target.id, invalidated: false };
        return;
      }
      default: throw new Error("Unknown action.");
    }
  }

  private startGame(game: GameState, now: number): void {
    game.phase = "active"; game.startedAt = now; game.winnerId = null; game.endReason=null; game.juryCycleEndsAt = now + DAILY_AP_INTERVAL_MS; game.juryVotes = {};
    const occupied = new Set<string>();
    const obstacleCount = Math.round(30 * (game.boardSize / BOARD_SIZE) ** 2);
    while (game.obstacles.length < obstacleCount) {
      const x = Math.floor(Math.random() * game.boardSize), y = Math.floor(Math.random() * game.boardSize);
      const key = x + "," + y;
      if (!occupied.has(key)) { occupied.add(key); game.obstacles.push([x, y]); }
    }
    for (const player of game.players) {
      let x = 0, y = 0, key = "";
      do {
        x = Math.floor(Math.random() * game.boardSize); y = Math.floor(Math.random() * game.boardSize); key = x + "," + y;
      } while (occupied.has(key));
      occupied.add(key);
      player.x = x; player.y = y; player.hp = STARTING_HP; player.ap = STARTING_AP;
      player.range = STARTING_RANGE; player.alive = true; player.killedByName=null; player.nextApAt = now + DAILY_AP_INTERVAL_MS;
    }
    game.events=[];game.nextEventId=1;
    for(const player of game.players){player.lastSeenEventId=0;player.replayEvents=[];player.replayMapSnapshot=undefined;}
    this.recordEvent(game,"match-start",null,undefined,{mapSnapshot:this.captureReplayMap(game)});
  }

  private spend(player: Player, amount: number): void {
    if (!Number.isInteger(amount) || amount < 0) throw new Error("Invalid AP amount.");
    if (player.ap < amount) throw new Error("Not enough AP. You need " + amount + ", and have " + player.ap + ".");
    player.ap -= amount;
  }

  private target(game: GameState, actor: Player, targetId?: string): Player {
    if (!targetId || targetId === actor.id) throw new Error("Choose another player.");
    const target = game.players.find((p) => p.id === targetId);
    if (!target || target.x === null || target.y === null || actor.x === null || actor.y === null) throw new Error("Player not found on the battlefield.");
    return target;
  }

  private requireRange(actor: Player, target: Player): void {
    if (actor.x === null || actor.y === null || target.x === null || target.y === null) throw new Error("Tank position unavailable.");
    if (chebyshevDistance(actor.x, actor.y, target.x, target.y) > actor.range) throw new Error("That player is outside your range.");
  }

  private findPath(game: GameState, actor: Player, targetX: number, targetY: number): Array<[number, number]> | null {
    const blocked = new Set(game.obstacles.map(([x, y]) => x + "," + y));
    for (const player of game.players) {
      if (player.id !== actor.id && player.x !== null && player.y !== null) blocked.add(player.x + "," + player.y);
    }
    const start: [number, number] = [actor.x!, actor.y!];
    const queue: Array<[number, number]> = [start];
    const key = (x: number, y: number) => x + "," + y;
    const previous = new Map<string, string | null>([[key(start[0], start[1]), null]]);
    const directions: Array<[number, number]> = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
    while (queue.length) {
      const [x, y] = queue.shift()!;
      if (x === targetX && y === targetY) break;
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy, nk = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= game.boardSize || ny >= game.boardSize || blocked.has(nk) || previous.has(nk)) continue;
        previous.set(nk, key(x, y)); queue.push([nx, ny]);
      }
    }
    const targetKey = key(targetX, targetY);
    if (!previous.has(targetKey)) return null;
    const path: Array<[number, number]> = [];
    let cursor: string | null = targetKey;
    while (cursor) {
      const [x, y] = cursor.split(",").map(Number);
      path.push([x, y]); cursor = previous.get(cursor) || null;
    }
    return path.reverse();
  }

  private publicState(game: GameState, player: Player): PublicGameState {
    const host = game.players.find(p => p.id === game.hostId) || game.players.find(p => p.host);
    return {
      phase:game.phase,createdAt:game.createdAt,startedAt:game.startedAt,boardSize:game.boardSize,
      obstacles:game.obstacles,winnerId:game.winnerId,endReason:game.endReason||null,
      onlineCount:game.players.filter(p=>p.online).length,
      hostOnline:host?.online ?? false,
      hostLastConnectedAt:host?.lastConnectedAt ?? null,
      eventLog:this.publicEventLog(game),
      players:game.players.map(({id,name,color,hp,x,y,alive,host})=>({id,name,color,hp,x,y,alive,host})),
      jury:{memberCount:game.players.filter(p=>!p.alive).length,cycleEndsAt:game.juryCycleEndsAt},
      me:{id:player.id,ap:player.ap,nextApAt:player.nextApAt,range:player.range,notes:player.notes||"",
        killerName:!player.alive?(player.killedByName||null):null,isJuryMember:!player.alive,hasVoted:!!game.juryVotes[player.id],
        replayEvents:this.replayFor(player)},
    };
  }

  private broadcast(game: GameState): void {
    for (const socket of this.state.getWebSockets()) {
      const session = socket.deserializeAttachment() as { playerId: string; token: string } | null;
      if (!session) continue;
      const player = game.players.find((p) => p.id === session.playerId && p.token === session.token);
      if (!player) { socket.close(1008, "Kicked by host."); continue; }
      try { socket.send(JSON.stringify({ type: "state", state: this.publicState(game, player) })); }
      catch { /* closed socket */ }
    }
  }
}
