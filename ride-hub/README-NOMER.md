# НОМЕР — Telegram Mini App

Replaces the former ZUB VPN entry point `ride-hub/index.html`.

## Deployment

- Existing static service: `https://ride-hub-qr-test.onrender.com`, publish directory `ride-hub`.
- Existing bot: `@ZUBVPN_BOT`, source `zub-bot/server.js`.
- Bot variables: `TELEGRAM_BOT_TOKEN` (existing secret), optional `MINI_APP_URL` (defaults to existing static URL).
- Start: `node zub-bot/server.js`. It can also serve the game at `/` from the repository checkout.
- Keep the Render build context at repository root if using the bot server to serve static files.
- `/health` exposes configuration presence only; no secrets.
- Bot commands and menu are updated at startup. Telegram Main Mini App URL is a separate BotFather setting; the existing URL is preserved.

## Game

- Every standard passenger plate combination: 12 letters, digits 001–999, 169 selectable region codes (including historical codes).
- Uniform rejection-sampled Web Crypto RNG. Every region is equally likely when not fixed.
- 1,726,272 combinations per region; six deterministic rarity classes.
- Highest class takes precedence. Ultra rare: both three identical letters and three identical digits, 108 combinations, probability 1/15,984.
- Free rolls; no payment, wagering, prize, or cash-out features.
- Device-local persistence, keyed by Telegram user ID when available. This is not server authentication or cloud synchronization.
- Up to 5,000 collection entries. JSON export/import validates fields and merges by plate identity.
- The region catalog is a game catalog, including historical codes; it is not a legal registration directory.

## Verification

Enumerated all 1,726,272 combinations: tier counts 930600 / 557172 / 195624 / 27324 / 15444 / 108.
10,000 generated plates passed format and region validation.

Catalog references consulted 2026-10-04:
https://calc2me.ru/kod-regiona/
https://www.sravni.ru/osago/info/avtomobilnye-kody-regionov/
