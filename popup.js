"use strict";

const DEFAULTS = { enabled: true, speed: 1.5, disableCaptions: true };
const MIN_SPEED = 0.0625;
const MAX_SPEED = 16;

const el = {
  enabled: document.getElementById("enabled"),
  disableCaptions: document.getElementById("disableCaptions"),
  range: document.getElementById("speedRange"),
  number: document.getElementById("speedNumber"),
  value: document.getElementById("speedValue"),
  presets: document.getElementById("presets"),
  status: document.getElementById("status"),
};

let statusTimer = null;

function clampSpeed(value) {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
}

function formatSpeed(n) {
  // Trim trailing zeros: 1.50 -> "1.5", 2.00 -> "2"
  return parseFloat(n.toFixed(4)).toString();
}

function flashSaved() {
  el.status.textContent = "Saved";
  el.status.classList.add("flash");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.status.classList.remove("flash");
    el.status.textContent = "Saved automatically";
  }, 900);
}

// Reflect a speed value across the slider, number box, big display, and presets.
function renderSpeed(speed) {
  const text = formatSpeed(speed);
  el.value.textContent = text;
  el.number.value = text;
  // The slider only spans 0.25–4; keep it in range without distorting the value.
  el.range.value = Math.min(Math.max(speed, Number(el.range.min)), Number(el.range.max));

  el.presets.querySelectorAll(".preset").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.speed) === speed);
  });
}

function renderEnabled(enabled) {
  el.enabled.checked = enabled;
  document.body.classList.toggle("disabled", !enabled);
}

function save(patch) {
  chrome.storage.sync.set(patch, flashSaved);
}

function setSpeed(rawSpeed) {
  const speed = clampSpeed(rawSpeed);
  renderSpeed(speed);
  save({ speed });
}

/* ---------- init ---------- */

chrome.storage.sync.get(DEFAULTS, (stored) => {
  const settings = { ...DEFAULTS, ...stored };
  renderEnabled(settings.enabled);
  renderSpeed(clampSpeed(settings.speed));
  el.disableCaptions.checked = settings.disableCaptions;
});

/* ---------- events ---------- */

el.range.addEventListener("input", () => setSpeed(el.range.value));

el.number.addEventListener("change", () => setSpeed(el.number.value));

el.presets.addEventListener("click", (e) => {
  const btn = e.target.closest(".preset");
  if (!btn) return;
  setSpeed(btn.dataset.speed);
});

el.enabled.addEventListener("change", () => {
  renderEnabled(el.enabled.checked);
  save({ enabled: el.enabled.checked });
});

el.disableCaptions.addEventListener("change", () => {
  save({ disableCaptions: el.disableCaptions.checked });
});
