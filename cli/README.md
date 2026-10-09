# gitlab-dump-cli

Clone repositories and perform conservative transfers between GitLab instances.
Requires Node.js 24 and Git. LFS needs `git-lfs`; history rewrite needs
`git-filter-repo`.

```bash
npm install -g gitlab-dump-cli
gitlab-dump --help
gitlab-dump --version
```

Commands: `clone`, `transfer plan`, `transfer run`, `transfer status`,
`transfer cancel`, and `rewrite-history`. Use `--help` for each command.

PATs are accepted through `GITLAB_TOKEN`, `GITLAB_SOURCE_TOKEN`,
`GITLAB_DESTINATION_TOKEN`, or a masked interactive prompt. Tokens must never
be passed in command arguments or clone URLs.

Git sync fast-forwards only, leaves divergent refs unchanged, and never deletes
refs or force-pushes. History rewrite requires explicit confirmation.

See the [full documentation](https://github.com/rekurt/gitlab-downloader#cli)
for examples, compatibility, reports, exit codes, and credential rules.

Licensed under MIT; see LICENSE.
