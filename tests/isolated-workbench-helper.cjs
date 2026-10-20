"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { installTestLicense } = require("./license-test-helper.cjs");

// Always use a clean test checkout, even when a production workbench is running.
async function withIsolatedWorkbench(run, options = {}) {
  const root = path.resolve(__dirname, "..");
  const temp = fs.mkdtempSync(path.join(process.env.WORKBENCH_QA_TEMP || os.tmpdir(), "shuzhi-isolated-qa-"));
  let child;
  let recentServerLog="";
  try {
    for (const file of fs.readdirSync(root, { withFileTypes: true })) {
      if (file.isFile() && /\.(?:js|css|html|json)$/.test(file.name) && file.name !== "license-config.json") {
        fs.copyFileSync(path.join(root, file.name), path.join(temp, file.name));
      }
    }
    fs.cpSync(path.join(root, "assets"), path.join(temp, "assets"), { recursive: true });
    if (options.academicWarning) {
      fs.mkdirSync(path.join(temp, "scripts"));
      for (const name of ["generate-academic-warning.ps1", "validate-academic-warning-template.ps1"]) fs.copyFileSync(path.join(root, "scripts", name), path.join(temp, "scripts", name));
    }
    installTestLicense(temp);
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const allocated = probe.address().port;
        probe.close(error => error ? reject(error) : resolve(allocated));
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    async function startServer() {
      let stderr = "";
      child = spawn(process.execPath, [path.join(temp, "web-server.js")], {
        cwd: temp,
        env: { ...process.env, XIANGCAI_PORT: String(port) },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.on("data", data => { recentServerLog=(recentServerLog+data).slice(-6000); });
      child.stderr.on("data", data => { recentServerLog=(recentServerLog+data).slice(-6000); });
      let startupError;
      child.on("error", error => { startupError = error; });
      child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (startupError) throw startupError;
        if (child.exitCode !== null) throw new Error(`isolated workbench exited: ${stderr}`);
        try {
          const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
          const health = await response.json();
          if (response.ok && health.pid === child.pid && health.ok === true) { ready = true; break; }
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error(`isolated workbench did not start: ${stderr}`);
    }
    async function stopServer() {
      if (child && child.exitCode === null && child.pid) {
        await new Promise(resolve => { child.once("exit", resolve); child.kill(); });
      }
    }
    await startServer();
    return await run(origin, { restart: async (prepare) => { await stopServer(); if (prepare) await prepare(temp); await startServer(); } });
  } catch(error) {
    if(recentServerLog) console.error("Isolated server diagnostics:\n"+recentServerLog);
    throw error;
  } finally {
    if (child && child.exitCode === null && child.pid) {
      await new Promise(resolve => { child.once("exit", resolve); child.kill(); });
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { withIsolatedWorkbench };
