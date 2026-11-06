# Tank Turn Tactics — implemented rules (v0.5)

This is the exact ruleset implemented by the current prototype.

## 1. One shared match

- There is exactly one shared game for all players. There are no room codes, lobby codes, invitations, or separate rooms.
- The first player to join creates the shared lobby and automatically becomes host.
- Each tab joins as a separate player. A tab's session is stored in sessionStorage, so reloading that tab reconnects as the same player without making other tabs share its identity.
- Open the game in another tab and choose a different callsign to add another player. The top-bar New player tab button opens a fresh tab for this purpose.
- The game supports 2–64 players. New players can join only while the shared game is in its lobby phase.
- The host starts the match. Once started, the roster and map size are locked.
- The host can reset a completed match. Reset returns all existing players to the lobby and preserves their identities and recovery keys; it resets HP to 3, AP to 0, range to 2, clears positions and obstacles, and clears jury state.
- The host selects a square battlefield from 16×16, 20×20, 24×24, or 32×32. Obstacle count scales with map area to maintain approximately the same density as the original 16×16 board.
- At match start, the server randomly places the scaled obstacle count and places each tank on a distinct, unblocked tile.
- Every player starts with 3 hearts (HP), 0 action points (AP), and range 2.
- There are no fixed teams. Players decide whom to cooperate with.

## 2. Action points and schedule

- Each living player receives 1 AP exactly every 24 hours, beginning 24 hours after the match starts.
- The schedule runs every day, including weekends and holidays. It is a rolling 24-hour timer, not a midnight reset.
- AP continues to accumulate while a player is offline. Unspent AP is banked without a cap.
- AP is private: the server sends each player their own AP total and timer, never another player's AP total.
- An eliminated player stops receiving AP. If revived, they return with 0 AP and their next AP is due 24 hours after revival.

## 3. Movement

- A move can travel orthogonally or diagonally, one tile per step (8 possible directions).
- Each step costs 1 AP. The server finds the shortest legal path around obstacles and other tanks; a move costs the number of steps in that path. The entire move is rejected if the player cannot pay the full path cost.
- Tanks cannot move outside the board, through obstacles, or onto another tank's tile.
- Eliminated tanks remain on their tile and continue to block movement.

## 4. Combat

- A player may shoot any living player whose Chebyshev distance is at most the shooter's range.
- Obstacles do not block shots; range is checked by tile distance only.
- Each shot costs 1 AP and deals 1 damage (removes 1 HP).
- A tank is eliminated at 0 HP. Its AP bank is transferred to the player who dealt the eliminating shot; the eliminated player's AP becomes 0.
- The match ends when exactly one living player remains. That player wins.

## 5. Repairs, upgrades, and gifts

- Repair: spend 3 AP to restore 1 HP to yourself, up to the 3 HP maximum.
- Range upgrade: spend 3 AP to permanently increase your attack / gift range by 1 tile.
- Gift AP: transfer 1–3 AP to another living player within your range. The sender pays exactly the amount gifted; there is no additional fee.
- Gift a heart: transfer 1 HP to another player within your range. You cannot give away your last HP.
- A living recipient gains 1 HP, up to 3 maximum. An eliminated recipient is revived at 1 HP with 0 AP; their next AP arrives 24 hours after revival.
- Heart gifts do not require AP. AP gifts deduct the gifted amount from the sender's AP as described above.

## 6. Names, labels, recovery, and connections

- Names are 1–18 characters and visible to everyone.
- Each player may assign every other player a private label: Ally, Enemy, or Unmarked. Labels are saved in that player's browser and are not shared with the server. They do not create teams or change damage.
- There is no in-game chat.
- A disconnected player stays in the shared match. Their tab reconnects using its tab-specific session.
- Each player can export a portable recovery key from the in-game Save key control. On another browser, select Restore on the landing screen and paste that key. The key is a bearer credential: anyone holding it can control that player, so keep it private. There are no password-based accounts yet.
- The server is authoritative: it validates AP, pathing, range, HP, gifts, and match phase.

## 7. Jury

- Every eliminated player becomes a juror while the match remains active.
- Each juror may cast one secret ballot per 24-hour match cycle, choosing one living player to support.
- The ballot window opens at match start and closes at the same 24-hour boundary as daily AP income.
- If a living player receives 3 or more valid votes in a cycle, that player receives 1 bonus AP when the cycle closes. The bonus is added on top of normal daily AP income; more than 3 votes still awards only 1 bonus AP.
- Votes and vote totals are never sent to clients. A juror sees only whether their own ballot has been recorded.
- A vote counts only if the voter is still eliminated and the recipient is still alive when the cycle is tallied.
- If a juror is revived before the tally, their ballot is not counted. Their ballot remains marked as used for that cycle, so they cannot be revived and then cast a second ballot if eliminated again before the next cycle.
- The jury stops voting when the match ends and is cleared by host reset.

## 8. Not yet implemented

Daily map heart pickups, status text, tournament placement / negotiated placement rules, and payment/prize handling are not implemented yet.

## Why the AP timer is 24 hours

The prototype intentionally uses the requested one AP per day rule. The timer is matchStartedAt + 24 hours, then every 24 hours thereafter.
