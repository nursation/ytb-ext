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

  /* ---------- orchestration ---------- */

  function applyAll() {
    const video = getVideo();
    if (video) hookVideo(video);
    applySpeed();
    disableCaptions();
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
