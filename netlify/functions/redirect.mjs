// l.hyphi.art redirect function.
//
// Catches every request whose Host is l.hyphi.art (via netlify.toml
// rewrite), looks the slug up in the repo-bundled links.json, fires
// a tracking event into Netlify Blobs and (optionally) GA4 via the
// Measurement Protocol, and 302s to the destination.
//
// Click tracking runs through context.waitUntil so the redirect is
// never delayed by a Blobs write or GA round-trip.
//
// Each click is written to a UNIQUE Blob key — no read-modify-write
// counter, so concurrent clicks on the same slug never collide and
// every click is preserved exactly once. Totals are derived from
// list() on the dashboard side.

import { getStore } from '@netlify/blobs';
import links from '../../links.json' with { type: 'json' };

const GA_ID     = process.env.GA_MEASUREMENT_ID; // e.g. G-XXXXXXX
const GA_SECRET = process.env.GA_API_SECRET;

export default async (req, context) => {
  const url = new URL(req.url);
  const slug = url.pathname.replace(/^\/+|\/+$/g, '');

  if (!slug) {
    return Response.redirect(links.fallback || 'https://hyphi.art', 302);
  }

  const target = links.links[slug];
  if (!target) {
    return new Response(`Unknown short link: ${slug}`, {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    });
  }

  context.waitUntil(track(slug, target, req, context));
  return Response.redirect(target, 302);
};

async function track(slug, target, req, context) {
  const clicks = getStore('clicks');

  // Unique key per click. Grouping by date in the path lets the
  // dashboard ask for "clicks on slug X on date Y" via a prefixed
  // list() — bounded by that day's traffic, not the slug's lifetime.
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const rand = (crypto.randomUUID?.() || `${Math.random()}`).slice(0, 8);
  const key = `${slug}/${dateKey}/${now.getTime()}-${rand}`;

  await clicks.setJSON(key, {
    t: now.toISOString(),
    ref: req.headers.get('referer') || null,
    country: context.geo?.country?.code || null,
    ua: (req.headers.get('user-agent') || '').slice(0, 200) || null,
  });

  if (GA_ID && GA_SECRET) {
    try { await sendGA(slug, target, req); } catch {}
  }
}

async function sendGA(slug, target, req) {
  const clientId = await hashClientId(req);
  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${GA_ID}&api_secret=${GA_SECRET}`,
    {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        events: [{
          name: 'link_click',
          params: { slug, destination: target },
        }],
      }),
    }
  );
}

// Stable per-visitor id without persisting PII. ip+ua hashed and
// truncated — same visitor → same client_id until either changes.
async function hashClientId(req) {
  const ip = req.headers.get('x-nf-client-connection-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || '';
  const data = new TextEncoder().encode(ip + '|' + ua);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
