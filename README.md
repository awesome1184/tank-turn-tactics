# Tank Turn Tactics

A persistent browser-based multiplayer tank tactics game. The React client is hosted on GitHub Pages; an authoritative Cloudflare Worker and SQLite-backed Durable Object run one shared match.

## Included in v0.5

- One global game shared by everyone; there are no lobby codes or separate rooms.
- Up to 64 players can join the shared lobby before the host starts.
- Each browser tab has its own player session. Open another tab and join with a different callsign to simulate multiple players.
- The first player to join automatically becomes host.
- Host-selectable 16×16, 20×20, 24×24, and 32×32 battlefields, with obstacle counts scaled to board area.
- Host can reset a completed match to the lobby while preserving the same players and tab sessions for another test.
- Portable player recovery keys let a player restore their server-saved state in another browser.
- In-game debug panel with connection status, API health checks, manual sync/reconnect, and privacy-safe diagnostic copying.
- Tactical movement, attacks, HP, range upgrades, healing, AP transfers, and heart gifts/revivals.
- Private Ally, Enemy, and Unmarked labels saved per player in that browser.
- One AP every 24 hours per living player, on a rolling schedule that keeps running while a player is offline.
- Secret daily jury ballots for eliminated players.

There is no chat. See docs/RULESET.md for the exact rules and docs/DEPLOYMENT.md for deployment details.

## Playtest with multiple tabs

1. Open the game in one tab and join with a callsign. The first player becomes host.
2. Use New player tab in the top bar, or open the game URL in a separate tab.
3. Join with a different callsign in each tab. Each tab gets a separate player.
4. When everyone is in the lobby, start the match from the host tab.
5. After the match ends, the host can select Reset match for another test. The same players remain in the lobby, so all tabs can play again.

Use the Save key control to back up a player or restore it in another browser. Treat recovery keys like passwords.

## Deployment

The web client is at https://awesome1184.github.io/tank-turn-tactics/.

The Cloudflare Worker is tank-turn-tactics-api. The multiplayer API uses one fixed Durable Object identity for the shared match, so no room or lobby IDs are needed. See docs/DEPLOYMENT.md for deployment instructions.
