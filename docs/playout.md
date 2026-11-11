# Playout computers (experimental)

## Using it (an alpha-only trial)

Only on the alpha site (`features.js`, `TimerFeatures.playout`; the Worker's `FEATURES`): elsewhere `playout.html` isn't served and the timer treats a playout computer as a plain view-only device.

For bigger shows with several operators: an audio operator with the walk-up stings, a video operator feeding the vision mixer, and so on. Each runs `playout.html` on their own computer. It follows the timer's run sheet and plays **their own** audio and video at the moments they choose. The timer doesn't know or control what a playout computer does; it just runs the show.

1. On the playout computer, open `playout.html` next to the timer (e.g. `alpha.timed-show.com/playout.html`).
2. Pair it like an overlay: **share** → **Pair a computer** on the timer, type the 6-digit code on the playout computer, then type the number it shows into the timer's share panel.
3. The timer's run sheet appears. Click **+ cue** on an item and choose when: **At the start**, **When time's up**, **After** m:ss, or **With** m:ss **left**. Then **Choose the sound or video…** opens the same dialog as the run sheet editor's **+ sting**: a stock walk-up sting, a file or a folder of your own (**Custom file**), or one of your clips (**Edited sting**, the sting library). **✂** there makes a clip first.

Whatever you choose is copied into this computer's browser: cues play from here, whatever happens to the site or the network.

**✂ on a cue** opens the clip editor: just the part to play, fades, a loop and a trim. The file isn't cut. Cues are levelled like the timer's walk-up stings: turned down (never up) to this computer's house level.

**During the show:** each cue plays once each time its item runs, and plays on into the next items until it ends or you stop it. **Back** on the timer stops whatever is playing here. A playout computer that connects (or reloads) in the middle of an item doesn't replay a cue whose moment has passed, except a start cue within 2 seconds of the start. Time cues count running time: a pause holds them. Several cues at the same moment all play: audio cues together, video cues one at a time (the one lower in the item's list stays on screen).

**Changing a cue:** **✎** changes when it plays (the trigger and its time); **✂** changes the part of the file it plays.

**Manual control:** ▶ on any cue plays it now, for testing or by hand. Turn off **Follow the timer** to take over completely (rehearsals, say, where the order depends on who's there): nothing plays by itself and the timer's Back no longer stops anything here; ▶ still works, and **▶ Start item** runs an item's cues as if it had started then: its start cues at once, the others timed from that moment by this computer's clock (*When time's up* and *With … left* from the item's planned length). Starting another item drops the cues the last one hadn't played yet; what's playing plays on. **■ Stop item** stops its cues. **Fade out** (or **Esc**) fades everything out over 3 seconds; **■ Stop all** stops it at once (and an item started here).

**Output:** video cues play in the **Output** box (one at a time). **Full screen (F)** fills this screen with it, to see how it looks. For the audience's screen, **To external monitor** opens a floating window: drag it to that screen and double-click it (or press **F** in it) for full screen; videos then play there and the Output box says *External playback activated*. **Play here instead** brings them back and leaves the window open and black, ready for next time (not while a video is playing there). A video playing here moves to the window and carries on from where it was (a break of a few frames). If the window is closed, videos come back here. After a reload of this page, click **To external monitor** again: it finds the same window. **Sound outputs** (Chrome and Edge) picks the sound card the cues play on and another for the ▶ previews and the clip editor, so you can listen on headphones during the show; if the show's card is unplugged, audio cues don't play (videos play silent) and a warning says so.

**A cue's own output:** the menu on each cue (**→ Show** unless changed) sends that cue to another sound card on this computer, for a cue that needs a channel of its own. A video can have **No sound**: its picture only, so an audio cue starting beside it replaces its soundtrack (the two start together but aren't locked to each other: fine for music, not for lip sync). If a cue's card isn't connected when it's due, it doesn't play (a video plays without its sound) and a note says why; it never goes to another output instead.

**Cues belong to items, not to the pairing:** they stay on this computer when the timer makes a new share code, and an item keeps its cues when the run sheet is revised with **Replace sheet** (rows are matched to the items already there) or edited as a CSV file (its **Id** column). Cues for items that aren't on the timer's run sheet are kept for when they come back; **Remove them** under the list deletes them.

**Connection:** the status line says **⚡ Connected directly** or **Connected via the server**. Either works for playout (the messages are small); via the server, start cues fire after the trip through it. A browser that never connects directly, even next to the timer, may have WebRTC limited: Opera with its VPN sets *Disable non-proxied UDP* (search its settings for WebRTC and choose the default), then reload.

Not yet: a Stream Deck on the playout computer (keys to fire cues and to take over), lower-thirds graphics, and slides (the PowerPoint computers were dropped from the run sheet in Nov 2026: slides belong here).
