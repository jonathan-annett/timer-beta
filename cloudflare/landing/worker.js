/*!
 * Coming soon: timed-show.com and timed.show (and www.) until the launch. Every path gets this
 * page (no-store, so the launch replaces it at once); it points at the beta.
 * MIT Licensed
 */
const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Timed Show: coming soon</title>
  <meta name="description" content="A presentation timer for shows, conferences and meetings. Coming soon; the beta is available now.">
  <style>
    html, body { margin: 0; min-height: 100%; background: #0b0b0b; color: #ddd; font: 18px/1.55 "Helvetica Neue", Arial, sans-serif; }
    main { max-width: 620px; margin: 0 auto; padding: 14vh 24px 40px; }
    .clock { font: bold 64px/1 "Helvetica Neue", Arial, sans-serif; color: #fff; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
    h1 { font-size: 30px; color: #fff; margin: 28px 0 10px; }
    p { margin: 0 0 14px; }
    a.beta { display: inline-block; margin-top: 16px; padding: 12px 26px; border-radius: 8px; border: 1px solid #2a6a9a; background: #0b3d5c;
      color: #fff; text-decoration: none; font-size: 19px; }
    a.beta:hover { background: #10507a; }
    .small { color: #777; font-size: 14px; margin-top: 40px; }
  </style>
</head>
<body>
  <main>
    <div class="clock" aria-hidden="true">0:00</div>
    <h1>Timed Show is coming soon</h1>
    <p>A presentation timer for shows, conferences and meetings: a countdown for the presenter, run sheets, phones and Stream Deck as remotes, and a floating overlay over PowerPoint.</p>
    <p>In the meantime, the beta is available:</p>
    <a class="beta" href="https://beta.timed-show.com/">beta.timed-show.com</a>
  </main>
</body>
</html>`;

export default {
  fetch() {
    return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  },
};
