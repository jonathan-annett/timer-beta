/*!
 * whats-new.js
 * After an update, a small toast on the timer page lists what's new: the releases in changelog.html
 * this browser hasn't seen. localStorage.whatsnew_seen holds the newest version seen. A new user's
 * first visit just records the latest (they get the quick start, not the history); someone who used
 * the timer before the change log existed sees the latest release once. The "next" section
 * (work on alpha, not released) is never shown. Not in the presenter window or P/S modes.
 *   window.WhatsNew.show(all)   show the toast now (all: the latest release even if seen)
 * MIT Licensed
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).has('presenter')) return;
  const SEEN = 'whatsnew_seen';
  // Someone who used the timer before (it has state; read now, before timer.js writes any) gets the
  // latest release the first time, even with nothing recorded (the change log came after them)
  const returning = (() => { try { return localStorage.getItem('startedAt') !== null; } catch (_) { return false; } })();
  const store = {
    get: () => { try { return localStorage.getItem(SEEN); } catch (_) { return null; } },
    set: v => { try { localStorage.setItem(SEEN, v); } catch (_) { /* private mode */ } },
  };

  const CSS = `
#whats-new { position: fixed; right: 16px; top: calc(var(--buttons-bottom, 70px) + 10px); z-index: 2147481000; width: 380px; max-width: calc(100vw - 32px);
  max-height: calc(100vh - var(--buttons-bottom, 70px) - 30px); overflow: auto; background: #151515; color: #ddd; border: 1px solid #2a6a9a; border-radius: 12px;
  padding: 14px 16px 12px; font: 14px/1.45 "Helvetica Neue", Arial, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.6);
  transform: translateY(12px); opacity: 0; transition: transform .25s, opacity .25s; }
#whats-new.in { transform: none; opacity: 1; }
#whats-new .wn-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
#whats-new .wn-head b { font-size: 16px; color: #fff; flex: 1; }
#whats-new .wn-x { background: none; border: 0; color: #888; font-size: 18px; cursor: pointer; padding: 0 4px; }
#whats-new h3 { font-size: 13px; color: #9ab; margin: 8px 0 2px; font-weight: normal; }
#whats-new ul { margin: 0; padding-left: 1.2em; }
#whats-new li { margin: 3px 0; }
#whats-new .wn-row { display: flex; gap: 8px; margin-top: 10px; }
#whats-new .wn-row a, #whats-new .wn-row button { flex: 1; text-align: center; padding: 8px; border-radius: 6px; font: inherit; cursor: pointer;
  text-decoration: none; border: 1px solid #444; background: #222; color: #eee; }
#whats-new .wn-row .wn-ok { background: #0b3d5c; border-color: #2a6a9a; color: #fff; }
@media (pointer: coarse) { #whats-new { left: 12px; right: 12px; width: auto; max-width: none; top: auto; bottom: calc(84px + env(safe-area-inset-bottom)); max-height: calc(100vh - 110px); font-size: 15px; } }
`;

  async function releases() {
    const r = await fetch('changelog.html', { cache: 'no-cache' });
    if (!r.ok) return [];
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    return [...doc.querySelectorAll('section.release[data-version]')]
      .map(s => ({ v: s.dataset.version, title: (s.querySelector('h2') || {}).textContent || s.dataset.version, list: s.querySelector('ul') }))
      .filter(x => x.v && x.v !== 'next' && x.list);
  }

  function toast(items, latest) {
    if (document.getElementById('whats-new')) return;
    if (!document.getElementById('whats-new-css')) {
      const st = document.createElement('style'); st.id = 'whats-new-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.id = 'whats-new';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="wn-head"><b>What’s new</b><button class="wn-x" aria-label="Close">✕</button></div><div class="wn-body"></div>' +
      '<div class="wn-row"><a class="wn-all" href="changelog.html" target="_blank" rel="noopener">All changes</a><button class="wn-ok">Got it</button></div>';
    const body = el.querySelector('.wn-body');
    for (const r of items) {
      if (items.length > 1) { const h = document.createElement('h3'); h.textContent = r.title; body.appendChild(h); }
      body.appendChild(document.importNode(r.list, true));   // the list as written in changelog.html (our own file)
    }
    const close = () => { store.set(latest); el.classList.remove('in'); setTimeout(() => el.remove(), 260); };
    el.querySelector('.wn-x').addEventListener('click', close);
    el.querySelector('.wn-ok').addEventListener('click', close);
    el.querySelector('.wn-all').addEventListener('click', () => store.set(latest));
    el.addEventListener('click', () => { if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur(); });   // the timer keeps its keys
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  }

  async function show(all) {
    let list;
    try { list = await releases(); } catch (_) { return; }
    if (!list.length) return;
    const latest = list[0].v, seen = store.get();
    if (!all && !seen && !returning) { store.set(latest); return; }   // a new user: nothing is "new"
    const i = seen ? list.findIndex(r => r.v === seen) : -1;
    const fresh = all ? list.slice(0, 1) : list.slice(0, i < 0 ? 1 : i).slice(0, 3);   // unknown version: just the latest
    if (!fresh.length) return;
    toast(fresh, latest);
  }

  window.WhatsNew = { show };
  // A moment after load, and not over a screen without controls (P/S modes)
  // (after the phone's first-run quick start, if that's up)
  const start = () => setTimeout(function later() {
    if (document.documentElement.classList.contains('reduced')) return;
    const qs = document.getElementById('quick-start-overlay');
    if (qs) { setTimeout(later, 2000); return; }       // (removed when it's done)
    show(false);
  }, 1500);
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
