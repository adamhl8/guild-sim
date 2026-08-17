# guild-sim

Self-hosted web app where your raiders paste their `/simc` export. It runs the
[Raidbots](https://www.raidbots.com) droptimizer for each one and uploads the result to their
[wowaudit](https://wowaudit.com) wishlist.

The roster comes from wowaudit, so there is no separate list to maintain: track a character there and
whoever owns it can submit for it.

<!-- toc -->

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Setup](#setup)
- [Access](#access)
- [Deployment](#deployment)
- [Notes on the Raidbots side](#notes-on-the-raidbots-side)
  - [Pastes are the input, not the armory](#pastes-are-the-input-not-the-armory)
  - [Staleness](#staleness)
  - [The submit payload is deliberately minimal](#the-submit-payload-is-deliberately-minimal)
  - [Who owns the hourly limit](#who-owns-the-hourly-limit)
  - [Sources and upgrade levels](#sources-and-upgrade-levels)
  - [Things that do not work](#things-that-do-not-work)
  - [When sims fail on talents](#when-sims-fail-on-talents)
- [Development](#development)

<!-- tocstop -->

## How it works

1. A raider signs in with Battle.net.
2. The server reads their WoW characters and matches them against the roster. No match means no access.
3. They paste their `/simc` output. It is mapped to one of their characters and queued.
4. A worker drains the queue against Raidbots' hourly limit and uploads each report to wowaudit.

An admin dashboard shows the queue, who has submitted and when, and holds every setting that used to
live in a config file.

## Requirements

- [Bun](https://bun.sh)
- A wowaudit team API key (team settings -> API)
- A Battle.net API client from [develop.battle.net](https://develop.battle.net)
- A Raidbots account. Premium is strongly recommended: free accounts get 20 submits/hour and the public
  queue, which makes a full roster impractical.

## Setup

Register the redirect URI on your Battle.net client:

```
https://your-host/api/auth/callback/battlenet
```

Create a `.env` (it is gitignored):

```sh
PUBLIC_SITE_URL=https://your-host
BETTER_AUTH_SECRETS=1:$(openssl rand -base64 32)
BNET_CLIENT_ID=...
BNET_CLIENT_SECRET=...
WOWAUDIT_API_KEY=...
RAIDBOTS_EMAIL=...
RAIDBOTS_PASSWORD="..."
```

> **Escape any `$` in your Raidbots password as `\$`.** Bun's `.env` parser expands `$NAME` even inside
> single quotes, so an unescaped `$` silently truncates the password and Raidbots answers
> `401 invalid_credentials` with no hint that the value was mangled.

`BETTER_AUTH_SECRETS` is a comma-separated list of `version:secret` pairs, newest first. It is versioned
from the start because the stored Battle.net tokens are encrypted with it: rotating a bare secret would
orphan every one of them. To rotate, prepend a new pair and keep the old one for decryption.

```sh
just db-migrate   # create the database
just dev          # http://localhost:4321
```

The first officer to sign in gets the dashboard automatically; see [Access](#access).

## Access

There is no user list to manage. Both questions are answered by the roster:

- **Who may submit?** Anyone whose Battle.net account owns a tracked character. wowaudit stores
  `blizzard_id` as `{realmId}-{characterId}`, which is exactly how Blizzard keys a character, so the
  match is by ownership rather than by name. Alts are handled for free.
- **Who is an admin?** Anyone whose character holds one of the configured admin ranks (`GM,Officer` by
  default). Promote someone in game, and they have the dashboard on their next login.

Claims are re-resolved on every sign-in, so a roster change needs no intervention.

## Deployment

One process, one container: the Astro server, the queue worker and the daily sync all share it.

```sh
docker run -d \
  --name=guild-sim \
  --env-file .env \
  -e DATABASE_URL=file:db/prod.db \
  -p 4321:4321 \
  -v ./data/:/app/db/ \
  --restart unless-stopped \
  ghcr.io/adamhl8/guild-sim:latest
```

Migrations run at container start. The SQLite file lives on the mounted volume. `SIGTERM` stops the
server, interrupts any rate-limit wait and lets the in-flight job finish, so give `docker stop` a
generous timeout if a sim is running.

Behind Caddy, nothing extra is needed in the Caddyfile:

```caddyfile
guild-sim.example.com {
	reverse_proxy localhost:4321
}
```

`PUBLIC_SITE_URL` is what makes that work. Better Auth builds the OAuth callback from it, and middleware
uses it as the CSRF origin allowlist.

Astro's own `security.checkOrigin` is deliberately off. It derives from `allowedDomains`, which Astro
bakes into the build manifest, so leaving it on would produce a host-specific image: every form POST
behind any other hostname returns 403. Checking the origin in middleware against the runtime
`PUBLIC_SITE_URL` keeps one image usable on any host.

## Notes on the Raidbots side

Raidbots has an official API, but it only supports `advanced` sims and access is limited to a few high
Patreon tiers, so it cannot drive a droptimizer. This app uses the same endpoints the website itself
uses, authenticating with your account. Be considerate: it respects the per-tier submit limits and
caches Raidbots static data locally, as the maintainer asks.

### Pastes are the input, not the armory

A `/simc` export reflects gear the moment it was taken, including bags, and does not wait for a logout
to propagate. It is sent as the sim's `text` with an empty `armory.name` — Raidbots treats those two as
mutually exclusive, and a non-empty name would silently sim the armory profile instead.

Every paste is stored, which is what lets an admin requeue the whole roster after a patch without
asking anyone to paste again.

### Staleness

A paste is rejected when its WoW build does not match the live one, or when it is older than
`maxPasteAgeDays` (3 by default). Both are dashboard settings.

`buildCheck` defaults to `exact`, which is strict on purpose: it also rejects a paste from before the
last hotfix, since Blizzard ships those most weeks. Set it to `patch` to compare only `12.1.0` and
ignore the build number, or `off` to rely on the age limit alone.

The live build comes from Raidbots' own static metadata via the daily sync, so it needs no maintenance.

### The submit payload is deliberately minimal

Raidbots' own form posts 43 top-level fields; this app posts 16. Everything omitted is defaulted
server-side to exactly what the website sends, so raid buffs, consumables, `enemyType`, `apl` and
friends are left out rather than restated. Verified by simming one character both ways: identical item
list, identical profilesets, identical iteration count, same `Fluffy_Pillow` target, DPS within noise.

Three exceptions:

- `powerInfusion: false` must be sent. wowaudit checks that it can _see_ it disabled, and Raidbots does
  not echo an omitted field, so trimming it produces correct sims that fail on upload. Raidbots-side
  comparison cannot catch this: the sims really are identical.
- `includeConversions` must be sent. Omitting it drops catalyst conversions and shrinks the item list.
- `frontendJsHash`, `gameDataVersion` and a freshly loaded `profileCacheId` are mandatory. A missing or
  stale one is rejected with `400 {"error":"stale_snapshot"}`, so drift here fails loudly.

### Who owns the hourly limit

Raidbots does. It answers an over-quota submit with `{"error": "too_many_sims", "retryAfter": <seconds>}`,
and that is what the worker waits on.

`submitsPerHour` is only a local guard to avoid firing requests that will bounce. It cannot be
authoritative, because it counts sims this app submitted and knows nothing about ones you run in the
browser. When Raidbots overrules it, its `retryAfter` is recorded so the wait survives a restart, and
the submit is retried once.

Quota rejections are deliberately not retried by the HTTP layer: its backoff is capped at two minutes,
which cannot satisfy an hourly wait, and retrying only hammers a service that already said no.

### Sources and upgrade levels

`source` names a Raidbots droptimizer source. The default, `season`, resolves to the current season's
aggregate (`Season 2 Raids`), which covers every raid in the season in a **single sim per raider** and
uploads to all of their wishlists. That is what keeps a full roster inside the hourly limit. Naming one
raid instead narrows it, at the cost of a sim per raid.

wowaudit refuses any report not simmed with **"Upgrade All Equipped Gear to the Same Level"** enabled
and set to **Myth 6/6**. Both are handled automatically. Myth 6/6 is a bonus id that changes every
season, and Raidbots can be a season ahead of wowaudit, so the season is derived from the _instance
being simmed_ rather than from whichever season Raidbots considers active.

### Things that do not work

- **Healing specs.** Raidbots answers `unsupported_spec`, since SimC does not model healing throughput.
  The spec is recorded against the character and later pastes are refused with a clear reason.
- **Non-raid sources.** Mythic+, Delves, Catalyst and PVP are valid Raidbots sources but wowaudit
  rejects them, so only raids are offered. Note wowaudit returns _the same message_ for a report that
  simmed nothing, which makes a failed sim easy to misread as an unsupported source.

### When sims fail on talents

Shortly after a patch or hotfix, SimC's talent data can lag the live game and armory talent hashes fail
to initialize:

```
Error: Initialization error: Player 'X': Selected node 103771 entry 128077 is not available to player's spec.
```

Nothing here fixes that; it clears when SimC catches up, and requeuing picks the affected characters
back up. Switching `simcVersion` to `nightly` does not help.

A sim that fails this way still reports its job as `complete`, so the report is checked for an error and
a non-empty result set before anything is uploaded.

## Development

```sh
just dev          # dev server
just lint         # oxlint, oxfmt, knip, tests
just build        # lint + astro build
just db-migrate   # create a migration
just db-studio    # browse the database
just release      # tag a release and publish the image
```

Tests are `bun test`: pure-function units for the staleness rules, quota maths, roster matching and
payload shape, plus integration tests that run the submit flow against a throwaway SQLite database with
the Raidbots and wowaudit clients stubbed.
