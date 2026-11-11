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

**Manual control:** ▶ on any cue plays it now, for testing or by hand. Turn off **Follow the timer** to take over completely: nothing plays by itself, ▶ still works. **Fade out** (or **Esc**) fades everything out over 3 seconds; **■ Stop all** stops it at once.

**Output:** video cues play in the **Output** box (one at a time). **Full screen (F)** fills a screen with it, for a capture card or a projector. **Sound outputs** (Chrome and Edge) picks the sound card the cues play on and another for the ▶ previews and the clip editor, so you can listen on headphones during the show; if the show's card is unplugged, audio cues don't play (videos play silent) and a warning says so.

**A cue's own output:** the menu on each cue (**→ Show** unless changed) sends that cue to another sound card on this computer, for a cue that needs a channel of its own. A video can have **No sound**: its picture only, so an audio cue starting beside it replaces its soundtrack (the two start together but aren't locked to each other: fine for music, not for lip sync). If a cue's card isn't connected when it's due, it doesn't play (a video plays without its sound) and a note says why; it never goes to another output instead.

**Cues belong to items, not to the pairing:** they stay on this computer when the timer makes a new share code, and an item keeps its cues when the run sheet is revised with **Replace sheet** (rows are matched to the items already there) or edited as a CSV file (its **Id** column). Cues for items that aren't on the timer's run sheet are kept for when they come back; **Remove them** under the list deletes them.

Not yet: a Stream Deck on the playout computer (keys to fire cues and to take over), lower-thirds graphics, and slides (the PowerPoint computers were dropped from the run sheet in Nov 2026: slides belong here).
