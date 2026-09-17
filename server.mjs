import http from "node:http";
import { loadConfig, saveNames } from "./config.mjs";
import { Bridge } from "./bridge.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile),
  root = fileURLToPath(new URL(".", import.meta.url));
const codes = {
  up: 19,
  down: 20,
  left: 21,
  right: 22,
  ok: 23,
  back: 4,
  home: 3,
  menu: 82,
  play: 85,
  volumeUp: 24,
  volumeDown: 25,
  mute: 164,
  delete: 67,
  enter: 66,
};
const apps = {
  vlc: "org.videolan.vlc/org.videolan.vlc.gui.MainActivity",
  cast: "com.tcl.MultiScreenInteraction_TV/com.tcl.tcast.ui.activity.MainActivity",
};
export function command(
  body,
  { screenWidth = 1920, screenHeight = 1080 } = {},
) {
  const n = (v) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  const pt = (x, y) => [
    Math.round(x * (screenWidth - 1)),
    Math.round(y * (screenHeight - 1)),
  ];
  if (body.type === "key" && Object.hasOwn(codes, body.key))
    return ["shell", "input", "keyevent", String(codes[body.key])];
  if (body.type === "tap" && n(body.x) && n(body.y))
    return ["shell", "input", "tap", ...pt(body.x, body.y).map(String)];
  if (body.type === "swipe" && [body.x, body.y, body.toX, body.toY].every(n))
    return [
      "shell",
      "input",
      "swipe",
      ...pt(body.x, body.y).map(String),
      ...pt(body.toX, body.toY).map(String),
      "300",
    ];
  if (
    body.type === "text" &&
    typeof body.text === "string" &&
    body.text.length > 0 &&
    body.text.length <= 300 &&
    /^[\x20-\x7E]+$/.test(body.text) &&
    !body.text.includes("%")
  ) {
    const value = body.text.replaceAll(" ", "%s").replaceAll("'", "'\\''");
    return ["shell", "input text '" + value + "'"];
  }
  if (body.type === "app" && Object.hasOwn(apps, body.app))
    return ["shell", "am", "start", "-n", apps[body.app]];
  throw new Error(
    "Choose a valid control. Text supports English letters and symbols, except %.",
  );
}
export function createRemote({
  token,
  host = "127.0.0.1",
  port = 8765,
  run,
  bridge,
  config = {},
  persistNames = async () => {},
}) {
  let chain = Promise.resolve(),
    pending = 0,
    lastShot = 0,
    shot = null;
  const queue = (fn) => {
    if (pending >= 10) throw new Error("Please wait for the previous command.");
    pending++;
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p.finally(() => pending--);
  };
  const same = (a, b) =>
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const json = (res, status, value) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  return http.createServer(async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'",
      );
      const allowed = [
        `${host}:${port}`,
        `localhost:${port}`,
        `127.0.0.1:${port}`,
      ];
      if (!allowed.includes(req.headers.host))
        return json(res, 403, { error: "Unrecognized host" });
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`
      )
        return json(res, 403, { error: "Use the local remote page" });
      const path = new URL(req.url, `http://${req.headers.host}`).pathname;
      let body = {};
      if (req.method === "POST") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 4096)
            return json(res, 413, { error: "Request too large" });
        }
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          return json(res, 400, { error: "Invalid request" });
        }
      }
      if (path === "/api/pair" && req.method === "POST") {
        if (typeof body.token !== "string" || !same(body.token, token))
          return json(res, 403, {
            error: "Open the pairing link from your Mac.",
          });
        res.setHeader(
          "Set-Cookie",
          `remote=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
        );
        return json(res, 200, { ok: true });
      }
      if (path.startsWith("/api/")) {
        const cookie =
          (req.headers.cookie || "")
            .split(";")
            .map((x) => x.trim())
            .find((x) => x.startsWith("remote="))
            ?.slice(7) || "";
        if (!same(cookie, token))
          return json(res, 401, {
            error: "Open your pairing link to connect.",
          });
        if (path === "/api/settings" && req.method === "GET")
          return json(res, 200, {
            tvName: config.tvName || "MY TV",
            roomName: config.roomName || "Living room",
          });
        if (path === "/api/settings" && req.method === "POST") {
          const names = {};
          for (const key of ["tvName", "roomName"]) {
            if (
              typeof body[key] !== "string" ||
              !body[key].trim() ||
              body[key].trim().length > 60
            )
              return json(res, 400, {
                error: "Names must be between 1 and 60 characters.",
              });
            names[key] = body[key].trim();
          }
          await persistNames(names);
          Object.assign(config, names);
          return json(res, 200, names);
        }
        if (path === "/api/status" && req.method === "GET") {
          if (bridge)
            return json(res, 200, {
              connected: bridge.ready,
              stream: true,
              frames: bridge.frames,
              lastFrame: bridge.lastFrame,
            });
          const r = await run(["get-state"]);
          return json(res, 200, {
            connected: String(r.stdout).trim() === "device",
          });
        }
        if (path === "/api/stream" && req.method === "GET" && bridge)
          return bridge.stream(req, res);
        if (path === "/api/screen" && req.method === "GET") {
          if (!shot || Date.now() - lastShot > 1800) {
            const r = await run(["exec-out", "screencap", "-p"], true);
            shot = r.stdout;
            lastShot = Date.now();
            if (shot[0] !== 137)
              throw new Error("The TV screen is unavailable.");
          }
          res.writeHead(200, { "Content-Type": "image/png" });
          return res.end(shot);
        }
        if (path === "/api/control" && req.method === "POST") {
          let args;
          try {
            args = command(body, config);
          } catch (e) {
            return json(res, 400, { error: e.message });
          }
          await queue(() => (bridge ? bridge.input(body, args) : run(args)));
          lastShot = 0;
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: "Not found" });
      }
      const files = {
        "/": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
        "/icon.svg": "icon.svg",
        "/manifest.json": "manifest.json",
        "/player": "player.html",
        "/player.html": "player.html",
        "/player.js": "player.js",
        "/player.css": "player.css",
        "/vendor/three.module.js": "vendor/three.module.js",
      };
      if (req.method !== "GET" || !files[path])
        return json(res, 404, { error: "Not found" });
      const types = {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
        svg: "image/svg+xml",
        json: "application/json",
      };
      res.setHeader("Content-Type", types[files[path].split(".").pop()]);
      res.end(await readFile(root + "public/" + files[path]));
    } catch (e) {
      json(res, 503, {
        error: e.message?.includes("Choose a valid")
          ? e.message
          : "TV unavailable. Check that the TV and Mac are on, on the same Wi-Fi, and ADB is connected.",
      });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(root + ".local", { recursive: true });
  let token;
  try {
    token = (await readFile(root + ".local/token", "utf8")).trim();
  } catch {
    token = randomBytes(32).toString("hex");
    await writeFile(root + ".local/token", token, { mode: 0o600 });
  }
  const config = await loadConfig(root),
    { host, port, adb, device } = config;
  if (!device || !config.scrcpyServer)
    throw new Error(
      "Set device and scrcpyServer in .local/config.json. See README.md.",
    );
  const run = async (args, binary = false) =>
    exec(adb, ["-s", device, ...args], {
      timeout: 12000,
      maxBuffer: 12 * 1024 * 1024,
      encoding: binary ? "buffer" : "utf8",
    });
  const bridge = new Bridge(run, config);
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => {
      bridge.stop();
      process.exit(0);
    });
  createRemote({
    token,
    host,
    port,
    run,
    bridge,
    config,
    persistNames: (names) => saveNames(root, names),
  }).listen(port, host === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0", () =>
    console.log(`Remote ready: http://${host}:${port}/#${token}`),
  );
}
