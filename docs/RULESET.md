# Tank Turn Tactics — implemented rules (v0.7)

## Shared game
- There is one global match. No room codes, separate rooms, or chat.
- The first player is host. Each browser tab can join as a separate player. Supports 2–64 players.
- Players join only in the lobby. The host starts the game, can end it manually, and can reset an ended game.
- Board sizes: 16×16, 20×20, 24×24, or 32×32. Each player chooses a hex color in the lobby; colors lock on start.
- 3 HP, 0 AP, range 2 at match start.

## Turns and AP
- Living players normally receive 1 AP every 24 hours, with offline accumulation and no AP cap.
- AP and timers are private.
- Take a turn immediately grants +1 AP to that player for playtesting; it does not shift the daily AP timer.
- AP gifts transfer exactly 1 AP per click.
- Eliminated players stop earning AP. Revived players return at 1 HP and 0 AP, with next AP due 24 hours later.

## Movement and combat
- Movement is 8-directional, one AP per shortest legal path step. Obstacles and tanks block movement.
- Shooting costs 1 AP and deals 1 HP within the shooter's range. Obstacles do not block shots.
- Other players cannot see a player's numeric firing range. Each client shades only its own range light gray; all other map tiles are dark gray.
- Other tanks show green (alive) or red (eliminated) dots. Your own tank has a bright border.
- Source of non-lethal damage is hidden. When a player is eliminated, only that player sees the killer's name.
- The last tank alive wins; host can also end the match manually.

## Other actions
- Repair costs 3 AP for +1 HP, up to 3.
- Range upgrade costs 3 AP for +1 range.
- Give a heart costs no AP; giver must keep 1 HP. An eliminated player revives with 1 HP.

## Private notes
- Each player's notes are private, up to 5,000 characters, and autosave after a short pause.
- Saving a changed note creates a server-side revision with timestamp. The private notes and archive are never in normal player broadcasts.
- Only the host can open the notes history after the game ends. Up to 30 revisions per player are retained.

## While you were gone replay
- The server records public game events with timestamps.
- On reconnect, each player receives only the unseen event list since the last disconnect.
- Each step displays for 1.5 seconds and includes the local timestamp.
- The replay does not expose attackers on non-lethal damage. A victim sees who eliminated them; other players only see the elimination.
- Private AP, hidden ranges, notes, jury votes, and individual online status are not exposed through the replay.
- The server holds up to 3,000 recent events for the current match.

## Presence and jury
- The interface exposes only the aggregate online headcount; it never reveals which players are online.
- Eliminated players can cast one secret jury ballot per daily cycle; 3+ valid votes award +1 AP.
