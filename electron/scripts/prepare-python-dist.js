const path = require('path');
const os = require('os');
const fs = require('fs-extra');

const buildRoot = path.resolve(__dirname, '../../build');
const distRoot = path.join(buildRoot, 'dist');
const pythonDistRoot = path.join(buildRoot, 'python_dist');
const apiTargetDir = path.join(pythonDistRoot, 'api-server');

function getSourceBinaryPath() {
  const platform = os.platform();

  if (platform === 'win32') {
    return path.join(distRoot, 'api-server.exe');
  }

  if (platform === 'darwin') {
    return path.join(distRoot, 'api-server.app', 'Contents', 'MacOS', 'api-server');
  }

  return path.join(distRoot, 'api-server');
}

function getTargetBinaryPath() {
  return path.join(apiTargetDir, os.platform() === 'win32' ? 'api-server.exe' : 'api-server');
}

function main() {
  const sourceBinary = getSourceBinaryPath();
  const targetBinary = getTargetBinaryPath();

  if (!fs.existsSync(sourceBinary)) {
    throw new Error(`Python binary not found: ${sourceBinary}`);
  }

  fs.removeSync(pythonDistRoot);
  fs.ensureDirSync(apiTargetDir);
  fs.copySync(sourceBinary, targetBinary);

  if (os.platform() !== 'win32') {
    fs.chmodSync(targetBinary, '0755');
  }

  console.log(`Prepared python_dist binary: ${targetBinary}`);
}

main();
