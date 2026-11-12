/*!
 * sting-styles.js
 * Music styles of a sting (a trial, not wired in yet: step 1 of style search, Nov 2026): a file in, 400
 * Discogs style scores out ("Rock---Hard Rock", "Funk / Soul---Disco"…), then tags and a word search over
 * the style names. The work is in sting-styles-worker.js (our own spectrogram, matching Essentia's, and
 * MTG's Discogs-EffNet model); this decodes the file straight to 16 kHz mono (one resample; channels
 * averaged, as Essentia's MonoLoader), at most MAX_SEC of it, and keeps one worker for the page.
 *
 *   StingStyles.analyse(blob, {onProgress(f)}) → Promise of {scores: Float32Array(400), patches, seconds}
 *   StingStyles.ranked(scores, n)              the n best style indexes
 *   StingStyles.tags(scores, threshold, max)   [{i, genre, style, score}] at or above the threshold (0.1)
 *   StingStyles.match(scores, query)           {i, score} of the best style whose "genre style" has every
 *                                              word of the query ("hard rock", "disco"), or null
 *   StingStyles.compact(scores, n) / expand(c) the n best as [[i, score], …] (kept with a sting) and back
 *   StingStyles.STYLES [{genre, style, key}], MODEL (its name: kept with the scores), modelUrl (settable)
 * Scores are independent sigmoids, not shares of 1: a clear match is typically 0.3–0.7, anything over
 * about 0.1 a plausible tag (MTG's guidance; to tune on the stings).
 *
 * Model: Discogs-EffNet by the Music Technology Group, Universitat Pompeu Fabra
 * (https://essentia.upf.edu/models.html), CC BY-NC-SA 4.0: non-commercial use only.
 * MIT Licensed (this file; not the model)
 */
var StingStyles = (function () {
  'use strict';
  const LABELS = ["Blues---Boogie Woogie", "Blues---Chicago Blues", "Blues---Country Blues", "Blues---Delta Blues", "Blues---Electric Blues", "Blues---Harmonica Blues", "Blues---Jump Blues", "Blues---Louisiana Blues", "Blues---Modern Electric Blues", "Blues---Piano Blues", "Blues---Rhythm & Blues", "Blues---Texas Blues", "Brass & Military---Brass Band", "Brass & Military---Marches", "Brass & Military---Military", "Children's---Educational", "Children's---Nursery Rhymes", "Children's---Story", "Classical---Baroque", "Classical---Choral", "Classical---Classical", "Classical---Contemporary", "Classical---Impressionist", "Classical---Medieval", "Classical---Modern", "Classical---Neo-Classical", "Classical---Neo-Romantic", "Classical---Opera", "Classical---Post-Modern", "Classical---Renaissance", "Classical---Romantic", "Electronic---Abstract", "Electronic---Acid", "Electronic---Acid House", "Electronic---Acid Jazz", "Electronic---Ambient", "Electronic---Bassline", "Electronic---Beatdown", "Electronic---Berlin-School", "Electronic---Big Beat", "Electronic---Bleep", "Electronic---Breakbeat", "Electronic---Breakcore", "Electronic---Breaks", "Electronic---Broken Beat", "Electronic---Chillwave", "Electronic---Chiptune", "Electronic---Dance-pop", "Electronic---Dark Ambient", "Electronic---Darkwave", "Electronic---Deep House", "Electronic---Deep Techno", "Electronic---Disco", "Electronic---Disco Polo", "Electronic---Donk", "Electronic---Downtempo", "Electronic---Drone", "Electronic---Drum n Bass", "Electronic---Dub", "Electronic---Dub Techno", "Electronic---Dubstep", "Electronic---Dungeon Synth", "Electronic---EBM", "Electronic---Electro", "Electronic---Electro House", "Electronic---Electroclash", "Electronic---Euro House", "Electronic---Euro-Disco", "Electronic---Eurobeat", "Electronic---Eurodance", "Electronic---Experimental", "Electronic---Freestyle", "Electronic---Future Jazz", "Electronic---Gabber", "Electronic---Garage House", "Electronic---Ghetto", "Electronic---Ghetto House", "Electronic---Glitch", "Electronic---Goa Trance", "Electronic---Grime", "Electronic---Halftime", "Electronic---Hands Up", "Electronic---Happy Hardcore", "Electronic---Hard House", "Electronic---Hard Techno", "Electronic---Hard Trance", "Electronic---Hardcore", "Electronic---Hardstyle", "Electronic---Hi NRG", "Electronic---Hip Hop", "Electronic---Hip-House", "Electronic---House", "Electronic---IDM", "Electronic---Illbient", "Electronic---Industrial", "Electronic---Italo House", "Electronic---Italo-Disco", "Electronic---Italodance", "Electronic---Jazzdance", "Electronic---Juke", "Electronic---Jumpstyle", "Electronic---Jungle", "Electronic---Latin", "Electronic---Leftfield", "Electronic---Makina", "Electronic---Minimal", "Electronic---Minimal Techno", "Electronic---Modern Classical", "Electronic---Musique Concr\u00e8te", "Electronic---Neofolk", "Electronic---New Age", "Electronic---New Beat", "Electronic---New Wave", "Electronic---Noise", "Electronic---Nu-Disco", "Electronic---Power Electronics", "Electronic---Progressive Breaks", "Electronic---Progressive House", "Electronic---Progressive Trance", "Electronic---Psy-Trance", "Electronic---Rhythmic Noise", "Electronic---Schranz", "Electronic---Sound Collage", "Electronic---Speed Garage", "Electronic---Speedcore", "Electronic---Synth-pop", "Electronic---Synthwave", "Electronic---Tech House", "Electronic---Tech Trance", "Electronic---Techno", "Electronic---Trance", "Electronic---Tribal", "Electronic---Tribal House", "Electronic---Trip Hop", "Electronic---Tropical House", "Electronic---UK Garage", "Electronic---Vaporwave", "Folk, World, & Country---African", "Folk, World, & Country---Bluegrass", "Folk, World, & Country---Cajun", "Folk, World, & Country---Canzone Napoletana", "Folk, World, & Country---Catalan Music", "Folk, World, & Country---Celtic", "Folk, World, & Country---Country", "Folk, World, & Country---Fado", "Folk, World, & Country---Flamenco", "Folk, World, & Country---Folk", "Folk, World, & Country---Gospel", "Folk, World, & Country---Highlife", "Folk, World, & Country---Hillbilly", "Folk, World, & Country---Hindustani", "Folk, World, & Country---Honky Tonk", "Folk, World, & Country---Indian Classical", "Folk, World, & Country---La\u00efk\u00f3", "Folk, World, & Country---Nordic", "Folk, World, & Country---Pacific", "Folk, World, & Country---Polka", "Folk, World, & Country---Ra\u00ef", "Folk, World, & Country---Romani", "Folk, World, & Country---Soukous", "Folk, World, & Country---S\u00e9ga", "Folk, World, & Country---Volksmusik", "Folk, World, & Country---Zouk", "Folk, World, & Country---\u00c9ntekhno", "Funk / Soul---Afrobeat", "Funk / Soul---Boogie", "Funk / Soul---Contemporary R&B", "Funk / Soul---Disco", "Funk / Soul---Free Funk", "Funk / Soul---Funk", "Funk / Soul---Gospel", "Funk / Soul---Neo Soul", "Funk / Soul---New Jack Swing", "Funk / Soul---P.Funk", "Funk / Soul---Psychedelic", "Funk / Soul---Rhythm & Blues", "Funk / Soul---Soul", "Funk / Soul---Swingbeat", "Funk / Soul---UK Street Soul", "Hip Hop---Bass Music", "Hip Hop---Boom Bap", "Hip Hop---Bounce", "Hip Hop---Britcore", "Hip Hop---Cloud Rap", "Hip Hop---Conscious", "Hip Hop---Crunk", "Hip Hop---Cut-up/DJ", "Hip Hop---DJ Battle Tool", "Hip Hop---Electro", "Hip Hop---G-Funk", "Hip Hop---Gangsta", "Hip Hop---Grime", "Hip Hop---Hardcore Hip-Hop", "Hip Hop---Horrorcore", "Hip Hop---Instrumental", "Hip Hop---Jazzy Hip-Hop", "Hip Hop---Miami Bass", "Hip Hop---Pop Rap", "Hip Hop---Ragga HipHop", "Hip Hop---RnB/Swing", "Hip Hop---Screw", "Hip Hop---Thug Rap", "Hip Hop---Trap", "Hip Hop---Trip Hop", "Hip Hop---Turntablism", "Jazz---Afro-Cuban Jazz", "Jazz---Afrobeat", "Jazz---Avant-garde Jazz", "Jazz---Big Band", "Jazz---Bop", "Jazz---Bossa Nova", "Jazz---Contemporary Jazz", "Jazz---Cool Jazz", "Jazz---Dixieland", "Jazz---Easy Listening", "Jazz---Free Improvisation", "Jazz---Free Jazz", "Jazz---Fusion", "Jazz---Gypsy Jazz", "Jazz---Hard Bop", "Jazz---Jazz-Funk", "Jazz---Jazz-Rock", "Jazz---Latin Jazz", "Jazz---Modal", "Jazz---Post Bop", "Jazz---Ragtime", "Jazz---Smooth Jazz", "Jazz---Soul-Jazz", "Jazz---Space-Age", "Jazz---Swing", "Latin---Afro-Cuban", "Latin---Bai\u00e3o", "Latin---Batucada", "Latin---Beguine", "Latin---Bolero", "Latin---Boogaloo", "Latin---Bossanova", "Latin---Cha-Cha", "Latin---Charanga", "Latin---Compas", "Latin---Cubano", "Latin---Cumbia", "Latin---Descarga", "Latin---Forr\u00f3", "Latin---Guaguanc\u00f3", "Latin---Guajira", "Latin---Guaracha", "Latin---MPB", "Latin---Mambo", "Latin---Mariachi", "Latin---Merengue", "Latin---Norte\u00f1o", "Latin---Nueva Cancion", "Latin---Pachanga", "Latin---Porro", "Latin---Ranchera", "Latin---Reggaeton", "Latin---Rumba", "Latin---Salsa", "Latin---Samba", "Latin---Son", "Latin---Son Montuno", "Latin---Tango", "Latin---Tejano", "Latin---Vallenato", "Non-Music---Audiobook", "Non-Music---Comedy", "Non-Music---Dialogue", "Non-Music---Education", "Non-Music---Field Recording", "Non-Music---Interview", "Non-Music---Monolog", "Non-Music---Poetry", "Non-Music---Political", "Non-Music---Promotional", "Non-Music---Radioplay", "Non-Music---Religious", "Non-Music---Spoken Word", "Pop---Ballad", "Pop---Bollywood", "Pop---Bubblegum", "Pop---Chanson", "Pop---City Pop", "Pop---Europop", "Pop---Indie Pop", "Pop---J-pop", "Pop---K-pop", "Pop---Kay\u014dkyoku", "Pop---Light Music", "Pop---Music Hall", "Pop---Novelty", "Pop---Parody", "Pop---Schlager", "Pop---Vocal", "Reggae---Calypso", "Reggae---Dancehall", "Reggae---Dub", "Reggae---Lovers Rock", "Reggae---Ragga", "Reggae---Reggae", "Reggae---Reggae-Pop", "Reggae---Rocksteady", "Reggae---Roots Reggae", "Reggae---Ska", "Reggae---Soca", "Rock---AOR", "Rock---Acid Rock", "Rock---Acoustic", "Rock---Alternative Rock", "Rock---Arena Rock", "Rock---Art Rock", "Rock---Atmospheric Black Metal", "Rock---Avantgarde", "Rock---Beat", "Rock---Black Metal", "Rock---Blues Rock", "Rock---Brit Pop", "Rock---Classic Rock", "Rock---Coldwave", "Rock---Country Rock", "Rock---Crust", "Rock---Death Metal", "Rock---Deathcore", "Rock---Deathrock", "Rock---Depressive Black Metal", "Rock---Doo Wop", "Rock---Doom Metal", "Rock---Dream Pop", "Rock---Emo", "Rock---Ethereal", "Rock---Experimental", "Rock---Folk Metal", "Rock---Folk Rock", "Rock---Funeral Doom Metal", "Rock---Funk Metal", "Rock---Garage Rock", "Rock---Glam", "Rock---Goregrind", "Rock---Goth Rock", "Rock---Gothic Metal", "Rock---Grindcore", "Rock---Grunge", "Rock---Hard Rock", "Rock---Hardcore", "Rock---Heavy Metal", "Rock---Indie Rock", "Rock---Industrial", "Rock---Krautrock", "Rock---Lo-Fi", "Rock---Lounge", "Rock---Math Rock", "Rock---Melodic Death Metal", "Rock---Melodic Hardcore", "Rock---Metalcore", "Rock---Mod", "Rock---Neofolk", "Rock---New Wave", "Rock---No Wave", "Rock---Noise", "Rock---Noisecore", "Rock---Nu Metal", "Rock---Oi", "Rock---Parody", "Rock---Pop Punk", "Rock---Pop Rock", "Rock---Pornogrind", "Rock---Post Rock", "Rock---Post-Hardcore", "Rock---Post-Metal", "Rock---Post-Punk", "Rock---Power Metal", "Rock---Power Pop", "Rock---Power Violence", "Rock---Prog Rock", "Rock---Progressive Metal", "Rock---Psychedelic Rock", "Rock---Psychobilly", "Rock---Pub Rock", "Rock---Punk", "Rock---Rock & Roll", "Rock---Rockabilly", "Rock---Shoegaze", "Rock---Ska", "Rock---Sludge Metal", "Rock---Soft Rock", "Rock---Southern Rock", "Rock---Space Rock", "Rock---Speed Metal", "Rock---Stoner Rock", "Rock---Surf", "Rock---Symphonic Rock", "Rock---Technical Death Metal", "Rock---Thrash", "Rock---Twist", "Rock---Viking Metal", "Rock---Y\u00e9-Y\u00e9", "Stage & Screen---Musical", "Stage & Screen---Score", "Stage & Screen---Soundtrack", "Stage & Screen---Theme"];   // (accents escaped: right whatever charset a page declares)
  const STYLES = LABELS.map(l => { const [genre, style] = l.split('---'); return { genre, style, key: (genre + ' ' + style).toLowerCase() }; });
  const MODEL = 'discogs-effnet-bsdynamic-1', SR = 16000, MAX_SEC = 600, THRESHOLD = 0.1;
  let modelUrl = new URL('models/' + MODEL + '.onnx', location.href).href;

  let worker = null, seq = 0;
  const waiting = new Map();                           // id → {resolve, reject, onProgress}
  function work() {
    if (worker) return worker;
    worker = new Worker(new URL('sting-styles-worker.js', location.href));
    worker.onmessage = e => {
      const m = e.data || {}, w = waiting.get(m.id);
      if (!w) return;
      if (m.progress != null) { if (w.onProgress) w.onProgress(m.progress); return; }
      waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m);
    };
    worker.onerror = e => { for (const w of waiting.values()) w.reject(new Error(e.message || 'The style worker stopped')); waiting.clear(); worker = null; };
    return worker;
  }
  async function samplesOf(blob) {
    const ab = await new OfflineAudioContext(1, 1, SR).decodeAudioData(await blob.arrayBuffer());   // (decoded at 16 kHz)
    const n = Math.min(ab.length, MAX_SEC * SR), out = new Float32Array(n), k = ab.numberOfChannels;
    for (let c = 0; c < k; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / k; }
    return { samples: out, seconds: ab.duration };
  }
  async function analyse(blob, opts) {
    const { samples, seconds } = await samplesOf(blob);
    if (samples.length < SR) throw new Error('Too short to tell its style (under a second).');
    const id = ++seq;
    const r = await new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, onProgress: opts && opts.onProgress });
      work().postMessage({ id, samples, model: modelUrl }, [samples.buffer]);
    });
    return { scores: r.scores, patches: r.patches, seconds };
  }

  const ranked = (scores, n) => Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]).slice(0, n);
  const tags = (scores, threshold, max) => ranked(scores, max || 8).filter(i => scores[i] >= (threshold == null ? THRESHOLD : threshold))
    .map(i => ({ i, genre: STYLES[i].genre, style: STYLES[i].style, score: scores[i] }));
  function match(scores, query) {
    const words = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    let best = null;
    STYLES.forEach((s, i) => { if (words.every(w => s.key.includes(w)) && (!best || scores[i] > best.score)) best = { i, score: scores[i] }; });
    return best;
  }
  const compact = (scores, n) => ranked(scores, n || 20).map(i => [i, Math.round(scores[i] * 1000) / 1000]);
  function expand(list) { const s = new Float32Array(400); for (const [i, v] of list || []) if (i >= 0 && i < 400) s[i] = v; return s; }

  return { LABELS, STYLES, MODEL, THRESHOLD, analyse, ranked, tags, match, compact, expand,
    get modelUrl() { return modelUrl; }, set modelUrl(u) { modelUrl = new URL(u, location.href).href; } };
})();
