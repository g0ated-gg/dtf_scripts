// ==UserScript==
// @name         Default media volume
// @namespace    https://dtf.ru/
// @version      2026-02-01
// @description  Default volume for HTML5 video/audio
// @author       g0ated <https://dtf.ru/id79490>
// @match        https://dtf.ru/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'dtf_default_media_volume';
  const DEFAULT_VOLUME = 1.0;

  /* ===================== volume helpers ===================== */

  /**
   * Coerce value to a finite number and clamp into [0, 1].
   * Falls back to DEFAULT_VOLUME when value is not finite.
   * @param {unknown} x
   * @returns {number}
   */
  function clamp01(x) {
    x = Number(x);
    if (!Number.isFinite(x)) return DEFAULT_VOLUME;
    return Math.min(1, Math.max(0, x));
  }

  /**
   * Read stored default volume from userscript storage.
   * @returns {number}
   */
  function getVolume() {
    return clamp01(GM_getValue(STORAGE_KEY, DEFAULT_VOLUME));
  }

  /**
   * Persist default volume to userscript storage.
   * @param {number} v
   */
  function setVolume(v) {
    GM_setValue(STORAGE_KEY, clamp01(v));
  }

  /**
   * Convert a volume (0..1) into integer percent.
   * @param {number} v
   * @returns {number}
   */
  function pctFromVolume(v) {
    return Math.round(clamp01(v) * 100);
  }

  /**
   * Convert percent (0..100) into a volume (0..1).
   * @param {unknown} p
   * @returns {number}
   */
  function volumeFromPct(p) {
    p = Number(p);
    if (!Number.isFinite(p)) return DEFAULT_VOLUME;
    return clamp01(p / 100);
  }

  /* ===================== media handling ===================== */

  /**
   * Apply the default volume to a media element.
   * @param {HTMLMediaElement} el
   * @param {boolean} [force=false] When true, ignore user-set flag.
   */
  function applyDefaultVolume(el, force = false) {
    if (!force && el.dataset.__dtfUserSetVolume === '1') return;
    if (force) delete el.dataset.__dtfUserSetVolume;
    el.volume = getVolume();
  }

  /**
   * Attach handlers to a media element and mark it as hooked.
   * @param {Element} el
   */
  function hookMedia(el) {
    if (!(el instanceof HTMLMediaElement)) return;
    if (el.dataset.__dtfDefaultVolHooked === '1') return;
    el.dataset.__dtfDefaultVolHooked = '1';

    applyDefaultVolume(el);

    el.addEventListener('play', () => applyDefaultVolume(el), true);

    el.addEventListener('volumechange', (e) => {
      if (!el.paused && e.isTrusted) el.dataset.__dtfUserSetVolume = '1';
    }, true);
  }

  /**
   * Find all current media elements in the document and hook them.
   */
  function scanMedia() {
    document.querySelectorAll('video,audio').forEach(hookMedia);
  }

  /**
   * Observe DOM mutations to hook dynamically added media elements.
   */
  function startMediaObserver() {
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.('video,audio')) hookMedia(node);
          node.querySelectorAll?.('video,audio').forEach(hookMedia);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener('play', (e) => {
    if (e.target instanceof HTMLMediaElement) hookMedia(e.target);
  }, true);

  /* ===================== overlay UI ===================== */

  let overlayEl = null;

  /**
   * Inject overlay CSS once per page.
   */
  function ensureOverlayStyles() {
    if (document.getElementById('__dtfVolOverlayStyle')) return;

    const style = document.createElement('style');
    style.id = '__dtfVolOverlayStyle';
    style.textContent = `
#__dtfVolOverlay {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  width: 320px;
  max-width: calc(100vw - 32px);
  padding: 12px;
  border-radius: 12px;

  color-scheme: light dark;

  background: rgba(246, 247, 249, 0.96);
  color: #111827;
  border: 1px solid rgba(17, 24, 39, 0.12);
  box-shadow: 0 10px 26px rgba(0,0,0,.18);

  --dtf-accent: #2563eb; /* light */
}

@media (prefers-color-scheme: dark) {
  #__dtfVolOverlay {
    background: rgba(24, 24, 27, 0.94);
    color: rgba(255, 255, 255, 0.92);
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow: 0 14px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.15);

    --dtf-accent: #93c5fd; /* dark */
  }
}

#__dtfVolOverlayHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

#__dtfVolOverlayTitle {
  font-weight: 600;
}

#__dtfVolOverlayClose {
  border: 0;
  background: transparent;
  color: inherit;
  opacity: .75;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 8px;
}
#__dtfVolOverlayClose:hover {
  opacity: 1;
  background: rgba(127,127,127,.18);
}

#__dtfVolOverlayRow {
  display: flex;
  align-items: center;
  gap: 10px;
}

#__dtfVolOverlayValue {
  min-width: 52px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

#__dtfVolOverlayRange {
  flex: 1;
  width: 100%;
  margin: 0;

  accent-color: var(--dtf-accent);
}

#__dtfVolOverlayRange {
  background: linear-gradient(
    to right,
    rgba(0,0,0,.12),
    rgba(0,0,0,.12)
  );
  border-radius: 999px;
  height: 20px;
}

@media (prefers-color-scheme: dark) {
  #__dtfVolOverlayRange {
    background: linear-gradient(
      to right,
      rgba(255,255,255,.22),
      rgba(255,255,255,.22)
    );
  }
}
`;
    document.documentElement.appendChild(style);
  }

  /**
   * Build and mount the overlay; wire up UI handlers.
   * @returns {HTMLDivElement}
   */
  function createOverlay() {
    ensureOverlayStyles();

    const el = document.createElement('div');
    el.id = '__dtfVolOverlay';
    el.innerHTML = `
<div id="__dtfVolOverlayHeader">
  <div id="__dtfVolOverlayTitle">Default media volume</div>
  <button id="__dtfVolOverlayClose" type="button" aria-label="Close">✕</button>
</div>

<div id="__dtfVolOverlayRow">
  <input id="__dtfVolOverlayRange" type="range" min="0" max="100" step="1">
  <div id="__dtfVolOverlayValue">—%</div>
</div>
`;
    document.body.appendChild(el);

    const range = el.querySelector('#__dtfVolOverlayRange');
    const valueEl = el.querySelector('#__dtfVolOverlayValue');
    const closeBtn = el.querySelector('#__dtfVolOverlayClose');

    const currentPct = pctFromVolume(getVolume());
    range.value = String(currentPct);
    valueEl.textContent = `${currentPct}%`;

    range.addEventListener('input', () => {
      const pct = Math.min(100, Math.max(0, Number(range.value)));
      valueEl.textContent = `${pct}%`;
      setVolume(volumeFromPct(pct));
      document.querySelectorAll('video,audio').forEach((el) => applyDefaultVolume(el, true));
    });

    closeBtn.addEventListener('click', hideOverlay);

    return el;
  }

  /**
   * Show the overlay, waiting for body if needed.
   */
  function showOverlay() {
    const ensure = () => {
      if (!document.body) return false;
      if (!overlayEl) overlayEl = createOverlay();
      overlayEl.style.display = 'block';
      return true;
    };

    if (!ensure()) {
      document.addEventListener('DOMContentLoaded', ensure, { once: true });
    }
  }

  /**
   * Hide the overlay if it exists.
   */
  function hideOverlay() {
    if (overlayEl) overlayEl.style.display = 'none';
  }

  /**
   * Toggle overlay visibility.
   */
  function toggleOverlay() {
    if (!overlayEl || overlayEl.style.display === 'none') showOverlay();
    else hideOverlay();
  }

  GM_registerMenuCommand('Set default volume…', toggleOverlay);

  /* ===================== start ===================== */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scanMedia();
      startMediaObserver();
    }, { once: true });
  } else {
    scanMedia();
    startMediaObserver();
  }
})();
