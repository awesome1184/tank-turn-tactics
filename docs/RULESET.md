# Tank Turn Tactics — implemented rules (v0.3)

This is the exact ruleset implemented by the current prototype. It resolves details left unspecified so the server can validate every action consistently.

## 1. Match setup
- A lobby has a six-character code and one host. It supports 2–64 players.
- The host starts the match; no one can join after it begins.
- The battlefield is a 16×16 square grid. The lobby cap is 64 players; after 30 obstacles are placed, 226 unblocked tiles remain available for tank spawns.
- At match start, the server randomly places 30 obstacles (about 12% of the map) and places each tank on a distinct, unblocked tile.
- Every player starts with 3 hearts (HP), 0 action points (AP), and range 2.
- There are no fixed teams. Players decide whom to cooperate with.

## 2. Action points and schedule
- Each living player receives **1 AP exactly every 24 hours**, beginning 24 hours after the match starts.
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
- A player may shoot any living player whose Chebyshev distance is at most the shooter's range. Chebyshev distance is the larger of the horizontal or vertical tile differences.
- Obstacles do not block shots in v0.1; range is checked by tile distance only.
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

## 6. Names, labels, chat, and connections
- Names are 1–18 characters and visible to everyone.
- Each player may assign every other player a private label: **Ally**, **Enemy**, or **Unmarked**. Labels are stored in that player's browser and are not shared with the server. They do not create teams or change damage.
- The room has shared chat. Messages are limited to 300 characters; the latest 50 are retained.
- A disconnected player stays in the match. Their browser can reconnect using its saved session key.
- The server is authoritative: it validates AP, pathing, range, HP, gifts, and match phase.

## 7. Jury (implemented in v0.2)
- Every eliminated player becomes a juror while the match remains active.
- Each juror may cast one secret ballot per 24-hour match cycle, choosing one living player to support.
- The ballot window opens at match start and closes at the same 24-hour boundary as daily AP income.
- If a living player receives **3 or more valid votes** in a cycle, that player receives **1 bonus AP** when the cycle closes. The bonus is added on top of normal daily AP income; more than 3 votes still awards only 1 bonus AP.
- Votes and vote totals are never sent to clients. A juror sees only whether their own ballot has been recorded.
- A vote counts only if the voter is still eliminated and the recipient is still alive when the cycle is tallied.
- If a juror is revived before the tally, their ballot is not counted. Their ballot remains marked as used for that cycle, so they cannot be revived and then cast a second ballot if eliminated again before the next cycle.
- The jury stops voting when the match ends.

### Which historical jury variant is used?
The creator's spoken explanation in the original game retrospective describes a daily secret vote to help a living player, with 3 votes granting that player an extra AP. This is the implemented rule. A separately transcribed printed rule sheet describes a different “haunted” penalty for the most-voted player. The prototype does **not** combine those conflicting variants and does not apply a haunting penalty.

## 8. Not yet implemented
Daily map heart pickups, status text, tournament placement / negotiated placement rules, and payment/prize handling are not implemented yet.

## Why the AP timer is 24 hours
The prototype intentionally uses the user's requested **one AP per day** rule. The timer is matchStartedAt + 24 hours, then every 24 hours thereafter. It does not use the 17-hour schedule from a related community recreation or the variable workday schedule in one historical transcription.