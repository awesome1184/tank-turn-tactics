# Tank Turn Tactics

A persistent browser-based multiplayer tank tactics game. The React client is hosted on GitHub Pages; an authoritative Cloudflare Worker + Durable Object server handles rooms, WebSockets, combat, and daily AP income.

## Included in v0.4

- Six-character lobby codes, player names, host-controlled match start, and up to 64 players.
- Host-selectable 16×16, 20×20, 24×24, and 32×32 battlefields, with obstacle counts scaled to board area.
- Portable player recovery keys: export a key, then restore that same player from another browser without creating an account.
- An in-game debug panel with connection status, API health checks, manual sync/reconnect, and privacy-safe diagnostic copying.
- Reconnectable sessions and persistent match state.
- A 16×16 square grid with movement, attacks, HP, range upgrades, healing, AP transfers, and heart gifts/revivals.
- Private `Ally`, `Enemy`, and `Unmarked` labels saved in each player's browser.
- AP totals hidden from other players.
- One AP every 24 hours per living player, on a rolling schedule that keeps running while a player is offline.

See [`docs/RULESET.md`](docs/RULESET.md) for the exact implemented rules and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for Cloudflare setup.


Jury: eliminated players may cast one secret vote per daily cycle. A living player receiving at least three votes receives +1 bonus AP when the cycle closes. See [docs/RULESET.md](docs/RULESET.md) for exact timing and edge cases.


## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the Cloudflare Worker and GitHub Pages setup steps.
