const STORAGE_KEY = "pomodoro.v1";
const RADIUS = 92;
const CIRC = 2 * Math.PI * RADIUS;
const MODES = ["focus", "short", "long"];
const HINTS = {
  focus: "只做这一件事",
  short: "离开屏幕一会儿",
  long: "走远一点，再回来",
};
const LABELS = { focus: "专注", short: "短休", long: "长休" };

const ring = document.getElementById("ring");
const timeEl = document.getElementById("time");
const phaseLabel = document.getElementById("phaseLabel");
const hintEl = document.getElementById("hint");
const todayEl = document.getElementById("today");
const dateEl = document.getElementById("date");
const toggleBtn = document.getElementById("toggle");
const taskInput = document.getElementById("task");
const cycleEl = document.getElementById("cycle");
const sheet = document.getElementById("sheet");
const topHint = document.getElementById("topHint");

ring.style.strokeDasharray = String(CIRC);

const state = load();
let audioCtx = null;
let desktop = false;
let lastTitle = "";

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function clampMinutes(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(180, Math.max(1, n));
}

function load() {
  const base = {
    minutes: { focus: 25, short: 5, long: 15 },
    sound: true,
    autoNext: false,
    onTop: false,
    task: "",
    mode: "focus",
    remaining: 25 * 60,
    running: false,
    endAt: null,
    cycle: 0,
    todayKey: todayKey(),
    todayCount: 0,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return base;
    const minutes = { ...base.minutes, ...(saved.minutes || {}) };
    MODES.forEach((mode) => {
      minutes[mode] = clampMinutes(minutes[mode], base.minutes[mode]);
    });
    const next = {
      ...base,
      ...saved,
      minutes,
      mode: MODES.includes(saved.mode) ? saved.mode : "focus",
      cycle: Math.min(4, Math.max(0, Number(saved.cycle) || 0)),
      todayCount: Math.max(0, Number(saved.todayCount) || 0),
      remaining: Math.max(0, Number(saved.remaining) || 0),
    };
    if (next.todayKey !== todayKey()) {
      next.todayKey = todayKey();
      next.todayCount = 0;
    }
    next.expired = false;
    if (next.running && next.endAt) {
      const left = Math.round((Number(next.endAt) - Date.now()) / 1000);
      if (left > 0) next.remaining = left;
      else next.expired = true;
    } else {
      next.running = false;
      next.endAt = null;
      next.remaining = Math.min(next.remaining, next.minutes[next.mode] * 60);
    }
    return next;
  } catch {
    return base;
  }
}

function save() {
  const { expired, ...rest } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
}

function duration() {
  return state.minutes[state.mode] * 60;
}

function format(total) {
  const seconds = Math.max(0, total);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function render() {
  const total = duration();
  const progress = total <= 0 ? 0 : 1 - state.remaining / total;
  ring.style.strokeDashoffset = String(CIRC * (1 - Math.min(1, Math.max(0, progress))));
  timeEl.textContent = format(state.remaining);
  phaseLabel.textContent = LABELS[state.mode];
  hintEl.textContent = state.running ? HINTS[state.mode] : state.remaining < total ? "已暂停" : HINTS[state.mode];
  document.body.dataset.mode = state.mode;
  document.body.classList.toggle("is-running", state.running);
  todayEl.textContent = state.todayCount > 0 ? `今日 ${state.todayCount} 个` : "今天还没开始";
  const full = state.remaining === total;
  toggleBtn.textContent = state.running ? "暂停" : full ? "开始" : "继续";
  document.querySelectorAll(".mode").forEach((button) => {
    const mode = button.dataset.mode;
    button.setAttribute("aria-selected", mode === state.mode ? "true" : "false");
    button.querySelector("span").textContent = `${state.minutes[mode]} 分钟`;
  });
  cycleEl.replaceChildren(
    ...[0, 1, 2, 3].map((index) => {
      const dot = document.createElement("span");
      if (index < state.cycle) dot.className = "on";
      return dot;
    })
  );
  const title = `${format(state.remaining)} ${LABELS[state.mode]}`;
  if (title !== lastTitle) {
    lastTitle = title;
    document.title = `${title} · 番茄钟`;
    if (desktop && window.pywebview?.api?.set_title) {
      window.pywebview.api.set_title(title).catch(() => {});
    }
  }
  syncSettings();
}

function syncSettings() {
  MODES.forEach((mode) => {
    const input = document.getElementById(`min-${mode}`);
    if (document.activeElement !== input) input.value = String(state.minutes[mode]);
  });
  document.getElementById("opt-sound").checked = state.sound;
  document.getElementById("opt-auto").checked = state.autoNext;
  document.getElementById("opt-top").checked = state.onTop;
}

function tick() {
  if (!state.running || !state.endAt) return;
  const left = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
  if (left !== state.remaining) {
    state.remaining = left;
    render();
  }
  if (left <= 0) finishPhase();
}

function start() {
  if (state.remaining <= 0) state.remaining = duration();
  state.endAt = Date.now() + state.remaining * 1000;
  state.running = true;
  unlockAudio();
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  save();
  render();
}

function pause() {
  if (state.endAt) state.remaining = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
  state.running = false;
  state.endAt = null;
  save();
  render();
}

function reset() {
  state.running = false;
  state.endAt = null;
  state.remaining = duration();
  save();
  render();
}

function switchMode(mode) {
  if (!MODES.includes(mode) || mode === state.mode) return;
  state.mode = mode;
  state.running = false;
  state.endAt = null;
  state.remaining = duration();
  save();
  render();
}

function skip() {
  const leaving = state.mode;
  state.running = false;
  state.endAt = null;
  if (leaving === "long") state.cycle = 0;
  state.mode = leaving === "focus" ? "short" : "focus";
  state.remaining = duration();
  save();
  render();
}

function finishPhase() {
  if (!state.running && !state.expired) return;
  const finished = state.mode;
  state.running = false;
  state.endAt = null;
  state.expired = false;
  if (finished === "focus") {
    state.cycle = Math.min(4, state.cycle + 1);
    state.todayCount += 1;
    state.mode = state.cycle >= 4 ? "long" : "short";
  } else {
    if (finished === "long") state.cycle = 0;
    state.mode = "focus";
  }
  state.remaining = duration();
  save();
  render();
  if (state.sound) chime(finished === "focus");
  notify(finished);
  if (state.autoNext) start();
}

function setMinutes(mode, value) {
  const prev = state.minutes[mode];
  const next = clampMinutes(value, prev);
  state.minutes[mode] = next;
  if (state.mode === mode && !state.running) {
    if (state.remaining === prev * 60) state.remaining = next * 60;
    else state.remaining = Math.min(state.remaining, next * 60);
  }
  save();
  render();
}

function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

function tone(ctx, freq, when, length, gainValue) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(gainValue, when + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + length + 0.02);
}

function chime(resting) {
  unlockAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime + 0.02;
  const notes = resting ? [523.25, 659.25, 783.99] : [783.99, 523.25];
  notes.forEach((freq, index) => tone(audioCtx, freq, now + index * 0.14, 1.15, 0.08));
}

function notify(finished) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const task = state.task.trim();
  if (finished === "focus") {
    const next = state.mode === "long" ? "长休息" : "短休息";
    new Notification("专注结束", {
      body: task ? `「${task}」先告一段落，去${next}。` : `去${next}。`,
      silent: true,
    });
    return;
  }
  new Notification("休息结束", {
    body: task ? `回到「${task}」。` : "可以开始下一轮专注了。",
    silent: true,
  });
}

function applyOnTop() {
  if (!desktop || !window.pywebview?.api?.set_on_top) return;
  window.pywebview.api.set_on_top(!!state.onTop).catch(() => {});
}

function openSettings() {
  sheet.hidden = false;
  topHint.hidden = desktop;
  syncSettings();
}

function closeSettings() {
  sheet.hidden = true;
}

dateEl.textContent = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(new Date());

taskInput.value = state.task;
taskInput.addEventListener("input", () => {
  state.task = taskInput.value.slice(0, 80);
  save();
});

toggleBtn.addEventListener("click", () => (state.running ? pause() : start()));
document.getElementById("reset").addEventListener("click", reset);
document.getElementById("skip").addEventListener("click", skip);
document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => switchMode(button.dataset.mode));
});

document.getElementById("settingsBtn").addEventListener("click", openSettings);
document.getElementById("closeSettings").addEventListener("click", closeSettings);
document.getElementById("backdrop").addEventListener("click", closeSettings);

document.querySelectorAll("[data-step]").forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.step;
    setMinutes(mode, state.minutes[mode] + Number(button.dataset.dir));
  });
});

MODES.forEach((mode) => {
  document.getElementById(`min-${mode}`).addEventListener("change", (event) => {
    setMinutes(mode, event.target.value);
  });
});

document.getElementById("opt-sound").addEventListener("change", (event) => {
  state.sound = event.target.checked;
  if (state.sound) {
    unlockAudio();
    chime(true);
  }
  save();
});

document.getElementById("opt-auto").addEventListener("change", (event) => {
  state.autoNext = event.target.checked;
  save();
});

document.getElementById("opt-top").addEventListener("change", (event) => {
  state.onTop = event.target.checked;
  save();
  applyOnTop();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !sheet.hidden) {
    closeSettings();
    return;
  }
  if (event.code !== "Space") return;
  if (event.target.closest("input, textarea, button")) return;
  event.preventDefault();
  state.running ? pause() : start();
});

window.addEventListener("pywebviewready", () => {
  desktop = true;
  topHint.hidden = true;
  applyOnTop();
  render();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});

window.addEventListener("beforeunload", save);

if (state.expired) finishPhase();
else render();

window.setInterval(tick, 200);

window.pomodoro = { state, start, pause, reset, skip, switchMode, setMinutes, finishPhase };
