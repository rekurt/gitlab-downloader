# Desktop and development dependency audit — 2026-10-09

Scope: desktop runtime, developer server, tests, and packaging. Follow-up to the npm release; core/CLI versions and published artifacts remain unchanged.

## Results

Full npm audit: 36 affected dependency entries before (28 moderate, 6 high, 2 critical), 33 after (28 moderate, 5 high, 0 critical). These are affected packages, not independent vulnerabilities: five distinct root advisories initially, three remaining. The install summary reported 24, but the subsequent standalone audit reports 33; use the latter for acceptance. Production-only audit reports zero. Electron is a devDependency but its binary ships in the desktop application; production-only audit does not cover that runtime.

## Compatible fixes

| Advisory | Change | Reachability |
| --- | --- | --- |
| [GHSA-qmv3-fv6v-rmhq](https://github.com/advisories/GHSA-qmv3-fv6v-rmhq), sandboxed preload cache poisoning | Electron 43.4.1 → 43.7.9; same major, patch starts at 43.5.0 | Requires compromised renderer and untrusted content. Packaged app loads local HTML, denies additional windows/other navigation, enables sandbox/context isolation. This reduces exposure but cannot rule out renderer compromise; update shipped runtime. |
| [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), command injection | concurrently 10.0.5 → 10.0.6, shell-quote 1.9.0 → 1.12.0; patch starts at 1.11.0 | Development start/dev run fixed npm commands. No application input enters concurrently. Advisory requires an attacker-controlled line terminator after a comment token in quote(). Update rather than depending on this usage restriction. |

No audit fix --force, major overrides, credential/protection changes, or npm publication.

## Remaining advisories and follow-up plan

| Root advisory | Paths and risk | Resolution and impact |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), braces stack exhaustion | webpack-dev-server → chokidar → braces; dev-server → http-proxy-middleware → micromatch → braces. Developer server, not packaged app/public core/CLI. Config serves static dist on port 8000 with no custom proxy/glob input from GitLab. Malicious nested patterns need to reach matcher; no application path located. This is not proof of safety for exposed servers or untrusted repositories. | No patched braces version (latest 3.0.3). Separately migrate dev-server 5.2.6 → 6.0.0, whose dependencies remove these chains. Required Node >=22.15 / webpack >=5.101 already met. Verify webpack-cli serve, HTTP/static assets, WebSocket hot reload, file watching, Electron dev startup. Express 5, proxy middleware 4, removed SockJS and changed middleware APIs require regression; [official migration details](https://github.com/webpack/webpack-dev-server/releases/tag/v6.0.0). No custom proxy/SockJS/middleware APIs here. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), UUID buffer bounds | dev-server → sockjs → uuid 8.3.2. SockJS lib/transport.js only calls uuid.v4() without a buffer. Advisory affects v3/v5/v6 output buffers; located call does not exercise it. Absent from public package/desktop production trees. | Blind uuid 8 → 11 override crosses majors/consumer range. Prefer dev-server 6 migration removing SockJS; verify HTTP/WebSocket behavior instead of forcing transitive versions. |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), sprintf precision DoS | Jest/Babel coverage → load-nyc-config → js-yaml 3 → argparse 1 → sprintf-js; electron-builder → app-builder-lib → @electron/get → global-agent → roarr → sprintf-js. Requires attacker-controlled format precision. Argparse help/error templates and global-agent logging are tooling paths; no GitLab input path to format strings found. Build/test/config code already executes; use trusted sources. | No patched sprintf-js version (latest 1.1.3). Audit suggests Jest 25/globals 27 and electron-builder 26.5.0 downgrades, not safe forward repair. Keep toolchains. Track nyc loader using js-yaml 4/argparse 2 and downloader/logger without affected sprintf-js. Scoped roarr 3/js-yaml 4 overrides cross supported ranges: test logging/proxy downloads, coverage config and three-OS packaging before adoption. Do not suppress advisory or force overrides. |

## Validation

Results recorded in PR: lint, complete core/CLI/desktop coverage regression, production build, unsigned unpacked macOS app using Electron 43.7.9, production audit. CI checks unpacked apps on Linux/macOS/Windows. Packages are JavaScript with no typecheck script.
