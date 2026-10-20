"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");

async function main(origin) {
  const modules = [process.env.CODEX_NODE_MODULES, path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules")].filter(Boolean);
  const playwright = modules.map(dir => path.join(dir, "playwright")).find(dir => fs.existsSync(dir));
  assert.ok(playwright, "Playwright is unavailable");
  const executablePath = [process.env.EDGE_PATH, process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"), process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")].find(file => file && fs.existsSync(file));
  assert.ok(executablePath, "Edge is unavailable");
  const browser = await require(playwright).chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    for (const name of ["academic-summary-tool", "academic-analysis-tool", "excel-merge-tool", "excel-check-tool", "data-match-tool"]) {
      const errors = [], consoleErrors = [];
      const onError = error => errors.push(error.message);
      const onConsole = message => { if (message.type() === "error") consoleErrors.push(message.text() + " " + message.location().url); };
      page.on("pageerror", onError);
      page.on("console", onConsole);
      const response = await page.goto(`${origin}/assets/${name}.html`, { waitUntil: "networkidle" });
      assert.strictEqual(response.status(), 200, name);
      const csp = response.headers()["content-security-policy"];
      assert.match(csp, /(?:^|;\s*)script-src 'self';/);
      assert.match(csp, /script-src-attr 'none'/);
      assert.strictEqual(await page.evaluate(() => typeof window.XLSX), "object", `${name}: external scripts must load`);
      assert.deepStrictEqual(errors, [], `${name}: runtime errors`);
      assert.deepStrictEqual(consoleErrors, [], `${name}: load/CSP errors`);
      page.off("console", onConsole); // The following two CSP violations are expected.
      await page.evaluate(() => {
        window.__qaViolations = [];
        document.addEventListener("securitypolicyviolation", event => window.__qaViolations.push(event.effectiveDirective));
        const script = document.createElement("script");
        script.textContent = "window.__qaInlineScriptExecuted = true";
        document.body.appendChild(script);
        const button = document.createElement("button");
        button.setAttribute("onclick", "window.__qaInlineHandlerExecuted = true");
        document.body.appendChild(button);
        button.click();
        button.remove();
      });
      await page.waitForFunction(() => window.__qaViolations.includes("script-src-elem") && window.__qaViolations.includes("script-src-attr"));
      assert.deepStrictEqual(await page.evaluate(() => [window.__qaInlineScriptExecuted === true, window.__qaInlineHandlerExecuted === true]), [false, false], `${name}: injected inline code must be blocked`);
      assert.deepStrictEqual(errors, [], name);
      page.off("pageerror", onError);
    }
    console.log("qa-tool-csp: passed (5 tools load normally; injected scripts and HTML handlers blocked)");
  } finally {
    await browser.close();
  }
}

withIsolatedWorkbench(main).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
