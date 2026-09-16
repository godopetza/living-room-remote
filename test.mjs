import test from "node:test";
import assert from "node:assert/strict";
import { command, createRemote } from "./server.mjs";
test("controls are allowlisted; coordinates bounded; text shell-quoted", () => {
  assert.deepEqual(command({ type: "key", key: "home" }), [
    "shell",
    "input",
    "keyevent",
    "3",
  ]);
  assert.throws(() => command({ type: "key", key: "reboot" }));
  assert.throws(() => command({ type: "tap", x: Infinity, y: 0.5 }));
  assert.throws(() => command({ type: "app", app: "anything" }));
  assert.deepEqual(command({ type: "tap", x: 1, y: 1 }), [
    "shell",
    "input",
    "tap",
    "1919",
    "1079",
  ]);
  assert.equal(
    command({ type: "text", text: "a'b;$(id)" })[1],
    "input text 'a'\\''b;$(id)'",
  );
  assert.throws(() => command({ type: "text", text: "x%sy" }));
});
test("pairing, origin validation and commands", async () => {
  const calls = [];
  const server = createRemote({
    token: "abc123",
    host: "127.0.0.1",
    port: 18766,
    run: async (a) => {
      calls.push(a);
      return { stdout: "device\n" };
    },
  });
  await new Promise((r) => server.listen(18766, "127.0.0.1", r));
  try {
    const url = "http://127.0.0.1:18766";
    assert.equal(
      (
        await fetch(url + "/api/control", {
          method: "POST",
          body: '{"type":"key","key":"home"}',
        })
      ).status,
      401,
    );
    assert.equal(calls.length, 0);
    assert.equal(
      (
        await fetch(url + "/api/pair", {
          method: "POST",
          body: '{"token":"bad"}',
        })
      ).status,
      403,
    );
    const pair = await fetch(url + "/api/pair", {
      method: "POST",
      body: '{"token":"abc123"}',
    });
    assert.equal(pair.status, 200);
    const cookie = pair.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (
        await fetch(url + "/api/control", {
          method: "POST",
          headers: { cookie, origin: "http://evil.test" },
          body: '{"type":"key","key":"home"}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url + "/api/control", {
          method: "POST",
          headers: { cookie },
          body: '{"type":"key","key":"home"}',
        })
      ).status,
      200,
    );
    assert.deepEqual(calls, [["shell", "input", "keyevent", "3"]]);
    assert.equal(
      (
        await fetch(url + "/api/control", {
          method: "POST",
          headers: { cookie },
          body: '{"type":"key","key":"reboot"}',
        })
      ).status,
      400,
    );
    assert.equal(calls.length, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
import { keyPacket, touchPacket } from "./bridge.mjs";
test("persistent controls match scrcpy binary protocol", () => {
  const k = keyPacket(24, 1);
  assert.equal(k.length, 14);
  assert.equal(k[0], 0);
  assert.equal(k[1], 1);
  assert.equal(k.readUInt32BE(2), 24);
  const t = touchPacket(1, 1, 0);
  assert.equal(t.length, 32);
  assert.equal(t[0], 2);
  assert.equal(t.readUInt32BE(10), 959);
  assert.equal(t.readUInt32BE(14), 543);
  assert.equal(t.readUInt16BE(18), 960);
  assert.equal(t.readUInt16BE(20), 544);
  assert.equal(touchPacket(0, 0, 1).readUInt16BE(22), 0);
});
test("settings require pairing, validate input and persist only display names", async () => {
  const saved = [];
  const config = {
    tvName: "My TV",
    roomName: "Lounge",
    device: "private-device",
  };
  const server = createRemote({
    token: "test-key",
    host: "127.0.0.1",
    port: 18767,
    config,
    persistNames: async (n) => saved.push(n),
    run: async () => ({ stdout: "device" }),
  });
  await new Promise((r) => server.listen(18767, "127.0.0.1", r));
  try {
    const url = "http://127.0.0.1:18767/api/settings";
    assert.equal((await fetch(url)).status, 401);
    const headers = {
      cookie: "remote=test-key",
      "Content-Type": "application/json",
    };
    assert.deepEqual(await (await fetch(url, { headers })).json(), {
      tvName: "My TV",
      roomName: "Lounge",
    });
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ tvName: "", roomName: "Room" }),
        })
      ).status,
      400,
    );
    const names = { tvName: "Family TV", roomName: "Den" };
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...names, device: "changed" }),
        })
      ).status,
      200,
    );
    assert.deepEqual(saved, [names]);
    assert.equal(config.device, "private-device");
    assert.deepEqual(await (await fetch(url, { headers })).json(), names);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
