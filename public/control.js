/*!
 * control.js
 * control.html: pairs this phone with a timer by the 6-digit code its share panel shows (pairing
 * server protocol 6), then opens remote.html with the link the timer sends (remote control or
 * countdown display, as chosen on the timer). remote.html then does the proximity check.
 * Server: ?remote= or this site's default.
 * MIT Licensed
 */

/* global RemotePeer */

(function () {
  'use strict';

  const code = document.getElementById('code'), msgEl = document.getElementById('msg');
  const server = new URLSearchParams(location.search).get('remote') || RemotePeer.defaultServer();
  const msg = (text, kind) => { msgEl.textContent = text; msgEl.className = kind || ''; };

  code.addEventListener('input', () => {
    const v = code.value.replace(/\D/g, '').slice(0, 6);
    code.value = v;
    if (v.length === 6) claim(v);
  });
  code.focus();

  function claim(c) {
    msg('Checking…');
    code.disabled = true;
    const retry = text => { msg(text, 'bad'); code.disabled = false; code.value = ''; code.focus(); };
    RemotePeer.claim(server, c, {
      onWait: () => msg('Found it. Connecting…', 'ok'),
      onGranted: frag => {
        const l = new URLSearchParams(frag);
        if (!l.get('r') || !(l.get('k') || l.get('v'))) return retry('The timer sent something unexpected. Try again.');
        location.replace('remote.html#' + frag);
      },
      onError: reason => retry(RemotePeer.CLAIM_ERRORS[reason] || 'Pairing failed: ' + reason),
    });
  }
})();
