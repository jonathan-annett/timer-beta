# Walk-up stings (experimental)

## Using it (a trial: alpha and beta)

On the alpha and beta sites (`features.js`, `TimerFeatures.stings`; beta since 11 Nov 2026): elsewhere the run sheet editor doesn't offer them and the timer doesn't play them.

A walk-up sting is a short piece of music (or a video) that plays as a run sheet item starts: the speaker's walk-on music, say. Unlike a video on an item, it doesn't set the timer: the item keeps its own duration, and the sting just plays over its start.

In the run sheet editor, click **+ sting** in an item's Video column. Three tabs along the top:

- **Walk-up sting:** the stock stings the site offers (`stock-stings.json` next to the timer: `name`, `url`, `media` audio or video, `duration` in seconds), including the site's own clips of them.
- **Custom file:** **Browse for a file…** for a file of your own (dropping an audio file on a row does the same; a video file dropped on a row is still a video for the item), or **Choose a folder…** to pick from a list of the audio and video files in a folder (and its subfolders), with **▶** to hear one first. Under the list, **Exclude this from random selection pools** keeps the file shown out of Random stings (a test tone, say, or anything in the folder for other reasons): it's kept on this computer the moment you tick it, whether you then use a file or cancel, and the list marks it *not picked at random*. You can still choose it here by hand; untick it to let Random stings have it again. Chrome and Edge remember the folder: next time the list is there at once, or after one click on **Show the files in … again** if the browser wants to ask. Other browsers keep it until the run sheet editor is closed. The file you use is copied into the browser like a browsed one. AIFF files (from Logic or Pro Tools, say) work too: Chrome and Edge can't play AIFF, so the file you choose is turned into a WAV with exactly the same sound as it's copied in (only the one you choose, however many the folder holds). A compressed AIFF-C can't be: export it as WAV or uncompressed AIFF.
- **Edited sting:** your clips from the sting library, and **Open the sting library…**, which opens it as a panel over the editor.

**Music styles (on trial):** each stock sting shows its strongest music style in the list (*Hard Rock*, *House*, *Disco (Funk / Soul)* where a name belongs to two genres), and above it are chips of every genre and style the stings have, with how many: *Electronic (47)*, *House (25)*, *Rock (33)*, *Punk (6)*… The chips sit above the tabs: light one (or several: any of them) and every list shows only the stings in them (stock stings, your folder's files and your clips), the best match first, with the style each matched; a genre chip takes all its styles. Tap again to turn one off; with none lit you see them all. As more stings are added, more chips appear. The styles come from a music model that listens to each stock sting when it's added to the site (on our side, once: nothing of the model runs in your browser); a style counts when the model gives it 0.08 or more (short jingles often have no clear style). Clips of a stock sting share its styles. **Your own files** (the folder under **Custom file**, ticked in Random stings, and your clips' own files) aren't sorted by style: while chips are lit they're all included, as you know your own music, so a folder chosen alongside the chips is taken as in those styles. On alpha, as a further trial, your own files are listened to on your computer instead: the files in the folder you list under **Custom file** (or tick in Random stings) and the files of your own clips. It runs in the background, one file at a time (a few seconds each; the model, about 18 MB, is fetched the first time), with a line above the tabs saying how far it's got; each file's styles appear as it's done, and they're kept in this browser, so a file is listened to only once. A file it can't listen to (under a second, or not audio it can read) is left without styles. Until a file has been listened to, it's left out while any chips are lit. *Styles: Discogs-EffNet by the Music Technology Group, Universitat Pompeu Fabra ([essentia.upf.edu](https://essentia.upf.edu/models.html)), used under its non-commercial licence.*

**Use** takes the one on the tab that's showing. **✂** beside a list opens the clip editor on the sting chosen there (see *Clips* below): on a stock sting or a file from the folder list it makes a new clip, on one of your clips it changes that clip. **Save and use** keeps the clip in your sting library (for next time) and puts it on the item; **Cancel** goes back to the dialog with nothing saved.

In the dialog, **▶** next to the stock list lets you hear the selected sting first. Stock stings already on this run sheet are marked *in use* with the items using them; tick **Hide stings already on this run sheet** to leave them out (some presenters want their walk-up to themselves). Choosing a stock sting or link that another item already uses asks first.

An item has a video or a sting, not both.

**Everything plays on the timer's computer:** audio from the timer page itself, video in the player window (open it with **video**). It's made for a small show run from one laptop, with no network needed. A file is kept in the browser; a link or stock sting is copied there too, as soon as the timer sees it, if its server allows it (it has to send `Access-Control-Allow-Origin`). One that couldn't be copied shows **⚠** in the editor and plays from its link, so it needs the internet.

**During the show:** **Next** plays the item's sting (the next one is loaded ahead, so it starts at once). A sting plays to its end: long tracks cover activity on stage, and an item without a sting leaves it playing, so an introduction spoken over a sting can be followed by the speaker's countdown. It stops when another sting (or a video item) starts, or when you fade it: the sting bar on the timer's screen (**Fade out** over 3 seconds, or **Stop**), **Esc** on the timer (the same fade, for videos in the player too; in Chrome's full screen a tap fades and holding Esc leaves full screen), or a Stream Deck **Fade sting** key (lit while one plays). These fades are even in decibels: the sound dies away steadily to silence. **Back** stops a sting only if it undoes the item that started it. Video stings show only a stop button in the player window.

A run sheet editor on another computer can add stock and link stings from anywhere, and send a sting file to the timer over the same network (like a video).

## Random stings: one for every speaker

The run sheet editor's **Random stings** panel gives every item long enough to be a speaker a walk-up sting picked at random, never the same track twice on the sheet:

- **From**: tick **Stock stings**, **The folder** (the one chosen in + sting's *Custom file*, or **Choose…** here; files ticked *Exclude this from random selection pools* there are left out) and **My clips** (your sting library). With My clips ticked, your edit of a track stands in for the track; unticked, tracks play as supplied. A track counts once however it's cut, so two speakers never get the same music.
- **Items of at least** *n* **min** (2 unless you change it; 0 = every item) decides which items get one.
- **Stings** *of any length* / *no longer than* / *at least* *n* **s**: to leave out (or keep to) very short walk-ups. It goes by the length as it plays (a clip's part, not the whole track).
- **Only these styles** (on trial): the same chips as + sting's; light some (punk, rock and metal, say, or jazz and emo) and only stock stings in any of them are picked, so a show can keep to a mood; it says how many stings that leaves (and how many of them are your own). Your own files (the folder, My clips' files) are taken as in the lit styles. On alpha, ticking the folder or My clips listens to your own files for their styles instead (see + sting above), and the chips count them as each is done; until then the panel says how many aren't listened to yet, and they're left out while any are lit. None lit: any style.
- **🎲 Roll stings** gives a sting to each of those items that doesn't have one of its own, and picks again for the ones it picked before. Stings you chose yourself (with + sting, a dropped file, or edited with ✂) and items with a video are left alone. If the pool runs out (more speakers than stings, say, with a style set), it asks whether it's OK to reuse stings already chosen: yes gives the rest one each, the least used first and never the same as the item just before or after (unless there's nothing else); no leaves them without and says how many.
- **🎲 on a row** picks another for that item (even one you chose: you asked); with none left unused, it asks whether to reuse one already chosen. A die that's lit means the sting was picked at random.
- **Remove rolled stings** takes off the ones picked at random; yours stay.

During the show, items that have run and the one running now are never changed. Only audio stings are picked (a video walk-up needs the player window). A run sheet editor on another computer picks only from stock stings and edits of them (a file would have to be sent across).

## Clips: just the part you want

A guest brings a song and wants five seconds of it. Click **✂** on an item's sting in the run sheet editor: the track's waveform opens, the whole track on top and a close-up of the part below. Drag across the whole track to pick the part, then fine-tune the edges: drag a white line (the pointer turns into ↔ over one), type the times (m:ss.ss; ↑ ↓ step 0.01 s, Shift 0.1 s), or press ← → (Shift for a second, Alt for a hundredth). Set a fade in and a fade out in milliseconds (↑ ↓ or the box's arrows: 10 ms, Shift 100 ms). Fades are even in decibels, so the sound dies away steadily rather than hanging on and dropping at the end; **Linear fades** makes them a straight line in volume instead. Clips made before this change (November 2026) have it ticked, so they sound as they did; untick it to give one the smoother fade. **▶ Play the part** plays it with its fades; **▶ First 2 s** its opening; **▶ Last 2 s** the 2 seconds before the fade out begins, then the fade; **▶ From 2 s before** the lead-in (on a part too long to hold in memory, over 10 minutes, its first 10 seconds; First 2 s and Last 2 s play there too, and only **Play the part** says it's too long). **Punch in and out as it plays:** **▶ Play on** plays from 2 seconds before the start straight on to the end of the track (not stopping at the part's end; long files too). While anything plays, **Mark start** (or **I**) puts the start where you heard it, half a second back for your reaction, and it plays on so you can listen for the end; **Mark end** (or **O**) puts the end there and stops. Then fine-tune with First / Last 2 s. While you work on an edge (First / Last 2 s, dragging, typing or nudging it) the close-up keeps a standard scale: 6 seconds across, the start 1 second in from the left, or the end 1 second in from the right; **Show the whole part** goes back to all of it. **Whole track** undoes it. The file isn't cut: the sting just remembers the part, and the timer cuts it in memory when it loads, so Next starts it at once and exactly.

**Finding words in a long recording (on trial on alpha):** under the play buttons, **Transcribe** writes down what's said in the track or video, so you can find a moment by its words instead of by ear. It runs on this computer (English; the speech model, about 80–200 MB, is fetched the first time and kept by the browser; a computer with a graphics chip is much quicker), working through the file in pieces of up to 30 seconds: lines appear with their times as each is done, and silent stretches are skipped. Type in **Find words** to see only the lines with all of them (any order); **▶** plays from that line, with the close-up there, and **Start** / **End** put the clip's edges at it. **Stop** keeps what's done, and **Transcribe** later carries on from there. **Save as text** writes the transcript to a text file, a line each with its time, to keep or to compare. A file's transcript is kept in this browser, so opening the same file again shows it at once. The menu beside it picks a smaller, quicker model or a bigger, more accurate one.

While a long file opens, the editor says how big it is and counts the seconds: all of its sound has to be read first (a 1 GB, 51-minute video takes about half a minute). Meanwhile a bar fills where the waveform will be, timed by how long this computer took for files before (the first time, a band sweeps across instead). A long track's or video's waveform (half a minute or more) is kept in this browser after the first time, so opening it again shows the waveform at once: you can set the start and end straight away, and play and **Save** come on once the sound is read.

**A video's picture:** for a video, a small window beside the close-up shows the picture: playing in step while you play the part (the sound is the editor's, at its level), and otherwise the frame at the edge you're working on, so you can see exactly where a clip starts and ends.

### Loops: make a short sting longer

**⟲ Add a loop** (or Shift+drag across the whole track) marks a region to repeat, in orange, with its own edges to drag, type (From / To) or nudge. **Plays** is how many times it plays where it is: 3 plays the region three times in a row, so the sting grows by two copies (**Plays for** shows the new length). The joins are crossfaded over 10 ms, so a loop cut close to the beat doesn't click; **▶ Preview loop** plays just the loop, over and over (joined the same way), while you move its edges: it starts again with the new loop each time you let go of an edge (or type or nudge one); click it again (**■ Stop preview**) to stop. **▶ Around the loop** plays from 2 seconds before the repeats to 2 seconds after them to check.

Once it sounds right you can move the repeats: drag the ⟲ tab at the top of the region (or type **Goes in at**). The region itself stays where it was and plays once as part of the track; the copies (as many as **Plays** says) go in at the new place. So the repeated bit can come from anywhere in the track, even from outside the part that plays. Drag the tab back to the region's end, or click **Put back**, to put them back. A loop that goes in outside the part isn't heard (the editor says so). **Remove loop** removes it.

The timer builds the loop in memory when it loads the sting, so it has limits: the last play has to start within the first 1:30 of the sting (it may end up to one loop later), the whole sting with its loop can be 3 minutes at most, and the track 10 minutes. Audio stings only.

**Save as WAV** saves the edit as it sounds (part, loop and fades) as a WAV file in your downloads, up to 10 minutes. Use it for anything longer than a clip allows (a 6-minute version of a 30-second sting, say): add the file as the sting's file (**+ sting** → **Custom file**, or **+ From a file…** in the library).

## Levels: every sting at the same loudness

Stings come from everywhere, mastered at very different loudness. The timer evens them out by turning the louder ones **down** (never up, so nothing clips, and long tracks and video stings level the same way) to one level, measured the way broadcasters do (LUFS, EBU R128 / ITU-R BS.1770).

- **The clip editor** shows each clip's loudness as it plays (part, loop and fades), measured again as you change it, and what it will play at. **Trim** turns it down further by ear (dB). Its play buttons play it at that level.
- **The house level** (the run sheet editor's *Options* → *Sting levels*; −23 LUFS unless you change it) is what stings come down to, unless the show has its own.
- **Level this show…** measures every sting on the run sheet and uses the quietest one's loudness as this show's level: it plays as it is and the others come down to it, so you keep as much signal as you can. Do it once before the show (and again if you add a quieter sting); **Use the house level** goes back.
- **▶ Line-up tone** plays a 1 kHz tone from the timer, at the level the stings play at (the show's, or the house level), until you stop it (or press Esc, or Stop on the sting bar). Set the mixer's input so the tone reads your nominal level: every levelled sting then lands there. Stings are only turned down, so the mixer may need a little more gain than for a full-level track; the tone shows how much.

Video stings level the same way: their soundtrack is measured, and the player window plays them at that level (a video with no sound shows *no sound to measure*).

A sting that hasn't been measured (added since the show was levelled, and not saved in the clip editor) plays at its own level: level the show again.

## Sound outputs: the show on the PA, previews on headphones

In Chrome and Edge, the run sheet editor's *Options* → *Sound outputs* chooses two sound cards (kept on this computer; the sting library page has the same choice at its foot):

- **Show**: what the audience hears. Stings, video stings, videos and the line-up tone, from the timer.
- **Previews and editing**: the ▶ buttons in **+ sting**, the clip editor and the sting library. Bluetooth headphones, say.

Each plays only on its own output, so you can audition and edit stings on headphones while the show's stings play out on the PA: someone pressing Next on the Stream Deck doesn't stop your preview, and your preview doesn't reach the room. Choosing the show's output also keeps the stings there when headphones connect (a Mac makes them its default output as they do).

The browser lists sound cards by name only once the site may use the microphone, so the first time click **Name the sound cards…** and allow it (choose to allow it on every visit; nothing is recorded).

If a chosen output isn't connected, nothing plays there rather than on another output: with the **show** output missing, stings and the tone don't play and videos play silently, and a red warning on the timer's screen says so; with the **preview** output missing (headphones off), previews don't play, so one can never land on the PA. Plug it back in and everything carries on by itself. Leave either on *This computer's default output* for the old behaviour.

In the library file a clip's level is `"lufs"` (its measured loudness) and `"volume"` (the trim, 0–1).

## The sting library

The library (a panel in the run sheet editor, from **+ sting** → **Edited sting** → **Open the sting library…**; also a page of its own, `stings.html`) keeps clips on this computer: make them from the stock stings (**✂** on one) or from your own tracks (**+ From a file…**). They appear in the run sheet editor's **+ sting** under **My clips** (an open dialog picks up changes made in the library's tab); a clip of your own file brings the file with it. Trimming such a sting with **✂** in the run sheet asks whether to update the library clip too (its cut and its name), or just this item.

**Export** saves the library as `sting-library.json`, the same format as the site's stock list with the clip fields added:

```json
{ "stings": [
  { "name": "Keynote — 5 s hit", "stock": "Walk-up 3", "start": 32.5, "end": 37.5, "fadeIn": 150, "fadeOut": 800 },
  { "name": "Sarah's walk-on", "file": "sarah-song.mp3", "size": 4197288, "start": 61.2, "end": 66.2, "fadeOut": 500 },
  { "name": "Awards — long", "stock": "Fanfare", "start": 0, "end": 12, "fadeOut": 1500, "loop": { "from": 4, "to": 8, "plays": 4 } }
] }
```

`loop` is `{from, to, plays}` (seconds into the track; `plays` 2–99), plus `at` (seconds into the track) when the repeats have been moved.

A clip of a stock sting can **hide the original** (ticked by default when you make one): while the clip exists, **+ sting** offers the clip and not the whole track, so nobody picks the original by mistake. A song can give several clips (a different middle can be just as good a sting); the original stays hidden while any of them has the box ticked, and the library shows how many clips each stock sting has. Delete those clips (or untick them) and the original is offered again. In the file it's `"hideOriginal": true`; the site's own clips can carry it too, for a better edit of a song with an odd start or end.

`stock` points at a stock sting by name; `file` at a track by its file name and size (browsers can't read file paths). **Import** on another computer brings the clips; any that need a file show **⚠ needs the file**, and **Find files…** asks for the folder they're in, once.

On the hosted site, the owner's exported library goes in the stings folder as `clips.json`; the deploy lists those clips after the songs, so everyone gets the short versions as stock stings.
