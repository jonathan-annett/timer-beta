# Playout computers (experimental)

## Using it (an alpha-only trial)

Only on the alpha site (`features.js`, `TimerFeatures.playout`; the Worker's `FEATURES`): elsewhere `playout.html` isn't served and the timer treats a playout computer as a plain view-only device.

For bigger shows with several operators: an audio operator with the walk-up stings, a video operator feeding the vision mixer, and so on. Each runs `playout.html` on their own computer. It follows the timer's run sheet and plays **their own** audio and video at the moments they choose. The timer doesn't know or control what a playout computer does; it just runs the show.

1. On the playout computer, open `playout.html` next to the timer (e.g. `alpha.timed-show.com/playout.html`).
2. Pair it like an overlay: **share** → **Pair a computer** on the timer, type the 6-digit code on the playout computer, then type the number it shows into the timer's share panel.
3. The timer's run sheet appears. Click **+ cue** on an item, choose when (**At the start**, **When time's up**, **After** m:ss, or **With** m:ss **left**) and an audio or video file. The file stays on this computer.

**During the show:** each cue plays once each time its item runs. **Back** on the timer stops whatever is playing here. A playout computer that connects (or reloads) in the middle of an item doesn't replay a cue whose moment has passed, except a start cue within 2 seconds of the start. Time cues count running time: a pause holds them.

**Manual control:** ▶ on any cue plays it now, for testing or by hand. Turn off **Follow the timer** to take over completely: nothing plays by itself, ▶ still works. **■ Stop all** stops everything.

**Output:** video cues play in the **Output** box (one at a time). **Full screen (F)** fills a screen with it, for a capture card or a projector; audio comes out of this computer.

Not yet: a Stream Deck on the playout computer (keys to fire cues and to take over), lower-thirds graphics, and slides (to replace the PowerPoint player script).
