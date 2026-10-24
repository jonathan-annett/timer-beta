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
| **Player** `Pptx-WsController.ps1` (Windows PowerShell 5.1 or 7) | Copies decks from that folder (its *Inbox*) into its *Show* folder and drives PowerPoint through COM automation: open, start, close, change slide. |

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
player, *n/m decks ready*, what's showing (slide x/y), and any error. The run sheet dashboard says
when the next item's deck isn't ready, or no PowerPoint computer is connected.

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
- **Protected View:** files saved by a browser carry the "downloaded from the internet" mark,
  which would make PowerPoint open them in Protected View (no slide show). The player removes it
  from its copy (`Unblock-File`); the files come from the operator's own timer.
- **Show ended by hand** (Esc, last slide): the player notices (COM) and reports `showing: false`.
- **Timer API:** `{cmd:'pptxslide', action: next|prev|first|last|black|white|resume|<n>}`,
  `{cmd:'pptxstop'}`. Bus variables: `pptx_machines`, `pptx_current`, `pptx_showing`,
  `pptx_slide`, `pptx_slides`, `pptx_next_ready`. The Companion module has actions, feedbacks and
  presets for these.

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
{t:'hello', kind:'player', name, version, pair, inbox, token, current, showing, slide, slides, simulate}
{t:'pp-ack', req, verb, ok, result?, note?, error?, …}      one per command, in order
{t:'pp-state', current, showing, slide, slides}              when what's on screen changes (polled each second)
```

Timer → player: `{t:'pp', req, verb, arg, keep?}`, one at a time (the timer waits for each ack):

| verb | arg | does | ack |
|---|---|---|---|
| `check` | | reads `<inbox>\.timer-pair` again | `result`: the receiver id in it |
| `send` | file name in Inbox | copies it into Show (in the background; never overwrites: a changed file gets `name v2.ext`) | `result`: the name in Show; `note:'unchanged'` if already there |
| `start` | file name in Show | opens and starts it (COM: read-only, no editing window, then closes the previous show) | `result`; a missing file fails without touching the current show |
| `stop` | | closes the show | |
| `slide` | `next` `prev` `first` `last` `black` `white` `resume` or a number | changes slide | |
| `status` | | | `current`, `showing`, `slide`, `slides` |
| `delete` | file name in Show | closes it if showing, deletes it | |
| `tidy` | `keep`: names | deletes other files in Show (not the current one) | `result`: how many |
| `wallpaper` | image name in Show | sets the desktop wallpaper | |
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
(`.pptx .ppsx .pptm .ppsm .ppt .pps .potx`); keys `rsdeck:<id>:<time>`.

### Testing without Windows

`-Simulate` runs the player without PowerPoint. The timer side was tested with a Node stand-in
that speaks the player protocol above, and the receiver page with the browser's origin-private
file system standing in for the chosen folder.
