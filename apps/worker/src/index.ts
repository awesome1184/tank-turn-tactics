import {
  BOARD_SIZE, DAILY_AP_INTERVAL_MS, MAX_CHAT_MESSAGES, MAX_HP, MAX_PLAYERS,
  RANGE_UPGRADE_COST, STARTING_AP, STARTING_HP, STARTING_RANGE, chebyshevDistance,
} from "../../../packages/shared/src/contracts";
import type { ClientAction, GameState, Player, PublicGameState } from "../../../packages/shared/src/contracts";

export interface Env { ROOMS: DurableObjectNamespace; }
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
const stubFor = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
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
      if (url.pathname === "/api/health") return cors(json({ ok: true, service: "tank-turn-tactics-api" }));
      if (url.pathname === "/api/rooms" && request.method === "POST") {
        const body = await request.json() as { name?: unknown };
        const name = cleanName(body.name);
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = makeCode(), token = makeToken(), playerId = crypto.randomUUID();
          const response = await stubFor(env, code).fetch("https://room.internal/create", {
            method: "POST", body: JSON.stringify({ code, name, token, playerId }),
          });
          if (response.status !== 409) return cors(response);
        }
        return cors(json({ error: "Could not reserve a lobby code. Please retry." }, 503));
      }
      const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|ws))?$/i);
      if (!match) return cors(json({ error: "Not found." }, 404));
      const code = match[1].toUpperCase();
      const action = match[2] || "state";
      const stub = stubFor(env, code);
      if (action === "join" && request.method === "POST") {
        const body = await request.json() as { name?: unknown };
        return cors(await stub.fetch("https://room.internal/join", {
          method: "POST", body: JSON.stringify({ name: cleanName(body.name) }),
        }));
      }
      if (action === "ws") return stub.fetch(new Request("https://room.internal/ws" + url.search, request));
      return cors(await stub.fetch("https://room.internal/state"));
    } catch (error) {
      return cors(json({ error: error instanceof Error ? error.message : "Unexpected server error." }, 400));
    }
  },
};

export class GameRoom {
  private state: DurableObjectState;
  constructor(state: DurableObjectState, _env: Env) { this.state = state; }

  private queue: Promise<void> = Promise.resolve();

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  async fetch(request: Request): Promise<Response> {
    return this.exclusive(() => this.route(request));
  }

  private async route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/ws") return this.connect(request);
    if (path === "/create" && request.method === "POST") return this.create(request);
    if (path === "/join" && request.method === "POST") return this.join(request);
    if (path === "/state") {
      const game = await this.getGame();
      if (!game) return json({ error: "Lobby not found." }, 404);
      this.applyDailyAp(game, Date.now());
      await this.save(game);
      return json({ ok: true, code: game.code, phase: game.phase, players: game.players.length });
    }
    return json({ error: "Not found." }, 404);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.exclusive(() => this.handleSocketMessage(socket, message));
  }

  private async handleSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const session = socket.deserializeAttachment() as { playerId: string; token: string } | null;
      if (!session) return socket.close(1008, "Missing session");
      const game = await this.getGame();
      if (!game) return socket.close(1008, "Lobby not found");
      const player = game.players.find((p) => p.id === session.playerId && p.token === session.token);
      if (!player) return socket.close(1008, "Invalid session");
      let action: ClientAction;
      try {
        action = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as ClientAction;
      } catch { return this.sendError(socket, "Invalid message format."); }
      const now = Date.now();
      this.applyDailyAp(game, now);
      if (action.type !== "sync") this.applyAction(game, player, action, now);
      game.updatedAt = now;
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
      player.online = false;
      game.updatedAt = Date.now();
      await this.save(game);
      this.broadcast(game);
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> { await this.webSocketClose(socket); }

  private async getGame(): Promise<GameState | null> {
    return (await this.state.storage.get<GameState>("game")) || null;
  }
  private async save(game: GameState): Promise<void> { await this.state.storage.put("game", game); }
  private sendError(socket: WebSocket, message: string): void {
    try { socket.send(JSON.stringify({ type: "error", message })); } catch { /* closed socket */ }
  }

  private async create(request: Request): Promise<Response> {
    const body = await request.json() as { code: string; name: string; token: string; playerId: string };
    if (await this.getGame()) return json({ error: "Code collision." }, 409);
    const now = Date.now();
    const player: Player = {
      id: body.playerId, token: body.token, name: cleanName(body.name), hp: STARTING_HP,
      ap: STARTING_AP, range: STARTING_RANGE, x: null, y: null, alive: true,
      host: true, joinedAt: now, nextApAt: null, online: false,
    };
    const game: GameState = {
      code: body.code, phase: "lobby", hostId: player.id, createdAt: now,
      startedAt: null, updatedAt: now, boardSize: BOARD_SIZE, obstacles: [],
      players: [player], chat: [], winnerId: null,
    };
    await this.save(game);
    return json({ code: game.code, playerId: player.id, token: player.token });
  }

  private async join(request: Request): Promise<Response> {
    const game = await this.getGame();
    if (!game) return json({ error: "Lobby not found. Check the code." }, 404);
    if (game.phase !== "lobby") return json({ error: "This match has already started." }, 409);
    if (game.players.length >= MAX_PLAYERS) return json({ error: "This lobby is full." }, 409);
    const body = await request.json() as { name: string };
    const now = Date.now();
    const player: Player = {
      id: crypto.randomUUID(), token: makeToken(), name: cleanName(body.name),
      hp: STARTING_HP, ap: STARTING_AP, range: STARTING_RANGE, x: null, y: null,
      alive: true, host: false, joinedAt: now, nextApAt: null, online: false,
    };
    game.players.push(player);
    game.updatedAt = now;
    await this.save(game);
    return json({ code: game.code, playerId: player.id, token: player.token });
  }

  private async connect(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId") || "";
    const token = url.searchParams.get("token") || "";
    const game = await this.getGame();
    if (!game) return new Response("Lobby not found", { status: 404 });
    const player = game.players.find((p) => p.id === playerId && p.token === token);
    if (!player) return new Response("Invalid player session", { status: 403 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server, [player.id]);
    server.serializeAttachment({ playerId, token });
    player.online = true;
    game.updatedAt = Date.now();
    await this.save(game);
    this.broadcast(game);
    return new Response(null, { status: 101, webSocket: client });
  }

  private applyDailyAp(game: GameState, now: number): void {
    if (game.phase !== "active") return;
    for (const player of game.players) {
      if (!player.alive || player.nextApAt === null || now < player.nextApAt) continue;
      const earned = Math.floor((now - player.nextApAt) / DAILY_AP_INTERVAL_MS) + 1;
      player.ap += earned;
      player.nextApAt += earned * DAILY_AP_INTERVAL_MS;
    }
  }

  private applyAction(game: GameState, actor: Player, action: ClientAction, now: number): void {
    if (action.type === "chat") {
      const text = typeof action.text === "string" ? action.text.trim().slice(0, 300) : "";
      if (!text) throw new Error("Chat message cannot be empty.");
      game.chat.push({ id: crypto.randomUUID(), playerId: actor.id, playerName: actor.name, text, at: now });
      game.chat = game.chat.slice(-MAX_CHAT_MESSAGES);
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
    if (!actor.alive) throw new Error("Eliminated players cannot take actions.");

    switch (action.type) {
      case "move": {
        const x = Number(action.x), y = Number(action.y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) throw new Error("Choose a tile on the board.");
        if (x === actor.x && y === actor.y) throw new Error("Your tank is already there.");
        const path = this.findPath(game, actor, x, y);
        if (!path || path.length < 2) throw new Error("That tile cannot be reached.");
        const cost = path.length - 1;
        this.spend(actor, cost);
        actor.x = x;
        actor.y = y;
        return;
      }
      case "attack": {
        const target = this.target(game, actor, action.targetId);
        if (!target.alive) throw new Error("That tank is already eliminated.");
        this.requireRange(actor, target);
        this.spend(actor, 1);
        target.hp -= 1;
        if (target.hp <= 0) {
          target.hp = 0; target.alive = false; target.nextApAt = null;
          actor.ap += target.ap; target.ap = 0;
          const alive = game.players.filter((p) => p.alive);
          if (alive.length === 1) { game.phase = "ended"; game.winnerId = alive[0].id; }
        }
        return;
      }
      case "heal":
        if (actor.hp >= MAX_HP) throw new Error("Your tank is already at full health.");
        this.spend(actor, 3); actor.hp = Math.min(MAX_HP, actor.hp + 1); return;
      case "upgradeRange":
        this.spend(actor, RANGE_UPGRADE_COST); actor.range += 1; return;
      case "giftAp": {
        const target = this.target(game, actor, action.targetId);
        if (!target.alive) throw new Error("You can only gift AP to a living player.");
        this.requireRange(actor, target);
        const amount = Number(action.amount);
        if (!Number.isInteger(amount) || amount < 1 || amount > 3) throw new Error("Choose a gift between 1 and 3 AP.");
        this.spend(actor, amount); target.ap += amount; return;
      }
      case "giftHp": {
        const target = this.target(game, actor, action.targetId);
        this.requireRange(actor, target);
        if (actor.hp <= 1) throw new Error("You must keep at least 1 HP to give a heart.");
        if (target.alive && target.hp >= MAX_HP) throw new Error("That player is already at full health.");
        actor.hp -= 1;
        if (!target.alive) {
          target.alive = true; target.hp = 1; target.ap = 0;
          target.nextApAt = now + DAILY_AP_INTERVAL_MS;
        } else target.hp = Math.min(MAX_HP, target.hp + 1);
        return;
      }
      default: throw new Error("Unknown action.");
    }
  }

  private startGame(game: GameState, now: number): void {
    game.phase = "active"; game.startedAt = now; game.winnerId = null;
    const occupied = new Set<string>();
    while (game.obstacles.length < 30) {
      const x = Math.floor(Math.random() * BOARD_SIZE), y = Math.floor(Math.random() * BOARD_SIZE);
      const key = x + "," + y;
      if (!occupied.has(key)) { occupied.add(key); game.obstacles.push([x, y]); }
    }
    for (const player of game.players) {
      let x = 0, y = 0, key = "";
      do {
        x = Math.floor(Math.random() * BOARD_SIZE); y = Math.floor(Math.random() * BOARD_SIZE); key = x + "," + y;
      } while (occupied.has(key));
      occupied.add(key);
      player.x = x; player.y = y; player.hp = STARTING_HP; player.ap = STARTING_AP;
      player.range = STARTING_RANGE; player.alive = true; player.nextApAt = now + DAILY_AP_INTERVAL_MS;
    }
    game.chat.push({
      id: crypto.randomUUID(), playerId: "system", playerName: "COMMAND",
      text: "Match started. Each living tank earns 1 AP every 24 hours.", at: now,
    });
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
        if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE || blocked.has(nk) || previous.has(nk)) continue;
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
    return {
      code: game.code, phase: game.phase, createdAt: game.createdAt,
      startedAt: game.startedAt, boardSize: game.boardSize,
      obstacles: game.obstacles, chat: game.chat, winnerId: game.winnerId,
      players: game.players.map(({ id, name, hp, range, x, y, alive, host, online }) => ({
        id, name, hp, range, x, y, alive, host, online,
      })),
      me: { id: player.id, ap: player.ap, nextApAt: player.nextApAt },
    };
  }

  private broadcast(game: GameState): void {
    for (const socket of this.state.getWebSockets()) {
      const session = socket.deserializeAttachment() as { playerId: string; token: string } | null;
      if (!session) continue;
      const player = game.players.find((p) => p.id === session.playerId && p.token === session.token);
      if (!player) { socket.close(1008, "Session expired"); continue; }
      try { socket.send(JSON.stringify({ type: "state", state: this.publicState(game, player) })); }
      catch { /* closed socket */ }
    }
  }
}
