module.exports = {
  appId: 'com.gitlabdump.app',
  productName: 'GitLab Dump',
  directories: {
    output: 'dist_electron',
    buildResources: 'assets',
  },
  files: [
    'main.js',
    'preload.js',
    'ipc-handlers.js',
    'operation-registry.js',
    'window-security.js',
    'dist/**/*',
    '!node_modules/@gitlab-dump/core/**/*',
    {
      from: '../lib',
      to: 'node_modules/@gitlab-dump/core',
      filter: [
        '**/*',
        '!node_modules/**/*',
        '!__tests__/**/*',
        '!coverage/**/*',
        '!jest.config.js',
        '!eslint.config.js',
      ],
    },
  ],
  // Windows configuration - single portable exe
  win: {
    icon: 'assets/icon.png',
    target: [
      {
        target: 'portable',
        arch: ['x64'],
      },
    ],
  },
  portable: {
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.utilities',
    icon: 'assets/icon.icns',
    identity: process.env.MAC_IDENTITY || undefined,
    notarize: process.env.MAC_NOTARIZE === 'true'
      ? {
        teamId: process.env.APPLE_TEAM_ID,
      }
      : false,
  },
  dmg: {
    artifactName: '${productName}-${version}.${ext}',
    contents: [
      {
        x: 110,
        y: 150,
        type: 'file',
      },
      {
        x: 240,
        y: 150,
        type: 'link',
        path: '/Applications',
      },
    ],
  },
  linux: {
    target: ['AppImage'],
    category: 'Utility',
    icon: 'assets/icon.png',
    description: 'Conservative GitLab repository transfer tool',
  },
  appImage: {
    artifactName: '${productName}-${version}.${ext}',
  },
  buildDependenciesFromSource: false,
  nodeGypRebuild: false,
  asar: true,
};
