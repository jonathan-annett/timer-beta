# Presentation Timer (beta)

A keyboard-driven countdown timer for talks, conferences and live events. One window is the operator's controller; a second window shows a clean countdown on the stage display. It can step through a run sheet, play videos on another screen, and work with a Stream Deck (directly or through Bitfocus Companion) and with phones, tablets and other computers as remote controls or extra displays.

**Try it:** https://timer.sophtwhere.com/beta/

---

## Quick start

1. **Open the timer** in Chrome or Edge on the computer you'll operate from.
2. **Pick a duration**: click a preset (10, 20, 30, 45, 60, 90 min, 2h, 3h; **Up** counts up from zero), or type the minutes (e.g. `4` `5`) and press **Enter**. For hours, type `1` `:` `30` for 1 h 30 min.
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
| **Next** (Page Down, clicker, deck key, editor button, phone) | Starts the next item: shows its name to the presenter, sets the timer to its duration and starts it. The start time goes into the log. |
| **Back** (Page Up, deck key, editor button, phone) | Undoes the last Next exactly, as if it never happened: the previous countdown (including a pause), its duration and its message come back. Press repeatedly to step back further. |
| **Space** | Restarts the current item's countdown, as usual. |
| **▶** on a row in the editor | Jumps straight to that item (Back undoes it). |

While the show is running, the order up to and including the current item is fixed, and an upcoming item can't be moved above the one running now (the ↑/↓ buttons grey out). The live dashboard, phones and log all follow that order. To stop an item happening, delete it; items further down can still be reordered.

**Two screens are enough:** put the timer on the stage display and press **P** so it shows only the countdown and message. Then keep the run sheet editor on your own screen and run the show from it, the clicker or the Stream Deck. The editor shows now/next, the log and ahead/behind.

The timer screen shows a three-line dashboard: **previous** (when it started and how long it ran), **now**, and **next** (its planned time). Below that is the schedule status, e.g. *Running 2:30 behind · finish ≈ 17:04*. Each item keeps its full planned duration even when the show is late; the status tells you how much to trim.

Ahead/behind is measured against the sheet's start times. If it has none, it's measured from when you started the first item. Until then, the editor (and the phones' run sheet display) shows the times as if the show started now, so you can see when everything would happen and when it would finish; they move on with the clock until the first **Next**.

The top of the editor shows the timer's countdown as it is now (yellow under a minute, red when over, *Paused* when paused), with **Pause** / **Resume** and **Restart**. Restart gives the current item its full time again from now (the default duration when the run sheet is off), for when the presenter walks on after a long introduction or the deck was loaded well before they took the stage. The item's start time in the log moves to the restart, and the show runs that much later. It doesn't start the video again. If you'd rather a stray click couldn't reset a talk, turn on **Restart needs a second click** under **Options** (on the right): then Restart asks for a second click within 2 seconds. Each computer remembers its own setting; it's off by default.

**Editing during the show:** items that have finished are locked as they happened. **✕** on one hides it from the run sheet but keeps it (the log and the exported CSV still have it; *Show deleted* under the table shows them again, and **Reset show** drops them). The item running now keeps its start time. Its name can be changed, but because it's on the presenter's screen the editor asks first and only then shows the new name there; Cancel puts the old name back. Names of items still to come change without asking.

**Durations and end times:** an item that hasn't finished can be given either a duration or an end time (the **Ends** column): some producers think in hard outs, some in how long someone speaks, and the other one follows. Either way every start time after it moves by as much, to the end of the day. For the item running now it also moves its countdown, so the presenter sees the time they really have; a duration is refused if more than that has already gone, and an end time if it has already passed. Time added or taken off on the timer itself (Ctrl+arrows, ↑/↓, a phone, Companion) updates the duration in the run sheet the same way. A pause doesn't: it makes the show late instead (see below).

**Start times:** changing an item's start moves every start time after it by as much, to the end of the day, the same as a duration does. Clearing one moves nothing.

Changing the **start of the next item** is changing when the current one ends, and the items after it move by as much. A time that has already gone is refused. Otherwise the editor asks whether the countdown should end then too. *No* is fine (it just leaves a gap), but if the next item would then start before the current one is due to end, it asks again: do nothing, end the countdown at that time after all, or save the start anyway. A start saved over the current item is shown in red. To move the next item without moving the rest, change its start and then give it back its old end time.

**Times during the show:** once the show has started, the editor's **Start** and **Ends** columns show what really happened and what's expected, whether or not the sheet had start times to begin with. An item that has started shows the second it actually started (a Restart or ▶ counts as starting again), and a finished one when it ended. The item running now ends when its countdown does, pauses and changes included. Everything after it follows on from there, except that an item with a start time of its own waits for it when that's later (leaving a gap). Where that differs from the plan, the Status column shows the planned time (red if later, green if earlier). The timer's dashboard, the phones' run sheet display and *finish ≈* use the same times.

**Scaling several items:** to win back time (or fill some), click the numbers of two or more items still to come (Shift+click selects a range) and drag the **Scale** slider in the bar that appears: every selected item gets longer or shorter by the same percentage (to the nearest 15 seconds), and the table previews the result. The bar shows the time saved, when the last selected item would end, and whether the item after it can start on time; **Fit to …** finds the smallest change that gets it there. Nothing changes until **Apply**; **Cancel** (or Esc) leaves the sheet as it was. Within the selection the start times move with the new lengths, but items after the last selected one keep theirs, so lunch at 12:30 stays at 12:30 and the time saved catches up the lateness (or becomes a gap). Videos keep their length, so they can't be selected; nor can the item running now or finished ones. While the preview is up the table can't be edited, but Next and Back still work.

**Running late:** when the show is behind, the times still to come move later in all those places. Pausing the timer counts too: whatever is left on the clock still has to play out after Resume, so while it's paused the status line reads *Paused 1:20 · …* and every later time keeps moving, like the end time on the timer screen. Ahead of time, items with a start time of their own keep it; the rest move earlier. The same bar is in the run sheet editor opened from another computer.

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
- **Video**: *Play video* (lit when a video is ready), *Stop video* and *Rewind video* (lit while one plays; rewinding goes back to the start, ready to play again). They work for dropped and run sheet videos. The XL has Stop and Rewind in the last two keys by default (if you saved your own XL layout, add them in the editor or use Reset defaults).
- **Catch up**: lights up while the timer is running fast or slow after a nudge; press it to jump straight to the adjusted time.
- **Backlight**: steps the deck's brightness 100 → 50 → 25 → 10% for dark venues. You can also set it in the editor, and it's remembered.

**Disconnect** releases the deck and stops it reconnecting until you click Connect again. **Forget deck** removes the browser's permission entirely.

> Key images are tested against a simulated deck. If they appear rotated on a real Mini, please open an issue.

---

## Videos

Click **video** to open the separate **player window** and the video panel. Drag the player window to the screen it should play on and press **F** for full screen. To load a video, click **Browse for a video…** in the panel, or drag a video file (or a link to one) onto the timer. Controls appear at the bottom right of the timer:

| | |
|---|---|
| **▶** | Play. The timer counts down the video's length and the message shows **Video:** and the file name. |
| **■** | Stop and unload the video (clears the message and the timer). |
| **⟲** | While playing: back to the start, ready to play again. |
| **Before play: first frame / black** | What the player window shows before the video plays. Remembered for next time. |

Keys pressed in the player window work as if pressed in the timer. Drop another video on either window to replace the current one.

### Recent videos

Every video you play is listed under **Recent videos** in the video panel (click **video**): dropped and browsed files, links and run sheet videos, newest first, with when each was last played. Click **Cue** to load one into the player again, then **▶** to play it; **✕** removes one from the list, **Clear** empties it. The list is kept between sessions (the last 30 videos).

In Chrome and Edge the timer remembers where a file is on your computer rather than copying it. The first time you cue one after reopening the browser, Chrome asks to let the page view the file. If the file has since been moved, renamed or deleted, browse for it again. Other browsers keep a copy of each file in the browser instead (up to 8 GB in all; the oldest copies go first). A video that wasn't kept is marked *not kept*: browse for it or drop it again to play it.

### Videos in the run sheet

In the run sheet editor, click **+ video** on an item (or drop a video file on its row). The file is copied into the browser, so it's still there after a restart; the item takes the video's length as its duration, and its name as the item name if it has none. Give the item a descriptive name: that's the message shown while it plays. Choose **frame** or **black** for what the player shows before it plays.

During the show:

- When the item before a video starts, its video is loaded into the player and waits there (showing its first frame, or black).
- **Next** onto the video item plays it straight away; the timer counts down its length.
- When it finishes, the run sheet stays on that item (timer 0:00) until you press **Next**.
- **Back** stops it and loads it again, ready to replay.

The player window has to be open (click **video** once before the show); if it isn't when a video is coming up, the dashboard says so. While a run sheet video plays, the controls at the bottom right of the timer show **⟲** (rewind) and **■** (stop); once it has been rewound or has finished, **▶** plays it again. The Stream Deck keys do the same. The next item's video, waiting in the player, gets no controls: **Next** plays it.

## Sharing with phones, displays and Companion (experimental)

Click **share** in the button bar to let other devices in. Control the timer from a phone or tablet: start, pause, ±1 minute, catch up, presets, messages, run sheet Back/Next, and a virtual Stream Deck XL. The phone shows the live countdown. Phones and tablets can also be **view-only displays**: a big countdown, or the run sheet status for a green room.

1. Click **share** in the timer's button bar. A panel shows a QR code.
2. Choose what the code is for:
   - **Control**: the phone can control the timer.
   - **Countdown**: a view-only countdown and message display. On a computer (a confidence monitor, a screen in another room) it looks exactly like the timer's presenter screen, and **F** toggles full screen; move the mouse to see its controls. On a phone or tablet it uses a touch-friendly layout that follows the timer's **B** (progress bar), **T** (time of day) and **M** (messages: the *Paused* notice) switches.
   - **Run sheet**: a view-only display of now, next, ahead/behind and the schedule, e.g. for a green room or backstage.
   - **Admin**: everything Control can do, every view, and setting up other computers (below). Keep this code for yourself: Control lets someone run the timer without being able to hand it to other devices.
   - **Companion**: for Bitfocus Companion (below) and other automation. The panel shows a link to copy instead of a QR code.
3. Scan it with the phone or tablet. The page opens and connects.

Each kind of code has its own key, and the timer enforces what each can do, even if someone fiddles with the page: view-only devices can't send anything, and only admin phones can set up other computers. The share panel lists each device as *Phone*, *Phone · admin* or *Display · view only*.

The badge at the top of the phone shows how it's connected:

- **⚡ LAN direct:** phone and timer are on the same network, so they talk to each other directly.
- **⚡ direct:** a direct link over the internet (the phone is on another network, mobile data say, and the routers let them connect). Everything works except sending videos from a remote run sheet editor, which needs the same network.
- **via server:** they can't reach each other directly (venue Wi-Fi that keeps devices apart, strict routers). Everything still works through the pairing server. It's small messages only: about 100 bytes a second, or a few hundred with the Stream Deck view open. **Tap the badge** to try a direct link again, for example after joining the venue Wi-Fi (Android phones also try again by themselves when they change network).

**☰ View** (top right) chooses what the screen shows. A controller can use **Simple controls**, **Stream Deck XL**, **Countdown display** or **Run sheet display** (on a computer with a mouse: **Run sheet editor**, see below); an admin phone also gets **Admin: set up another computer**; a view-only device only the two displays. The menu also has **Help** (this guide), the **Second tap** setting (below) and, where the browser supports it, **Install as an app**. The **Stream Deck XL** view is a virtual Stream Deck: the same 32 keys as the timer's XL layout, drawn the same way, including countdown, message and run sheet keys. Pressing a key does exactly what that key does on a real deck. Change the layout in the timer's deck editor (**D**, model *XL*), and the phone follows, even with no real deck connected. Turn the phone sideways for bigger keys: the keys fill the screen and the buttons move into a narrow strip down the side. **Type message** opens a message box on the phone. **Remote** is dimmed, because opening a presenter window needs a click on the timer computer. The phone remembers which view you used last.

The **run sheet display** shows the time of day, what's on now with its countdown, what's next with its planned time, how far ahead or behind the show is, and the whole schedule with planned times. Items that have run are dimmed and show when they actually started. On a tablet held sideways the status is on the left and the schedule on the right. On a controller or admin phone or tablet (not a view-only display) it also has buttons, so a director or second operator can step in: **◀ Back**, **Pause** / **Resume** and **Next ▶**, nudges of **−1 min**, **−10 s**, **+10 s** and **+1 min**, and **Catch up**. A nudge works like the timer's ↑/↓ keys: the countdown runs a little fast or slow until it reaches the new end time; **Catch up** jumps straight there.

**Editing the run sheet from another computer:** on a computer (one with a mouse) opened with a **Control** or **Admin** code, the ☰ View menu offers **Run sheet editor** in place of the display. The quickest way to set one up is from an admin phone: scan the other computer's code and choose **A run sheet editor** (below); it opens straight into the editor. It's the full run sheet editor, the same one **E** opens on the timer, editing the timer's run sheet: change items, paste or import a sheet, Next and Back, jump to an item, the log. A label in its header says *Editing the timer on another computer*. Changes made on either computer show up on the other within a second. You can also add videos to items from there, but only when the badge shows **⚡ LAN direct**: the file goes straight to the timer's computer over the local network (with progress shown in the row) and is stored there. Through the server, adding a video is refused; add it on the timer's computer instead.

**⛶ Full screen** hides the browser bars (Android and tablets). Safari on iPhone can't do that for web pages; instead use **Share → Add to Home Screen** and open the remote from its icon. The simple controls size themselves to fit the screen without scrolling, and switch to two columns on a phone held sideways, a tablet or an almost square folding phone.

**Setting up another computer (Admin):** to make another computer, say a laptop in another room, a remote control or display of this timer without typing a link into it:

1. On that computer, open the timer, click **share** and choose **Control**.
2. On a phone paired with this timer's **Admin** code, choose **☰ View → Admin: set up another computer** and scan the other computer's QR code.
3. Choose **A remote control**, **A run sheet editor**, **A countdown display** or **A run sheet display**.

The phone gets the link from this timer and passes it to the other computer, which shows a notice for 8 seconds (anyone there can **Cancel**) and then opens it. It's then listed in this timer's share panel, and it remembers the link. The phone needs the other computer's *Control* code because it is telling that computer what to do; a view-only code won't work. The phone uses the browser's built-in QR reader where there is one (Chrome on Android) and otherwise a small bundled reader (jsQR), so iPhones work too.

**For a multi-day event:** the timer keeps the same codes until someone presses **New code**, and each phone remembers the last link it opened. Install the remote as an app (**☰ View → Install as an app** on Android and in desktop Chrome/Edge; on iPhone, **Share → Add to Home Screen**) and it opens straight into the remote, full screen, already paired. If the timer computer is shut down overnight, phones show *timer offline* and reconnect by themselves when it's opened again the next day. After **New code**, every phone needs the new QR code.

Buttons and deck keys buzz as soon as you press them (on phones that can vibrate) and act when you lift your finger. A quick tap always counts. If you touched a button by accident, the buzz warns you: keep your finger down, slide it off the button and lift it there, and nothing happens (the button goes dark to show it). If you'd rather Restart and the presets need a second tap within 2 seconds, so a stray touch can't restart a talk, turn on **Second tap** in the ☰ View menu (each phone remembers its own setting; off by default). The phone screen stays on while the page is open. Up to 16 phones and displays can connect at once.

The QR code contains a secret key: anyone with the link can control the timer, so the panel closes itself as soon as a phone connects (open it again with **share** when you want to add another). Every new phone, display or computer also has to pass a **proximity check**: it shows a 3-digit number (deliberately not large: you read it close up, or the person holding it reads it to you over the phone), and it isn't let in until you type that number into the share panel. One wrong number disconnects it; it has to scan or pair again. Devices you've let in stay approved until you make a new code. **New code** disconnects every phone and makes a new link. **Turn off** stops phone control. 

### Bitfocus Companion

[Bitfocus Companion](https://bitfocus.io/companion) (Stream Deck and other control surfaces, on any computer) can run the timer through a connection module in `companion/`. It joins the timer like a phone does, so Companion can be on another computer, or on the same one alongside the timer's own Stream Deck support. Companion gets every timer command as an action (start a countdown of any length with a message, pause, nudge, catch up, messages, display switches, run sheet Next/Back, video, keystrokes, raw API commands) and every value the timer publishes as a variable, with feedbacks for paused, under a minute, time up, message showing, behind schedule and so on. Companion can also drive the timer from its own data: a duration or message in a *Start a countdown* action can be a variable or expression from another connection.

1. In the timer, click **share** and choose **Companion**. Copy the link shown.
2. In Companion, add a **Presentation Timer** connection and paste the link into its settings.

It connects within a second or two. The first time, Companion's status shows a 3-digit number to type into the share panel (the proximity check); it's remembered afterwards. The module's own help (in Companion) lists the actions, variables, feedbacks and presets. It isn't in Companion's module store yet: build it from `companion/companion-module-sophtwhere-presentationtimer` (`npm install && npm run build`) and point Companion's **Developer modules path** at the `companion/` folder, or `npm run package` for a `.tgz` to import. It is written for Companion 5.1 and should work from 4.3 on.

### Countdown overlay on another computer

A countdown that floats on top of everything on another computer, for example over PowerPoint's Presenter View on the slides computer, so the presenter sees their time there. No keys are needed once it's running.

1. On the other computer, open `overlay.html` next to the timer (the share panel shows the address; on a Cloudflare-hosted timer it's just the site plus `/o`, e.g. `alpha.timed-show.com/o`).
2. On the timer, click **share**, then **Pair a computer**. It shows a 6-digit code that changes every 30 seconds.
3. Type the code on the other computer. They link up straight away and the code disappears from the timer. The other computer then shows a 3-digit number: type it into the timer's share panel (the proximity check), and it connects.
4. Choose a shape (**16:9**, **Square**, **9:16**, or **9:16 stacked**, with the minutes above the seconds for bigger digits in a narrow window; from an hour it shows *1 hr* above *23:59*), whether to show the **message** (along the top, sized to fit) and the **progress shade** (the background fills in as time runs out), then click **Start overlay**. Drag the floating window where you want it and resize it, then minimize the overlay page.

The overlay turns orange under a minute and red when time is up, and greys out while paused. The progress shade follows the timer's bar switch (**B**), and with its messages switch (**M**) on, the message strip shows the timer's own notices (*Wrap up - last minute*, *Time is Up*, *Paused*) whenever no message is up. The overlay's own **Message** and **Progress shade** boxes turn them off on that screen only. It can't control the timer. The computer stays paired: next time just open `overlay.html` (it remembers), even after the timer was closed. **Unpair this computer** forgets it; a **New code** on the timer unpairs every device. The code works once, from any network (it can be read out over the phone); the proximity check is what makes sure the right computer gets in. The floating window works best in Chrome or Edge; other browsers get a simpler video overlay.

### Pairing server

Sharing needs `remote-server.js` running on a server you control (the hosted timer has one). View-only, admin and Companion links and pairing by code need the current version: after updating, restart the service. `curl https://your-server:8443/` shows the version (*protocol 3* supports view-only and admin links, *4* adds Companion, *6* pairing a computer by code), and the timer's share panel warns if the server is too old for the code you've selected. By default the timer looks for it at `wss://<the timer's host>:8443/`; change that under **Server** in the share panel.

```bash
npm install
node remote-server.js --cert fullchain.pem --key privkey.pem --origin https://your-timer-site
```

For a Linux server with Let's Encrypt, `deploy/timer-remote.service` runs it under systemd as a normal user. systemd reads the root-only certificate and hands it to the server. `deploy/certbot-deploy-hook.sh` restarts it after each renewal. Both files have install steps at the top. Open port 8443 in the firewall.

Some venue and corporate networks only allow ports 80 and 443. On those, phones can't reach a server on 8443: use mobile data on the phone, or run the server on 443 behind a reverse proxy.

## Phones and tablets

On a touch screen the controller shows a bottom bar: **Presets**, **Start**, **Pause**, **+1 min**, **−1 min** and **⋯** (more: a friend's phone as a remote, and this guide). **Presets** opens a sheet with the built-in durations and any you've added. **Other duration…** there is a keypad: type the minutes (or hours : minutes, e.g. `1:30`), then **▶ Start** to start it, **Set default** to make it the default without starting, or **Save preset** to add it to the sheet. Your own presets are kept on the phone; **Edit** lets you remove them.

**A friend's phone as your remote:** if you're speaking with the timer on your own phone or tablet, tap **⋯ → Let a friend control this timer**. A code appears; your friend scans it with their phone and gets a **remote control** (start, pause, ±1 min, presets, messages, or a virtual Stream Deck) or, with **Countdown display** selected first, a view-only countdown of their own. They can start the talk at the right moment and keep you to time while you speak. It needs the pairing server (see *Sharing with phones, displays and Companion*), which the hosted timer has; the two phones connect directly when they're on the same Wi-Fi, otherwise through it.

The phone's **Back** button closes whatever is open (the guide, the presets, a menu); when nothing is open it does nothing, so a stray press can't leave the timer during a talk. The same goes for the phone remote.

The clock face also responds to two gestures:

| Gesture | Action |
|---|---|
| Double-tap | Start / restart |
| Long-press | Pause / resume |

The first time you open it on a phone, it asks how long your talk is.

---

## Running it yourself

### Static hosting

Copy the contents of `public/` to any static web host. It must be served over **HTTPS**. Everything works on its own except **share**, which also needs the pairing server, `remote-server.js` (see *Pairing server* above). It can run on the same machine as the web host or another one; the timer looks for it on port 8443 of its own host unless told otherwise.

---

## Development

No build step: it's plain HTML, CSS and JavaScript. See [`CLAUDE.md`](CLAUDE.md) for the architecture, conventions and known issues before changing anything.

## Licence

MIT. Original timer by Jonathan Annett.
