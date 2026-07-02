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

  function applySpeed() {
    if (!settings.enabled) return;
    const video = getVideo();
    if (!video) return;
    const target = clampSpeed(settings.speed);
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

  const PRESETS = [1, 1.5, 2, 2.5];
  const BAR_ID = "ytscc-speed-bar";
  const STYLE_ID = "ytscc-speed-style";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BAR_ID} {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: none;
        margin-right: 8px;
        user-select: none;
      }
      #${BAR_ID} button {
        box-sizing: border-box;
        min-width: 38px;
        font: 500 12px/1 "Roboto", "Arial", sans-serif;
        padding: 5px 8px;
        border: 1px solid var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
        border-radius: 12px;
        cursor: pointer;
        background: transparent;
        color: var(--yt-spec-text-secondary, #606060);
        transition: background 0.15s, color 0.15s, border-color 0.15s;
      }
      #${BAR_ID} button:hover {
        background: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, 0.1));
        color: var(--yt-spec-text-primary, #0f0f0f);
      }
      #${BAR_ID} button.ytscc-active {
        background: var(--yt-spec-text-primary, #0f0f0f);
        border-color: transparent;
        color: var(--yt-spec-base-background, #fff);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function selectSpeed(speed) {
    settings.speed = clampSpeed(speed);
    chrome.storage.sync.set({ speed: settings.speed });
    // Apply immediately (even with enforcement toggled off) for instant feedback.
    const video = getVideo();
    if (video) video.playbackRate = settings.speed;
    updateActiveButtons();
  }

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
    const target = clampSpeed(settings.speed);
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
