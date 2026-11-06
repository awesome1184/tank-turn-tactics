import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, BatteryCharging, Bug, ChevronRight, Copy, Crosshair, Download, Heart, KeyRound, MessageCircle, Move, RefreshCw, Shield, Skull, Swords, Users, Zap } from "lucide-react";
import { MAP_SIZES, MAX_PLAYERS } from "../../../packages/shared/src/contracts";
import type { ChatMessage, PlayerLabel, PublicGameState, PublicPlayer } from "../../../packages/shared/src/contracts";

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "https://tank-turn-tactics-api.awesome69421.workers.dev")).replace(/\/$/, "");
const SESSION_KEY = "tank-turn-tactics-session-v1";
type Session = { code: string; playerId: string; token: string; name: string };
type Labels = Record<string, PlayerLabel>;

async function api(path: string, body?: unknown): Promise<any> {
  if (!API_BASE) throw new Error("Server URL is not configured. Deploy the Worker and set the VITE_API_BASE repository variable.");
  const response = await fetch(API_BASE + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
  return data;
}
function savedSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as Session | null; }
  catch { return null; }
}
function makeRecoveryKey(session: Session): string {
  const payload = JSON.stringify({ version: 1, code: session.code, playerId: session.playerId, token: session.token });
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return "TTT1." + encoded;
}
function readRecoveryKey(value: string): { code: string; playerId: string; token: string } {
  const key = value.trim();
  if (!key.startsWith("TTT1.") || key.length > 2048) throw new Error("Paste a valid Tank Turn Tactics recovery key.");
  const encoded = key.slice(5).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(encoded + "=".repeat((4 - encoded.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  if (payload.version !== 1 ||
      typeof payload.code !== "string" || !/^[A-Z2-9]{6}$/.test(payload.code) ||
      typeof payload.playerId !== "string" || payload.playerId.length < 8 || payload.playerId.length > 100 ||
      typeof payload.token !== "string" || payload.token.length < 20 || payload.token.length > 256) {
    throw new Error("That recovery key is incomplete or invalid.");
  }
  return { code: payload.code, playerId: payload.playerId, token: payload.token };
}
function readLabels(code: string): Labels {
  try { return JSON.parse(localStorage.getItem("tank-turn-tactics-labels-" + code) || "{}") as Labels; }
  catch { return {}; }
}
function duration(ms: number): string {
  if (ms <= 0) return "Due now";
  const s = Math.ceil(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return d ? d + "d " + h + "h " + m + "m" : h + "h " + m + "m " + sec + "s";
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => savedSession());
  const [game, setGame] = useState<PublicGameState | null>(null);
  const [connection, setConnection] = useState("offline");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"create" | "join" | "recover">("create");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [labels, setLabels] = useState<Labels>({});
  const [chatText, setChatText] = useState("");
  const [giftAmount, setGiftAmount] = useState(1);
  const [juryTarget, setJuryTarget] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugHealth, setDebugHealth] = useState("Not checked");
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!session) { setGame(null); setConnection("offline"); return; }
    if (!API_BASE) { setError("Server URL is not configured. See README.md."); setConnection("offline"); return; }
    setLabels(readLabels(session.code));
    let stopped = false, retry = 0, retryId = 0;
    const connect = () => {
      if (stopped) return;
      setConnection("connecting");
      const endpoint = new URL(API_BASE);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      endpoint.pathname = "/api/rooms/" + session.code + "/ws";
      endpoint.search = new URLSearchParams({ playerId: session.playerId, token: session.token }).toString();
      const socket = new WebSocket(endpoint.toString());
      socketRef.current = socket;
      socket.onopen = () => { retry = 0; setConnection("online"); setError(""); socket.send(JSON.stringify({ type: "sync" })); };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === "state") {
            setGame(message.state as PublicGameState);
            setSelectedId((old) => old && message.state.players.some((p: PublicPlayer) => p.id === old) ? old : null);
          } else if (message.type === "error") setError(String(message.message || "Action rejected."));
        } catch { /* ignore malformed frame */ }
      };
      socket.onclose = () => {
        if (stopped) return;
        setConnection("offline"); retry += 1;
        retryId = window.setTimeout(connect, Math.min(15000, 700 * 2 ** Math.min(retry, 4)));
      };
      socket.onerror = () => setConnection("offline");
    };
    connect();
    const sync = window.setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "sync" }));
    }, 30000);
    return () => { stopped = true; clearTimeout(retryId); clearInterval(sync); socketRef.current?.close(); socketRef.current = null; };
  }, [session]);

  const send = useCallback((action: object) => {
    setError("");
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) { setError("Not connected. Your action was not sent."); return; }
    socketRef.current.send(JSON.stringify(action));
  }, []);

  const enter = async () => {
    if (mode === "recover" || !name.trim() || name.trim().length > 18) return;
    setBusy(true); setError("");
    try {
      const result = mode === "create"
        ? await api("/api/rooms", { name: name.trim() })
        : await api("/api/rooms/" + code.toUpperCase() + "/join", { name: name.trim() });
      const next: Session = { code: result.code, playerId: result.playerId, token: result.token, name: name.trim() };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSession(next);
      setRecoveryOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not enter the lobby."); }
    finally { setBusy(false); }
  };
  const restoreSession = async () => {
    setBusy(true); setError("");
    try {
      const recovery = readRecoveryKey(recoveryInput);
      const result = await api("/api/rooms/" + recovery.code + "/recover", { playerId: recovery.playerId, token: recovery.token });
      const next: Session = { code: result.code, playerId: result.playerId, token: recovery.token, name: result.name };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSession(next); setMode("create"); setRecoveryInput(""); setRecoveryOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not restore this player."); }
    finally { setBusy(false); }
  };
  const leave = () => {
    socketRef.current?.close(); localStorage.removeItem(SESSION_KEY);
    setSession(null); setGame(null); setError(""); setRecoveryOpen(false); setDebugOpen(false);
  };
  const recoveryKey = session ? makeRecoveryKey(session) : "";
  const downloadRecoveryKey = () => {
    if (!session) return;
    const blob = new Blob([recoveryKey + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "tank-turn-tactics-" + session.code + "-recovery-key.txt";
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const checkApiHealth = async () => {
    setDebugHealth("Checking…");
    try { const result = await api("/api/health"); setDebugHealth("Healthy · " + result.service); }
    catch (e) { setDebugHealth("Failed · " + (e instanceof Error ? e.message : "Request failed")); }
  };
  const copyDiagnostics = async () => {
    const report = {
      app: "Tank Turn Tactics v0.4", apiBase: API_BASE || "not configured",
      connection, websocketState: socketRef.current?.readyState ?? null,
      roomCode: session?.code ?? null, phase: game?.phase ?? null,
      playerCount: game?.players.length ?? null, boardSize: game?.boardSize ?? null,
      apiHealth: debugHealth, lastError: error || null, timestamp: new Date().toISOString(),
      // Recovery tokens are intentionally excluded.
    };
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setError("Diagnostics copied. Recovery credentials were not included."); }
    catch { setError("Clipboard access was blocked. Try the browser's secure-site permissions."); }
  };
  const me = game?.players.find((p) => p.id === session?.playerId);
  const target = game?.players.find((p) => p.id === selectedId);
  const canAct = game?.phase === "active" && !!me?.alive;
  const obstacles = useMemo(() => new Set(game?.obstacles.map(([x, y]) => x + "," + y) || []), [game?.obstacles]);
  const occupants = useMemo(() => new Map<string, PublicPlayer>((game?.players || []).filter((p) => p.x !== null && p.y !== null).map((p): [string, PublicPlayer] => [String(p.x) + "," + String(p.y), p])), [game?.players]);
  const updateLabel = (id: string, label: PlayerLabel) => {
    const next = { ...labels, [id]: label };
    setLabels(next);
    if (session) localStorage.setItem("tank-turn-tactics-labels-" + session.code, JSON.stringify(next));
  };
  const sendChat = () => { if (chatText.trim()) { send({ type: "chat", text: chatText }); setChatText(""); } };
  const juryCandidates = game?.players.filter((p) => p.alive) || [];
  const effectiveJuryTarget = juryCandidates.some((p) => p.id === juryTarget) ? juryTarget : (juryCandidates[0]?.id || "");

  if (!session) return <div className="landing">
    <header className="brand"><div className="brand-icon"><Shield/></div><div><b>TANK TURN TACTICS</b><small>A long game of short decisions</small></div></header>
    <main className="landing-grid">
      <section className="intro"><div className="eyebrow">PERSISTENT MULTIPLAYER STRATEGY</div><h1>Make every<br/><em>move count.</em></h1><p>Build alliances. Watch your range. Choose when to strike. Your tank earns one action point each day, so the best move is rarely the fastest one.</p><div className="features"><span><Move size={16}/> Tactical grid</span><span><Users size={16}/> Lobby codes</span><span><BatteryCharging size={16}/> Daily AP</span></div></section>
      <section className="panel join-card">
        <div className="tabs">
          <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>Create</button>
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>Join</button>
          <button className={mode === "recover" ? "active" : ""} onClick={() => setMode("recover")}>Restore</button>
        </div>
        <div className="eyebrow">{mode === "create" ? "HOST A MATCH" : mode === "join" ? "ENTER A ROOM CODE" : "RESTORE A PLAYER"}</div>
        <h2>{mode === "create" ? "Start a new lobby." : mode === "join" ? "Join your crew." : "Recover your save."}</h2>
        <p>{mode === "create" ? "Create a private room and invite others with a six-character code." : mode === "join" ? "Enter the code shared by the lobby host." : "Paste the recovery key you saved earlier to reconnect to your player."}</p>
        {mode === "recover" ? (
          <label>RECOVERY KEY<textarea className="recovery-input" value={recoveryInput} rows={4} placeholder="TTT1.…" onChange={(e) => setRecoveryInput(e.target.value)}/></label>
        ) : <>
          <label>PLAYER NAME<input value={name} maxLength={18} placeholder="Choose a callsign" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enter()}/></label>
          {mode === "join" && <label>LOBBY CODE<input className="room-code-input" value={code} maxLength={6} placeholder="ABC123" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))}/></label>}
        </>}
        {error && <div className="error">{error}</div>}
        <button className="primary-button" disabled={busy || (mode === "recover" ? !recoveryInput.trim() : !name.trim() || (mode === "join" && code.length !== 6))} onClick={mode === "recover" ? restoreSession : enter}>
          {busy ? "Connecting…" : mode === "create" ? "Create lobby" : mode === "join" ? "Join lobby" : "Restore player"}<ChevronRight size={18}/>
        </button>
        <div className="card-foot"><KeyRound size={14}/> Keep recovery keys private. Anyone holding one can control that player.</div>
      </section>
    </main><footer className="landing-foot">16 × 16 TO 32 × 32 MAPS <span>•</span> UP TO {MAX_PLAYERS} PLAYERS <span>•</span> 1 AP EVERY 24 HOURS</footer>
  </div>;

  return <div className="shell">
    <header className="topbar"><div className="brand"><div className="brand-icon"><Shield/></div><div><b>TANK TURN TACTICS</b><small>A long game of short decisions</small></div></div><div className="top-right"><span className={"connection " + connection}><i/>{connection === "online" ? "Connected" : connection === "connecting" ? "Connecting" : "Reconnecting"}</span><button className="quiet-button" onClick={() => { setRecoveryOpen(!recoveryOpen); setDebugOpen(false); }}><KeyRound size={14}/> Save key</button><button className="quiet-button" onClick={() => { setDebugOpen(!debugOpen); setRecoveryOpen(false); }}><Bug size={14}/> Debug</button><button className="quiet-button" onClick={leave}>Leave view</button></div></header>
    {recoveryOpen && <section className="panel utility-panel recovery-panel">
      <div className="section-title"><div><div className="eyebrow">PLAYER BACKUP</div><h2>Recovery key</h2></div><button className="quiet-button" onClick={() => setRecoveryOpen(false)}>Close</button></div>
      <p>Save this private key somewhere safe. It restores this exact player and server-saved game state on another browser. Anyone holding it can take over the player.</p>
      <textarea readOnly rows={3} value={recoveryKey} aria-label="Your recovery key"/>
      <div className="utility-actions">
        <button className="secondary-button" onClick={() => navigator.clipboard.writeText(recoveryKey).then(() => setError("Recovery key copied."), () => setError("Clipboard blocked. Use Download key instead."))}><Copy size={14}/> Copy key</button>
        <button className="secondary-button" onClick={downloadRecoveryKey}><Download size={14}/> Download .txt</button>
      </div>
    </section>}
    {debugOpen && <section className="panel utility-panel debug-panel">
      <div className="section-title"><div><div className="eyebrow">DEVELOPER TOOLS</div><h2>Debug menu</h2></div><button className="quiet-button" onClick={() => setDebugOpen(false)}>Close</button></div>
      <div className="debug-grid">
        <div><small>Connection</small><b>{connection}</b></div><div><small>Room phase</small><b>{game?.phase || "Loading"}</b></div>
        <div><small>Players</small><b>{game?.players.length ?? "—"} / {MAX_PLAYERS}</b></div><div><small>Map</small><b>{game ? game.boardSize + " × " + game.boardSize : "—"}</b></div>
        <div><small>WebSocket</small><b>{socketRef.current?.readyState ?? "—"}</b></div><div><small>API health</small><b>{debugHealth}</b></div>
      </div>
      <p className="debug-api">API: <code>{API_BASE || "not configured"}</code></p>
      {error && <p className="debug-error">Last client message: {error}</p>}
      <div className="utility-actions">
        <button className="secondary-button" onClick={() => send({ type: "sync" })}>Send sync</button>
        <button className="secondary-button" onClick={checkApiHealth}>Check API</button>
        <button className="secondary-button" onClick={() => { socketRef.current?.close(); setConnection("connecting"); }}>Reconnect</button>
        <button className="secondary-button" onClick={copyDiagnostics}>Copy diagnostics</button>
      </div>
      <details><summary>Show public room state</summary><pre>{game ? JSON.stringify({ code: game.code, phase: game.phase, boardSize: game.boardSize, players: game.players, obstacles: game.obstacles, chatCount: game.chat.length }, null, 2) : "No room state received yet."}</pre></details>
      <small className="debug-note">Diagnostics do not include your recovery token or API credentials.</small>
    </section>}
    {error && <div className="toast">{error}<button onClick={() => setError("")}>×</button></div>}
    {!game ? <div className="loading panel"><RefreshCw className="spin"/><h2>Reconnecting to {session.code}</h2><p>Restoring your player session.</p><button className="quiet-button" onClick={leave}>Use another lobby</button></div> :
    game.phase === "lobby" ? <main className="lobby-layout">
      <section className="panel lobby-hero"><div className="eyebrow">MATCH LOBBY · WAITING FOR PLAYERS</div><h1>Assemble your crew.</h1><p>Share the room code. Once the host starts, the battlefield is locked. Every tank starts with 3 HP, range 2, and 0 AP.</p>
        <div className="code-box"><div><small>YOUR LOBBY CODE</small><strong>{game.code}</strong></div><button className="secondary-button" onClick={() => navigator.clipboard.writeText(game.code).then(() => setError("Lobby code copied."), () => setError("Lobby code: " + game.code))}><Copy size={16}/> Copy code</button></div>
        <div className="lobby-meta"><span><Users size={16}/> {game.players.length} / {MAX_PLAYERS} players</span><span>Waiting for host</span></div>
      </section>
      <section className="panel lobby-settings">
        <div className="section-title"><div><div className="eyebrow">MATCH CONFIGURATION</div><h2>Lobby settings</h2></div><small>{me?.host ? "Host controls" : "View only"}</small></div>
        <div className="map-setting-row">
          <div><b>Battlefield size</b><small>{Math.round(30 * (game.boardSize / 16) ** 2)} obstacles will be generated at match start</small></div>
          {me?.host
            ? <select aria-label="Battlefield size" value={game.boardSize} disabled={connection !== "online"} onChange={(e) => send({ type: "setMapSize", mapSize: Number(e.target.value) })}>{MAP_SIZES.map((size) => <option key={size} value={size}>{size} × {size}</option>)}</select>
            : <strong>{game.boardSize} × {game.boardSize}</strong>}
        </div>
        <p className="micro-note">Only the host can change this before the match starts. The setting locks when the battlefield is deployed.</p>
      </section>
      <section className="panel lobby-roster"><div className="section-title"><div><div className="eyebrow">THE ROSTER</div><h2>Players</h2></div><small>Names are public</small></div>
        {game.players.map((p, i) => <div className="roster-row" key={p.id}><span className="roster-number">{i + 1}</span><div><b>{p.name}{p.id === session.playerId ? " · YOU" : ""}</b><small>{p.host ? "Lobby host" : "Ready to deploy"}</small></div>{p.host && <span className="host-chip">HOST</span>}</div>)}
        {me?.host ? <button className="primary-button" disabled={game.players.length < 2} onClick={() => send({ type: "start" })}>Start match <ChevronRight/></button> : <p className="waiting">Waiting for the host to start the match…</p>}
        {game.players.length < 2 && <small className="muted">Invite at least one other player to unlock Start match.</small>}
      </section>
      <Chat chat={game.chat} text={chatText} setText={setChatText} send={sendChat}/>
    </main> :
    <main className="game-main">
      <div className="game-heading"><div><div className="eyebrow">{game.phase === "ended" ? "MATCH COMPLETE" : "LIVE MATCH"} · ROOM {game.code}</div><h1>{game.phase === "ended" ? "The dust has settled." : "Command your tank."}</h1><p>{game.phase === "ended" ? (game.players.find((p) => p.id === game.winnerId)?.name || "A player") + " is the last tank standing." : "Every move matters. Choose each action carefully."}</p></div><div className="game-pills"><span><Users size={15}/> {game.players.length} players</span><span>{game.boardSize} × {game.boardSize} grid</span></div></div>
      <div className="game-grid">
        <section className="panel map-panel"><div className="section-title"><div><div className="eyebrow">TACTICAL MAP</div><h2>Battlefield</h2></div><div className="legend"><span><i className="legend-you"/> You</span><span><i className="legend-player"/> Player</span><span><i className="legend-rock"/> Obstacle</span></div></div>
          <div className="board-wrap"><div className={"board " + (game.boardSize > 20 ? "board-large" : "")} style={{ gridTemplateColumns: "repeat(" + game.boardSize + ", minmax(0, 1fr))" }}>{Array.from({ length: game.boardSize * game.boardSize }, (_, i) => {
            const x = i % game.boardSize, y = Math.floor(i / game.boardSize), p = occupants.get(x + "," + y), rock = obstacles.has(x + "," + y);
            return <button key={x + "-" + y} className={"tile " + (rock ? "rock-tile " : "") + (p ? "occupied " : "") + (p?.id === session.playerId ? "self-tile " : "") + (p?.id === selectedId ? "selected " : "") + (p && !p.alive ? "dead-tile" : "")} title={p ? p.name + " · " + p.hp + " HP" : rock ? "Obstacle" : "Tile " + (x + 1) + ", " + (y + 1)} onClick={() => p ? setSelectedId(p.id) : canAct && !rock && send({ type: "move", x, y })}>
              {rock ? <span className="rock">◆</span> : p ? <><span className="tank">{p.alive ? "▰" : "✕"}</span>{game.boardSize <= 20 && <span className="tile-label">{p.name.slice(0, 6)}</span>}</> : null}
            </button>;
          })}</div></div>
          <div className="map-help"><span><Move size={14}/> Click an empty tile to move (AP per step).</span><span>8 directions</span></div>
        </section>
        <aside className="side-column">
          <section className="panel stats-panel"><div className="eyebrow">YOUR TANK</div><h2>{me?.name || session.name}</h2><div className="tank-status">{me?.alive ? "Active tank" : "Jury · eliminated"}</div>
            <div className="stat-grid"><div className="stat-card"><small>HEALTH</small><strong className="hp-number">{me?.hp ?? 0}<i> / 3</i></strong><div className="hearts">{[0,1,2].map(i => <Heart key={i} size={15} fill={i < (me?.hp || 0) ? "currentColor" : "none"}/>)}</div></div><div className="stat-card"><small>ACTION POINTS</small><strong className="ap-number">{game.me.ap}</strong><div className="ap-clock"><BatteryCharging size={13}/> +1 in {game.me.nextApAt ? duration(game.me.nextApAt - now) : "Paused"}</div></div></div>
            <div className="stat-line"><span>Attack range</span><b>{me?.range ?? 2} tiles</b></div><div className="stat-line"><span>Next AP</span><b>{game.me.nextApAt ? new Date(game.me.nextApAt).toLocaleString() : "Paused"}</b></div>
          </section>
          <section className="panel actions-panel"><div className="section-title"><div><div className="eyebrow">COMMANDS</div><h2>Actions</h2></div><small>AP is private</small></div>
            <div className="target-card">{target ? <><div><small>SELECTED PLAYER</small><b>{target.name}{target.id === me?.id ? " · YOU" : ""}</b></div><span className={target.alive ? "alive-tag" : "dead-tag"}>{target.alive ? "ALIVE" : "ELIMINATED"}</span><div className="target-stats">{target.hp} HP <span>Range {target.range}</span><span>({(target.x ?? -1) + 1}, {(target.y ?? -1) + 1})</span></div></> : <div className="no-target"><Crosshair size={17}/> Select a tank on the map or roster.</div>}</div>
            {canAct ? <><div className="gift-select"><span>AP gift amount</span><select value={giftAmount} onChange={e => setGiftAmount(Number(e.target.value))}><option value={1}>1 AP</option><option value={2}>2 AP</option><option value={3}>3 AP</option></select></div>
              <div className="action-buttons">
                <button disabled={!target || target.id === me?.id || !target.alive || game.me.ap < 1} onClick={() => target && send({ type: "attack", targetId: target.id })}><Swords/><span><b>Shoot</b><small>1 AP · 1 damage</small></span></button>
                <button disabled={game.me.ap < 3 || (me?.hp || 3) >= 3} onClick={() => send({ type: "heal" })}><Heart/><span><b>Repair</b><small>3 AP · +1 HP</small></span></button>
                <button disabled={game.me.ap < 3} onClick={() => send({ type: "upgradeRange" })}><Crosshair/><span><b>Upgrade range</b><small>3 AP · +1 tile</small></span></button>
                <button disabled={!target || target.id === me?.id || !target.alive || game.me.ap < giftAmount} onClick={() => target && send({ type: "giftAp", targetId: target.id, amount: giftAmount })}><Zap/><span><b>Gift AP</b><small>Transfer 1–3 AP</small></span></button>
                <button className="action-wide" disabled={!target || target.id === me?.id || (me?.hp || 0) <= 1 || (!!target.alive && target.hp >= 3)} onClick={() => target && send({ type: "giftHp", targetId: target.id })}><Heart/><span><b>Give a heart</b><small>Free · can revive an eliminated player</small></span></button>
              </div>
            </> : <div className="eliminated-note"><Skull/> {game.phase === "ended" ? "This match has ended." : "You are eliminated. Another player can revive you with a heart gift."}</div>}
          </section>
          {game.phase === "active" && game.jury.memberCount > 0 && <section className="panel jury-panel">
            <div className="section-title"><div><div className="eyebrow">THE JURY</div><h2>Secret ballot</h2></div><span className="jury-count">{game.jury.memberCount} juror{game.jury.memberCount === 1 ? "" : "s"}</span></div>
            <p className="jury-description">Eliminated players can secretly support one living tank each day. Three or more votes for the same player award that player +1 bonus AP when the daily cycle closes.</p>
            <div className="jury-deadline"><span>Ballot closes in</span><strong>{game.jury.cycleEndsAt ? duration(game.jury.cycleEndsAt - now) : "—"}</strong></div>
            {game.me.isJuryMember ? (game.me.hasVoted
              ? <div className="jury-confirmation"><Shield size={16}/> Your vote is recorded and remains secret until the cycle resolves.</div>
              : <div className="jury-vote-form"><label>CHOOSE A LIVING PLAYER<select value={effectiveJuryTarget} onChange={(e) => setJuryTarget(e.target.value)}>{juryCandidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="jury-vote-button" disabled={!effectiveJuryTarget || connection !== "online"} onClick={() => send({ type: "juryVote", targetId: effectiveJuryTarget })}>Cast secret vote <ChevronRight size={16}/></button></div>
            ) : <div className="jury-confirmation"><Skull size={16}/> Only eliminated players can cast a jury vote. Votes and AP balances are private.</div>}
          </section>}
          <section className="panel roster-panel"><div className="section-title"><div><div className="eyebrow">FIELD INTELLIGENCE</div><h2>Players</h2></div><small>{game.players.filter(p => p.alive).length} alive</small></div>
            {game.players.map(p => <div className={"field-row " + (p.id === selectedId ? "focused" : "")} key={p.id}><button className="field-person" onClick={() => setSelectedId(p.id)}><i className={p.id === session.playerId ? "you-dot" : p.alive ? "player-dot" : "dead-dot"}/><span><b>{p.name}{p.id === session.playerId ? " · YOU" : ""}</b><small>{p.alive ? p.hp + " HP · range " + p.range : "Eliminated"}</small></span></button><select aria-label={"Label " + p.name} value={labels[p.id] || "unmarked"} onChange={e => updateLabel(p.id, e.target.value as PlayerLabel)}><option value="unmarked">Unmarked</option><option value="ally">Ally</option><option value="enemy">Enemy</option></select></div>)}
            <p className="micro-note">Labels are private notes saved in this browser. They do not create teams or change damage.</p>
          </section>
          <Chat chat={game.chat} text={chatText} setText={setChatText} send={sendChat}/>
        </aside>
      </div>
      <p className="server-note"><Shield size={14}/> Server-authoritative match · AP and actions are validated by the game server.</p>
    </main>}
    <footer className="footer">TANK TURN TACTICS <span>·</span> v0.4</footer>
  </div>;
}

function Chat({ chat, text, setText, send }: { chat: ChatMessage[]; text: string; setText: (value: string) => void; send: () => void }) {
  return <section className="panel chat-panel"><div className="section-title"><div><div className="eyebrow">COMMS</div><h2><MessageCircle size={17}/> Field chat</h2></div><small>{chat.length}/50</small></div>
    <div className="chat-messages">{chat.length ? chat.map((m: ChatMessage) => <div className={"chat-message " + (m.playerId === "system" ? "system-message" : "")} key={m.id}><div><b>{m.playerName}</b><time>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p>{m.text}</p></div>) : <div className="chat-empty">No messages yet. Coordinate with your crew.</div>}</div>
    <form className="chat-form" onSubmit={e => { e.preventDefault(); send(); }}><input value={text} maxLength={300} onChange={e => setText(e.target.value)} placeholder="Send a message…"/><button aria-label="Send message" disabled={!text.trim()}><ArrowUpRight size={17}/></button></form>
  </section>;
}
