// ==UserScript==
// @name         Audio player in header
// @namespace    https://dtf.ru/
// @version      2026-02-01
// @description  Pin playing audio into the header with post link
// @author       g0ated <https://dtf.ru/id79490>
// @match        https://dtf.ru/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.__dtfPinnedAudioInited) return;
  window.__dtfPinnedAudioInited = true;

  const HOST_ID = '__dtfPinnedAudioHost';
  const AUDIO_ID = '__dtfPinnedAudioPlayer';
  const LINK_ID = '__dtfPinnedAudioLink';

  let hostEl = null;
  let headerAudio = null;
  let sourceAudio = null;
  let currentTrack = null;
  let syncing = false;

  /**
   * Injects the player styles once.
   */
  function ensureStyles() {
    if (document.getElementById('__dtfPinnedAudioStyle')) return;
    const style = document.createElement('style');
    style.id = '__dtfPinnedAudioStyle';
    style.textContent = `
#${HOST_ID} {
  display: none;
  flex: 1 1 auto;
  align-self: stretch;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 2px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  max-height: var(--layout-header-height-large, 64px);
  overflow: hidden;
  padding: 2px 0;
}
#${HOST_ID} a {
  color: inherit;
  text-decoration: none;
  font-weight: 600;
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}
#${HOST_ID} a:hover { text-decoration: underline; }
#${HOST_ID} audio {
  width: 100%;
  height: 28px;
}
@media (max-width: 900px) {
  #${HOST_ID} { max-width: 100%; }
}
`;
    document.documentElement.appendChild(style);
  }

  /**
   * Ensures the host container exists in the header.
   * @returns {HTMLDivElement|null}
   */
  function ensureHost() {
    ensureStyles();

    const header = document.querySelector('.header__main');
    if (!header) return null;

    if (!hostEl) {
      hostEl = document.createElement('div');
      hostEl.id = HOST_ID;
      hostEl.innerHTML = `
<a id="${LINK_ID}" href="#" rel="noopener" data-router-link>Audio</a>
`;
    }

    if (hostEl.parentElement !== header) {
      header.appendChild(hostEl);
    }

    return hostEl;
  }

  /**
   * Shows the header player host.
   */
  function showHost() {
    const host = ensureHost();
    if (host) host.style.display = 'flex';
  }

  /**
   * Hides the header player host.
   */
  function hideHost() {
    if (hostEl) hostEl.style.display = 'none';
  }

  /**
   * Builds a lightweight anchor element with text.
   * @param {string} href
   * @param {string} text
   * @returns {HTMLAnchorElement}
   */
  function buildVirtualLink(href, text) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text || 'Audio';
    return a;
  }

  /**
   * Finds the post link for the audio source element.
   * @param {Element} fromEl
   * @returns {HTMLAnchorElement|null}
   */
  function findPostLink(fromEl) {
    let node = fromEl;
    while (node && node !== document.documentElement) {
      if (node.querySelector) {
        const titleLink = node.querySelector('.content-title a');
        if (titleLink) return titleLink;

        const dateLink = node.querySelector('.content-header__date a');
        if (dateLink) {
          const title = node.querySelector('.content-title')?.textContent?.trim();
          return buildVirtualLink(dateLink.href, title || dateLink.textContent?.trim());
        }
      }
      node = node.parentElement;
    }
    const canonical = document.querySelector('link[rel="canonical"]')?.href
      || document.querySelector('meta[property="og:url"]')?.content;
    if (canonical) {
      const title = document.querySelector('.content-title')?.textContent?.trim();
      return buildVirtualLink(canonical, title);
    }
    return null;
  }

  /**
   * Updates the header link to point to the source post.
   * @param {Element} fromEl
   */
  function setHeaderLink(fromEl) {
    const host = ensureHost();
    if (!host) return;
    const linkEl = host.querySelector(`#${LINK_ID}`);
    if (!linkEl) return;

    const postLink = findPostLink(fromEl);
    if (postLink) {
      const url = new URL(postLink.href, window.location.href);
      linkEl.href = url.pathname + url.search + url.hash;
      linkEl.textContent = postLink.textContent?.trim() || 'Audio';
      linkEl.title = linkEl.textContent;
      if (currentTrack) {
        currentTrack.href = linkEl.href;
        currentTrack.linkEl = postLink;
        currentTrack.title = linkEl.textContent;
      }
    } else {
      linkEl.href = '#';
      linkEl.textContent = 'Audio';
      linkEl.removeAttribute('title');
    }
  }

  /**
   * Returns the best available media source URL.
   * @param {HTMLMediaElement} el
   * @returns {string}
   */
  function getAudioSrc(el) {
    return el?.currentSrc || el?.src || '';
  }

  /**
   * Removes the header audio element.
   */
  function detachHeaderAudio() {
    if (headerAudio) {
      headerAudio.pause();
      headerAudio.remove();
      headerAudio = null;
    }
  }

  /**
   * Restores and clears the current source audio element.
   */
  function cleanupSourceAudio() {
    if (!sourceAudio) return;
    sourceAudio.muted = false;
    delete sourceAudio.dataset.__dtfPinnedAudioSource;
    sourceAudio = null;
  }

  /**
   * Clears the header player and source state.
   */
  function clearPlayer() {
    detachHeaderAudio();
    cleanupSourceAudio();
    hideHost();
    currentTrack = null;
  }

  /**
   * Mirrors header playback time to the source element.
   */
  function syncSourceTime() {
    if (!sourceAudio || !headerAudio) return;
    if (syncing) return;
    syncing = true;
    try {
      sourceAudio.currentTime = headerAudio.currentTime;
      if (currentTrack) currentTrack.time = headerAudio.currentTime;
    } finally {
      syncing = false;
    }
  }

  /**
   * Binds header audio event handlers.
   */
  function attachHeaderAudioEvents() {
    if (!headerAudio) return;

    headerAudio.addEventListener('timeupdate', syncSourceTime);
    headerAudio.addEventListener('seeked', syncSourceTime);
    headerAudio.addEventListener('volumechange', () => {
      if (!sourceAudio || !headerAudio) return;
      sourceAudio.volume = headerAudio.volume;
      if (currentTrack) currentTrack.volume = headerAudio.volume;
    });

    headerAudio.addEventListener('ended', () => {
      if (headerAudio?.loop) return;
      clearPlayer();
    });
  }

  /**
   * Creates the header audio element from the source.
   * @param {HTMLAudioElement} fromEl
   */
  function makeHeaderAudio(fromEl) {
    detachHeaderAudio();

    headerAudio = fromEl.cloneNode(true);
    headerAudio.id = AUDIO_ID;
    headerAudio.dataset.__dtfPinnedAudioHeader = '1';
    headerAudio.muted = false;
    headerAudio.volume = fromEl.volume;
    headerAudio.playbackRate = fromEl.playbackRate;

    // Keep controls visible even if source lacked them.
    headerAudio.controls = true;

    headerAudio.currentTime = fromEl.currentTime || 0;

    hostEl.appendChild(headerAudio);
    attachHeaderAudioEvents();
  }

  /**
   * Activates the header player from a source audio element.
   * @param {HTMLAudioElement} fromEl
   */
  function activateFromSource(fromEl) {
    const host = ensureHost();
    if (!host) return;

    // Avoid loops when interacting with the header audio.
    if (fromEl.dataset.__dtfPinnedAudioHeader === '1') return;

    if (sourceAudio && sourceAudio !== fromEl) cleanupSourceAudio();

    sourceAudio = fromEl;
    sourceAudio.dataset.__dtfPinnedAudioSource = '1';
    sourceAudio.muted = true;
    sourceAudio.pause();
    sourceAudio.currentTime = fromEl.currentTime || 0;

    currentTrack = {
      src: getAudioSrc(fromEl),
      href: null,
      linkEl: null,
      title: null,
      time: fromEl.currentTime || 0,
      volume: fromEl.volume,
      playbackRate: fromEl.playbackRate
    };

    setHeaderLink(fromEl);
    makeHeaderAudio(fromEl);
    showHost();

    const playPromise = headerAudio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }

  /**
   * Type guard for audio elements.
   * @param {Element} el
   * @returns {el is HTMLAudioElement}
   */
  function isAudio(el) {
    return el instanceof HTMLAudioElement;
  }

  /**
   * Finds a post link by its href in the current DOM.
   * @param {string} href
   * @returns {HTMLAnchorElement|null}
   */
  function findPostLinkByHref(href) {
    if (!href) return null;
    return document.querySelector(`.content-title a[href="${CSS.escape(href)}"]`);
  }

  /**
   * Performs SPA-friendly navigation to a path.
   * @param {string} href
   */
  function softNavigate(href) {
    if (!href || href === '#') return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) {
      window.location.href = url.href;
      return;
    }

    if (tryRouterPush(url.pathname + url.search + url.hash)) return;

    const a = document.createElement('a');
    a.href = url.pathname + url.search + url.hash;
    a.setAttribute('data-router-link', '');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /**
   * Tries to access Vue Router and navigate with it.
   * @param {string} path
   * @returns {boolean}
   */
  function tryRouterPush(path) {
    const app = document.querySelector('#app')?.__vue_app__;
    const routerFromGlobals = app?.config?.globalProperties?.$router;
    if (routerFromGlobals?.push) {
      routerFromGlobals.push(path).catch(() => {});
      return true;
    }

    const provides = app?._context?.provides;
    if (!provides) return false;
    for (const key of Reflect.ownKeys(provides)) {
      const candidate = provides[key];
      if (candidate?.push && candidate?.currentRoute) {
        candidate.push(path).catch(() => {});
        return true;
      }
    }
    return false;
  }

  /**
   * Wires the header link click handler.
   */
  function wireHeaderLink() {
    const host = ensureHost();
    if (!host) return;
    const linkEl = host.querySelector(`#${LINK_ID}`);
    if (!linkEl || linkEl.dataset.__dtfPinnedAudioClick) return;
    linkEl.dataset.__dtfPinnedAudioClick = '1';
    linkEl.addEventListener('click', (e) => {
      if (!currentTrack?.href) return;
      e.preventDefault();
      if (currentTrack.linkEl && document.contains(currentTrack.linkEl)) {
        currentTrack.linkEl.click();
        return;
      }
      softNavigate(currentTrack.href);
    });
  }

  document.addEventListener('play', (e) => {
    if (!isAudio(e.target)) return;
    activateFromSource(e.target);
  }, true);

  /**
   * Ensures the host survives SPA re-renders and rebinds to audio.
   */
  function startHostObserver() {
    new MutationObserver(() => {
      if (hostEl && !document.contains(hostEl)) {
        hostEl = null;
        if (headerAudio) {
          // Keep header audio alive by recreating host and reattaching.
          const oldAudio = headerAudio;
          headerAudio = null;
          ensureHost();
          hostEl.appendChild(oldAudio);
          headerAudio = oldAudio;
        }
      }
      if (!hostEl) ensureHost();
      wireHeaderLink();

      if (currentTrack?.src) {
        document.querySelectorAll('audio').forEach((el) => {
          if (el.dataset.__dtfPinnedAudioHeader === '1') return;
          if (el.dataset.__dtfPinnedAudioSource === '1') return;
          if (getAudioSrc(el) !== currentTrack.src) return;
          sourceAudio = el;
          sourceAudio.dataset.__dtfPinnedAudioSource = '1';
          sourceAudio.muted = true;
          sourceAudio.pause();
          sourceAudio.currentTime = currentTrack.time || 0;
          sourceAudio.volume = currentTrack.volume ?? sourceAudio.volume;
        });
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureHost();
      wireHeaderLink();
      startHostObserver();
    }, { once: true });
  } else {
    ensureHost();
    wireHeaderLink();
    startHostObserver();
  }
})();
