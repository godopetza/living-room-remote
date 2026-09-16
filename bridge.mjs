import net from "node:net";
import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function keyPacket(code, action) {
  const b = Buffer.alloc(14);
  b[1] = action;
  b.writeUInt32BE(code, 2);
  return b;
}
export function touchPacket(x, y, action, width = 960, height = 544) {
  const b = Buffer.alloc(32);
  b[0] = 2;
  b[1] = action;
  b.writeBigUInt64BE(0xfffffffffffffffen, 2);
  b.writeUInt32BE(Math.round(x * (width - 1)), 10);
  b.writeUInt32BE(Math.round(y * (height - 1)), 14);
  b.writeUInt16BE(width, 18);
  b.writeUInt16BE(height, 20);
  b.writeUInt16BE(action === 1 ? 0 : 65535, 22);
  return b;
}
export class Bridge {
  constructor(run, config) {
    this.config = config;
    this.touch = (x, y, action) =>
      touchPacket(x, y, action, config.streamWidth, config.streamHeight);
    this.run = run;
    this.clients = new Set();
    this.frames = 0;
    this.ready = false;
    this.stopped = false;
    this.start().catch((e) => console.error("Bridge:", e.message));
  }
  async start() {
    try {
      await this.run([
        "push",
        this.config.scrcpyServer,
        "/data/local/tmp/scrcpy-remote.jar",
      ]);
      await this.run(["forward", "tcp:27189", "localabstract:scrcpy_1234abce"]);
      this.proc = spawn(
        this.config.adb,
        [
          "-s",
          this.config.device,
          "shell",
          "CLASSPATH=/data/local/tmp/scrcpy-remote.jar",
          "app_process",
          "/",
          "com.genymobile.scrcpy.Server",
          this.config.scrcpyVersion,
          "scid=1234abce",
          "tunnel_forward=true",
          "audio=false",
          "raw_stream=true",
          "send_dummy_byte=true",
          `max_size=${Math.max(this.config.streamWidth, this.config.streamHeight)}`,
          "max_fps=20",
          "video_bit_rate=2000000",
          "video_codec_options=i-frame-interval=1",
          "clipboard_autosync=false",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      this.proc.stdout.on("data", (b) => console.log(String(b).trim()));
      this.proc.stderr.on("data", (b) => console.error(String(b).trim()));
      await sleep(900);
      const connect = () =>
        new Promise((resolve, reject) => {
          const s = net.connect(27189, "127.0.0.1", () => {
            s.setNoDelay(true);
            resolve(s);
          });
          s.once("error", reject);
        });
      for (let attempt = 0; attempt < 30; attempt++) {
        const v = await connect();
        const ok = await new Promise((resolve) => {
          const t = setTimeout(() => resolve(false), 500);
          v.once("data", (b) => {
            clearTimeout(t);
            if (b.length > 1) v.unshift(b.subarray(1));
            resolve(true);
          });
          v.once("close", () => {
            clearTimeout(t);
            resolve(false);
          });
        });
        if (ok) {
          this.video = v;
          break;
        }
        v.destroy();
        await sleep(300);
      }
      if (!this.video || this.video.destroyed)
        throw new Error("TV encoder unavailable");
      this.control = await connect();
      this.ready = true;
      this.control.on("data", () => {});
      this.decoder = spawn(this.config.ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-flags",
        "low_delay",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-f",
        "h264",
        "-i",
        "pipe:0",
        "-an",
        "-fps_mode",
        "passthrough",
        "-c:v",
        "mjpeg",
        "-q:v",
        "6",
        "-f",
        "image2pipe",
        "pipe:1",
      ]);
      this.decoder.stderr.on("data", (b) => console.error(String(b).trim()));
      this.decoder.stdin.on("error", () => {});
      this.video.pipe(this.decoder.stdin);
      let pending = Buffer.alloc(0);
      this.decoder.stdout.on("data", (chunk) => {
        pending = Buffer.concat([pending, chunk]);
        let end;
        while ((end = pending.indexOf(Buffer.from([255, 217]))) >= 0) {
          const jpg = pending.subarray(0, end + 2);
          pending = pending.subarray(end + 2);
          if (jpg[0] !== 255 || jpg[1] !== 216) continue;
          this.frame = jpg;
          this.frames++;
          this.lastFrame = Date.now();
          for (const res of this.clients) {
            if (res.writableLength > 256000) {
              res.destroy();
              continue;
            }
            if (res.writableLength === 0) this.sendFrame(res, jpg);
          }
        }
        if (pending.length > 8e6) pending = Buffer.alloc(0);
      });
      let failed = false;
      const fail = () => {
        if (failed || this.stopped) return;
        failed = true;
        this.cleanup();
        setTimeout(() => {
          if (!this.stopped) this.start();
        }, 1500);
      };
      for (const p of [this.video, this.control, this.proc, this.decoder]) {
        p.on("error", fail);
        p.on("close", fail);
      }
    } catch (e) {
      this.cleanup();
      if (!this.stopped) setTimeout(() => this.start(), 3000);
    }
  }
  sendFrame(res, jpg) {
    res.write(
      Buffer.concat([
        Buffer.from(
          `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`,
        ),
        jpg,
        Buffer.from("\r\n"),
      ]),
    );
  }
  stream(req, res) {
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    this.clients.add(res);
    if (this.frame) this.sendFrame(res, this.frame);
    res.on("close", () => this.clients.delete(res));
  }
  async input(body, args) {
    if (!this.ready) throw new Error("Live connection reconnecting");
    if (this.control.writableLength > 65536)
      throw new Error("Control connection busy");
    if (body.type === "key") {
      const code = Number(args.at(-1));
      this.control.write(
        Buffer.concat([keyPacket(code, 0), keyPacket(code, 1)]),
      );
    } else if (body.type === "text") {
      const str = Buffer.from(body.text);
      const b = Buffer.alloc(5);
      b[0] = 1;
      b.writeUInt32BE(str.length, 1);
      this.control.write(Buffer.concat([b, str]));
    } else if (body.type === "tap") {
      this.control.write(
        Buffer.concat([
          this.touch(body.x, body.y, 0),
          this.touch(body.x, body.y, 1),
        ]),
      );
    } else if (body.type === "swipe") {
      this.control.write(this.touch(body.x, body.y, 0));
      for (let i = 1; i <= 8; i++) {
        await sleep(20);
        if (!this.ready) throw new Error("Disconnected");
        this.control.write(
          this.touch(
            body.x + ((body.toX - body.x) * i) / 8,
            body.y + ((body.toY - body.y) * i) / 8,
            2,
          ),
        );
      }
      this.control.write(this.touch(body.toX, body.toY, 1));
    } else await this.run(args);
  }
  cleanup() {
    this.ready = false;
    this.video?.destroy();
    this.control?.destroy();
    this.proc?.kill();
    this.decoder?.kill();
  }
  stop() {
    this.stopped = true;
    this.cleanup();
    for (const res of this.clients) res.end();
  }
}
