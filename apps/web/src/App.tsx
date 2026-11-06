import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BatteryCharging, ChevronRight, Copy, Crosshair, Download, Heart, KeyRound, Move, RefreshCw, Shield, Skull, Swords, UserX, Users, Zap } from "lucide-react";
import { MAP_SIZES, MAX_PLAYERS } from "../../../packages/shared/src/contracts";
import type { NoteHistoryEntry, PlayerLabel, PublicGameState, PublicPlayer, PublicReplayEvent, ReplayMapSnapshot } from "../../../packages/shared/src/contracts";

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
function estimateMoveCost(game:PublicGameState,playerId:string,targetX:number,targetY:number):number|null {
  const actor=game.players.find(player=>player.id===playerId);
  if(!actor||actor.x===null||actor.y===null)return null;
  const blocked=new Set(game.obstacles.map(([x,y])=>x+","+y));
  for(const player of game.players)if(player.id!==actor.id&&player.x!==null&&player.y!==null)blocked.add(player.x+","+player.y);
  const key=(x:number,y:number)=>x+","+y;
  const queue:Array<[number,number]>=[[actor.x,actor.y]];
  const distances=new Map<string,number>([[key(actor.x,actor.y),0]]);
  const directions:Array<[number,number]>=[[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
  for(let head=0;head<queue.length;head++){
    const [x,y]=queue[head],distance=distances.get(key(x,y))||0;
    if(x===targetX&&y===targetY)return distance;
    for(const [dx,dy] of directions){
      const nx=x+dx,ny=y+dy,next=key(nx,ny);
      if(nx<0||ny<0||nx>=game.boardSize||ny>=game.boardSize||blocked.has(next)||distances.has(next))continue;
      distances.set(next,distance+1);queue.push([nx,ny]);
    }
  }
  return null;
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
  const [selectedMove, setSelectedMove] = useState<{x:number;y:number;cost:number}|null>(null);
  const [moveConfirmationOpen, setMoveConfirmationOpen] = useState(false);
  const [labels, setLabels] = useState<Labels>({});
  const [juryTarget, setJuryTarget] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesArchive, setNotesArchive] = useState<NoteHistoryEntry[] | null>(null);
  const [notesArchiveLoading, setNotesArchiveLoading] = useState(false);
  const [replayEvents, setReplayEvents] = useState<PublicReplayEvent[]>([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef<WebSocket | null>(null);
  const notesDirtyRef = useRef(false);
  const notesDraftRef = useRef("");

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
      setGame(null);setConnection("offline");notesDirtyRef.current=false;notesDraftRef.current="";setNotesDraft("");setNotesArchive(null);setReplayEvents([]);setReplayIndex(0);setSelectedMove(null);setMoveConfirmationOpen(false);return;
    }
    if (!API_BASE) { setError("Server URL is not configured. See README.md."); setConnection("offline"); return; }
    setLabels(readLabels(session.playerId));
    let stopped = false, retry = 0, retryId = 0;
    const connect = async () => {
      if (stopped) return;
      // Validate again before every reconnect so tabs that were offline when a
      // match ended also discard their now-invalid local session.
      try {
        await api("/api/game/recover", { playerId: session.playerId, token: session.token });
      } catch (e) {
        if (stopped) return;
        const message = e instanceof Error ? e.message : "";
        if (message.includes("does not match a saved player")) {
          sessionStorage.removeItem(SESSION_KEY);
          localStorage.removeItem("tank-turn-tactics-labels-" + session.playerId);
          setError("This player account is no longer active. It may have been removed by the host.");
          setSession(null);
          return;
        }
        // If validation is temporarily unavailable, still attempt the socket;
        // its existing reconnect behavior will handle a server outage.
      }
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
      socket.onclose = (event) => {
        if (stopped) return;
        if (event.code === 1008 && event.reason === "Kicked by host.") {
          sessionStorage.removeItem(SESSION_KEY);
          localStorage.removeItem("tank-turn-tactics-labels-" + session.playerId);
          setError("The host removed this player from the match.");
          setSession(null);
          setConnection("offline");
          return;
        }
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
    setSession(null); setGame(null); setError(""); setRecoveryOpen(false);
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
  const me = game?.players.find((p) => p.id === session?.playerId);
  const winner = game?.winnerId ? game.players.find((p) => p.id === game.winnerId) : undefined;
  const target = game?.players.find((p) => p.id === selectedId);
  const canAct = game?.phase === "active" && !!me?.alive;
  const obstacles = useMemo(() => new Set(game?.obstacles.map(([x, y]) => x + "," + y) || []), [game?.obstacles]);
  const occupants = useMemo(() => new Map<string, PublicPlayer>((game?.players || []).filter((p) => p.x !== null && p.y !== null).map((p): [string, PublicPlayer] => [String(p.x) + "," + String(p.y), p])), [game?.players]);
  const replayMap = useMemo(() => {
    const visible=replayEvents.slice(0,replayIndex+1);
    const anchor=visible.findIndex(event=>!!event.mapSnapshot);
    if(anchor<0)return null;
    const base=visible[anchor].mapSnapshot as ReplayMapSnapshot;
    const map:ReplayMapSnapshot={boardSize:base.boardSize,obstacles:base.obstacles.map(([x,y]):[number,number]=>[x,y]),players:base.players.map(player=>({...player}))};
    for(const event of visible.slice(anchor)){
      if(event.type==="move"&&event.actorId&&event.x!==undefined&&event.y!==undefined){
        const player=map.players.find(item=>item.id===event.actorId);
        if(player){player.x=event.x;player.y=event.y;}
      } else if(event.type==="attack"&&event.killed&&event.targetId){
        const target=map.players.find(item=>item.id===event.targetId);
        if(target)target.alive=false;
      } else if(event.type==="gift-heart"&&event.targetId){
        const target=map.players.find(item=>item.id===event.targetId);
        if(target)target.alive=true;
      } else if(event.type==="player-kick"&&event.targetId){
        map.players=map.players.filter(item=>item.id!==event.targetId);
      }
    }
    return map;
  },[replayEvents,replayIndex]);
  const replayObstacles=useMemo(()=>new Set(replayMap?.obstacles.map(([x,y])=>x+","+y)||[]),[replayMap]);
  const replayOccupants=useMemo(()=>new Map((replayMap?.players||[]).filter(player=>player.x!==null&&player.y!==null).map(player=>[player.x+","+player.y,player] as const)),[replayMap]);
  const selectedMoveCost=selectedMove&&game&&session?estimateMoveCost(game,session.playerId,selectedMove.x,selectedMove.y):null;
  const handleTileClick=(x:number,y:number)=>{
    const occupant=occupants.get(x+","+y);
    if(occupant){setSelectedMove(null);setMoveConfirmationOpen(false);setSelectedId(occupant.id);return;}
    if(!canAct||!game||!session||obstacles.has(x+","+y))return;
    if(selectedMove?.x===x&&selectedMove?.y===y){setMoveConfirmationOpen(true);return;}
    const cost=estimateMoveCost(game,session.playerId,x,y);
    if(cost===null){setSelectedMove(null);setMoveConfirmationOpen(false);setError("That tile cannot be reached.");return;}
    setError("");setSelectedId(null);setSelectedMove({x,y,cost});setMoveConfirmationOpen(false);
  };
  const confirmMove=()=>{
    if(!selectedMove||!game||!session)return;
    const cost=estimateMoveCost(game,session.playerId,selectedMove.x,selectedMove.y);
    if(cost===null){setError("That tile can no longer be reached.");setMoveConfirmationOpen(false);setSelectedMove(null);return;}
    if(game.me.ap<cost){setError("Not enough AP. You need "+cost+", and have "+game.me.ap+".");return;}
    send({type:"move",x:selectedMove.x,y:selectedMove.y});
    setSelectedMove(null);setMoveConfirmationOpen(false);
  };
  const kickPlayer=(player:PublicPlayer)=>{
    if(!me?.host||player.id===me.id||game?.phase==="ended")return;
    if(!window.confirm("Remove "+player.name+" from this match? Their current player account and recovery key will stop working."))return;
    send({type:"kick",targetId:player.id});
  };
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
      <section className="intro"><div className="eyebrow">ONE SHARED MULTIPLAYER MATCH</div><h1>Make every<br/><em>move count.</em></h1><p>Join with your callsign, coordinate with other players, and make every action point count. Each player has an independent account and recovery key.</p><div className="features"><span><Move size={16}/> Tactical grid</span><span><Users size={16}/> Shared multiplayer</span><span><BatteryCharging size={16}/> Daily AP</span></div></section>
      <section className="panel join-card">
        <div className="tabs">
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>Join game</button>
          <button className={mode === "recover" ? "active" : ""} onClick={() => setMode("recover")}>Restore</button>
        </div>
        <div className="eyebrow">{mode === "join" ? "SHARED MATCH" : "RESTORE A PLAYER"}</div>
        <h2>{mode === "join" ? "Join the game." : "Recover your save."}</h2>
        <p>{mode === "join" ? "Join the shared lobby. The first player becomes host and can start the match once everyone is ready." : "Paste the recovery key you saved earlier to reconnect to this player."}</p>
        {mode === "recover" ? (
          <label>RECOVERY KEY<textarea className="recovery-input" value={recoveryInput} rows={4} placeholder="TTT2.…" onChange={(e) => setRecoveryInput(e.target.value)}/></label>
        ) : (
          <label>PLAYER NAME<input value={name} maxLength={18} placeholder="Choose a callsign" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enter()}/></label>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary-button" disabled={busy || (mode === "recover" ? !recoveryInput.trim() : !name.trim())} onClick={mode === "recover" ? restoreSession : enter}>
          {busy ? "Connecting…" : mode === "join" ? "Join shared game" : "Restore player"}<ChevronRight size={18}/>
        </button>
        <div className="card-foot"><KeyRound size={14}/> Keep your recovery key private. It restores this player from another browser.</div>
      </section>
    </main><footer className="landing-foot">16 × 16 TO 32 × 32 MAPS <span>•</span> UP TO {MAX_PLAYERS} PLAYERS <span>•</span> 1 AP EVERY 24 HOURS</footer>
  </div>;

  return <div className="shell">
    <header className="topbar"><div className="brand"><div className="brand-icon"><Shield/></div><div><b>TANK TURN TACTICS</b><small>One shared game · each tab is a player</small></div></div><div className="top-right"><span className={"connection " + connection}><i/>{connection === "online" ? "Connected" : connection === "connecting" ? "Connecting" : "Reconnecting"}</span><button className="quiet-button" onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}><Users size={14}/> New player tab</button><button className="quiet-button" onClick={() => setRecoveryOpen(!recoveryOpen)}><KeyRound size={14}/> Save key</button><button className="quiet-button" onClick={leave}>Switch player</button></div></header>
    {recoveryOpen && <section className="panel utility-panel recovery-panel">
      <div className="section-title"><div><div className="eyebrow">PLAYER BACKUP</div><h2>Recovery key</h2></div><button className="quiet-button" onClick={() => setRecoveryOpen(false)}>Close</button></div>
      <p>Save this private key somewhere safe. It restores this exact player and server-saved game state on another browser. Anyone holding it can take over the player.</p>
      <textarea readOnly rows={3} value={recoveryKey} aria-label="Your recovery key"/>
      <div className="utility-actions">
        <button className="secondary-button" onClick={() => navigator.clipboard.writeText(recoveryKey).then(() => setError("Recovery key copied."), () => setError("Clipboard blocked. Use Download key instead."))}><Copy size={14}/> Copy key</button>
        <button className="secondary-button" onClick={downloadRecoveryKey}><Download size={14}/> Download .txt</button>
      </div>
    </section>}
    {error && <div className="toast">{error}<button onClick={() => setError("")}>×</button></div>}
    {moveConfirmationOpen&&selectedMove&&<div className="move-confirm-overlay" role="dialog" aria-modal="true" aria-label="Confirm movement" onClick={event=>{if(event.target===event.currentTarget){setMoveConfirmationOpen(false);}}}><section className="move-confirm-card"><div className="eyebrow">CONFIRM MOVEMENT</div><h2>Move to ({selectedMove.x+1}, {selectedMove.y+1})?</h2><p>This move will spend <strong>{selectedMoveCost===null?selectedMove.cost:selectedMoveCost} AP</strong>.</p>{selectedMoveCost===null?<small className="move-warning">That destination can no longer be reached.</small>:game&&game.me.ap<selectedMoveCost?<small className="move-warning">You only have {game.me.ap} AP available.</small>:null}<div className="move-confirm-actions"><button className="secondary-button" onClick={()=>setMoveConfirmationOpen(false)}>Cancel</button><button className="primary-button" disabled={selectedMoveCost===null||!game||game.me.ap<selectedMoveCost} onClick={confirmMove}>Confirm move · {selectedMoveCost===null?selectedMove.cost:selectedMoveCost} AP</button></div></section></div>}
    {replayEvents.length>0&&<div className="replay-overlay" role="dialog" aria-modal="true" aria-label="While you were gone replay">
      <section className="replay-card"><div className="replay-heading"><div><div className="eyebrow">WHILE YOU WERE GONE</div><h2>Match replay</h2></div><small>{replayIndex+1} / {replayEvents.length}</small></div>
        <time>{new Date(replayEvents[replayIndex].at).toLocaleString()}</time>
        {replayMap&&<div className="replay-map-wrap"><div className="replay-map" style={{gridTemplateColumns:"repeat("+replayMap.boardSize+",minmax(0,1fr))",gridTemplateRows:"repeat("+replayMap.boardSize+",minmax(0,1fr))"}}>{Array.from({length:replayMap.boardSize*replayMap.boardSize},(_,i)=>{const x=i%replayMap.boardSize,y=Math.floor(i/replayMap.boardSize),player=replayOccupants.get(x+","+y),rock=replayObstacles.has(x+","+y);return <div key={x+"-"+y} className={"replay-map-tile "+(rock?"rock":"")+(player?" occupied":"")} title={player?player.name:rock?"Obstacle":"Empty tile"}>{rock?<span>◆</span>:player?<span className={"replay-map-tank "+(!player.alive?"eliminated":"")} style={{color:player.color}}>{player.alive?"▰":"✕"}</span>:null}</div>;})}</div><small>Battlefield replay</small></div>}
        <p className={"replay-message "+(replayEvents[replayIndex].type==="match-end"?"replay-winner-message":"")}>{replayEvents[replayIndex].message}</p>
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
        {game.players.map((p, i) => <div className="roster-row" key={p.id}><span className="roster-number">{i + 1}</span><i className="roster-color" style={{backgroundColor:p.color}}/><div><b>{p.name}{p.id === session.playerId ? " · YOU" : ""}</b><small>{p.host ? "Lobby host" : "Ready to start"}</small></div>{p.host && <span className="host-chip">HOST</span>}{me?.host&&p.id!==me.id&&<button className="kick-button" onClick={()=>kickPlayer(p)} title={"Remove "+p.name}><UserX size={13}/> Kick</button>}</div>)}
        {me?.host ? <button className="primary-button" disabled={game.players.length < 2} onClick={() => send({ type: "start" })}>Start match <ChevronRight/></button> : <p className="waiting">Waiting for the host to start the match…</p>}
        {game.players.length < 2 && <small className="muted">Invite at least one other player to unlock Start match.</small>}
      </section>
      <section className="panel event-log-panel"><div className="section-title"><div><div className="eyebrow">MATCH HISTORY</div><h2>Public event log</h2></div><small>{game.eventLog.length} events</small></div>
        <div className="event-log-list">{game.eventLog.length?game.eventLog.slice().reverse().slice(0,200).map(event=><article key={event.id}><time>{new Date(event.at).toLocaleString()}</time><p>{event.message}</p></article>):<small className="muted">No events yet.</small>}</div>
      </section>
    </main> :
    <main className="game-main">
      <div className="game-heading"><div><div className="eyebrow">{game.phase==="ended"?"MATCH COMPLETE":"LIVE MATCH"} · SHARED GAME</div><h1 className={game.phase==="ended"?"game-result-title":""}>{game.phase==="ended"?(winner?winner.name+" wins!":"No tanks remain."):"Command your tank."}</h1><p>{game.phase==="ended"?(winner?"Last tank standing. Congratulations, "+winner.name+".":"There are no surviving tanks."):"Every move matters. Choose each action carefully."}</p></div><div className="game-pills"><span><Users size={15}/> {game.players.length} players</span><span>{game.onlineCount} {game.onlineCount===1?"person":"people"} online</span><span>{game.boardSize} × {game.boardSize} grid</span></div></div>
      <div className="game-grid">
        <section className="panel map-panel"><div className="section-title"><div><div className="eyebrow">TACTICAL MAP</div><h2>Battlefield</h2></div><div className="legend"><span><i className="legend-you"/> You</span><span><i className="legend-ally"/> Allies</span><span><i className="legend-enemy"/> Enemies</span><span><i className="legend-rock"/> Obstacle</span></div></div>
          <div className="board-wrap"><div className={"board " + (game.boardSize > 20 ? "board-large" : "")} style={{ gridTemplateColumns: "repeat(" + game.boardSize + ", minmax(0, 1fr))", gridTemplateRows: "repeat(" + game.boardSize + ", minmax(0, 1fr))", gridAutoRows: "minmax(0, 1fr)" }}>{Array.from({ length: game.boardSize * game.boardSize }, (_, i) => {
            const x=i%game.boardSize,y=Math.floor(i/game.boardSize),p=occupants.get(x+","+y),rock=obstacles.has(x+","+y);
            const inMyRange=me?.x!==null&&me?.x!==undefined&&me?.y!==null&&me?.y!==undefined&&Math.max(Math.abs(x-me.x),Math.abs(y-me.y))<=game.me.range;
            return <button key={x+"-"+y} className={"tile "+(inMyRange?"range-tile ":"outside-range-tile ")+(rock?"rock-tile ":"")+(p?"occupied ":"")+(p?.id===session.playerId?"self-tile ":"")+(p?.id===selectedId?"selected ":"")+(selectedMove?.x===x&&selectedMove?.y===y?"selected-move":"")} title={p?p.name+" · "+p.hp+" HP":rock?"Obstacle":canAct?"Tile "+(x+1)+", "+(y+1)+(selectedMove?.x===x&&selectedMove?.y===y?" · selected destination · "+selectedMove.cost+" AP":" · click to select"):"Tile "+(x+1)+", "+(y+1)} onClick={()=>handleTileClick(x,y)}>
              {rock?<span className="rock">◆</span>:p?<><span className="tank" style={{color:p.color}}>{p.alive?"▰":"✕"}</span>{(labels[p.id]==="ally"||labels[p.id]==="enemy")&&<span className={"tank-label-dot "+labels[p.id]}/>}{game.boardSize<=20&&<span className="tile-label">{p.name.slice(0,6)}</span>}</>:null}
            </button>;
          })}</div></div>
          <div className="map-help"><span><Move size={14}/> Click a destination to outline it, then click it again to review the AP cost.</span><span>8 directions</span></div>
        </section>
        <aside className="side-column">
          <section className="panel stats-panel"><div className="eyebrow">YOUR TANK</div><h2>{me?.name || session.name}</h2><div className="tank-status">{me?.alive ? "Active tank" : "Jury · eliminated"}</div>
            <div className="stat-grid"><div className="stat-card"><small>HEALTH</small><strong className="hp-number">{me?.hp ?? 0}<i> / 3</i></strong><div className="hearts">{[0,1,2].map(i => <Heart key={i} size={15} fill={i < (me?.hp || 0) ? "currentColor" : "none"}/>)}</div></div><div className="stat-card"><small>ACTION POINTS</small><strong className="ap-number">{game.me.ap}</strong><div className="ap-clock"><BatteryCharging size={13}/> +1 in {game.me.nextApAt ? duration(game.me.nextApAt - now) : "Paused"}</div></div></div>
            <div className="stat-line"><span>Next AP</span><b>{game.me.nextApAt?new Date(game.me.nextApAt).toLocaleString():"Paused"}</b></div>
            {!me?.alive&&game.me.killerName&&<div className="killer-note">Eliminated by <b>{game.me.killerName}</b></div>}
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
            {game.players.map(p => <div className={"field-row " + (p.id === selectedId ? "focused" : "")} key={p.id}><button className="field-person" onClick={() => setSelectedId(p.id)}><i title={labels[p.id]==="ally"?"Ally":labels[p.id]==="enemy"?"Enemy":"Unmarked"} className={"player-label-dot "+(labels[p.id]||"unmarked")}/><span><b>{p.name}{p.id === session.playerId ? " · YOU" : ""}</b><small>{p.alive ? p.hp + " HP" : "Eliminated"}</small></span></button><select aria-label={"Label " + p.name} value={labels[p.id] || "unmarked"} onChange={e => updateLabel(p.id, e.target.value as PlayerLabel)}><option value="unmarked">Unmarked</option><option value="ally">Ally</option><option value="enemy">Enemy</option></select>{me?.host&&p.id!==me.id&&game.phase!=="ended"&&<button className="kick-button" onClick={()=>kickPlayer(p)} title={"Remove "+p.name}><UserX size={13}/> Kick</button>}</div>)}
            <p className="micro-note">Green dots mark allies and red dots mark enemies. Labels are private to this browser and do not change damage.</p>
          </section>
          <section className="panel event-log-panel"><div className="section-title"><div><div className="eyebrow">MATCH HISTORY</div><h2>Public event log</h2></div><small>{game.eventLog.length} events</small></div>
            <div className="event-log-list">{game.eventLog.length?game.eventLog.slice().reverse().slice(0,200).map(event=><article key={event.id}><time>{new Date(event.at).toLocaleString()}</time><p>{event.message}</p></article>):<small className="muted">No events yet.</small>}</div>
          </section>
          {game.phase==="ended"&&me?.host&&<section className="panel notes-archive"><div className="section-title"><div><div className="eyebrow">HOST RECORD</div><h2>Private notes history</h2></div></div><p>Saved revisions from players’ private notes, visible only to the host after the match ends.</p><button className="secondary-button" onClick={loadNotesArchive} disabled={notesArchiveLoading}>{notesArchiveLoading?"Loading…":"Load notes history"}</button>{notesArchive&&<div className="notes-archive-list">{notesArchive.length?notesArchive.map(entry=><article key={entry.id}><div><b>{entry.playerName}</b><time>{new Date(entry.at).toLocaleString()}</time></div><pre>{entry.text||"(cleared notes)"}</pre></article>):<small>No notes were saved this match.</small>}</div>}</section>}
        </aside>
      </div>
      <p className="server-note"><Shield size={14}/> Server-authoritative match · AP and actions are validated by the game server.</p>
    </main>}
    <footer className="footer">TANK TURN TACTICS <span>·</span> SHARED MULTIPLAYER</footer>
  </div>;
}
