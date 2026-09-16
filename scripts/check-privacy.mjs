import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const patterns = [
  /\/Users\/[^/\s]+\//,
  /\b192\.168\.\d+\.\d+\b/,
  /\b10\.\d+\.\d+\.\d+\b/,
  /\b172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+\b/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];
let secrets = [];
try {
  secrets.push((await readFile(".local/token", "utf8")).trim());
} catch {}
try {
  const config = JSON.parse(await readFile(".local/config.json", "utf8"));
  secrets.push(config.tvName, config.device);
  if (config.host !== "127.0.0.1") secrets.push(config.host);
} catch {}
secrets = secrets.filter((s) => typeof s === "string" && s.length > 5);
let failures = 0;
for (const file of files) {
  const content = execFileSync("git", ["show", ":" + file], {
    encoding: "utf8",
    maxBuffer: 4e6,
  });
  if (
    file.startsWith(".local/") ||
    patterns.some((p) => p.test(content)) ||
    secrets.some((s) => content.includes(s))
  ) {
    console.error("Review sensitive content in:", file);
    failures++;
  }
}
if (failures) process.exitCode = 1;
else
  console.log(
    `Privacy scan passed for ${files.length} indexed files (no private values printed).`,
  );
