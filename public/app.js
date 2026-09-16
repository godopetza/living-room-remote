const $ = (s) => document.querySelector(s);
let paired = false,
  busy = false,
  screenBusy = false,
  timer,
  liveTimer,
  screenUrl;
let mode = "remote";
function say(s) {
  $("#message").textContent = s;
  $("#message").classList.add("visible");
  clearTimeout(timer);
  timer = setTimeout(() => $("#message").classList.remove("visible"), 4000);
}
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let data;
    try {
      data = await r.json();
    } catch {}
    throw new Error(data?.error || "Could not reach your Mac.");
  }
  return r;
}
async function status() {
  try {
    const r = await api("status");
    const d = await r.json();
    $("#status").classList.toggle("connected", d.connected);
    $("#status span").textContent = d.connected ? "Connected" : "TV offline";
    return d.connected;
  } catch (e) {
    $("#status").classList.remove("connected");
    $("#status span").textContent = "Reconnect";
    return false;
  }
}
async function control(data) {
  if (!paired) {
    say("Open your private pairing link first.");
    return false;
  }
  try {
    await api("control", data);
    return true;
  } catch (e) {
    say(e.message);
    return false;
  }
}
function showScreen() {
  if (!paired) return;
  $("#live").checked = true;
  updateLive(true);
}
function updateLive(force = false) {
  const active = $("#live").checked && mode === "touch" && !document.hidden;
  if (active) {
    if (force || !$("#screen").getAttribute("src"))
      $("#screen").src = "/api/stream?t=" + Date.now();
    $("#screen").hidden = false;
    $("#screen-empty").hidden = true;
    $("#screen-time").textContent = "Live · continuous stream";
  } else {
    $("#screen").removeAttribute("src");
    $("#screen").hidden = true;
    $("#screen-empty").hidden = false;
    $("#screen-time").textContent = "Live view paused";
  }
}
for (const tab of document.querySelectorAll("[data-mode]"))
  tab.onclick = () => {
    mode = tab.dataset.mode;
    for (const b of document.querySelectorAll("[data-mode]")) {
      const active = b === tab;
      b.classList.toggle("selected", active);
      b.setAttribute("aria-pressed", String(active));
    }
    for (const p of document.querySelectorAll(".panel"))
      p.hidden = p.id !== mode;
    updateLive();
  };
for (const b of document.querySelectorAll("[data-key]")) {
  let hold, repeat;
  let pointerUsed = false;
  const send = () => control({ type: "key", key: b.dataset.key });
  const stop = () => {
    clearTimeout(hold);
    clearInterval(repeat);
    b.classList.remove("pressed");
  };
  b.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    pointerUsed = true;
    b.setPointerCapture(e.pointerId);
    b.classList.add("pressed");
    send();
    if (
      [
        "up",
        "down",
        "left",
        "right",
        "volumeUp",
        "volumeDown",
        "delete",
      ].includes(b.dataset.key)
    )
      hold = setTimeout(() => {
        repeat = setInterval(async () => {
          if (busy) return;
          busy = true;
          await send();
          busy = false;
        }, 220);
      }, 450);
  });
  b.addEventListener("pointerup", stop);
  b.addEventListener("pointercancel", stop);
  b.addEventListener("lostpointercapture", stop);
  b.addEventListener("click", () => {
    if (!pointerUsed) send();
    pointerUsed = false;
  });
}
for (const b of document.querySelectorAll("[data-app]"))
  b.onclick = async () => {
    if (await control({ type: "app", app: b.dataset.app }))
      say("Opening " + b.textContent + "…");
  };
for (const b of document.querySelectorAll("[data-scroll]"))
  b.onclick = async () => {
    const up = b.dataset.scroll === "up";
    await control({
      type: "swipe",
      x: 0.5,
      y: up ? 0.3 : 0.75,
      toX: 0.5,
      toY: up ? 0.75 : 0.3,
    });
  };
$("#send-text").onclick = async () => {
  const text = $("#text").value;
  if (!text.trim()) return say("Type something first.");
  $("#send-text").disabled = true;
  if (await control({ type: "text", text })) {
    say("Sent to TV");
    $("#text").value = "";
    $("#text").blur();
  }
  $("#send-text").disabled = false;
};
$("#status").onclick = async () =>
  say(
    (await status())
      ? "TV connected. Ready to use."
      : "Check your TV, Mac and Wi-Fi.",
  );
$("#refresh").onclick = showScreen;
$("#show-screen").onclick = showScreen;
$("#live").onchange = () => updateLive();
document.addEventListener("visibilitychange", updateLive);
$("#help").onclick = () =>
  say(
    "In Safari: Share → Add to Home Screen. Keep your Mac awake while using the remote.",
  );
let start;
const screen = $("#screen");
function imageBounds() {
  const r = screen.getBoundingClientRect(),
    ratio = (screen.naturalWidth || 960) / (screen.naturalHeight || 544);
  let width = r.width,
    height = width / ratio;
  if (height > r.height) {
    height = r.height;
    width = height * ratio;
  }
  return {
    left: r.left + (r.width - width) / 2,
    top: r.top + (r.height - height) / 2,
    width,
    height,
  };
}
function point(e) {
  const r = imageBounds();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
  };
}
const box = $("#screen-box");
let expanded = false;
function collapse() {
  expanded = false;
  box.classList.remove("expanded");
  document.body.classList.remove("screen-expanded");
  $("#fullscreen").focus();
}
$("#fullscreen").onclick = async () => {
  if (!paired) return say("Open your private pairing link first.");
  showScreen();
  expanded = true;
  box.classList.add("expanded");
  document.body.classList.add("screen-expanded");
  $("#exit-fullscreen").focus();
  try {
    if (box.requestFullscreen) await box.requestFullscreen();
  } catch {
    /* Safari uses the expanded viewport. */
  }
};
$("#exit-fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } finally {
    collapse();
  }
};
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && expanded) collapse();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && expanded) {
    $("#exit-fullscreen").click();
  }
});
screen.onpointerdown = (e) => {
  const bounds = imageBounds();
  if (
    e.clientX < bounds.left ||
    e.clientX > bounds.left + bounds.width ||
    e.clientY < bounds.top ||
    e.clientY > bounds.top + bounds.height
  )
    return;
  e.preventDefault();
  screen.setPointerCapture(e.pointerId);
  start = { ...point(e), px: e.clientX, py: e.clientY };
  const dot = $("#touch-dot");
  dot.hidden = false;
  const br = box.getBoundingClientRect();
  dot.style.left = e.clientX - br.left + "px";
  dot.style.top = e.clientY - br.top + "px";
};
screen.onpointerup = async (e) => {
  if (!start) return;
  const p = point(e),
    s = start;
  start = null;
  $("#touch-dot").hidden = true;
  const swipe = Math.hypot(e.clientX - s.px, e.clientY - s.py) > 12;
  await control(
    swipe
      ? { type: "swipe", x: s.x, y: s.y, toX: p.x, toY: p.y }
      : { type: "tap", x: p.x, y: p.y },
  );
};
screen.onpointercancel = () => {
  start = null;
  $("#touch-dot").hidden = true;
};
(async () => {
  const token = location.hash.slice(1);
  try {
    if (token) {
      await api("pair", { token });
      history.replaceState(null, "", location.pathname);
    }
    const r = await fetch("/api/status");
    if (r.status === 401) {
      $("#setup").hidden = false;
      $("#status span").textContent = "Not paired";
      return;
    }
    paired = true;
    await loadNames();
    await status();
    setInterval(() => {
      if (!document.hidden) status();
    }, 15000);
  } catch (e) {
    say(e.message);
    $("#status span").textContent = "Mac offline";
  }
})();

function displayNames(names) {
  $("#tv-name").textContent = names.tvName;
  $("#room-name").textContent = names.roomName;
  $("#tv-name-input").value = names.tvName;
  $("#room-name-input").value = names.roomName;
  document.title = names.roomName + " · Remote";
}
async function loadNames() {
  displayNames(await (await api("settings")).json());
}
$("#names-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    displayNames(
      await (
        await api("settings", {
          tvName: $("#tv-name-input").value,
          roomName: $("#room-name-input").value,
        })
      ).json(),
    );
    say("Names saved on this computer.");
  } catch (e) {
    say(e.message);
  }
};
