# WhiteS Download

Cloudflare Workers-based automatic URL resolver.

## Scope

- Provider Resolver Engine
- HTTP-first resolution
- Cloudflare Browser Run abstraction
- SSRF and redirect validation
- No database
- No user accounts
- No permanent URL history
- No file hosting or file proxying

## Current provider status

Resolver modules are present for the current provider target set, but certification is gated by runtime verification. **Only providers with `meta.enabled: true` are active in the public engine.**

Current certified providers:
- None

Staged, not yet certified:
- SafelinkU / SFL family (including Semawur)
- Linkvertise
- Ouo
- Sfile
- MegaUp
- DropGalaxy
- TeraBox
- DoodStream

Do not treat staged providers as production-supported until their public runtime flow and destination download probe succeed.

## Cloudflare

The project uses a Worker with a Browser Run binding named `BROWSER`.

Local Quick Actions/browser binding development may require remote mode:
`npx wrangler dev --remote`.

## Verification

`npm run typecheck`

`npm test`

The deployment build should use:

- Build command: `npm run typecheck`
- Deploy command: `npx wrangler deploy`
