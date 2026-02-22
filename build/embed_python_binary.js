#!/usr/bin/env node
/**
 * Script to embed Python binary into Electron app
 * This is called as part of the build process
 */
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { execSync } = require('child_process');

const PYTHON_BINARY_DIR = path.join(__dirname, '..', 'electron', 'python_binary');
const BUILD_DIR = path.join(__dirname, '..', 'build');

/**
 * Get platform-specific Python executable path
 */
function getPythonExecutablePath() {
  const pythonBuildDir = path.join(BUILD_DIR, 'python_dist');
  if (!fs.existsSync(pythonBuildDir)) {
    throw new Error(
      `Python build directory not found: ${pythonBuildDir}\n` +
      'Run: python build/create_python_binary.py first'
    );
  }

  const platform = os.platform();
  if (platform === 'win32') {
    return path.join(pythonBuildDir, 'api-server', 'api-server.exe');
  } else if (platform === 'darwin') {
    return path.join(pythonBuildDir, 'api-server', 'api-server');
  } else {
    // Linux
    return path.join(pythonBuildDir, 'api-server', 'api-server');
  }
}

/**
 * Embed Python binary into electron package
 */
async function embedPythonBinary() {
  try {
    console.log('Preparing Python binary for embedding...');

    // Create destination directory
    if (fs.existsSync(PYTHON_BINARY_DIR)) {
      fs.removeSync(PYTHON_BINARY_DIR);
    }
    fs.ensureDirSync(PYTHON_BINARY_DIR);

    // Get the Python executable path
    const pythonExe = getPythonExecutablePath();
    if (!fs.existsSync(pythonExe)) {
      throw new Error(
        `Python executable not found: ${pythonExe}\n` +
        'Make sure to build the Python binary first'
      );
    }

    // Copy Python binary to embedding location
    const platform = os.platform();
    let destName = 'python';
    if (platform === 'win32') {
      destName = 'python.exe';
    }

    const destPath = path.join(PYTHON_BINARY_DIR, destName);
    console.log(`Copying Python binary from ${pythonExe} to ${destPath}`);
    fs.copySync(pythonExe, destPath);

    // Make executable on Unix-like systems
    if (platform !== 'win32') {
      fs.chmodSync(destPath, '0755');
    }

    console.log('Python binary embedded successfully');
    return true;
  } catch (error) {
    console.error('Failed to embed Python binary:', error.message);
    process.exit(1);
  }
}

/**
 * Verify embedded binary
 */
function verifyBinary() {
  try {
    const platform = os.platform();
    let binaryName = 'python';
    if (platform === 'win32') {
      binaryName = 'python.exe';
    }

    const binaryPath = path.join(PYTHON_BINARY_DIR, binaryName);
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Embedded binary not found: ${binaryPath}`);
    }

    // Check file size to ensure it's a real binary
    const stats = fs.statSync(binaryPath);
    if (stats.size < 1000000) {
      // Less than 1MB is suspicious for a Python binary
      throw new Error(
        `Embedded binary seems too small (${stats.size} bytes)`
      );
    }

    console.log(`✓ Verified embedded binary (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    return true;
  } catch (error) {
    console.error('Failed to verify binary:', error.message);
    process.exit(1);
  }
}

// Run embedding process
if (require.main === module) {
  embedPythonBinary()
    .then(() => {
      verifyBinary();
      console.log('Embedding complete!');
    })
    .catch((error) => {
      console.error('Embedding failed:', error);
      process.exit(1);
    });
}

module.exports = { embedPythonBinary, verifyBinary };
