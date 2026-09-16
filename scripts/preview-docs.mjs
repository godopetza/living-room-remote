// Isolated documentation preview. Never connects to ADB or reads local settings.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const frame = (mode, cls) =>
  `<div class="phone ${cls}"><iframe title="${mode} preview" src="/demo?mode=${mode}"></iframe></div>`;
const hero = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#121816;color:#f3f1e9;font-family:'Avenir Next',sans-serif}.canvas{width:1280px;height:720px;position:relative;overflow:hidden;padding:58px;background:radial-gradient(ellipse at 95% 100%,#34482e,transparent 65%),#121816}.brand{display:flex;align-items:center;gap:14px;color:#dbeaac;font-size:15px;letter-spacing:3px}.brand img{width:40px;height:40px}h1{font-size:67px;font-weight:500;letter-spacing:-3px;line-height:1.05;margin:58px 0 22px;width:570px}p{font-size:21px;line-height:1.5;color:#aebbb0;width:440px}.tags{display:flex;gap:12px;margin-top:30px}.tags span{border:1px solid #48553e;border-radius:20px;padding:9px 15px;color:#dbeaac;font-size:13px}.foot{position:absolute;bottom:42px;left:58px;font-size:13px;color:#aebbb0}.phone{position:absolute;width:390px;height:844px;overflow:hidden;border-radius:34px;border:7px solid #52624d;background:#121816;box-shadow:0 18px 50px #0005;transform-origin:top left}.phone iframe{border:0;width:390px;height:844px;transform:translate(-7px,-7px)}.first{left:649px;top:54px;transform:scale(.61)}.second{left:913px;top:131px;transform:scale(.61)}.canvas:after{content:'LOCAL • OPEN SOURCE';position:absolute;right:42px;top:32px;font-size:10px;letter-spacing:2px;color:#adbaa5}</style></head><body><div class="canvas"><div class="brand"><img src="/icon.svg">LIVING ROOM REMOTE</div><h1>Your TV.<br>Within reach.</h1><p>A live view and a touch remote.<br>Right in your phone’s browser.</p><div class="tags"><span>Tap & swipe</span><span>Live screen</span><span>Fullscreen</span></div><div class="foot">Safari remote available now · Native mobile app in development</div>${frame("remote", "first")}${frame("touch", "second")}</div></body></html>`;
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      res.setHeader("Cache-Control", "no-store");
      if (url.pathname === "/hero") {
        res.setHeader("Content-Type", "text/html");
        return res.end(hero);
      }
      if (url.pathname === "/api/status") {
        res.setHeader("Content-Type", "application/json");
        return res.end('{"connected":true}');
      }
      if (url.pathname === "/api/settings") {
        res.setHeader("Content-Type", "application/json");
        return res.end('{"tvName":"MY TV","roomName":"Living room"}');
      }
      if (url.pathname === "/api/stream") {
        res.setHeader("Content-Type", "image/png");
        return res.end(await readFile(root + "docs/images/demo-footage.png"));
      }
      if (url.pathname.startsWith("/api/")) {
        res.writeHead(405);
        return res.end("Read-only demo");
      }
      const files = {
        "/demo": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
        "/icon.svg": "icon.svg",
        "/manifest.json": "manifest.json",
      };
      const file = files[url.pathname];
      if (!file) {
        res.writeHead(404);
        return res.end();
      }
      let source = await readFile(root + "public/" + file, "utf8");
      if (file === "app.js")
        source = source.replace("if (box.requestFullscreen)", "if (false)");
      if (file === "app.js")
        source += `\nsetTimeout(()=>{const mode=new URLSearchParams(location.search).get('mode');if(['touch','keyboard'].includes(mode))document.querySelector('[data-mode="'+mode+'"]').click();if(mode==='touch')document.querySelector('#screen-time').textContent='Demo preview · sample artwork';},200);`;
      res.setHeader(
        "Content-Type",
        {
          html: "text/html",
          js: "text/javascript",
          css: "text/css",
          svg: "image/svg+xml",
          json: "application/json",
        }[file.split(".").pop()],
      );
      res.end(source);
    } catch {
      res.writeHead(500);
      res.end("Preview error");
    }
  })
  .listen(8766, "127.0.0.1", () =>
    console.log("Documentation preview: http://127.0.0.1:8766/hero"),
  );
