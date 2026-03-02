/**
 * electron-builder configuration for single-file distribution
 * Supports Windows (portable .exe), macOS (.app), and Linux (AppImage)
 */
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
    'env.js',
    'dist/**/*',
    'node_modules/**/*',
    '!node_modules/@gitlab-dump/core',
    { from: '../lib', to: 'node_modules/@gitlab-dump/core', filter: ['**/*', '!node_modules', '!__tests__'] },
  ],
  // Windows configuration - single portable exe
  win: {
    target: [
      {
        target: 'portable',
        arch: ['x64', 'ia32'],
      },
    ],
    signingHashAlgorithms: ['sha256'],
  },
  portable: {
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },
  // macOS configuration
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
  // Linux configuration - AppImage for universal Linux distribution
  linux: {
    target: ['AppImage'],
    category: 'Utility',
    icon: 'assets/icon.png',
    desktop: {
      Name: 'GitLab Dump',
      Comment: 'Desktop application for GitLab repository management',
      Type: 'Application',
      Categories: 'Development;',
    },
  },
  appImage: {
    artifactName: '${productName}-${version}.${ext}',
  },
  // Build configuration
  buildDependenciesFromSource: false,
  nodeGypRebuild: false,
  asar: true,
};
