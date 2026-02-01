// ==UserScript==
// @name         Clickable blocked list
// @namespace    https://dtf.ru/
// @version      2026-02-01
// @description  Make blocked users list clickable in feed settings
// @author       g0ated <https://dtf.ru/id79490>
// @match        https://dtf.ru/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  if (window.__dtfClickableBlockedListInited) return;
  window.__dtfClickableBlockedListInited = true;

  /**
   * Map of normalized displayed user names -> absolute profile URLs.
   * Populated from the API response and used to linkify DOM entries.
   * @type {Map<string, string>}
   */
  const urlByName = new Map();

  /**
   * Normalizes user-displayed names for stable map lookups.
   * Collapses whitespace, trims, and lowercases.
   *
   * @param {string|null|undefined} s
   * @returns {string}
   */
  const normName = (s) => (s ?? "").toString().trim().replace(/\s+/g, " ").toLowerCase();

  /**
   * Builds an absolute DTF profile URL from a user-like object returned by the API.
   * Prefers `uri` when present (e.g. "/nickname"), otherwise falls back to "id<ID>".
   *
   * @param {{ uri?: string, id?: number }} u
   * @returns {string|null} Absolute profile URL or null if it cannot be derived.
   */
  function buildProfileUrl(u) {
    return (u?.uri && u.uri !== "")
      ? ("https://dtf.ru" + u.uri)
      : (u?.id != null ? ("https://dtf.ru/id" + u.id) : null);
  }

  /**
   * Installs a fetch hook that listens for the blocked-users API call and forwards
   * its parsed JSON response to `callback`.
   *
   * Notes:
   * - Does NOT initiate a request; it only observes the site's own request.
   * - Uses Response.clone() to avoid consuming the body for the original code.
   *
   * @param {(json: any) => void} callback Function invoked with the parsed JSON response.
   * @returns {void}
   */
  function onBlockedUsersResponse(callback) {
    const API_RE = /\/(?:v\d+(?:\.\d+)*\/)?ignores\/subsites(?:[/?#]|$)/i;

    const origFetch = window.fetch;
    window.fetch = async function(input, init) {
      const resp = await origFetch.apply(this, arguments);
      try {
        const url = typeof input === "string" ? input : input?.url;
        if (url && API_RE.test(String(url))) {
          resp.clone().json().then(callback).catch(() => {});
        }
      } catch {}
      return resp;
    };
  }

  /**
   * Ensures the provided name element contains a single clickable <a> pointing
   * to `profileUrl`. The function is idempotent: safe to call repeatedly.
   *
   * @param {HTMLElement|null} nameEl Element containing the user's displayed name.
   * @param {string|null} profileUrl Absolute URL of the user's profile.
   * @returns {void}
   */
  function ensureNameLink(nameEl, profileUrl) {
    if (!nameEl || !profileUrl) return;
    if (nameEl.dataset.dtfLinked === "1") return;

    if (nameEl.querySelector("a")) {
      nameEl.dataset.dtfLinked = "1";
      return;
    }

    const a = document.createElement("a");
    a.href = profileUrl;
    a.rel = "noopener noreferrer";
    a.style.color = "inherit";
    a.style.textDecoration = "none";
    a.style.cursor = "pointer";

    while (nameEl.firstChild) a.appendChild(nameEl.firstChild);
    nameEl.appendChild(a);

    nameEl.dataset.dtfLinked = "1";
  }

  /**
   * Scans the current page for blocked-user items and wraps their name elements
   * with profile links, if a matching URL exists in `urlByName`.
   *
   * Runs only on "/settings/feeds" (SPA navigation supported elsewhere via route hooks).
   *
   * @returns {void}
   */
  function linkify() {
    if (!location.pathname.startsWith("/settings/feeds")) return;

    const items = document.querySelectorAll("div.feeds-settings-blocked__item");
    for (const item of items) {
      const nameEl = item.querySelector("div.feeds-settings-blocked__name");
      if (!nameEl) continue;

      const name = normName(nameEl.textContent);
      if (!name) continue;

      const url = urlByName.get(name);
      if (!url) continue;

      ensureNameLink(nameEl, url);
    }
  }

  let rafScheduled = false;

  /**
   * Coalesces multiple rapid triggers (DOM mutations, route changes, API response)
   * into a single call to `linkify()` per animation frame.
   *
   * @returns {void}
   */
  function scheduleLinkify() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      linkify();
    });
  }

  onBlockedUsersResponse((json) => {
    const users = Array.isArray(json?.result) ? json.result : [];
    for (const u of users) {
      const url = buildProfileUrl(u);
      if (url && u?.name) urlByName.set(normName(u.name), url);
    }
    scheduleLinkify();
  });

  /**
   * Starts a single MutationObserver for the lifetime of the SPA session.
   * The observer triggers `scheduleLinkify()` when new blocked-user items are rendered.
   *
   * @returns {void}
   */
  function startObserverOnce() {
    if (window.__dtfClickableBlockedObserverStarted) return;
    window.__dtfClickableBlockedObserverStarted = true;

    /**
     * Attaches MutationObserver to document.body once it exists.
     * @returns {void}
     */
    const start = () => {
      if (!document.body) return;
      new MutationObserver(scheduleLinkify).observe(document.body, { childList: true, subtree: true });
      scheduleLinkify();
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }
  startObserverOnce();

  /**
   * Route-change handler for SPA navigation.
   * Triggers a linkify pass when the path changes.
   *
   * @returns {void}
   */
  function onRouteChange() {
    scheduleLinkify();
  }

  const _pushState = history.pushState;

  /**
   * Monkey-patches History.pushState to detect SPA route changes and trigger linkify.
   *
   * @this {History}
   * @returns {*}
   */
  history.pushState = function() {
    const r = _pushState.apply(this, arguments);
    onRouteChange();
    return r;
  };

  const _replaceState = history.replaceState;

  /**
   * Monkey-patches History.replaceState to detect SPA route changes and trigger linkify.
   *
   * @this {History}
   * @returns {*}
   */
  history.replaceState = function() {
    const r = _replaceState.apply(this, arguments);
    onRouteChange();
    return r;
  };

  window.addEventListener("popstate", onRouteChange);

})();
