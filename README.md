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

Sfile.mobi is implemented as **v0.1 / not live-verified**. Do not treat it as production-supported until a real public test URL succeeds.

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
