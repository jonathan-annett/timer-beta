# Presentation Timer (beta)

A keyboard-driven countdown timer for talks, conferences and live events. One window is the operator's controller; a second window shows a clean countdown on the stage display. It also works with a Stream Deck, a remote display over the network, and on phones and tablets.

**Try it:** https://timer.sophtwhere.com/beta/

---

## Quick start

1. **Open the timer** in Chrome or Edge on the computer you'll operate from.
2. **Pick a duration**: click a preset (10, 20, 30, 45, 60, 90 min, 2h, 3h), or type the minutes (e.g. `4` `5`) and press **Enter**. For hours, type `1` `:` `30` for 1 h 30 min.
3. **Press Space** to start. Press **Space** again any time to restart from the full duration.
4. **Show it on the stage screen**: press **R** (or click *display* at the bottom) to open the presenter window. Drag it to the stage display and press **F** for fullscreen.
5. **During the talk**:
   - **Ctrl+↑ / Ctrl+↓** adds or removes a minute.
   - **"** (or numpad **/**) pauses and resumes.
   - **C** sends a message to the presenter: type it and press **Enter**. Press **C** again to clear it.
   - The countdown turns **orange** in the last minute and **red** once time is up, then counts the overtime.

That's all you need for most events. Everything below is optional.

---

## Keyboard reference

### Setting and starting

| Key | Action |
|---|---|
| digits, then **Enter** | Set the default duration in minutes (`:` separates hours, e.g. `1:30`) |
| digits, then **Space** | Start that duration once, without changing the default |
| **Space** | Start / restart with the default duration |
| **Shift+Space** or **X** | Extend the running timer to the default duration |
| **Backspace** | Edit the typed duration |
| **[** / **]** | Default duration −/+ 1 second |
| **{** / **}** | Default duration −/+ 1 minute |

### Adjusting a running timer

| Key | Action |
|---|---|
| **Ctrl+↑ / Ctrl+↓** | Add / remove 1 minute (applied immediately) |
| **↑ / ↓** | Add / remove 1 second. The timer runs fast or slow until it reaches the new time; **Ctrl+Enter** or the **catch up** button jumps straight there |
| **Shift+↑ / Shift+↓** | Move the start time earlier / later (changes elapsed time, not the end) |
| **← / →** | Shift the whole timer (start and end) by 1 second; with **Ctrl**, 1 minute |
| **"** or numpad **/** | Pause / resume |
| **'** or **Tab** | Undo pauses (restore the original end time) |

### Display

| Key | Action |
|---|---|
| **R** | Open / close the presenter window |
| **F** | Fullscreen on / off |
| **P** | Toggle presenter mode in this window (hides controls) |
| **S** | Single-screen mode: presenter view, fullscreen, in this window |
| **B** | Progress bar on / off |
| **T** | Show the time of day |
| **M** | Messages on / off |
| **C** | Write a message for the presenter (**Enter** to show, **C** again to clear) |
| **O** | Picture-in-picture countdown overlay (stays on top of other apps) |
| **^** | PowerPoint mode: a clicker's **Page Down** restarts the timer |
| **D** | Stream Deck layout editor |
| **Ctrl+S** | Edit the timer's styles (CSS); **Ctrl+Shift+S** resets them |

### Clock accuracy

On first load the timer checks the time against an internet time service, so two computers stay in sync even if one clock is off. **Shift+T** re-checks; **Shift+L** ignores it and uses this computer's clock.

---

## Stream Deck

Works with the Stream Deck **Mini**, **MK.2** (and original) and **XL**, straight from the browser with no Elgato software or plugin.

1. **Quit the Elgato Stream Deck app.** It holds the device otherwise.
2. Use **Chrome or Edge** on a desktop.
3. Press **D** (or click **deck**), then **Connect deck** and choose it in the browser's prompt.

It reconnects automatically after that. The **deck** button shows **deck ✓** while connected.

In the editor you can drag actions from the palette onto keys, set per-key labels and colours, and import or export layouts as JSON. Each model keeps its own layout. Useful actions include:

- **Presets** and **controls**: start, pause, ±1 min, ±15 s, clear pauses.
- **Countdown keys**: show the remaining time on the deck. *Min / Hr* and *Sec / Min* work as a pair: `01` `30` for 90 seconds, `1h` `25m` for 85 minutes, and `+00` `45` in overtime. *Timer* shows the whole time on one key.
- **Display toggles**: bar, clock and messages.
- **Messages**: drag a *Message* action onto a key, and its text field opens in the editor. Pressing the key shows that message on the presenter screen; pressing it again clears it. The key lights up while its message is showing. *Clear message* removes whatever is showing, and *Type message* opens the on-screen message box. The XL comes with three examples (*Please wrap up*, *Speak up*, *Time for questions*).
- **Catch up**: lights up while the timer is running fast or slow after a nudge; press it to jump straight to the adjusted time.
- **Backlight**: steps the deck's brightness 100 → 50 → 25 → 10% for dark venues. You can also set it in the editor, and it's remembered.

**Disconnect** releases the deck and stops it reconnecting until you click Connect again. **Forget deck** removes the browser's permission entirely.

> Key images are tested against a simulated deck. If they appear rotated on a real Mini, please open an issue.

---

## Remote display

Click **share** to get a room code (e.g. `TIGER-7`), a QR code and a link. Anyone opening the link sees a read-only countdown on their phone, tablet or another computer, on any network. On the same Wi-Fi it switches to a direct peer-to-peer connection automatically.

> This needs the relay server (see below). It does not work on a plain static host such as the beta site.

---

## Phones and tablets

On a touch screen the controller shows a bottom bar (presets, start, pause, ±1 min), and the clock face responds to gestures:

| Gesture | Action |
|---|---|
| Double-tap | Start / restart |
| Long-press | Pause / resume |
| Swipe right / left | +1 / −1 minute |
| Swipe up / down | +15 / −15 seconds |

The first time you open it on a phone, it asks how long your talk is.

---

## Running it yourself

### Static hosting (no server code)

Copy the contents of `public/` to any static web host. It must be served over **HTTPS**. Everything works except **share** and the remote display.

### With the relay server (adds remote display)

Requires Node.js 18 or later.

```bash
npm install
DOMAIN=https://timer.example.com PORT=3000 node relay-server.js
```

Or pass `--domain` and `--port` as arguments. The server serves `public/` and handles the WebSocket relay and WebRTC signalling on the same port. Put it behind HTTPS; if you use a reverse proxy, it must pass WebSocket upgrades.

---

## Development

No build step: it's plain HTML, CSS and JavaScript. See [`CLAUDE.md`](CLAUDE.md) for the architecture, conventions and known issues before changing anything.

## Licence

MIT. Original timer by Jonathan Annett.
