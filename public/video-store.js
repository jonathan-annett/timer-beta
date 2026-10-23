/*!
 * video-store.js
 * Keeps video files for the run sheet in the browser (IndexedDB), so they survive restarts
 * (a multi-day event) without asking for the files again. Shared by the timer window
 * (dropPlayer.js / runsheet.js, to play them) and the run sheet editor (to add them).
 *
 * window.videoStore: put(key, blob), get(key) → Blob|null, remove(key), keys() → [key]
 * MIT Licensed
 */

(function (root) {
  'use strict';

  const DB = 'blobDB', STORE = 'blobs';   // same database the original drop player created

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onerror = () => reject(req.error || new Error('Could not open the video store'));
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = e => { e.target.result.createObjectStore(STORE, { keyPath: 'key' }); };
    });
  }

  function run(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req && req.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Video store error')); };
    }));
  }

  root.videoStore = {
    put: (key, blob) => run('readwrite', s => s.put({ key, data: blob })),
    get: key => run('readonly', s => s.get(key)).then(r => (r ? r.data : null)),
    remove: key => run('readwrite', s => s.delete(key)),
    keys: () => run('readonly', s => s.getAllKeys()).then(k => k || []),
  };
})(window);
