const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const desktop = __dirname;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlab-dev-server-'));
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const entry = path.join(temporary, 'entry.js');
  const configuration = path.join(temporary, 'webpack.config.cjs');
  const staticName = `${path.basename(temporary)}.txt`;
  const staticFile = path.join(desktop, 'dist', staticName);
  await fs.mkdir(path.dirname(staticFile), { recursive: true });
  await fs.writeFile(staticFile, 'STATIC_SMOKE_OK');
  const source = marker => `import ${JSON.stringify(path.join(desktop, 'src/index.js'))};\nconsole.log(${JSON.stringify(marker)});\n`;
  await fs.writeFile(entry, source('WATCH_BEFORE'));
  await fs.writeFile(configuration, `const original = require(${JSON.stringify(path.join(desktop, 'webpack.config.js'))});\nmodule.exports = {...original, entry:${JSON.stringify(entry)}, output:{...original.output,path:${JSON.stringify(path.join(temporary,'dist'))}}, devServer:{...original.devServer,host:'127.0.0.1',port:${port}}};\n`);
  const cli = require.resolve('webpack-cli/bin/cli.js', { paths: [desktop] });
  const child = spawn(process.execPath, [cli, 'serve', '--config', configuration, '--mode', 'development'], {cwd:desktop,stdio:['ignore','pipe','pipe']});
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  let websocket;
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i=0;i<120;i++) {
      if(child.exitCode !== null) throw new Error(`Dev server exited: ${logs.slice(-2000)}`);
      try { const r=await fetch(base, {signal:AbortSignal.timeout(1000)}); if(r.ok && (await r.text()).includes('bundle.js')) {ready=true;break;} } catch {}
      await sleep(500);
    }
    assert(ready, `HTTP server failed: ${logs.slice(-2000)}`);
    assert.equal(await (await fetch(`${base}/${staticName}`, {signal:AbortSignal.timeout(10000)})).text(), 'STATIC_SMOKE_OK');
    assert((await (await fetch(`${base}/bundle.js`, {signal:AbortSignal.timeout(10000)})).text()).includes('WATCH_BEFORE'));
    const messages = [];
    const WebSocket = require(require.resolve('ws', { paths: [desktop] }));
    websocket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {origin:base});
    websocket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
    await new Promise((resolve,reject) => {websocket.addEventListener('open',resolve,{once:true});websocket.addEventListener('error',reject,{once:true});setTimeout(()=>reject(new Error('WebSocket timeout')),10000).unref();});
    for(let i=0;i<30 && !messages.some(m=>m.type==='ok');i++) await sleep(200);
    assert(messages.some(m=>m.type==='hot'));
    assert(messages.some(m=>m.type==='ok'));
    messages.length=0;
    await fs.writeFile(entry, source('WATCH_AFTER'));
    for(let i=0;i<120 && !messages.some(m=>m.type==='ok');i++) await sleep(250);
    assert(messages.some(m=>m.type==='invalid'));
    assert(messages.some(m=>m.type==='hash'));
    assert(messages.some(m=>m.type==='ok'));
    assert((await (await fetch(`${base}/bundle.js`, {signal:AbortSignal.timeout(10000)})).text()).includes('WATCH_AFTER'));
    console.log('PASS: actual renderer HTTP, static assets, WebSocket hot mode, file watch and rebuilt bundle');
  } finally {
    websocket?.close();
    child.kill('SIGTERM');
    await new Promise(resolve=>{if(child.exitCode!==null)resolve();else {child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();}});
    await fs.rm(staticFile,{force:true});
    await fs.rm(temporary,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
