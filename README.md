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

## Button size (browser zoom)

The browser's zoom changes only the size of the **buttons**. The countdown, messages, run sheet dashboard and run sheet editor size themselves to the window and stay the same.

| | Mac | Windows / Linux |
|---|---|---|
| Bigger buttons | **Cmd +** | **Ctrl +** |
| Smaller buttons | **Cmd −** | **Ctrl −** |
| Back to normal | **Cmd 0** | **Ctrl 0** |

At normal zoom the buttons fit in one row on screens 1280 pixels wide or more. On a smaller screen, zoom out (e.g. to 90%) to keep them on one row. For a touchscreen or a far-away operator position, zoom in; the buttons wrap onto more rows and everything below moves down to make room. Chrome remembers the zoom for the site, so set it once.

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
| **?** or **F1** | This guide, shown over the timer (main screen only, not in presenter or single-screen mode). The *help* link at the bottom does the same |
| **E** | Run sheet editor (opens in its own window) |
| **Page Down / Page Up** | Run sheet mode: next item / back. Otherwise, in PowerPoint mode, Page Down restarts the timer |
| **^** | PowerPoint mode: a clicker's **Page Down** restarts the timer |
| **D** | Stream Deck layout editor |
| **Ctrl+S** | Edit the timer's styles (CSS); **Ctrl+S** again saves. Only the rules you add or change are saved, so updates to the timer still come through. **Ctrl+Shift+S** resets them |

### Clock accuracy

On first load the timer checks the time against an internet time service, so two computers stay in sync even if one clock is off. **Shift+T** re-checks; **Shift+L** ignores it and uses this computer's clock.

---

## Run sheet

Load the show's running order and step through it with a presentation clicker, the Stream Deck, or the keyboard.

1. Press **E** (or click **run sheet**) to open the editor. It opens in its own window, so you can drag it to another screen. Its **?** button (or **F1**) shows this guide.
2. Paste your running order into **Add items** and click **Replace sheet**. Any of these work:
   - Rows copied from Excel or Google Sheets, with start times, names and/or durations in any order, with or without a header row.
   - A CSV file (**Open CSV…**).
   - One item per line, e.g. `9:00 Welcome` or `Keynote – 30 min`. Plain names work too: set **Minutes per item** (e.g. 20 per speaker).
3. Check the table and fix anything. Durations come from the gap to the next start time when they aren't given. A last row with only a start time (e.g. `17:00 Close`) is the finish time.

**During the show** (run sheet mode on):

| | |
|---|---|
| **Next** (Page Down, clicker, deck key, editor button) | Starts the next item: shows its name to the presenter, sets the timer to its duration and starts it. The start time goes into the log. |
| **Back** (Page Up, deck key, editor button) | Undoes the last Next exactly, as if it never happened: the previous countdown (including a pause), its duration and its message come back. Press repeatedly to step back further. |
| **Space** | Restarts the current item's countdown, as usual. |
| **▶** on a row in the editor | Jumps straight to that item (Back undoes it). |

**Two screens are enough:** put the timer on the stage display and press **P** so it shows only the countdown and message. Then keep the run sheet editor on your own screen and run the show from it, the clicker or the Stream Deck. The editor shows now/next, the log and ahead/behind.

The timer screen shows a three-line dashboard: **previous** (when it started and how long it ran), **now**, and **next** (its planned time). Below that is the schedule status, e.g. *Running 2:30 behind · finish ≈ 17:04*. Each item keeps its full planned duration even when the show is late; the status tells you how much to trim.

Ahead/behind is measured against the sheet's start times. If it has none, it's measured from when you started the first item.

The editor's **Show log** lists planned vs actual start times and how long each item ran, and **Export log CSV** saves it. **Export CSV** saves the sheet as Start, Name, Duration with every time filled in. **Fill in times** writes the calculated times into the table. **Reset show** clears the log to run it again, and the **Run sheet mode** switch turns the whole thing off without deleting the sheet.

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
- **Messages**: drag a *Message* action onto a key, and its text field opens in the editor. Pressing the key shows that message on the presenter screen; pressing it again clears it. The key lights up while its message is showing. *Clear message* removes whatever is showing, and *Type message* opens the on-screen message box. The XL comes with two examples (*Please wrap up*, *Time for questions*).
- **Run sheet**: *Back*, *Next* (shows the next item's name) and *Schedule* (time ahead in green, or behind in red). The XL has all three in row 2 by default.
- **Catch up**: lights up while the timer is running fast or slow after a nudge; press it to jump straight to the adjusted time.
- **Backlight**: steps the deck's brightness 100 → 50 → 25 → 10% for dark venues. You can also set it in the editor, and it's remembered.

**Disconnect** releases the deck and stops it reconnecting until you click Connect again. **Forget deck** removes the browser's permission entirely.

> Key images are tested against a simulated deck. If they appear rotated on a real Mini, please open an issue.

---

## Remote display

Click **share** to get a room code (e.g. `TIGER-7`), a QR code and a link. Anyone opening the link sees a read-only countdown on their phone, tablet or another computer, on any network. On the same Wi-Fi it switches to a direct peer-to-peer connection automatically.

> This needs the relay server (see below). It does not work on a plain static host such as the beta site.

---

## Phone remote control (experimental)

Control the timer from a phone: start, pause, ±1 minute, catch up, presets, messages, and run sheet Back/Next. The phone shows the live countdown. Phones and tablets can also be **view-only displays**: a big countdown, or the run sheet status for a green room.

1. Click **phone** in the timer's button bar. A panel shows a QR code.
2. Choose what the code is for:
   - **Control**: the phone can control the timer.
   - **Countdown**: a view-only countdown and message display. It follows the timer's **B** (progress bar), **T** (time of day) and **M** (messages: the *Paused* notice) switches, like the presenter screen.
   - **Run sheet**: a view-only display of now, next, ahead/behind and the schedule, e.g. for a green room or backstage.
3. Scan it with the phone or tablet. The page opens and connects.

View-only devices get a different key from controllers, and the timer itself ignores anything they send, so they can't control it even if someone fiddles with the page. The phone panel lists each device as *Phone* or *Display · view only*.

The badge at the top of the phone shows how it's connected:

- **⚡ LAN direct:** phone and timer are on the same network, so they talk to each other directly.
- **via server:** they can't reach each other directly (different networks, mobile data, or venue Wi-Fi that keeps devices apart). Everything still works through the pairing server. It's small messages only, about 100 bytes a second.

**☰ View** (top right) chooses what the screen shows. A controller can use **Simple controls**, **Stream Deck XL**, **Countdown display** or **Run sheet display**; a view-only device only the two displays. The **Stream Deck XL** view is a virtual Stream Deck: the same 32 keys as the timer's XL layout, drawn the same way, including countdown, message and run sheet keys. Pressing a key does exactly what that key does on a real deck. Change the layout in the timer's deck editor (**D**, model *XL*), and the phone follows, even with no real deck connected. Turn the phone sideways for bigger keys: the keys fill the screen and the buttons move into a narrow strip down the side. **Type message** opens a message box on the phone. **Remote** is dimmed, because opening a presenter window needs a click on the timer computer. The phone remembers which view you used last.

The **run sheet display** shows the time of day, what's on now with its countdown, what's next with its planned time, how far ahead or behind the show is, and the whole schedule with planned times. Items that have run are dimmed and show when they actually started. On a tablet held sideways the status is on the left and the schedule on the right.

**⛶ Full screen** hides the browser bars (Android and tablets). Safari on iPhone can't do that for web pages; instead use **Share → Add to Home Screen** and open the remote from its icon. The simple controls size themselves to fit the screen without scrolling, and switch to two columns on a phone held sideways, a tablet or an almost square folding phone.

**Setting up another computer (Admin):** to make another computer, say a laptop in another room, a remote control or display of this timer without typing a link into it:

1. On that computer, open the timer, click **phone** and choose **Control**.
2. On a phone that controls this timer, choose **☰ View → Admin: set up another computer** and scan the other computer's QR code.
3. Choose **A remote control**, **A countdown display** or **A run sheet display**.

The phone gets the link from this timer and passes it to the other computer, which shows a notice for 8 seconds (anyone there can **Cancel**) and then opens it. It's then listed in this timer's phone panel, and it remembers the link. The phone needs the other computer's *Control* code because it is telling that computer what to do; a view-only code won't work. iPhones scan with the built-in QR reader where the browser has one, and otherwise with a small bundled reader (jsQR).

**For a multi-day event:** the timer keeps the same codes until someone presses **New code**, and each phone remembers the last link it opened. Install the remote as an app (**☰ View → Install as an app** on Android and in desktop Chrome/Edge; on iPhone, **Share → Add to Home Screen**) and it opens straight into the remote, full screen, already paired. If the timer computer is shut down overnight, phones show *timer offline* and reconnect by themselves when it's opened again the next day. After **New code**, every phone needs the new QR code.

In the simple controls, Restart and the presets need a second tap, so a stray touch can't restart a talk. Deck keys work on the first press, like a real deck. The phone screen stays on while the page is open. Up to 16 phones and displays can connect at once.

The QR code contains a secret key: anyone with the link can control the timer. **New code** disconnects every phone and makes a new link. **Turn off** stops phone control. The QR image needs internet access; otherwise use **Copy link**.

### Pairing server

Phone control needs `remote-server.js` running on a server you control. View-only links need the current version: after updating, restart the service. `curl https://your-server:8443/` shows the version (*protocol 2* supports view-only links), and the timer's phone panel warns if the server is too old for them. By default the timer looks for it at `wss://<the timer's host>:8443/`; change that under **Server** in the phone panel.

```bash
npm install
node remote-server.js --cert fullchain.pem --key privkey.pem --origin https://your-timer-site
```

For a Linux server with Let's Encrypt, `deploy/timer-remote.service` runs it under systemd as a normal user. systemd reads the root-only certificate and hands it to the server. `deploy/certbot-deploy-hook.sh` restarts it after each renewal. Both files have install steps at the top. Open port 8443 in the firewall.

Some venue and corporate networks only allow ports 80 and 443. On those, phones can't reach a server on 8443: use mobile data on the phone, or run the server on 443 behind a reverse proxy.

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
