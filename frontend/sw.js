// GB Hub service worker (Android app only).
// It does ONE thing: when you tap Share in a betting app and pick GB Hub,
// it catches the bet slip picture and opens Bet Challenges with it.
// Every other request is left alone - it goes to the network exactly as
// before, and nothing is ever cached, so pages always load fresh.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'POST' || u.origin !== self.location.origin || u.pathname !== '/share-bet') return;
  e.respondWith((async () => {
    try {
      const form = await e.request.formData();
      const box = await caches.open('gb-shared-bet');   // a one-item hand-over box, emptied by the page
      await box.delete('/shared/slip');
      const file = form.get('slip');
      if (file && file.size) await box.put('/shared/slip', new Response(file, { headers: { 'content-type': file.type || 'image/jpeg' } }));
      await box.put('/shared/info', new Response(JSON.stringify({
        title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''), at: Date.now()
      }), { headers: { 'content-type': 'application/json' } }));
    } catch (err) { /* the page will say nothing came through */ }
    return Response.redirect('/challenges?shared=1', 303);
  })());
});
