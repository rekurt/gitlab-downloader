# @gitlab-dump/core

GitLab repository downloading and migration primitives used by GitLab Dump.
Requires Node.js 24 and Git for Git operations.

```bash
npm install @gitlab-dump/core
```

```js
import { parseConfig, redactSecrets } from '@gitlab-dump/core';
```

Includes schema validation, planning, Direct Transfer, conservative Git sync,
OAuth device flow, repository discovery, and history rewrite functions.
Git sync never deletes refs or force-pushes. History rewrite requires
`git-filter-repo` and explicit confirmation. LFS transfers require `git-lfs`.

See the [full documentation](https://github.com/rekurt/gitlab-downloader#readme)
for APIs, credentials, compatibility requirements, and operational safeguards.

Licensed under MIT; see LICENSE.
