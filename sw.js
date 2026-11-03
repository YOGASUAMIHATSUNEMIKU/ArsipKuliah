/**
 * ArsipKuliah — Service Worker
 * Strategi:
 *  - App Shell (index.html, icons, manifest): Cache-First dengan fallback network
 *  - Offline fallback: offline.html ditampilkan saat navigasi gagal
 *  - Data pengguna (localStorage): TIDAK di-cache oleh SW — murni di browser
 *  - Update: saat SW baru tersedia, langsung aktif (skipWaiting + clients.claim)
 */

const CACHE_VERSION = 'v2';
const SHELL_CACHE   = `ak-shell-${CACHE_VERSION}`;
const OFFLINE_URL   = './offline.html';

// File-file yang harus di-cache saat instalasi (app shell)
const SHELL_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-maskable.svg',
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      // addAll gagal total jika salah satu URL tidak dapat difetch.
      // Gunakan Promise.allSettled agar parsial cache tetap berhasil.
      return Promise.allSettled(
        SHELL_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Gagal cache:', url, err))
        )
      );
    }).then(() => {
      console.log('[SW] Install selesai — versi', CACHE_VERSION);
      return self.skipWaiting(); // langsung aktif tanpa menunggu tab lama ditutup
    })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('ak-shell-') && key !== SHELL_CACHE)
          .map(key => {
            console.log('[SW] Hapus cache lama:', key);
            return caches.delete(key);
          })
      )
    ).then(() => {
      console.log('[SW] Aktif — versi', CACHE_VERSION);
      return self.clients.claim(); // ambil kontrol semua tab tanpa reload
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Hanya tangani GET — biarkan POST/PUT/DELETE lewat langsung
  if (request.method !== 'GET') return;

  // Jangan tangani request ke origin lain (CDN, analytics, dll.)
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Navigasi ke halaman — gunakan Network-First agar konten selalu fresh,
  // dengan fallback ke cache, lalu offline.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Simpan salinan terbaru ke cache
          const clone = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request)
            .then(cached => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Aset statis (CSS, JS, gambar, font) — Cache-First
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // Hanya cache respons valid (200 OK, tipe basic = same-origin)
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put(request, clone));
        return response;
      }).catch(() => {
        // Untuk gambar yang gagal: kembalikan icon fallback dari cache jika ada
        if (request.destination === 'image') {
          return caches.match('./icons/icon.svg');
        }
      });
    })
  );
});

// ── MESSAGE ───────────────────────────────────────────────────────────────────
// Terima pesan dari halaman untuk memaksa update cache (dipakai oleh tombol "Update" jika ada)
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});
