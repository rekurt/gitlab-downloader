/**
 * electron-builder configuration for single-file distribution
 * Supports Windows (portable .exe), macOS (.app), and Linux (AppImage)
 */
const path = require('path');
const os = require('os');

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
    'dist/**/*',
    'node_modules/**/*',
    {
      from: 'python_binary',
      to: 'python',
      filter: ['**/*'],
    },
  ],
  // Windows configuration - single portable exe
  win: {
    target: [
      {
        target: 'portable',
        arch: ['x64', 'ia32'],
      },
    ],
    certificateFile: process.env.WIN_CERT_FILE || undefined,
    certificatePassword: process.env.WIN_CERT_PASSWORD || undefined,
    signingHashAlgorithms: ['sha256'],
  },
  portable: {
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  },
  // macOS configuration - app bundle with embedded binary
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.utilities',
    icon: 'assets/icon.icns',
    certificateFile: process.env.MAC_CERT_FILE || undefined,
    certificatePassword: process.env.MAC_CERT_PASSWORD || undefined,
    identity: process.env.MAC_IDENTITY || undefined,
    notarize: process.env.MAC_NOTARIZE === 'true'
      ? {
        teamId: process.env.APPLE_TEAM_ID,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_ID_PASSWORD,
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
