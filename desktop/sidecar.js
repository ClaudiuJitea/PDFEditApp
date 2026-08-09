const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

class SidecarManager {
  constructor({ isDev, userDataDir, resourcesPath, appPath }) {
    this.isDev = isDev;
    this.userDataDir = userDataDir;
    this.resourcesPath = resourcesPath;
    this.appPath = appPath;
    this.process = null;
    this.port = null;
    this.authToken = '';
    this.host = '127.0.0.1';
  }

  async start() {
    this.port = await this._findFreePort();
    const env = {
      ...process.env,
      PDFEDIT_DATA_DIR: this.userDataDir,
      PDFEDIT_HOST: this.host,
      PDFEDIT_PORT: String(this.port),
      PDFEDIT_DEBUG: this.isDev ? '1' : '0',
    };

    const nativeTools = this._nativeToolsDir();
    if (nativeTools) {
      const openssl = this._findBinary(nativeTools, 'openssl');
      const tesseract = this._findBinary(nativeTools, 'tesseract');
      const tessdata = path.join(nativeTools, 'tessdata');
      if (openssl) env.PDFEDIT_OPENSSL_PATH = openssl;
      if (tesseract) env.PDFEDIT_TESSERACT_CMD = tesseract;
      if (fs.existsSync(tessdata)) env.PDFEDIT_TESSDATA_PREFIX = tessdata;
    }

    const { command, args, cwd } = this._resolveSidecarCommand(env);
    this.process = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stderr.on('data', (chunk) => {
      process.stderr.write(`[sidecar] ${chunk}`);
    });

    const bootstrap = await this._waitForBootstrap();
    this.authToken = bootstrap.auth_token;
    await this._waitForHealth();
    return {
      host: this.host,
      port: this.port,
      authToken: this.authToken,
      url: `http://${this.host}:${this.port}/`,
    };
  }

  async stop() {
    if (!this.process) return;
    const proc = this.process;
    this.process = null;
    proc.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (_) {
          /* ignore */
        }
        resolve();
      }, 5000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  _resolveSidecarCommand(env) {
    if (this.isDev) {
      const backendDir = path.join(this.appPath, 'backend');
      const python = process.env.PDFEDIT_PYTHON || 'python3';
      return {
        command: python,
        args: ['server_entry.py'],
        cwd: backendDir,
      };
    }

    const binaryName = process.platform === 'win32' ? 'pdfedit-sidecar.exe' : 'pdfedit-sidecar';
    const candidates = [
      path.join(this.resourcesPath, 'sidecar', binaryName),
      path.join(this.resourcesPath, 'sidecar', 'pdfedit-sidecar', binaryName),
    ];
    const binaryPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!binaryPath) {
      throw new Error(`Sidecar binary not found in packaged resources`);
    }
    return {
      command: binaryPath,
      args: [],
      cwd: path.dirname(binaryPath),
    };
  }

  _nativeToolsDir() {
    if (this.isDev) {
      const devTools = path.join(this.appPath, 'build', 'native-tools', process.platform);
      return fs.existsSync(devTools) ? devTools : null;
    }
    const packaged = path.join(this.resourcesPath, 'native-tools', process.platform);
    return fs.existsSync(packaged) ? packaged : null;
  }

  _findBinary(dir, name) {
    const candidates = [
      path.join(dir, name),
      path.join(dir, `${name}.exe`),
      path.join(dir, 'bin', name),
      path.join(dir, 'bin', `${name}.exe`),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  _findFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, this.host, () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolve(port));
      });
    });
  }

  _waitForBootstrap() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sidecar bootstrap timed out')), 30000);
      const onData = (chunk) => {
        const text = chunk.toString();
        const match = text.match(/PDFEDIT_BOOTSTRAP\s+(\{.*\})/);
        if (!match) return;
        clearTimeout(timeout);
        this.process.stdout.off('data', onData);
        try {
          resolve(JSON.parse(match[1]));
        } catch (error) {
          reject(error);
        }
      };
      this.process.stdout.on('data', onData);
      this.process.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Sidecar exited before bootstrap (code ${code})`));
      });
    });
  }

  _waitForHealth() {
    const url = `http://${this.host}:${this.port}/api/health`;
    const deadline = Date.now() + 30000;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const req = http.get(url, (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          retry();
        });
        req.on('error', retry);
        req.setTimeout(2000, () => {
          req.destroy();
          retry();
        });
      };
      const retry = () => {
        if (Date.now() > deadline) {
          reject(new Error('Sidecar health check timed out'));
          return;
        }
        setTimeout(attempt, 250);
      };
      attempt();
    });
  }
}

module.exports = { SidecarManager };
