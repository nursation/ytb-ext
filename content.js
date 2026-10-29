/*
 * YouTube Speed & Caption Control — content script
 *
 * Goals:
 *  1. Always force the user-selected playback speed on every video.
 *     If YouTube (or anything else) changes the rate, push it straight back.
 *  2. Always keep captions/subtitles turned off.
 *
 * YouTube is a single-page app: it swaps videos without a full page reload and
 * reuses the same <video> element, so we can't rely on the script re-running.
 * We defend on several fronts: the video's own events, SPA navigation events,
 * a debounced DOM observer, and a slow interval as a final safety net.
 */
(() => {
  "use strict";

  const DEFAULTS = { enabled: true, speed: 1.5, disableCaptions: true };
  const MIN_SPEED = 0.0625; // YouTube's lowest
  const MAX_SPEED = 16;     // HTMLMediaElement's practical ceiling
  const EPSILON = 0.001;

  let settings = { ...DEFAULTS };
  // Temporary in-memory override (Ctrl+Down → 1x). Never written to storage,
  // so the saved speed is untouched and Ctrl+Up can return to it.
  let tempSpeed = null;

  /* ---------- settings ---------- */

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored };
    applyAll();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key of Object.keys(changes)) {
      if (key in DEFAULTS) settings[key] = changes[key].newValue;
    }
    // A fresh speed choice (e.g. from the popup) ends any temporary override.
    if (changes.speed) tempSpeed = null;
    applyAll();
  });

  /* ---------- helpers ---------- */

  function clampSpeed(value) {
    const n = Number(value);
    if (!isFinite(n) || n <= 0) return 1;
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
  }

  function getVideo() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector(".html5-video-container video") ||
      document.querySelector("video")
    );
  }

  /* ---------- speed ---------- */

  function effectiveSpeed() {
    return clampSpeed(tempSpeed ?? settings.speed);
  }

  function applySpeed() {
    if (!settings.enabled) return;
    const video = getVideo();
    if (!video) return;
    const target = effectiveSpeed();
    if (Math.abs(video.playbackRate - target) > EPSILON) {
      video.playbackRate = target;
    }
  }

  // Attach once per <video>. The same element is usually reused across
  // navigations, but the dataset flag makes re-hooking safe and cheap.
  function hookVideo(video) {
    if (!video || video.dataset.ytSpeedHooked === "1") return;
    video.dataset.ytSpeedHooked = "1";

    const reapply = () => applySpeed();

    // The key listener: if anything resets the rate, force it back.
    // Setting playbackRate fires 'ratechange' again, but the epsilon guard
    // makes the second pass a no-op, so there is no infinite loop.
    video.addEventListener("ratechange", reapply);
    video.addEventListener("loadstart", reapply);
    video.addEventListener("loadeddata", reapply);
    video.addEventListener("durationchange", reapply);
    video.addEventListener("canplay", reapply);
    video.addEventListener("play", reapply);
    video.addEventListener("playing", reapply);

    applySpeed();
  }

  /* ---------- captions ---------- */

  function disableCaptions() {
    if (!settings.enabled || !settings.disableCaptions) return;
    const btn = document.querySelector(".ytp-subtitles-button");
    // aria-pressed === "true" means captions are currently ON.
    if (btn && btn.getAttribute("aria-pressed") === "true") {
      btn.click();
    }
  }

  /* ---------- on-page speed buttons ---------- */

  // Laid out as a 3-column grid: 1 / 1.5 / 2 on top, 2.5 / 3 / 3.3 below.
  const PRESETS = [1, 1.5, 2, 2.5, 3, 3.3];
  const BAR_ID = "ytscc-speed-bar";
  const STYLE_ID = "ytscc-speed-style";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BAR_ID} {
        /* Light theme by default; YouTube flags dark mode with <html dark>. */
        --ytscc-line: rgba(0, 0, 0, 0.2);
        --ytscc-fg: #606060;
        --ytscc-fg-strong: #0f0f0f;
        --ytscc-hover: rgba(0, 0, 0, 0.08);
        --ytscc-on-accent: #fff;
        display: inline-grid;
        grid-template-columns: repeat(3, 1fr);
        flex: none;
        margin-right: 8px;
        border: 1px solid var(--ytscc-line);
        background: transparent;
        user-select: none;
      }
      html[dark] #${BAR_ID},
      ytd-app[dark] #${BAR_ID} {
        --ytscc-line: rgba(255, 255, 255, 0.25);
        --ytscc-fg: #aaa;
        --ytscc-fg-strong: #f1f1f1;
        --ytscc-hover: rgba(255, 255, 255, 0.12);
        --ytscc-on-accent: #0f0f0f;
      }
      #${BAR_ID} button {
        box-sizing: border-box;
        min-width: 30px;
        font: 500 10px/1 "Roboto", "Arial", sans-serif;
        padding: 3px 4px;
        border: 0;
        /* Dividers live on the cells themselves, so the block stays see-through. */
        border-right: 1px solid var(--ytscc-line);
        border-bottom: 1px solid var(--ytscc-line);
        border-radius: 0;
        cursor: pointer;
        background: transparent;
        color: var(--ytscc-fg);
        transition: background 0.15s, color 0.15s;
      }
      #${BAR_ID} button:nth-child(3n) {
        border-right: 0;
      }
      #${BAR_ID} button:nth-child(n + 4) {
        border-bottom: 0;
      }
      #${BAR_ID} button:hover {
        background: var(--ytscc-hover);
        color: var(--ytscc-fg-strong);
      }
      #${BAR_ID} button.ytscc-active {
        background: var(--ytscc-fg-strong);
        color: var(--ytscc-on-accent);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function selectSpeed(speed) {
    tempSpeed = null;
    settings.speed = clampSpeed(speed);
    chrome.storage.sync.set({ speed: settings.speed });
    applyEffectiveSpeedNow();
  }

  // Apply immediately (even with enforcement toggled off) for instant feedback.
  function applyEffectiveSpeedNow() {
    const video = getVideo();
    if (video) video.playbackRate = effectiveSpeed();
    updateActiveButtons();
  }

  /* ---------- keyboard shortcuts ---------- */

  // Ctrl+Down: temporarily drop to 1x. Ctrl+Up: back to the saved speed.
  function isEditable(el) {
    return (
      el &&
      (el.isContentEditable ||
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT")
    );
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (isEditable(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      tempSpeed = e.key === "ArrowDown" ? 1 : null;
      applyEffectiveSpeedNow();
    },
    true
  );

  function buildBar() {
    const bar = document.createElement("span");
    bar.id = BAR_ID;
    for (const speed of PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.speed = String(speed);
      btn.textContent = `${speed}x`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        selectSpeed(speed);
      });
      bar.appendChild(btn);
    }
    return bar;
  }

  function updateActiveButtons() {
    const bar = document.getElementById(BAR_ID);
    if (!bar) return;
    const target = effectiveSpeed();
    for (const btn of bar.querySelectorAll("button")) {
      btn.classList.toggle(
        "ytscc-active",
        Math.abs(Number(btn.dataset.speed) - target) < EPSILON
      );
    }
  }

  // Insert the bar as the first element inside the watch-page title <h1>.
  // YouTube re-renders the title on SPA navigation, which can drop the bar;
  // applyAll() re-injects it whenever it's missing.
  function injectSpeedButtons() {
    ensureStyles();
    const title = document.querySelector(
      "ytd-watch-metadata h1, h1.title.ytd-video-primary-info-renderer"
    );
    if (!title) return;
    let bar = document.getElementById(BAR_ID);
    if (!bar || bar.parentElement !== title) {
      if (bar) bar.remove();
      bar = buildBar();
      title.prepend(bar);
    }
    // Lay the bar and the title text out on one line, buttons first.
    if (title.style.display !== "flex") {
      title.style.display = "flex";
      title.style.alignItems = "center";
    }
    updateActiveButtons();
  }

  /* ---------- orchestration ---------- */

  function applyAll() {
    const video = getVideo();
    if (video) hookVideo(video);
    applySpeed();
    disableCaptions();
    injectSpeedButtons();
  }

  // Debounced DOM observer: YouTube churns the DOM heavily, so coalesce
  // bursts into one pass per animation frame.
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyAll();
    });
  });

  function startObserving() {
    if (!document.documentElement) return;
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // YouTube's SPA navigation events — the moment a new video is ready.
  document.addEventListener("yt-navigate-finish", applyAll, true);
  document.addEventListener("yt-page-data-updated", applyAll, true);
  window.addEventListener("yt-navigate-finish", applyAll, true);

  // Final safety net for anything the above misses.
  setInterval(applyAll, 1000);

  startObserving();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAll, { once: true });
  }
  applyAll();
})();
