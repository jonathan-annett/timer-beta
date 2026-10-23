/*!
 * help-overlay.js
 * Shows the README as an overlay (rendered by markdown-lite.js). Used by the timer's main
 * screen and the run sheet editor.
 *
 *   const help = HelpOverlay.install({ section: 'quick-start', canOpen: () => true });
 *   help.open('run-sheet');
 *
 * Static deployments usually only copy public/, so it loads README.md next to the page
 * if there is one, otherwise the copy on GitHub, otherwise shows a link.
 * MIT Licensed
 */

/* global MarkdownLite */

var HelpOverlay = (function () {
  'use strict';

  const REPO = 'https://github.com/jonathan-annett/timer-beta';
  const SOURCES = ['README.md', 'https://raw.githubusercontent.com/jonathan-annett/timer-beta/main/README.md'];
  const QUICK_LINKS = [['quick-start', 'Quick start'], ['run-sheet', 'Run sheet'], ['stream-deck', 'Stream Deck'], ['phone-remote-control-experimental', 'Phone'], ['keyboard-reference', 'Keys'], ['button-size-browser-zoom', 'Button size']];

  // Keys that still reach the page while help is open: the clicker keeps running the show,
  // and Cmd shortcuts belong to the browser.
  const PASS_THROUGH = new Set(['PageDown', 'PageUp']);

  function install(opts) {
    opts = Object.assign({ section: 'quick-start', canOpen: () => true }, opts || {});
    let root = null, body = null, loaded = null, observer = null;

    function build() {
      root = document.createElement('div');
      root.id = 'help';
      root.hidden = true;
      root.innerHTML =
        '<div class="help-panel" role="dialog" aria-label="Help">' +
          '<div class="help-bar"><b>Help</b><span class="help-links">' +
            QUICK_LINKS.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('') +
          '</span><a id="help-gh" target="_blank" rel="noopener">Open on GitHub ↗</a>' +
          '<button id="help-close" aria-label="Close help">✕</button></div>' +
          '<div id="help-body" class="md" tabindex="-1"></div>' +
        '</div>';
      document.body.appendChild(root);
      body = root.querySelector('#help-body');

      root.querySelector('#help-close').addEventListener('click', close);
      root.addEventListener('click', e => {
        if (e.target === root) { close(); return; }                       // click outside the panel
        const a = e.target.closest('a[href^="#"]');
        if (a) { e.preventDefault(); jumpTo(a.getAttribute('href').slice(1)); }
      });
    }

    async function load() {
      for (const url of SOURCES) {
        try {
          const r = await fetch(url, { cache: 'no-cache' });
          if (!r.ok) continue;
          const text = await r.text();
          if (!/^\s*#/.test(text)) continue;                               // e.g. a host's HTML 404 page
          body.innerHTML = MarkdownLite.render(text, { linkBase: REPO + '/blob/main/' });
          unlinkSelf();
          return true;
        } catch (_) { /* offline or blocked: try the next source */ }
      }
      body.innerHTML = `<p class="help-status">Couldn't load the help here. Read it on GitHub: ` +
        `<a href="${REPO}#readme" target="_blank" rel="noopener">${REPO}</a></p>`;
      return false;
    }

    // Links to this site's own pages (e.g. the README's "Try it" link to the timer) are shown as
    // plain text: you're already in it, and on the phone remote it would open a second timer.
    function unlinkSelf() {
      body.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        if (!href || href[0] === '#') return;
        let u;
        try { u = new URL(href, location.href); } catch (_) { return; }
        if (u.origin !== location.origin) return;
        const span = document.createElement('span');
        span.textContent = a.textContent;
        a.replaceWith(span);
      });
    }

    function jumpTo(id) {
      const el = id && document.getElementById(id);
      if (!el || !body.contains(el)) return;
      body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top;
      el.classList.remove('help-flash'); void el.offsetWidth; el.classList.add('help-flash');
    }

    function open(section) {
      if (!opts.canOpen()) return false;
      if (!root) build();
      section = section || opts.section;
      root.hidden = false;
      root.querySelector('#help-gh').href = REPO + '#' + section;
      if (!loaded) {
        body.innerHTML = '<p class="help-status">Loading help…</p>';
        loaded = load();
      }
      loaded.then(() => jumpTo(section));
      body.focus({ preventScroll: true });                                  // arrows / Space scroll the help
      // Close if the page switches to a view where help isn't allowed (e.g. presenter mode)
      observer = observer || new MutationObserver(() => { if (isOpen() && !opts.canOpen()) close(); });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return true;
    }

    function close() {
      if (root) root.hidden = true;
      if (observer) observer.disconnect();
    }

    const isOpen = () => !!root && !root.hidden;
    const toggle = section => (isOpen() ? close() : open(section));

    // Window capture phase: runs before any page handler (including document capture listeners)
    window.addEventListener('keydown', e => {
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (isOpen()) {
        if (e.key === 'Escape' || e.key === 'F1' || (e.key === '?' && !e.ctrlKey && !e.metaKey)) {
          e.preventDefault(); e.stopPropagation(); close();
        } else if (!PASS_THROUGH.has(e.key) && !e.metaKey) {
          e.stopPropagation();          // keep the page's shortcuts quiet; default scrolling still happens
        }
        return;
      }
      if (e.key === 'F1' || (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        if (!opts.canOpen()) return;
        e.preventDefault(); e.stopPropagation();
        open();
      }
    }, true);

    return { open, close, toggle, isOpen };
  }

  return { install };
})();
