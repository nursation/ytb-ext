# YouTube Speed & Caption Control

A Chrome (Manifest V3) extension that:

- **Always forces your chosen playback speed.** Pick a speed in the popup and
  every YouTube video plays at that speed. If YouTube resets it (e.g. when a new
  video starts), the extension pushes it straight back.
- **Always keeps captions off.** Whenever subtitles turn on, they're switched
  back off automatically.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser — Edge, Brave…).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`...\repos\youtube`).
4. Pin the extension and click its icon to choose your speed.

To update after editing a file, return to `chrome://extensions` and click the
**reload** ↻ icon on the extension card.

## Using it

Click the toolbar icon to open the popup:

- **Extension enabled** — master on/off switch.
- **Speed** — drag the slider, tap a preset, or type a custom value
  (0.0625×–16×). Changes save automatically and apply to open YouTube tabs.
- **Always turn off captions** — toggle caption suppression.

Settings are stored with `chrome.storage.sync`, so they follow your Chrome
profile across devices.

## How it works

`content.js` runs on `*.youtube.com`. YouTube is a single-page app that swaps
videos without reloading, so the script reapplies your settings on several
triggers:

- the `<video>` element's own events (`ratechange`, `loadstart`, `play`, …) —
  the `ratechange` listener is what re-forces the speed instantly;
- YouTube's SPA navigation events (`yt-navigate-finish`);
- a debounced `MutationObserver` on the page;
- a 1-second interval as a final safety net.

Captions are turned off by clicking the player's subtitles button only when it
reports `aria-pressed="true"` (i.e. captions are currently on).

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `content.js` | Forces speed + disables captions on YouTube |
| `popup.html` / `popup.css` / `popup.js` | Settings UI |
| `icons/` | Toolbar icons |

## Notes

- Setting the speed directly on the video element changes actual playback; the
  speed shown inside YouTube's own settings menu may still read "Normal" — that's
  cosmetic, the playback speed is correct.
- The extension needs no network access and requests only the `storage`
  permission plus access to YouTube pages.
