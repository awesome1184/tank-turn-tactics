# Tank Turn Tactics

Persistent browser-based multiplayer tank tactics game. The React client is hosted on GitHub Pages; a Cloudflare Worker and SQLite-backed Durable Object run one shared match.

## v0.7 features

- One shared game, no room codes or chat; up to 64 players.
- Multi-tab playtesting with tab-specific player sessions.
- 16×16, 20×20, 24×24, and 32×32 maps.
- Lobby color picker; light-gray tiles inside your own firing range, dark-gray everywhere else.
- Other tanks show green alive / red eliminated dots; your tank has a border.
- Opponents cannot see your range or individual online status. Only an aggregate online headcount is shown.
- Attacker attribution is hidden for non-lethal damage; victims can see who eliminated them.
- Take a turn immediately grants +1 AP without affecting the daily AP timer.
- Host can end the game at any time.
- Private notes autosave to the server. Their revision history is available only to the host after game end.
- A reconnect replay shows events that happened while a player was disconnected, with timestamps and 1.5-second steps.
- Recovery keys and a developer debug menu.

## Multi-tab test

Open a tab, join as the host, then use New player tab and join with new callsigns. Set colors in the lobby. Start the match. Use Take a turn immediately in each tab to grant AP. Close one tab, make moves from other tabs, then reopen/restore the offline player to see the While you were gone replay.

After a match ends, open Debug from the host tab to retrieve the private notes history.
