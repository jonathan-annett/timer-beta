# PowerPoint machines (experimental)

Run sheet items can carry a PowerPoint deck. The timer sends every deck ahead of time to one or
more **PowerPoint computers** (a main one and a backup, say), and when Next reaches an item with a
deck, each of them opens it as a full-screen slide show. An item without a deck leaves the last
one on screen.

A PowerPoint computer runs two things, both joined to the timer with its **PowerPoint link**
(share → PowerPoint):

| Piece | What it does |
|---|---|
| **Receiver page** `pptx.html` (Chrome or Edge) | Receives the decks over the direct LAN link and saves them into a folder chosen once (File System Access API). Shows the player command to run. |
| **Player** `Pptx-WsController.ps1` (Windows PowerShell 5.1 or 7) | Copies decks from that folder (its *Inbox*) into its *Show* folder and starts them with `powerpnt.exe /S`, then works the show's window: Presenter View (context menu, R), slide keys, close. No COM. |

Why two pieces: a PowerShell script can't make the LAN WebRTC link (and decks are too big for the
pairing server, which only relays small messages), and a web page can't start PowerPoint.

## Setting one up

1. On the timer: **share → PowerPoint**, copy the link, open it in Chrome or Edge on the
   PowerPoint computer (same network as the timer's computer: the page's badge must show
   ⚡ LAN direct). Or with an admin phone: open the timer on the PowerPoint computer, share →
   Control there, then on the phone *Admin: set up another computer* → scan → **A PowerPoint
   computer** (share mode `pptx`; that computer's `adopt()` opens `pptx.html#r=…&p=…&s=…`).
2. In the page: **Download the player**, then run the command it shows in PowerShell:
   `powershell -ExecutionPolicy Bypass -File .\Pptx-WsController.ps1 -Link "…"`.
   It prints its Inbox folder (default `Documents\Presentation Timer\Inbox`).
3. In the page: **Choose folder…** and pick that Inbox. The page writes `.timer-pair` (its id)
   into it; the player reads it, which is how the timer knows the two belong together.
4. Attach decks in the run sheet editor (**Slides** column: **+ slides**, or drop a .pptx on a row;
   also from the remote run sheet editor, over the LAN only).

The timer's share panel shows a line per machine: receiver (LAN direct / no folder / via server),
player (and whether it uses Presenter View), *n/m decks ready*, what's showing, and any error. The run sheet dashboard says
when the next item's deck isn't ready, or no PowerPoint computer is connected.

If the page says the player **uses a different folder**, the folder chosen in the browser isn't
the player's Inbox (it names the exact path to pick). Watch out for OneDrive: on many Windows
computers Documents is `C:\Users\<you>\OneDrive\Documents`, and the player uses that, while the
folder picker can just as easily land in `C:\Users\<you>\Documents`. Choosing the right folder
pairs them straight away; nothing needs restarting.

A backup machine is set up the same way, with the same link. Every machine gets the same
commands at the same moment; one joining late is caught up with the deck already showing.

Player options: `-WorkFolder` (holds `Inbox`, `Show` and `.timer-token`), `-Inbox` (use another
folder as the inbox), `-Name` (the name shown in the timer; default the computer name),
`-AllowSelfSignedCert` (test servers), `-Simulate` (log instead of opening PowerPoint).

## Behaviour

- **Ahead of time:** all decks on the sheet are sent, current and next first, then the rest
  after, then earlier ones. Once a machine has them all, files the sheet no longer uses are
  removed (receiver: only files it saved; player: its Show folder, never the deck on screen).
- **File names:** `<deck name> ~<tag>.<ext>`, the tag from the deck's store key, so two items
  with `slides.pptx` never collide and replacing a deck gives a new name.
- **Next onto a deck item:** `start` on every machine. If a machine hasn't got it ready yet it
  starts as soon as it is. The new show starts before the old one is closed (no desktop flash).
- **Item without a deck:** nothing; the last deck stays up. **Back** onto a deck item shows it
  again if another deck is up.
- **Holding slides:** an item can carry an image (`item.holding`, key `rsimg:…`; PNG, JPG or BMP),
  sent ahead like decks. When the item starts, every machine sets it as the Windows desktop
  wallpaper (`wallpaper`, style Fill), so it shows whenever no deck is up (breaks, introducing a
  speaker without showing their title). With a deck as well, the wallpaper is set first. A machine
  connecting later gets the last holding slide. The player never tidies away the wallpaper in use.
  On a typical setup the projector is the second display, which shows the wallpaper without the
  taskbar or desktop icons.
- **Close slides** (`{cmd:'pptxclose'}`: the run sheet editor's *Close slides* button, the Stream
  Deck key *Close slides*, Companion): `stop all` on every machine, which closes every PowerPoint
  slide show there (one opened by hand too), so the holding slide shows. A machine connecting
  afterwards isn't told to open the last deck.
- **Protected View:** files saved by a browser carry the "downloaded from the internet" mark,
  which would make PowerPoint open them in Protected View (no slide show). The player removes it
  from its copy (`Unblock-File`); the files come from the operator's own timer.
- **Presenter View** is on by default (`-NoPresenterView` turns it off; the receiver page's tick box
  adds it to the command). In practice every show runs in Presenter View, whether or not it's put
  on the confidence monitor: it gives the control room reliable slide progress, and some videos
  don't play properly outside it (a PowerPoint optimisation bug). Starting from the command line, the only way into it is the show's
  context menu: the player focuses the show window and sends the Menu key, then **R**
  (*Show Presenter View*). That's a toggle, and a deck opened while another is in Presenter View
  comes up in Presenter View too, so the player looks first: after the old deck's windows have
  closed, it checks for a Presenter View window (class `PodiumParent`) and presses only if the
  state isn't the one wanted (this also turns off an inherited Presenter View with
  `-NoPresenterView`). It logs a warning if the state still isn't right afterwards, and (for now)
  lists PowerPoint's windows after each start so the class names can be checked.
- **No COM:** PowerPoint's COM automation caused trouble when closing files, so the player
  doesn't use it. It finds a deck's show by its window (class `screenClass`, the deck's name in
  the title), looked up afresh each time, and closes a show by sending that window `WM_CLOSE`
  (Esc if that doesn't work). It never kills PowerPoint.
- **Starting a deck** works from a clean slate, as an operator would (only faster; a seamless
  switch isn't the aim, and handing Presenter View from one deck to the next proved fragile):
  1. close every slide show (`WM_CLOSE` to the show windows, Esc if they linger; Presenter View
     goes with its show); wait until they've gone, and for PowerPoint to finish quitting if closing
     its last deck made it quit;
  2. open the new deck with `/S` and wait for its slide show;
  3. Presenter View on with the keys (only if it isn't already).
  *Close slides* (`stop all`) is step 1 on its own.
- **Show ended by hand** (Esc, last slide): its window is gone, so the player reports
  `showing: false`.
- **The show didn't appear** within 25 s (usually a PowerPoint dialog waiting for a click: sign-in,
  activation, repair): `start` fails and the player logs every PowerPoint window it can see.
- **Only load and start:** the timer gets each deck onto the machines and starts it. Slides are
  advanced on each machine itself (the presenter's clicker, the operator there); the timer never
  sends slide changes.
- **Bus variables:** `pptx_machines`, `pptx_current`, `pptx_showing`, `pptx_next_ready` (the
  next item's deck and holding slide are ready everywhere). The Companion module has feedbacks,
  presets and a *close slides* action.

## Protocol

Both pieces join the timer's room on the pairing server (`remote-server.js`, protocol 5) with the
PowerPoint key, exactly as a phone does: `{type:'join', room, key}` → `{type:'joined', id,
hostOnline, role:'pptx'}`, then messages to the timer go as `{type:'up', msg:{k:'data', d}}` and
arrive as `{type:'down', msg:{k:'data', d}}`. (`{k:'sig'}` messages are the timer offering a
WebRTC link: the receiver takes it; the player ignores them and the timer falls back to the
server after 7 s.) `host-online` means the timer reconnected: say hello again. `error` with
`not-found` / `room-closed` means the timer isn't open: retry every 15 s. The server accepts
clients that send no `Origin` header (PowerShell doesn't); browsers' Origin is still checked.

"Require a PIN" applies as for phones: `{t:'pin-required'}` → show a 4-digit code and send
`{t:'pin', code}`; `{t:'pin-ok', token}` → keep the token, send it in every hello;
`{t:'pin-rejected'}` → stop.

The timer (pptx-hub.js) never forwards anything from these peers to the timer API, and sends them
no timer state.

### Player ↔ timer

Player → timer:

```
{t:'hello', kind:'player', name, version, pair, inbox, token, current, showing, simulate, presenter}
{t:'pp-ack', req, verb, ok, result?, note?, error?, …}      one per command, in order
{t:'pp-state', current, showing}                            when what's on screen changes (polled each second)
```

Timer → player: `{t:'pp', req, verb, arg, keep?}`, one at a time (the timer waits for each ack):

| verb | arg | does | ack |
|---|---|---|---|
| `check` | | reads `<inbox>\.timer-pair` again | `result`: the receiver id in it |
| `send` | file name in Inbox | copies it into Show (in the background; never overwrites: a changed file gets `name v2.ext`) | `result`: the name in Show; `note:'unchanged'` if already there |
| `start` | file name in Show | `powerpnt.exe /S`, waits for the show window, Presenter View if on, then closes the previous deck's show | `result`; a missing file fails without touching the current show |
| `stop` | `all` or nothing | closes the deck's show; `all`: every PowerPoint slide show on the machine | |
| `status` | | | `current`, `showing` |
| `delete` | file name in Show | closes it if showing, deletes it | |
| `tidy` | `keep`: names | deletes other files in Show (not the current one) | `result`: how many |
| `wallpaper` | image name in Show | sets the desktop wallpaper (the holding slide); `tidy` keeps it | |
| `quit` | | acks, then the player exits (the show stays up) | |

File names are leaf names only (`[IO.Path]::GetFileName`; names starting with `.` are refused).

### Receiver ↔ timer

Receiver → timer:

```
{t:'hello', kind:'receiver', pair, folder, folderName, files:[{key, name, size}], token}
{t:'pf-ok' | 'pf-have' | 'pf-prog' | 'pf-saved' | 'pf-error', x, key, got?, name?, reason?, detail?}
```

Timer → receiver:

```
{t:'pf-offer', x, key, name, size}     a deck to save (only sent over the LAN link)
<binary>                               4-byte little-endian transfer number x + up to 64 KB
{t:'pf-cancel', x}
{t:'pf-tidy', keep:[keys]}             remove saved files not listed
{t:'pp-info', player, unpaired, ready, total}   status for the page
```

The receiver answers an offer with `pf-have` (it has that key, same name and size, still on disk),
`pf-ok` (send it) or `pf-error` (`bad`, `no-folder`, `not-lan`, `busy`, `write`). It reports
`pf-prog {got}` every 2 MB written; the timer keeps at most 16 MB unacknowledged. The browser
writes to a temporary file and only replaces the real name when the whole file is in, so the
player never sees half a deck. Names must be plain PowerPoint file names
(`.pptx .ppsx .pptm .ppsm .ppt .pps .potx`) or holding-slide images (`.png .jpg .jpeg .bmp`);
keys `rsdeck:<id>:<time>` / `rsimg:<id>:<time>`.

### Testing without Windows

`-Simulate` runs the player without PowerPoint. The timer side was tested with a Node stand-in
that speaks the player protocol above, and the receiver page with the browser's origin-private
file system standing in for the chosen folder.
