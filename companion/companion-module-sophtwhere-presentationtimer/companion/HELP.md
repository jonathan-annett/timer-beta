# Presentation Timer

Controls the [Presentation Timer](https://timer.sophtwhere.com/) — a browser-based countdown for talks and events — from Companion. The timer runs in a browser (on this computer or anywhere else); Companion joins it over the timer's pairing server, the same way a phone remote does.

## Connecting

1. Open the timer in Chrome or Edge and click **share** in its button bar.
2. Pick **Companion** as the link type. The panel shows a link instead of a QR code.
3. Copy that link into **Link from the timer** in this connection's settings and save.

The connection shows **Connected** within a second or two. The panel on the timer closes by itself once Companion is in.

The link carries a key: anyone with it can control that timer, so treat it like a password. **New code** in the timer's panel revokes every link, including this one.

**Require a PIN:** if that box is ticked on the timer, Companion's status reads *PIN needed on the timer* and the log shows a 4-digit PIN; type it in the timer’s share panel. The approval is remembered (the token is kept in this connection's config), so a restart doesn't ask again.

**Server:** leave blank. The link says which pairing server the timer uses (normally `wss://<timer host>:8443/`). Fill it in only for your own copy of the timer on a different server. **Allow self-signed certificates** is for a test server only.

The timer must be open in its browser tab for anything to work: Companion talks to the page, not to a server. If the tab is closed the status reads *The timer is not open*, and Companion reconnects when it comes back.

## Actions

Everything the timer's keyboard does, plus some conveniences:

- **Start a countdown** — duration, optional message, optionally also set as the default. Durations: `12` (minutes), `1:30` (h:mm), `0:20:00` (h:mm:ss), `90s`, `20 min`, `1 h`. Variables and expressions work here, so other connections can drive countdowns (`$(schedule:next_duration)`).
- **Start / restart** with the default duration · **Set the default duration**
- **Pause / resume**, **Pause or resume (specific)**, **Undo pauses**
- **Add or remove time** (applied at once, like Ctrl+arrows) · **Nudge the end time** (eases, like ↑/↓) · **Catch up**
- **Show a message**, **Clear the message**, **Show a message, or clear it if it is already showing**
- **Toggle a display switch** / **Set a display switch** — progress bar, time of day, messages, presenter mode
- **Run sheet: Next / Back**
- **Video player** — play the cued video, stop, rewind
- **Send keystrokes** — any keys from the timer's keyboard reference (`1,0,Enter`; `~` prefix = key up)
- **Send a raw timer API command** — the JSON object for `processTimerApiMessage` (see `timerapi.js` in the timer's source). `redirect` is refused.

## Variables

Every value the timer publishes, as it publishes it (at most a few times a second):

`remain` (the countdown as shown, `+` in overtime), its parts for big multi-key displays — `remain_hours`, `remain_minutes`, `remain_seconds` (two digits), `remain_sign` (`+` in overtime), `remain_total` (whole seconds, negative in overtime) and `remain_major` / `remain_minor` (minutes + seconds under an hour, `1h` + `25m` from an hour up, like the timer's Stream Deck keys) — `remain_actual`, `elapsed`, `default`, `startedAt`, `endsAt`, `pausing`, `paused`, `pauses`, `expired`, `impending`, `adjusting_up`, `adjusting_down`, `adjusting_delta`, `custommsg`, `showbar`, `showtimenow`, `showmessages`, `showpresenter`, `barpct`, `htmlclass`, `rs_active`, `rs_current`, `rs_next`, `rs_can_back`, `rs_status`, `rs_late`, `rs_title`, `rs_text`, `video_status`, `video_name`, the PowerPoint computers' `pptx_machines`, `pptx_current`, `pptx_showing` and `pptx_next_ready` (slides are advanced on those computers themselves), and `link_status` for this connection. Anything new the timer sends appears automatically.

## Feedbacks

Connected · Timer is paused · Under a minute left · Time is up · Catch up possible · A message is showing · The message showing is… · A display switch is on · Remaining time is under… · Run sheet mode is on · Run sheet behind / ahead of schedule · A video is cued · A video is playing · PowerPoint slide show running · Next item's deck ready.

## Presets

Ready-made buttons under **Countdown** (remaining time, with message, **Big:** one value per key in 44-point digits for building a large display across several keys, elapsed/ends at, connection status), **Controls**, **Durations**, **Messages**, **Display**, **Run sheet**, **Video** and **Slides**.

## Notes

- A time such as `1:02:03` can wrap at the colon on a small key. Use **Auto** size, or the **Big:** presets, which put one number on each key.

- One Companion connection per timer. For two timers, add two connections.
- Companion and the in-browser Stream Deck support can run at the same time; they are independent.
- The timer's own help (press **?** in it) covers the timer itself.
