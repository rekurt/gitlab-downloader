# Desktop development server migration — 2026-10-09

Follow-up to [the initial dependency audit](dev-dependency-audit-2026-10-09.md). Public core/CLI package versions and registry artifacts are unchanged.

## Changes

- webpack-dev-server 5.2.6 → 6.0.0; webpack-cli 6.0.1 → 7.2.3. The CLI explicitly supports server 6, and the existing Node 24 / webpack 5.109.2 satisfy both packages' requirements. See the [official migration notes](https://github.com/webpack/webpack-dev-server/releases/tag/v6.0.0).
- Pin js-yaml 5.4.3 as a desktop development dependency to satisfy webpack-cli's optional `^4 || ^5` peer. Jest's older js-yaml remains confined to its own dependency tree. Clean `npm ci` and `npm ls --all` report no invalid peers.
- Invoke `webpack-cli` directly for build/serve and resolve its local binary in the build test. The old webpack launcher could not find a CLI nested inside the workspace and offered an interactive installation. The existing build test exposed that failure before the fix; no network-based npx resolution is needed by the test.
- Add a CI dev-server smoke check: real renderer HTML/bundle, static assets, same-origin WebSocket hot mode, file watching and rebuilt bundle. Temporary source wrappers and static fixtures are removed, and the child server is stopped. Existing application source and dev-server host/origin policy remain unchanged.

## Audit outcome and limits

Standalone full npm audit decreases from 33 affected entries (28 moderate, 5 high) to 31 (26 moderate, 5 high); zero critical. Production-only audit remains zero. Counts include transitive affected packages and are not independent advisories.

SockJS and its uuid dependency are removed, closing the UUID advisory chain. The earlier proposal overstated the effect on braces: server 6 removes the old chokidar chain, but http-proxy-middleware 4.2.0 still depends on micromatch 4.0.8 → braces 3.0.3. Therefore [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) remains, including other tooling paths. [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) for sprintf-js remains in Jest/Babel coverage and Electron packaging/download tooling. Neither has a patched version available in the audited dependency tree. No forced major overrides, toolchain downgrades or advisory suppression were applied.

The packaged Electron runtime is still 43.7.9. This migration changes developer tooling; production-only audit does not by itself establish the safety of the desktop runtime or an exposed development server.

## Verification

Clean npm ci; lint; all 284 core/CLI/desktop tests with coverage gates; production build; HTTP/static/WebSocket/watch smoke; unsigned unpacked macOS arm64 packaging; production audit. CI additionally runs unpacked packaging on Linux, macOS and Windows. Exact commit/run results are recorded in the pull request.
