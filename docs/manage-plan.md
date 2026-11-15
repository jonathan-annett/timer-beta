# Management console for multi-room events (plan)

Status (15 Nov 2026): **steps 1 (cancelled items) and 2 (adding rooms, the grid) built on alpha**, see *Management console* in `docs/architecture.md`; steps 3–6 not yet. Decided while building step 2: the admin phone is its own page (`manage-phone.html`), not a mode of `remote.html`; the timer's side stays in `remote-control.js` for now (`manage-room.js` comes with the toasts and chat). The owner's design, agreed 13–15 Nov 2026. Alpha only
(`TimerFeatures.manage`) until it is fully tested. When it's built, the facts move into `docs/architecture.md`
(*Management console*) and the user guide into `docs/manage.md`; this file then keeps only what's still open.

## What it's for

A big event runs several rooms at once, each with its own timer and operator. Management (one desk, one laptop)
wants to see every room at a glance, talk to the operators, and fix the things that happen outside a room but
affect it: a speaker's name spelt wrong, a speaker running late or cancelled.

**Rooms keep control of their own show.** Management never works a room's timer and never touches its current or
next item. Old habits die hard (people send a text), so all of this has to be easy enough to be worth using.

## The pieces

| Piece | Where | What |
|---|---|---|
| **Console** | `manage.html` (`/m`), the management laptop | Interactive: the room grid, drilling into a room's run sheet, chat, editing later items, the QR that commissions the admin phone, the dashboard's pairing |
| **Dashboard** | `manage-dash.html`, an external screen on the same laptop or another computer | Not interactive: what's happening in each room right now |
| **Admin phone** | `remote.html`, in a new *management* mode | Commissions rooms (scans each room's share code) and can set a computer up as the dashboard |
| **Room** | the timer (`timer.html`) + the new `manage-room.js` | The grant prompt with the room's name, the name on screen, edit toasts, *Edit history*, chat |

## Connections

The pairing server and the Worker never look at payloads, so none of this needs a new server protocol.

- **The console joins each room as a peer**, as a phone does. It uses the room's **view-only key** plus a
  **management token** the room created when it allowed management. The timer marks such a peer
  `client: 'manage'` (same pattern as the assist station and playout: a view-key device with its own message set,
  handled before the view-only early return in `onPhoneMessage`). The token is a `remote_approved` entry with
  `manage: {name, console}`. It skips the proximity check, which the admin phone already passed in the room, and
  survives reloads on both sides.
- **The console also hosts a pairing room of its own.** The admin phone pairs with its admin key, and a dashboard
  on another computer with its view key or a pairing code. There's a proximity check for both.
- **One event per console, but sessions are kept apart** (the owner: a second event normally means a second laptop,
  but "never say never"). A session has an id, `manage.html#e=<id>`. Everything is stored under `manage_<id>_…`:
  rooms, tokens, names, chat, the change log, its pairing keys. A Web Lock (`manage-<id>`) allows one tab per
  session, with the usual "open in another tab" notice. A plain `/m` resumes the last session. *New event in
  another window* starts another.

### Why a token, not a fifth key

A `manage` pairing key would need protocol 8 in both `remote-server.js` and the Worker, and an old server would
refuse it. A token rides on what exists: the view key gets the console into the room, and the token, which only
a grant creates, gives it the management role. Revoking the grant in the share panel deletes the token. The
console is then an ordinary view-only peer, which sends nothing but `hello`, and it shows the room as *revoked*.

## Commissioning a room (the admin phone)

1. **The console shows one QR code:** the admin link to its own room. Scanning it makes the phone the admin phone
   (proximity number typed on the console).
2. **The admin goes to a room and scans its share QR code** with the phone's in-page scanner (`BarcodeDetector`,
   else `jsQR.js`, as the existing admin view does). Any of the room's links will do: the operator's say-so is the
   gate, not the key.
3. **The phone joins that room** (`client: 'mgr-phone'`). The room's operator types the proximity number the
   phone shows, as for any device.
4. **The phone asks** `{t:'manage-ask', console: <event name>}`. The share panel opens with a prompt that's separate
   from ordinary sharing: *"A management console ('‹event›') wants to monitor this timer. It can see the run sheet
   and chat with you, and can edit items after the next one."* It has a **room name** box, and **Allow stays
   disabled until a name is typed** (the owner: no "what was room 3 again?").
5. **On Allow**, the timer creates the token and answers `{t:'manage-grant', frag: <view link>, token, name}`.
6. **The phone shows the name, editable**, and checks it with the console before adding the room. **Only the
   console can say a name is unique** (each room knows only its own name). A taken name is refused on the phone:
   *"There's already a ‹name›: choose another"*.
7. **The phone sends the room to the console** `{t:'add-room', frag, token, name}` and leaves the room. The console
   joins with the token. If the name was edited, the console's hello carries it, and the timer takes it.
8. **The name is shown on the timer's operator screen** ("Monitored as *‹name›*"), whoever set it: the room, the
   phone, or later a rename on the console (`mg-name`, checked for uniqueness on the console first). It is not
   shown on the presenter screen.

The steps where the phone carries the grant are short. If the phone loses its link in the middle, nothing is half
added: an unused token is dropped after 10 minutes, and the room can be scanned again.

## What the console sees (read only)

From each room it subscribes to what a run sheet display already gets: `rs-sub` → `rs-data` (sheet, state, live),
plus the state push with countdown anchors (`hello` with `clock: 1`, `remote-clock.js`). All of that is already
built for phones.

**The grid, one row per room:** name, link status, current item and when it started, countdown remaining,
expected end of the room's show (from `RunsheetCore` with the actual starts), ahead / behind (`rs_late`), a chat
badge, and a marker for room changes not yet looked at. **Click a row** to open that room's run sheet in the
standard viewer, with the room's chat and change log beside it.

**Edge states:** offline (the room's timer closed or the network went), revoked, no run sheet (the countdown only).

## What management can change: items after the next one

Changes are **single operations**, not whole-sheet saves, so an operator editing at the same moment doesn't lose
work: `{t:'mg-edit', op, id, …}`, with `op` one of:

- `rename`: a new name (≤ 300 characters)
- `duration`: seconds
- `start`: a clock time, or none
- `move`: before which item (only among items after the next)
- `cancel`: on or off
- `add`: a new item (name, duration, start) after a given item that comes after the next (a replacement
  speaker)

**Swapped speakers** (Joe in room 4 at 6 pm swaps with Sue in room 1 at 3 pm, usually from scheduling changes
outside the planners' control) are two renames, one in each room. They're rare, so there's no swap function
(the owner, 15 Nov 2026). The change log still records both renames, which is the audit trail.

The timer checks each one, and **refuses any change to the current or next item**, including one that became
"next" while the edit was on its way. The answer is `{t:'mg-edit-result', ok | refused, reason}`. A change the
timer accepts goes through the same checks as `cleanSheet` and is written by `writeSheet`, so every viewer,
phone, playout computer and the editor sees it.

### Cancelled items (new on every run sheet)

- A **Cancelled** toggle on an item: `cancelled: true` on the sheet. It's dimmed and disabled on every view: the
  editor, the timer, phones, overlay lists, playout, the console and the dashboard. Next and Back skip over it.
- **Either side can switch it.** The room can reinstate an item management cancelled (the owner: a garbled
  message, when the speaker was only late and went straight to the room).
- **Timing (the owner, 15 Nov 2026):** a cancelled item takes no time (`eff = 0` in `normalise`). Later items
  move up on a sheet without clock times. On a sheet with clock times the times stay and the slot becomes a gap:
  the operator can start the next item early, which settles it, or edit the times in the room.
- This lands in `runsheet-core.js`, `runsheet.js`, `runsheet-editor.js`, `cleanSheet` / CSV (a `Cancelled`
  column), the phone and playout lists. It's useful without the console too, so it can ship to beta separately
  if the owner wants.

## The change log, both directions

One log per room, kept by the timer and mirrored on the console. Each entry has the time, who (*Management* or
*Room*), the item, and what changed ("Jon Smith" → "Jonathan Smyth"; 20 → 25 min; moved after "Coffee";
cancelled; reinstated).

- **Management's changes on the timer:** a toast for each that **must be dismissed**. The dismissal goes back to
  the console (`mg-seen`), which marks that change as seen. Once dismissed, it moves into a collapsed **Edit
  history** panel on the operator's screen.
- **The room's own changes on the console** (the owner wasn't sure; proposed and agreed in principle): the timer
  diffs the sheet by item id whenever `runsheet` changes and logs changes to items after the next one, plus every
  cancel and reinstate. The room's changes go straight into its history, with no toast for the operator, and are
  highlighted on the console until looked at. Without this, a reinstated speaker stays "cancelled" in
  management's head.
- **Not logged:** the room moving through its show (Next, Back, Pause, nudges, which the grid shows) and changes
  to items that have run.

## Chat (v1: management ↔ room only)

- **Console:** chat beside each room's row and in the drill-down. Click the row and type.
- **Room:** a badge on the operator's screen opens a small chat panel with the cursor in the box (Enter sends,
  Esc closes). A new message pulses the badge, with no toast (toasts are for edits). Quick replies are one tap:
  👍, *On it*, *Running late*. **Never on the presenter screen**, the presenter window or any view-only device.
- **Messages:** `{t:'mg-chat', id, text ≤ 1000, at}` both ways, plus `mg-chat-seen`. Kept on both sides per grant
  (the timer under its token, the console in its session) and sent again after a reconnect by id, so nothing is
  lost or doubled.
- **v2:** room-to-room chat, one global switch set by management. Until then there are no room-to-room messages,
  so their privacy can wait.

## The dashboard

- **On the same laptop:** *Open dashboard window* on the console (`manage-dash.html#e=<id>`), which follows its
  session through localStorage like the presenter window. Move it to the external screen, F for full screen.
- **On another computer:** pair it to the console's room with a **pairing code** (the share panel's *Pair a
  computer*, with the same `pair` / `claim` protocol as the console's host), or **assign it from the admin phone**:
  the phone scans that computer's share QR code, and `adopt()` gets a new kind of link, a dashboard of a console,
  with the usual 8 s notice and Cancel.
- **Not interactive:** big type, one row or tile per room, laid out to fit however many rooms there are; offline
  rooms greyed. No chat, no edits, no names of who's typing.

## Security

- **The room grants management only explicitly:** a prompt separate from ordinary sharing, a typed name, and a
  device that passed the proximity check in that room. Scanning a screen "for a harmless countdown" can't get it.
- **Management's messages have their own allow-list** in `remote-control.js` (`MANAGE_ALLOWED`: `hello`, `rs-sub`,
  `mg-edit`, `mg-chat`, `mg-chat-seen`, `mg-name`), with every field range-checked. No timer commands, no `api`,
  no deck, no keys, no `share`, no `adopt`.
- **The console treats rooms as untrusted too:** names and chat text are escaped, and sizes are capped.
- **Revoking:** the room's share panel lists the console with **Stop management** (drops the token and closes the
  peer). The console can also remove a room, which tells the room and drops its token there too.

## Files

- **New:**
  - `manage.html` + `manage.js` (the console)
  - `manage-host.js` (a small host for the console's own room: keys, peers, proximity, pairing codes)
  - `manage-dash.html` + `manage-dash.js`
  - `manage-room.js` (the timer side: grant prompt, name, toasts, *Edit history*, chat panel, change diffing)
  - `manage.css`
- **Changed:**
  - `remote-control.js`: the `manage` client, `MANAGE_ALLOWED`, the grant in approvals, `adopt()` for dashboards
  - `remote-phone.js` / `remote.html`: the admin phone's management mode
  - `runsheet-core.js`, `runsheet.js`, `runsheet-editor.js`: cancelled items
  - `timer.css`: html classes `manage-on`, `manage-chat-unread`
  - `features.js`: `manage: trial`
- **Private repo:** `/m` → `manage.html` in the Worker's routes, gated by `feature: 'manage'`, which the Worker
  also uses to refuse the `manage*` files; `manage` in alpha's and dev's `FEATURES` only.

**Why a new host rather than reusing `remote-control.js`'s:** that one is the timer's, tied to its keys, panel and
bus, and it's 1,600 lines. Factoring it out would risk the shipped share features for a trial. `manage-host.js`
copies its patterns: host / join, `RemotePeer`, proximity, approval tokens, pairing codes. Whether to merge the two
later can wait until the console has proved itself.

## Sketches (15 Nov 2026, for the owner's comments)

**Console: the grid.** One row per room, sorted by name (or by show end time). Colours: green on time, amber
1–5 min behind, red more than 5 min behind or over time on the current item, grey offline.

```
 Annual Conference 2026 · 6 rooms                       [ Add a room ⧉ ]  [ Dashboard ▾ ]  14:32:07
┌──────────────┬──────────────────────────────┬─────────┬──────────────────────┬───────────┬────────┬──────┐
│ Room         │ Now                          │ Left    │ Next                 │ Show ends │   ±    │      │
├──────────────┼──────────────────────────────┼─────────┼──────────────────────┼───────────┼────────┼──────┤
│ Auditorium   │ Keynote: Dr A. Patel  14:05  │  12:41  │ Q&A                  │ 17:30     │ on time│      │
│ Room 101     │ Panel: Supply chains  14:20  │   2:10  │ J. Smyth             │ 17:48 ▲8  │ −8 min │ 💬 2 │
│ Room 102     │ Coffee break          14:30  │  13:05  │ S. Okafor            │ 17:15     │ +2 min │      │
│ Room 104     │ R. Chen               14:00  │  +1:12  │ K. Brown  (1 ✕ skip) │ 17:40 ▲11 │ −11 min│ ✎ 1  │
│ Room 105     │ — not started (first 15:00)  │         │ Opening              │ 18:00     │        │      │
│ Breakout B   │ offline since 14:28                                                                       │
└──────────────┴──────────────────────────────┴─────────┴──────────────────────┴───────────┴────────┴──────┘
  💬 unread messages   ✎ changes made in the room, not yet looked at   ▲ later than planned
```

- **Left** counts up with a + once over. **Show ends** is the expected end, with ▲ minutes past the planned end.
- **Click a row** to open that room. **Add a room** shows the admin phone's QR code (folded away once a phone is
  paired). **Dashboard ▾**: *Open a window here* / *Pair another computer* (a code).

**Console: one room.** The standard run sheet viewer, items after the next one editable, chat and the change log
beside it.

```
 ◀ All rooms   Room 104 · monitored · linked (LAN)                                 [ Rename ]  [ Remove ]
┌────────────────────────────────────────────────────────────┬───────────────────────────────────────────┐
│ ✓ 13:30  Opening              30 min   ran 13:32–14:01     │ Chat                                      │
│ ▶ 14:00  R. Chen              30 min   +1:12 over          │  14:20 You: Has R. Chen finished yet?    │
│   14:30  ✕ M. Lopez           30 min   cancelled (you)     │  14:21 Room 104: 2 more minutes          │
│   15:00  K. Brown             30 min   next (the room's)   │  14:29 You: Lopez cancelled, sorry       │
│   15:30  Coffee         ✎     20 min                  ⋮    │  14:29 Room 104: 👍                      │
│   15:50  A. Grey        ✎     40 min                  ⋮    │ ┌───────────────────────────────────────┐ │
│   16:30  Close                                             │ │ type a message…                  Send │ │
│                                    [ + Add an item ]       │ └───────────────────────────────────────┘ │
│                                                            │ Changes                                   │
│ ▶ = now; now and next are locked (the room's)              │  14:29 You: M. Lopez cancelled  ✓ seen   │
│ ⋮ = rename, time, move, cancel                             │  14:31 Room: A. Grey 40 → 35 min    new  │
└────────────────────────────────────────────────────────────┴───────────────────────────────────────────┘
```

**Dashboard.** Not interactive: one tile per room, filling the screen (2 × 2 up to 4 rooms, 3 × 2 up to 6,
4 × 3 up to 12, then smaller tiles). Same colours as the grid. No chat, no changes, nothing to click.

```
┌───────────────────────────────┬───────────────────────────────┬───────────────────────────────┐
│ AUDITORIUM                    │ ROOM 101                      │ ROOM 102                      │
│ Keynote: Dr A. Patel          │ Panel: Supply chains          │ Coffee break                  │
│            12:41              │             2:10              │            13:05              │
│ next  Q&A                     │ next  J. Smyth                │ next  S. Okafor               │
│ ends 17:30 · on time          │ ends 17:48 · 8 min behind     │ ends 17:15 · 2 min ahead      │
├───────────────────────────────┼───────────────────────────────┼───────────────────────────────┤
│ ROOM 104                      │ ROOM 105                      │ BREAKOUT B                    │
│ R. Chen                       │ Starts at 15:00               │                               │
│           +1:12               │ Opening                       │          offline              │
│ next  K. Brown                │                               │                               │
│ ends 17:40 · 11 min behind    │ ends 18:00                    │                               │
└───────────────────────────────┴───────────────────────────────┴───────────────────────────────┘
                                         14:32:07
```

## Build order

Each step ends tested, documented (`docs/architecture.md`, the change log's `next`) and on alpha when the owner
says so.

1. **Cancelled items** on the run sheet (core, editor, timer, phones, playout, CSV). They stand alone and
   everything after uses them. Test `runsheet_cancel`.
2. **Commissioning and the grid:** `features.js`, `/m`, `manage.html` with sessions and the lock, `manage-host.js`
   and the admin phone, the grant prompt with the room name and its uniqueness check, the console joining with
   the token, the name on the timer screen, revoking, the grid and the drill-down. Tests `manage_join` (the name
   required, a duplicate refused, an edited name back on the timer, survives reloads), `manage_grid`,
   `manage_revoke`, `manage_sessions` (two sessions side by side, one tab each).
3. **Chat:** both ends, the badge, quick replies, resent after a reconnect. Test `manage_chat`.
4. **Edits to later items and the change log:** `mg-edit`, the refusals, toasts that must be dismissed and
   `mg-seen`, *Edit history*, the room's changes diffed and sent. Test `manage_edit` (including an edit that hits
   the item that has just become next, and an operator reinstating an item management cancelled).
5. **The dashboard:** the window on the same laptop, then another computer by code and by the admin phone's
   adopt. Test `manage_dash`.
6. **The user guide** `docs/manage.md`, a README pointer, the CLAUDE.md map row, and a full suite run before any
   talk of beta.

## Still open (to ask the owner as each step comes up)

- The console's grid columns and the dashboard's layout: the sketches below, for the owner's comments.

(No version check between rooms and the console: the site is deployed whole, so every page is the same version.
The owner, 15 Nov 2026.)
