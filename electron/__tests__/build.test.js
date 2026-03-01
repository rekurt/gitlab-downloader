const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const electronDir = path.resolve(__dirname, '..');

describe('Webpack build', () => {
  test('production build succeeds without errors', () => {
    const result = execFileSync('npx', ['webpack', '--mode', 'production'], {
      cwd: electronDir,
      encoding: 'utf-8',
      timeout: 120000,
    });
    expect(result).toContain('compiled successfully');
  });

  test('production build generates bundle.js', () => {
    const bundlePath = path.join(electronDir, 'dist', 'bundle.js');
    expect(fs.existsSync(bundlePath)).toBe(true);
    const stats = fs.statSync(bundlePath);
    expect(stats.size).toBeGreaterThan(0);
  });

  test('production build generates index.html', () => {
    const htmlPath = path.join(electronDir, 'dist', 'index.html');
    expect(fs.existsSync(htmlPath)).toBe(true);
  });
});
