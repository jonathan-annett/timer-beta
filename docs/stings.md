# Walk-up stings (experimental)

## Using it (an alpha-only trial)

Only on the alpha site (`features.js`, `TimerFeatures.stings`): elsewhere the run sheet editor doesn't offer them and the timer doesn't play them.

A walk-up sting is a short piece of music (or a video) that plays as a run sheet item starts: the speaker's walk-on music, say. Unlike a video on an item, it doesn't set the timer: the item keeps its own duration, and the sting just plays over its start.

In the run sheet editor, click **+ sting** in an item's Video column and choose:

- **a stock sting** from the list the site offers (`stock-stings.json` next to the timer: `name`, `url`, `media` audio or video, `duration` in seconds),
- **a link** to an audio or video file (https), or
- **a file** from your computer. Dropping an audio file on a row does the same (a video file dropped on a row is still a video for the item).

In the dialog, **▶** next to the stock list lets you hear the selected sting first. Stock stings already on this run sheet are marked *in use* with the items using them; tick **Hide stings already on this run sheet** to leave them out (some presenters want their walk-up to themselves). Choosing a stock sting or link that another item already uses asks first.

An item has a video or a sting, not both.

**Everything plays on the timer's computer:** audio from the timer page itself, video in the player window (open it with **video**). It's made for a small show run from one laptop, with no network needed. A file is kept in the browser; a link or stock sting is copied there too, as soon as the timer sees it, if its server allows it (it has to send `Access-Control-Allow-Origin`). One that couldn't be copied shows **⚠** in the editor and plays from its link, so it needs the internet.

**During the show:** **Next** plays the item's sting (the next one is loaded ahead, so it starts at once). A sting plays to its end: long tracks cover activity on stage, and an item without a sting leaves it playing, so an introduction spoken over a sting can be followed by the speaker's countdown. It stops when another sting (or a video item) starts, or when you fade it: the sting bar on the timer's screen (**Fade out** over 3 seconds, or **Stop**), or a Stream Deck **Fade sting** key (lit while one plays). **Back** stops a sting only if it undoes the item that started it. Video stings show only a stop button in the player window.

A run sheet editor on another computer can add stock and link stings from anywhere, and send a sting file to the timer over the same network (like a video).
