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
  // Sent back here by remote.html when the timer dropped this phone, or it was unpaired there
  const LEFT = { revoked: 'The timer took this phone’s control away. To connect again, ask for a new code.', refused: 'The timer didn’t let this phone in. To try again, ask for a new code.', unpaired: 'This phone is unpaired. To connect to a timer, type the code it shows.' };
  const left = new URLSearchParams(location.search).get('left');
  if (LEFT[left]) msg(LEFT[left], left === 'unpaired' ? '' : 'bad');

  code.addEventListener('input', () => {
    const v = code.value.replace(/\D/g, '').slice(0, 6);
    code.value = v;
    if (v.length === 6) claim(v);
  });
  // In the box from the start, and again after a tap anywhere (phones only raise the keyboard from
  // a tap) or on coming back to this page
  const refocus = () => { if (!code.disabled && document.activeElement !== code) code.focus(); };
  code.focus();
  document.addEventListener('click', refocus);
  window.addEventListener('focus', refocus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refocus(); });

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
