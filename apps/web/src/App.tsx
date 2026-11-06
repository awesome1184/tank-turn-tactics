import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BatteryCharging, Bug, ChevronRight, Copy, Crosshair, Download, Heart, KeyRound, Move, RefreshCw, Shield, Skull, Swords, Users, Zap } from "lucide-react";
import { MAP_SIZES, MAX_PLAYERS } from "../../../packages/shared/src/contracts";
import type { NoteHistoryEntry, PlayerLabel, PublicGameState, PublicPlayer, PublicReplayEvent } from "../../../packages/shared/src/contracts";

const API_BASE = (import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "https://tank-turn-tactics-api.awesome69421.workers.dev")).replace(/\/$/, "");
const SESSION_KEY = "tank-turn-tactics-session-v2";
type Session = { playerId: string; token: string; name: string };
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
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null") as Session | null; }
  catch { return null; }
}
function makeRecoveryKey(session: Session): string {
  const payload = JSON.stringify({ version: 2, playerId: session.playerId, token: session.token });
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return "TTT2." + encoded;
}
function readRecoveryKey(value: string): { playerId: string; token: string } {
  const key = value.trim();
  if (!key.startsWith("TTT2.") || key.length > 2048) throw new Error("Paste a valid Tank Turn Tactics recovery key.");
  const encoded = key.slice(5).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(encoded + "=".repeat((4 - encoded.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  if (payload.version !== 2 ||
      typeof payload.playerId !== "string" || payload.playerId.length < 8 || payload.playerId.length > 100 ||
      typeof payload.token !== "string" || payload.token.length < 20 || payload.token.length > 256) {
    throw new Error("That recovery key is incomplete or invalid.");
  }
  return { playerId: payload.playerId, token: payload.token };
}
function readLabels(playerId: string): Labels {
  try { return JSON.parse(localStorage.getItem("tank-turn-tactics-labels-" + playerId) || "{}") as Labels; }
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
  const [mode, setMode] = useState<"join" | "recover">("join");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [labels, setLabels] = useState<Labels>({});
  const [juryTarget, setJuryTarget] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesArchive, setNotesArchive] = useState<NoteHistoryEntry[] | null>(null);
  const [notesArchiveLoading, setNotesArchiveLoading] = useState(false);
  const [replayEvents, setReplayEvents] = useState<PublicReplayEvent[]>([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugHealth, setDebugHealth] = useState("Not checked");
  const [now, setNow] = useState(Date.now());
  const [landingPhase, setLandingPhase] = useState<"loading" | "lobby" | "active" | "ended" | "unknown">("loading");
  const [landingPlayerCount, setLandingPlayerCount] = useState(0);
  const [endingPublicMatch, setEndingPublicMatch] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const notesDirtyRef = useRef(false);
  const notesDraftRef = useRef("");

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (session) return;
    let cancelled = false;
    const refreshMatchStatus = async () => {
      try {
        const status = await api("/api/game/state");
        if (cancelled) return;
        setLandingPhase(status.phase === "active" ? "active" : status.phase === "ended" ? "ended" : "lobby");
        setLandingPlayerCount(typeof status.players === "number" ? status.players : 0);
      } catch {
        if (!cancelled) setLandingPhase("unknown");
      }
    };
    void refreshMatchStatus();
    const timer = window.setInterval(() => { void refreshMatchStatus(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [session]);

  useEffect(() => {
    if(!replayEvents.length)return;
    const timer=window.setTimeout(()=>{
      if(replayIndex+1>=replayEvents.length){
        if(socketRef.current?.readyState===WebSocket.OPEN)socketRef.current.send(JSON.stringify({type:"ackReplay",lastEventId:replayEvents[replayEvents.length-1].id}));
        setReplayEvents([]);setReplayIndex(0);
      } else setReplayIndex(index=>index+1);
    },1500);
    return ()=>window.clearTimeout(timer);
  },[replayEvents,replayIndex]);

  useEffect(() => {
    if(!session||!notesDirtyRef.current||connection!=="online"||game?.phase==="ended")return;
    const timer=window.setTimeout(()=>{
      if(socketRef.current?.readyState===WebSocket.OPEN)socketRef.current.send(JSON.stringify({type:"saveNotes",notes:notesDraftRef.current}));
    },700);
    return ()=>window.clearTimeout(timer);
  },[notesDraft,connection,game?.phase,session]);

  useEffect(() => {
    if (!session) {
      setGame(null);setConnection("offline");notesDirtyRef.current=false;notesDraftRef.current="";setNotesDraft("");setNotesArchive(null);setReplayEvents([]);setReplayIndex(0);return;
    }
    if (!API_BASE) { setError("Server URL is not configured. See README.md."); setConnection("offline"); return; }
    setLabels(readLabels(session.playerId));
    let stopped = false, retry = 0, retryId = 0;
    const connect = () => {
      if (stopped) return;
      setConnection("connecting");
      const endpoint = new URL(API_BASE);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      endpoint.pathname = "/api/game/ws";
      endpoint.search = new URLSearchParams({ playerId: session.playerId, token: session.token }).toString();
      const socket = new WebSocket(endpoint.toString());
      socketRef.current = socket;
      socket.onopen = () => { retry = 0; setConnection("online"); setError(""); socket.send(JSON.stringify({ type: "sync" })); };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if(message.type==="state"){
            const nextState=message.state as PublicGameState;
            setGame(nextState);
            setSelectedId(old=>old&&nextState.players.some((p:PublicPlayer)=>p.id===old)?old:null);
            const serverNotes=nextState.me.notes||"";
            if(notesDirtyRef.current){if(serverNotes===notesDraftRef.current)notesDirtyRef.current=false;}
            else{notesDraftRef.current=serverNotes;setNotesDraft(serverNotes);}
            if(nextState.me.replayEvents?.length){
              setReplayEvents(current=>current.length?current:nextState.me.replayEvents);
              setReplayIndex(current=>current===0?0:current);
            }
          } else if(message.type==="error")setError(String(message.message||"Action rejected."));
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
      const result = await api("/api/game/join", { name: name.trim() });
      const next: Session = { playerId: result.playerId, token: result.token, name: result.name || name.trim() };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      notesDirtyRef.current=false;notesDraftRef.current="";setNotesDraft("");setNotesArchive(null);setReplayEvents([]);setReplayIndex(0);
      setSession(next);setRecoveryOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not enter the lobby."); }
    finally { setBusy(false); }
  };
  const restoreSession = async () => {
    setBusy(true); setError("");
    try {
      const recovery = readRecoveryKey(recoveryInput);
      const result = await api("/api/game/recover", { playerId: recovery.playerId, token: recovery.token });
      const next: Session = { playerId: result.playerId, token: recovery.token, name: result.name };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      notesDirtyRef.current=false;notesDraftRef.current="";setNotesDraft("");setNotesArchive(null);setReplayEvents([]);setReplayIndex(0);
      setSession(next);setMode("join");setRecoveryInput("");setRecoveryOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not restore this player."); }
    finally { setBusy(false); }
  };
  const leave = () => {
    socketRef.current?.close(); sessionStorage.removeItem(SESSION_KEY);
    setSession(null); setGame(null); setError(""); setRecoveryOpen(false); setDebugOpen(false);
  };
  const endPublicMatch = async () => {
    if (endingPublicMatch || !window.confirm("End the active shared match for everyone? This cannot be undone.")) return;
    setEndingPublicMatch(true);
    setError("");
    try {
      const result = await api("/api/game/end", {});
      if (!result.ended) throw new Error(result.error || "The match could not be ended.");
      setLandingPhase("ended");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not end the shared match.");
    } finally {
      setEndingPublicMatch(false);
    }
  };
  const recoveryKey = session ? makeRecoveryKey(session) : "";
  const downloadRecoveryKey = () => {
    if (!session) return;
    const blob = new Blob([recoveryKey + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "tank-turn-tactics-player-recovery-key.txt";
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const checkApiHealth = async () => {
    setDebugHealth("Checking…");
    try { const result = await api("/api/health"); setDebugHealth("Healthy · " + result.service); }
    catch (e) { setDebugHealth("Failed · " + (e instanceof Error ? e.message : "Request failed")); }
  };
  const loadNotesArchive=async()=>{
    if(!session)return;setNotesArchiveLoading(true);
    try{const result=await api("/api/game/notes",{playerId:session.playerId,token:session.token});setNotesArchive(Array.isArray(result.entries)?result.entries as NoteHistoryEntry[]:[]);}
    catch(e){setError(e instanceof Error?e.message:"Could not load notes history.");}
    finally{setNotesArchiveLoading(false);}
  };
  const editNotes=(value:string)=>{notesDraftRef.current=value;notesDirtyRef.current=value!==(game?.me.notes||"");setNotesDraft(value);};
  const skipReplay=()=>{
    if(replayEvents.length)send({type:"ackReplay",lastEventId:replayEvents[replayEvents.length-1].id});
    setReplayEvents([]);setReplayIndex(0);
  };
  const copyDiagnostics = async () => {
    const report = {
      app: "Tank Turn Tactics v0.6", apiBase: API_BASE || "not configured",
      connection, websocketState: socketRef.current?.readyState ?? null,
      sharedMatch: true, phase: game?.phase ?? null,
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
    if (session) localStorage.setItem("tank-turn-tactics-labels-" + session.playerId, JSON.stringify(next));
  };
  const juryCandidates = game?.players.filter((p) => p.alive) || [];
  const effectiveJuryTarget = juryCandidates.some((p) => p.id === juryTarget) ? juryTarget : (juryCandidates[0]?.id || "");

  if (!session) return <div className="landing">
    <header className="brand"><div className="brand-icon"><Shield/></div><div><b>TANK TURN TACTICS</b><small>A long game of short decisions</small></div></header>
    <main className="landing-grid">
      <section className="intro"><div className="eyebrow">ONE SHARED MULTIPLAYER MATCH</div><h1>Make every<br/><em>move count.</em></h1><p>Open this page in a few separate tabs and join with a different callsign in each. Every tab gets its own tank, so you can test the game solo.</p><div className="features"><span><Move size={16}/> Tactical grid</span><span><Users size={16}/> Multi-tab playtest</span><span><BatteryCharging size={16}/> Daily AP</span></div></section>
      <section className="panel join-card">
        <div className="tabs">
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>Join game</button>
          <button className={mode === "recover" ? "active" : ""} onClick={() => setMode("recover")}>Restore</button>
        </div>
        <div className="eyebrow">{mode === "join" ? "SHARED MATCH" : "RESTORE A PLAYER"}</div>
        <h2>{mode === "join" ? "Join the game." : "Recover your save."}</h2>
        <p>{mode === "join" ? "The first player becomes host. Open a new tab for every additional player. The host starts once everyone has joined." : "Paste the recovery key you saved earlier to reconnect to this player."}</p>
        {mode === "recover" ? (
          <label>RECOVERY KEY<textarea className="recovery-input" value={recoveryInput} rows={4} placeholder="TTT2.…" onChange={(e) => setRecoveryInput(e.target.value)}/></label>
        ) : (
          <label>PLAYER NAME<input value={name} maxLength={18} placeholder="Choose a callsign" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enter()}/></label>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary-button" disabled={busy || (mode === "recover" ? !recoveryInput.trim() : !name.trim())} onClick={mode === "recover" ? restoreSession : enter}>
          {busy ? "Connecting…" : mode === "join" ? "Join shared game" : "Restore player"}<ChevronRight size={18}/>
        </button>
        {landingPhase === "active" && <div style={{ marginTop: 14, padding: 13, background: "#3b282c", border: "1px solid #77414a", borderRadius: 10 }}>
          <b style={{ display: "block", color: "#ffe5e6", fontSize: 12 }}>The shared match is already underway</b>
          <small style={{ display: "block", color: "#d7adb1", fontSize: 10, lineHeight: 1.5, marginTop: 5 }}>
            {landingPlayerCount} players are in this playtest. Anyone on this login screen can end the match.
          </small>
          <button className="danger-button" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} disabled={endingPublicMatch} onClick={endPublicMatch}>
            {endingPublicMatch ? "Ending match…" : "End active game"} <Shield size={16}/>
          </button>
        </div>}
        {landingPhase === "ended" && <p style={{ margin: "13px 0 0", padding: 11, background: "#172a2c", border: "1px solid #335e59", borderRadius: 8, color: "#a5dac6", fontSize: 11, lineHeight: 1.5 }}>
          The match has ended. The host must reset it before new players can join.
        </p>}
        <div className="card-foot"><KeyRound size={14}/> Recovery keys are private. Anyone holding one can control that player.</div>
      </section>
    </main><footer className="landing-foot">16 × 16 TO 32 × 32 MAPS <span>•</span> UP TO {MAX_PLAYERS} PLAYERS <span>•</span> 1 AP EVERY 24 HOURS</footer>
  </div>;

  return <div className="shell">
    <header className="topbar"><div className="brand"><div className="brand-icon"><Shield/></div><div><b>TANK TURN TACTICS</b><small>One shared game · each tab is a player</small></div></div><div className="top-right"><span className={"connection " + connection}><i/>{connection === "online" ? "Connected" : connection === "connecting" ? "Connecting" : "Reconnecting"}</span><button className="quiet-button" onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}><Users size={14}/> New player tab</button><button className="quiet-button" onClick={() => { setRecoveryOpen(!recoveryOpen); setDebugOpen(false); }}><KeyRound size={14}/> Save key</button><button className="quiet-button" onClick={() => { setDebugOpen(!debugOpen); setRecoveryOpen(false); }}><Bug size={14}/> Debug</button><button className="quiet-button" onClick={leave}>Switch player</button></div></header>
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
      {game?.phase==="ended"&&me?.host&&<section className="notes-archive">
        <div className="section-title"><div><div className="eyebrow">HOST-ONLY GAME RECORD</div><h3>Private notes history</h3></div></div>
        <p>Saved revisions from every player's private notes, visible only to the host after the match ends.</p>
        <button className="secondary-button" onClick={loadNotesArchive} disabled={notesArchiveLoading}>{notesArchiveLoading?"Loading…":"Load notes history"}</button>
        {notesArchive&&<div className="notes-archive-list">{notesArchive.length?notesArchive.map(entry=><article key={entry.id}><div><b>{entry.playerName}</b><time>{new Date(entry.at).toLocaleString()}</time></div><pre>{entry.text||"(cleared notes)"}</pre></article>):<small>No notes were saved this match.</small>}</div>}
      </section>}
      <details><summary>Show public match state</summary><pre>{game ? JSON.stringify({ phase: game.phase, boardSize: game.boardSize, players: game.players, obstacles: game.obstacles }, null, 2) : "No match state received yet."}</pre></details>
      <small className="debug-note">Diagnostics do not include your recovery token or API credentials.</small>
    </section>}
    {error && <div className="toast">{error}<button onClick={() => setError("")}>×</button></div>}
    {replayEvents.length>0&&<div className="replay-overlay" role="dialog" aria-modal="true" aria-label="While you were gone replay">
      <section className="replay-card"><div className="replay-heading"><div><div className="eyebrow">WHILE YOU WERE GONE</div><h2>Match replay</h2></div><small>{replayIndex+1} / {replayEvents.length}</small></div>
        <time>{new Date(replayEvents[replayIndex].at).toLocaleString()}</time>
        <p className="replay-message">{replayEvents[replayIndex].message}</p>
        <div className="replay-progress"><i style={{width:((replayIndex+1)/replayEvents.length*100)+"%"}}/></div>
        <div className="replay-footer"><small>Each event advances every 1.5 seconds.</small><button className="secondary-button" onClick={skipReplay}>Skip replay</button></div>
      </section>
    </div>}
    {!game ? <div className="loading panel"><RefreshCw className="spin"/><h2>Connecting to the shared game</h2><p>Restoring {session.name}'s player session.</p><button className="quiet-button" onClick={leave}>Switch player</button></div> :
    game.phase === "lobby" ? <main className="lobby-layout">
      <section className="panel lobby-hero"><div className="eyebrow">ONE SHARED MATCH · WAITING FOR PLAYERS</div><h1>Assemble your crew.</h1><p>Open the game in another tab and join with a different callsign to add another tank. Once everyone has joined, the host starts the match.</p>
        <div className="lobby-meta"><span><Users size={16}/> {game.players.length} / {MAX_PLAYERS} players</span><span>{game.onlineCount} {game.onlineCount===1?"person":"people"} online</span></div>
      </section>
      <section className="panel lobby-settings">
        <div className="section-title"><div><div className="eyebrow">MATCH CONFIGURATION</div><h2>Lobby settings</h2></div><small>{me?.host ? "Host controls" : "View only"}</small></div>
        <div className="map-setting-row">
          <div><b>Battlefield size</b><small>{Math.round(30 * (game.boardSize / 16) ** 2)} obstacles will be generated at match start</small></div>
          {me?.host
            ? <select aria-label="Battlefield size" value={game.boardSize} disabled={connection !== "online"} onChange={(e) => send({ type: "setMapSize", mapSize: Number(e.target.value) })}>{MAP_SIZES.map((size) => <option key={size} value={size}>{size} × {size}</option>)}</select>
            : <strong>{game.boardSize} × {game.boardSize}</strong>}
        </div>
        <div className="color-setting-row"><div><b>Your tank color</b><small>Choose your map color before the match starts.</small></div><input aria-label="Your tank color" type="color" value={me?.color||"#57a6e8"} disabled={connection!=="online"} onChange={e=>send({type:"setColor",color:e.target.value})}/></div>
        <p className="micro-note">Only the host can change map size. Every player chooses their own tank color before the match.</p>
      </section>
      <section className="panel lobby-roster"><div className="section-title"><div><div className="eyebrow">THE ROSTER</div><h2>Players</h2></div><small>Names are public</small></div>
        {game.players.map((p, i) => <div className="roster-row" key={p.id}><span className="roster-number">{i + 1}</span><i className="roster-color" style={{backgroundColor:p.color}}/><div><b>{p.name}{p.id === session.playerId ? " · YOU" : ""}</b><small>{p.host ? "Lobby host" : "Ready to deploy"}</small></div>{p.host && <span className="host-chip">HOST</span>}</div>)}
        {me?.host ? <button className="primary-button" disabled={game.players.length < 2} onClick={() => send({ type: "start" })}>Start match <ChevronRight/></button> : <p className="waiting">Waiting for the host to start the match…</p>}
        {game.players.length < 2 && <small className="muted">Invite at least one other player to unlock Start match.</small>}
      </section>
    </main> :
    <main className="game-main">
      <div className="game-heading"><div><div className="eyebrow">{game.phase==="ended"?"MATCH COMPLETE":"LIVE MATCH"} · SHARED GAME</div><h1>{game.phase==="ended"?(game.endReason==="ended-by-request"||game.endReason==="ended-by-host"?"The game was ended.":"The dust has settled."):"Command your tank."}</h1><p>{game.phase==="ended"?(game.winnerId?(game.players.find(p=>p.id===game.winnerId)?.name||"A player")+" is the last tank standing.":"The match was ended manually."):"Every move matters. Choose each action carefully."}</p>{game.phase==="active"&&me?.host&&<button className="danger-button" onClick={()=>{if(window.confirm("End the game for everyone now?"))send({type:"endGame"});}}>End the game <Shield size={16}/></button>}{game.phase==="ended"&&me?.host&&<button className="primary-button reset-match-button" onClick={()=>send({type:"reset"})}>Reset match for another test <RefreshCw size={16}/></button>}</div><div className="game-pills"><span><Users size={15}/> {game.players.length} players</span><span>{game.onlineCount} {game.onlineCount===1?"person":"people"} online</span><span>{game.boardSize} × {game.boardSize} grid</span></div></div>
      <div className="game-grid">
        <section className="panel map-panel"><div className="section-title"><div><div className="eyebrow">TACTICAL MAP</div><h2>Battlefield</h2></div><div className="legend"><span><i className="legend-you"/> You</span><span><i className="legend-player"/> Player</span><span><i className="legend-rock"/> Obstacle</span></div></div>
          <div className="board-wrap"><div className={"board " + (game.boardSize > 20 ? "board-large" : "")} style={{ gridTemplateColumns: "repeat(" + game.boardSize + ", minmax(0, 1fr))" }}>{Array.from({ length: game.boardSize * game.boardSize }, (_, i) => {
            const x=i%game.boardSize,y=Math.floor(i/game.boardSize),p=occupants.get(x+","+y),rock=obstacles.has(x+","+y);
            const inMyRange=me?.x!==null&&me?.x!==undefined&&me?.y!==null&&me?.y!==undefined&&Math.max(Math.abs(x-me.x),Math.abs(y-me.y))<=game.me.range;
            return <button key={x+"-"+y} className={"tile "+(inMyRange?"range-tile ":"outside-range-tile ")+(rock?"rock-tile ":"")+(p?"occupied ":"")+(p?.id===session.playerId?"self-tile ":"")+(p?.id===selectedId?"selected ":"")+(p&&!p.alive?"dead-tile":"")} title={p?p.name+" · "+p.hp+" HP":rock?"Obstacle":"Tile "+(x+1)+", "+(y+1)} onClick={()=>p?setSelectedId(p.id):canAct&&!rock&&send({type:"move",x,y})}>
              {rock?<span className="rock">◆</span>:p?<><span className="tank" style={{color:p.color}}>{p.alive?"▰":"✕"}</span>{p.id!==session.playerId&&<span className={"tank-state-dot "+(p.alive?"alive":"dead")}/>}{game.boardSize<=20&&<span className="tile-label">{p.name.slice(0,6)}</span>}</>:null}
            </button>;
          })}</div></div>
          <div className="map-help"><span><Move size={14}/> Click an empty tile to move (AP per step).</span><span>8 directions</span></div>
        </section>
        <aside className="side-column">
          <section className="panel stats-panel"><div className="eyebrow">YOUR TANK</div><h2>{me?.name || session.name}</h2><div className="tank-status">{me?.alive ? "Active tank" : "Jury · eliminated"}</div>
            <div className="stat-grid"><div className="stat-card"><small>HEALTH</small><strong className="hp-number">{me?.hp ?? 0}<i> / 3</i></strong><div className="hearts">{[0,1,2].map(i => <Heart key={i} size={15} fill={i < (me?.hp || 0) ? "currentColor" : "none"}/>)}</div></div><div className="stat-card"><small>ACTION POINTS</small><strong className="ap-number">{game.me.ap}</strong><div className="ap-clock"><BatteryCharging size={13}/> +1 in {game.me.nextApAt ? duration(game.me.nextApAt - now) : "Paused"}</div></div></div>
            <div className="stat-line"><span>Next AP</span><b>{game.me.nextApAt?new Date(game.me.nextApAt).toLocaleString():"Paused"}</b></div>
            {!me?.alive&&game.me.killerName&&<div className="killer-note">Eliminated by <b>{game.me.killerName}</b></div>}
            {canAct&&<button className="take-turn-button" onClick={()=>send({type:"takeTurn"})} disabled={connection!=="online"}><Zap size={15}/> Take a turn immediately <small>+1 AP · daily timer unchanged</small></button>}
          </section>
          <section className="panel actions-panel"><div className="section-title"><div><div className="eyebrow">COMMANDS</div><h2>Actions</h2></div><small>AP is private</small></div>
            <div className="target-card">{target ? <><div><small>SELECTED PLAYER</small><b>{target.name}{target.id === me?.id ? " · YOU" : ""}</b></div><span className={target.alive ? "alive-tag" : "dead-tag"}>{target.alive ? "ALIVE" : "ELIMINATED"}</span><div className="target-stats">{target.hp} HP <span>({(target.x ?? -1) + 1}, {(target.y ?? -1) + 1})</span></div></> : <div className="no-target"><Crosshair size={17}/> Select a tank on the map or roster.</div>}</div>
            {canAct ? <><div className="action-buttons">
                <button disabled={!target || target.id === me?.id || !target.alive || game.me.ap < 1} onClick={() => target && send({ type: "attack", targetId: target.id })}><Swords/><span><b>Shoot</b><small>1 AP · 1 damage</small></span></button>
                <button disabled={game.me.ap < 3 || (me?.hp || 3) >= 3} onClick={() => send({ type: "heal" })}><Heart/><span><b>Repair</b><small>3 AP · +1 HP</small></span></button>
                <button disabled={game.me.ap < 3} onClick={() => send({ type: "upgradeRange" })}><Crosshair/><span><b>Upgrade range</b><small>3 AP · +1 tile</small></span></button>
                <button disabled={!target || target.id === me?.id || !target.alive || game.me.ap < 1} onClick={() => target && send({ type: "giftAp", targetId: target.id, amount: 1 })}><Zap/><span><b>Gift 1 AP</b><small>Click to transfer</small></span></button>
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
          <section className="panel notes-panel"><div className="section-title"><div><div className="eyebrow">PERSONAL</div><h2>Private notes</h2></div><small>{notesDirtyRef.current?"Saving privately…":"Saved privately"}</small></div>
            <textarea value={notesDraft} maxLength={5000} rows={5} placeholder="Keep private notes about the match, players, plans, or observations…" onChange={e=>editNotes(e.target.value)} onBlur={()=>{if(notesDirtyRef.current&&socketRef.current?.readyState===WebSocket.OPEN)socketRef.current.send(JSON.stringify({type:"saveNotes",notes:notesDraftRef.current}));}}/>
            <small className="notes-count">{notesDraft.length}/5000 characters</small>
          </section>
          <section className="panel roster-panel"><div className="section-title"><div><div className="eyebrow">FIELD INTELLIGENCE</div><h2>Players</h2></div><small>{game.players.filter(p => p.alive).length} alive</small></div>
            {game.players.map(p => <div className={"field-row " + (p.id === selectedId ? "focused" : "")} key={p.id}><button className="field-person" onClick={() => setSelectedId(p.id)}><i className={p.id === session.playerId ? "you-dot" : p.alive ? "player-dot" : "dead-dot"}/><span><b>{p.name}{p.id === session.playerId ? " · YOU" : ""}</b><small>{p.alive ? p.hp + " HP" : "Eliminated"}</small></span></button><select aria-label={"Label " + p.name} value={labels[p.id] || "unmarked"} onChange={e => updateLabel(p.id, e.target.value as PlayerLabel)}><option value="unmarked">Unmarked</option><option value="ally">Ally</option><option value="enemy">Enemy</option></select></div>)}
            <p className="micro-note">Labels are private notes saved in this browser. They do not create teams or change damage.</p>
          </section>
        </aside>
      </div>
      <p className="server-note"><Shield size={14}/> Server-authoritative match · AP and actions are validated by the game server.</p>
    </main>}
    <footer className="footer">TANK TURN TACTICS <span>·</span> v0.6 · ONE SHARED MATCH</footer>
  </div>;
}
