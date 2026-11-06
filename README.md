# Tank Turn Tactics

Persistent browser-based multiplayer tank tactics game. The React client is hosted on GitHub Pages; a Cloudflare Worker and SQLite-backed Durable Object run one shared match.

## Features

- One shared match with up to 64 players.
- Player accounts with private recovery keys.
- 16×16, 20×20, 24×24, and 32×32 maps.
- Host-managed lobby, map size, and player removal.
- Public event log with timestamps, visible to every player.
- Reconnect replay shows missed events and reconstructs the actual battlefield as moves, eliminations, and revivals occur.
- Green and red player markers indicate private ally/enemy labels, not alive or eliminated status.
- Opponents cannot see your firing range or individual online status. Only an aggregate online headcount is shown.
- Attacker attribution is hidden for non-lethal damage; victims can see who eliminated them.
- Private notes autosave to the server. Their revision history is available only to the host after game end.
- Turn-based movement, attacks, repairs, range upgrades, AP gifts, heart gifts, and the daily AP timer.

## Joining a match

Enter a callsign to join the shared lobby. The first player becomes host and can set the map size, remove players, and start the match once everyone is ready. Keep the recovery key private so you can restore your player from another browser.

During a match, the public event log records important actions with timestamps. If you reconnect after being away, the replay shows missed events alongside the battlefield as it changed.
