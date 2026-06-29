// Stats API for the /links admin dashboard.
//
// Counts are derived by listing the Blobs store with date-scoped
// prefixes. Per-day lists are bounded by that day's traffic so they
// stay fast; the all-time count walks every day in the requested
// window plus a single broader sweep for lifetime totals.
//
// Auth is a shared bearer token (ADMIN_TOKEN env var). Fine for a
// personal dashboard; swap for Netlify Identity to share access.

import { getStore } from '@netlify/blobs';
import links from '../../links.json' with { type: 'json' };

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

export default async (req) => {
  if (!ADMIN_TOKEN) {
    return new Response('ADMIN_TOKEN not configured.', { status: 500 });
  }
  if ((req.headers.get('authorization') || '') !== `Bearer ${ADMIN_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url  = new URL(req.url);
  const days = Math.min(60, Math.max(1, Number(url.searchParams.get('days')) || 14));

  const clicks = getStore('clicks');

  // YYYY-MM-DD strings for the requested window, oldest first.
  const today = new Date();
  const dateList = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    return d.toISOString().slice(0, 10);
  });

  const slugs = Object.keys(links.links);

  // Fan out everything in parallel. For each slug we ask for:
  //   - per-day counts inside the window
  //   - the lifetime count (a single list at the slug prefix)
  // Each list paginates; countByPrefix walks all pages.
  const perSlug = await Promise.all(slugs.map(async (slug) => {
    const dailyCounts = await Promise.all(
      dateList.map(date => countByPrefix(clicks, `${slug}/${date}/`))
    );
    const lifetime = await countByPrefix(clicks, `${slug}/`);
    const daily = Object.fromEntries(dateList.map((d, i) => [d, dailyCounts[i]]));
    return { slug, daily, lifetime };
  }));

  const totals = {};
  const daily = {};
  for (const r of perSlug) {
    totals[r.slug] = r.lifetime;
    daily[r.slug] = r.daily;
  }

  return Response.json({
    links: links.links,
    totals,
    daily,
    dateList,
    generatedAt: new Date().toISOString(),
  });
};

async function countByPrefix(store, prefix) {
  let count = 0;
  let cursor;
  // Netlify Blobs paginates list() — walk every page so a hot slug
  // doesn't return a misleadingly low count.
  do {
    const page = await store.list({ prefix, cursor });
    count += (page.blobs || []).length;
    cursor = page.cursor;
  } while (cursor);
  return count;
}
