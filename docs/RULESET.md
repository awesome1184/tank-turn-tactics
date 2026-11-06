# Tank Turn Tactics — implemented rules (v0.1)

This is the exact ruleset implemented by the current prototype. It resolves details left unspecified so the server can validate every action consistently.

## 1. Match setup
- A lobby has a six-character code and one host. It supports 2–16 players.
- The host starts the match; no one can join after it begins.
- The battlefield is a 16×16 square grid.
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
- Each step costs 1 AP. The server finds the shortest legal path around obstacles and other tanks; a move costs the number of steps in that path.
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
- Gift AP: transfer 1–3 AP to another living player within your range. There is no transfer fee.
- Gift a heart: transfer 1 HP to another player within your range. You cannot give away your last HP.
- A living recipient gains 1 HP, up to 3 maximum. An eliminated recipient is revived at 1 HP with 0 AP; their next AP arrives 24 hours after revival.
- AP and heart gifts do not consume AP.

## 6. Names, labels, chat, and connections
- Names are 1–18 characters and visible to everyone.
- Each player may assign every other player a private label: **Ally**, **Enemy**, or **Unmarked**. Labels are stored in that player's browser and are not shared with the server. They do not create teams or change damage.
- The room has shared chat. Messages are limited to 300 characters; the latest 50 are retained.
- A disconnected player stays in the match. Their browser can reconnect using its saved session key.
- The server is authoritative: it validates AP, pathing, range, HP, gifts, and match phase.

## 7. Not in v0.1
Jury voting / haunted status, daily map heart pickups, status text, tournament placement rules, and payment/prize handling are not implemented yet. Eliminated players are identified as the jury and can be revived by a heart gift, but jury votes are not active yet.

## Why the AP timer is 24 hours
The prototype intentionally uses the user's requested **one AP per day** rule. The timer is matchStartedAt + 24 hours, then every 24 hours thereafter. It does not use the 17-hour schedule from a related community recreation or the variable workday schedule in one historical transcription.