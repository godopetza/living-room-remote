import { readFile, writeFile, mkdir } from "node:fs/promises";
export async function loadConfig(root, env = process.env) {
  let local = {};
  try {
    local = JSON.parse(await readFile(root + ".local/config.json", "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const config = {
    host: "127.0.0.1",
    port: 8765,
    adb: "adb",
    ffmpeg: "ffmpeg",
    scrcpyServer: "",
    scrcpyVersion: "3.3.4",
    device: "",
    screenWidth: 1920,
    screenHeight: 1080,
    streamWidth: 960,
    streamHeight: 544,
    tvName: "MY TV",
    roomName: "Living room",
    ...local,
  };
  for (const [key, name] of Object.entries({
    host: "REMOTE_HOST",
    device: "TV_ADB_SERIAL",
    adb: "ADB_PATH",
    ffmpeg: "FFMPEG_PATH",
    scrcpyServer: "SCRCPY_SERVER_PATH",
  }))
    if (env[name]) config[key] = env[name];
  if (env.PORT) config.port = Number(env.PORT);
  return config;
}
export async function saveNames(root, names) {
  await mkdir(root + ".local", { recursive: true, mode: 0o700 });
  let config = {};
  try {
    config = JSON.parse(await readFile(root + ".local/config.json", "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await writeFile(
    root + ".local/config.json",
    JSON.stringify({ ...config, ...names }, null, 2) + "\n",
    { mode: 0o600 },
  );
}
