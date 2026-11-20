import type { MatchEvent, OmniscientMatchExport, PrivatePlayerSnapshot } from "../../../packages/shared/src/contracts";

interface GifFrame { at: number; label: string; players: PrivatePlayerSnapshot[]; }

const GIF_WIDTH = 800;
const GIF_HEIGHT = 600;
const MAX_GIF_FRAMES = 160;
const FRAME_DELAY_CENTISECONDS = 40;

function clonePlayers(players: PrivatePlayerSnapshot[]): PrivatePlayerSnapshot[] {
  return players.map(player => ({ ...player }));
}

function eventLabel(event: MatchEvent): string {
  const actor = event.actorName || "Match";
  const target = event.targetName || "a player";
  switch (event.type) {
    case "move": return event.x !== undefined && event.y !== undefined ? actor + " moved to (" + (event.x + 1) + ", " + (event.y + 1) + ")" : actor + " moved";
    case "attack": return event.killed ? actor + " eliminated " + target : actor + " hit " + target;
    case "heal": return actor + " repaired their tank";
    case "range-upgrade": return actor + " privately upgraded range";
    case "gift-ap": return actor + " transferred 1 AP to " + target;
    case "gift-heart": return actor + " gave a heart to " + target;
    case "daily-ap": return actor + " received " + (event.amount || 1) + " daily AP";
    case "jury-vote": return "Secret jury vote: " + actor + " supported " + target;
    case "jury-award": return target + " received 1 AP from the jury";
    case "player-kick": return actor + " removed " + target;
    case "player-join": return target + " joined";
    case "match-end": return event.targetName ? target + " wins" : "The match ended";
    default: return "Match state updated";
  }
}

function buildFrames(data: OmniscientMatchExport): GifFrame[] {
  const initial = data.initialSnapshot?.length ? data.initialSnapshot : data.roster;
  const players = new Map(initial.map(player => [player.id, { ...player }]));
  const frames: GifFrame[] = [{
    at: data.startedAt ?? Date.parse(data.exportedAt),
    label: data.timelineAvailable ? "Match start" : "Historical private timeline unavailable",
    players: clonePlayers(Array.from(players.values())),
  }];
  if (!data.timelineAvailable) return frames;
  for (const event of data.timeline) {
    if (event.type === "match-start") continue;
    if (event.type === "player-kick" && event.targetId) players.delete(event.targetId);
    for (const change of event.privateChanges || []) players.set(change.id, { ...change });
    if (event.privateChanges?.length || event.type === "player-kick") {
      frames.push({ at: event.at, label: eventLabel(event), players: clonePlayers(Array.from(players.values())) });
    }
  }
  return frames;
}

function colorForPlayer(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#74a9d8";
}

function drawFrame(
  canvas: HTMLCanvasElement,
  frame: GifFrame,
  boardSize: number,
  obstacles: Array<[number, number]>,
  frameNumber: number,
  totalFrames: number,
): Uint8Array {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The browser could not create a canvas for the GIF export.");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#101923";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#eaf1fa";
  context.font = "bold 19px Arial, sans-serif";
  context.fillText("TANK TURN TACTICS  /  OMNISCIENT REPLAY", 22, 30);
  context.fillStyle = "#aab8c8";
  context.font = "11px Arial, sans-serif";
  context.fillText(new Date(frame.at).toLocaleString() + "    ·    Frame " + (frameNumber + 1) + " / " + totalFrames, 24, 50);

  const mapX = 22;
  const mapY = 78;
  const mapSize = 470;
  const tile = mapSize / boardSize;
  context.fillStyle = "#202d39";
  context.fillRect(mapX, mapY, mapSize, mapSize);

  for (const player of frame.players) {
    if (!player.alive || player.x === null || player.y === null) continue;
    const range = Math.max(0, Math.min(boardSize, player.range));
    const left = Math.max(0, player.x - range);
    const top = Math.max(0, player.y - range);
    const right = Math.min(boardSize - 1, player.x + range);
    const bottom = Math.min(boardSize - 1, player.y + range);
    context.globalAlpha = 0.12;
    context.fillStyle = colorForPlayer(player.color);
    context.fillRect(mapX + left * tile, mapY + top * tile, (right - left + 1) * tile, (bottom - top + 1) * tile);
    context.globalAlpha = 0.62;
    context.strokeStyle = colorForPlayer(player.color);
    context.lineWidth = 1.3;
    context.strokeRect(mapX + left * tile + 1, mapY + top * tile + 1, Math.max(0, (right - left + 1) * tile - 2), Math.max(0, (bottom - top + 1) * tile - 2));
  }
  context.globalAlpha = 1;

  context.strokeStyle = "#405160";
  context.lineWidth = 1;
  for (let index = 0; index <= boardSize; index++) {
    const vertical = mapX + index * tile;
    context.beginPath(); context.moveTo(vertical, mapY); context.lineTo(vertical, mapY + mapSize); context.stroke();
    const horizontal = mapY + index * tile;
    context.beginPath(); context.moveTo(mapX, horizontal); context.lineTo(mapX + mapSize, horizontal); context.stroke();
  }
  for (const [x, y] of obstacles) {
    context.fillStyle = "#536170";
    context.fillRect(mapX + x * tile + 1, mapY + y * tile + 1, Math.max(1, tile - 2), Math.max(1, tile - 2));
  }
  for (const player of frame.players) {
    if (player.x === null || player.y === null) continue;
    const centerX = mapX + (player.x + 0.5) * tile;
    const centerY = mapY + (player.y + 0.5) * tile;
    if (!player.alive) {
      context.fillStyle = "#d66b70";
      context.font = "bold " + Math.max(9, tile * 0.65) + "px Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("×", centerX, centerY);
    } else {
      context.beginPath();
      context.arc(centerX, centerY, Math.max(4, tile * 0.34), 0, Math.PI * 2);
      context.fillStyle = colorForPlayer(player.color);
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = "#f5f8fc";
      context.stroke();
      context.fillStyle = "#0b1118";
      context.font = "bold " + Math.max(7, tile * 0.34) + "px Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(player.name.slice(0, 2), centerX, centerY);
    }
  }

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#dce6f2";
  context.font = "bold 14px Arial, sans-serif";
  context.fillText("PRIVATE PLAYER INTELLIGENCE", 520, 84);
  context.fillStyle = "#8fa2b7";
  context.font = "10px Arial, sans-serif";
  context.fillText("Health · action points · firing range", 521, 100);

  const panelX = 520;
  const panelY = 116;
  const panelWidth = 258;
  const columns = frame.players.length > 32 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(frame.players.length / columns));
  const rowHeight = Math.min(19, (height - panelY - 52) / rows);
  const columnWidth = panelWidth / columns;
  frame.players.forEach((player, index) => {
    const column = Math.floor(index / rows);
    const row = index % rows;
    const x = panelX + column * columnWidth;
    const y = panelY + row * rowHeight;
    context.fillStyle = player.alive ? "#1a2936" : "#2b2028";
    context.fillRect(x, y, columnWidth - 3, Math.max(1, rowHeight - 1));
    context.fillStyle = colorForPlayer(player.color);
    context.fillRect(x + 1, y + 2, 3, Math.max(5, rowHeight - 5));
    context.fillStyle = player.alive ? "#eff4fa" : "#d9a0a2";
    context.font = "bold " + Math.max(7, Math.min(9, rowHeight * 0.58)) + "px Arial, sans-serif";
    const name = player.name.length > 10 ? player.name.slice(0, 9) + "…" : player.name;
    context.fillText(name + " · HP " + player.hp + " · AP " + player.ap + " · R " + player.range, x + 7, y + Math.max(9, rowHeight * 0.72));
  });

  context.fillStyle = "#95a7ba";
  context.font = "10px Arial, sans-serif";
  context.fillText("Colored outlines show each living player's firing range", 22, height - 34);
  context.fillText("HP = health   ·   AP = action points   ·   R = range", 22, height - 19);
  context.fillStyle = "#e9f0f8";
  context.font = "bold 11px Arial, sans-serif";
  const label = frame.label.length > 54 ? frame.label.slice(0, 51) + "…" : frame.label;
  context.fillText(label, 520, height - 19);

  const pixels = context.getImageData(0, 0, width, height).data;
  const indexed = new Uint8Array(width * height);
  for (let source = 0, target = 0; target < indexed.length; source += 4, target++) {
    indexed[target] = ((pixels[source] >> 5) << 5) | ((pixels[source + 1] >> 5) << 2) | (pixels[source + 2] >> 6);
  }
  return indexed;
}

function lzwCompress(indices: Uint8Array): Uint8Array {
  const clearCode = 256;
  const endCode = 257;
  const output: number[] = [];
  const dictionary = new Map<number, number>();
  let codeSize = 9;
  let nextCode = 258;
  let bitBuffer = 0;
  let bitCount = 0;
  const writeCode = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  writeCode(clearCode);
  if (indices.length === 0) writeCode(endCode);
  else {
    let prefix = indices[0];
    for (let index = 1; index < indices.length; index++) {
      const next = indices[index];
      const key = (prefix << 8) | next;
      const found = dictionary.get(key);
      if (found !== undefined) prefix = found;
      else {
        writeCode(prefix);
        if (nextCode < 4096) {
          dictionary.set(key, nextCode++);
          if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
        } else {
          writeCode(clearCode);
          dictionary.clear();
          codeSize = 9;
          nextCode = 258;
        }
        prefix = next;
      }
    }
    writeCode(prefix);
    writeCode(endCode);
  }
  if (bitCount > 0) output.push(bitBuffer & 0xff);
  return new Uint8Array(output);
}

function encodeGif(frames: Uint8Array[], width: number, height: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  const ascii = (value: string) => chunks.push(new TextEncoder().encode(value));
  const bytes = (...values: number[]) => chunks.push(new Uint8Array(values));
  const word = (value: number) => bytes(value & 0xff, (value >> 8) & 0xff);
  ascii("GIF89a");
  word(width); word(height);
  bytes(0xf7, 0, 0);

  const palette = new Uint8Array(256 * 3);
  for (let index = 0; index < 256; index++) {
    const red = (index >> 5) & 7;
    const green = (index >> 2) & 7;
    const blue = index & 3;
    palette[index * 3] = Math.round(red * 255 / 7);
    palette[index * 3 + 1] = Math.round(green * 255 / 7);
    palette[index * 3 + 2] = Math.round(blue * 255 / 3);
  }
  chunks.push(palette);
  bytes(0x21, 0xff, 0x0b);
  ascii("NETSCAPE2.0");
  bytes(0x03, 0x01, 0x00, 0x00, 0x00);
  for (const frame of frames) {
    const delay = FRAME_DELAY_CENTISECONDS;
    bytes(0x21, 0xf9, 0x04, 0x04, delay & 0xff, (delay >> 8) & 0xff, 0x00, 0x00);
    bytes(0x2c);
    word(0); word(0); word(width); word(height);
    bytes(0x00, 0x08);
    const compressed = lzwCompress(frame);
    for (let offset = 0; offset < compressed.length; offset += 255) {
      const block = compressed.subarray(offset, Math.min(offset + 255, compressed.length));
      bytes(block.length);
      chunks.push(block);
    }
    bytes(0x00);
  }
  bytes(0x3b);
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function createOmniscientGif(data: OmniscientMatchExport): Promise<Blob> {
  const allFrames = buildFrames(data);
  if (!allFrames.length) throw new Error("There is no match timeline to export.");
  const selectedFrames = allFrames.length <= MAX_GIF_FRAMES
    ? allFrames
    : Array.from({ length: MAX_GIF_FRAMES }, (_, index) => allFrames[Math.round(index * (allFrames.length - 1) / (MAX_GIF_FRAMES - 1))]);
  const canvas = document.createElement("canvas");
  canvas.width = GIF_WIDTH;
  canvas.height = GIF_HEIGHT;
  const rendered: Uint8Array[] = [];
  for (let index = 0; index < selectedFrames.length; index++) {
    rendered.push(drawFrame(canvas, selectedFrames[index], data.boardSize, data.obstacles || [], index, selectedFrames.length));
    if (index % 4 === 3) await new Promise(resolve => window.setTimeout(resolve, 0));
  }
  return new Blob([encodeGif(rendered, GIF_WIDTH, GIF_HEIGHT)], { type: "image/gif" });
}
