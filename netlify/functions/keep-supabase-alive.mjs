// Scheduled keep-alive ping for a Supabase free-tier project.
//
// Supabase pauses free-tier (no-cost) projects after 7 consecutive
// days with no activity. This function issues one lightweight,
// authenticated request against the project's REST API so the
// database registers activity and the project stays awake.
//
// Schedule: every 3 days (see `config` below). That's comfortably
// under the 7-day pause window while keeping invocations to a minimum
// (~10/month). Because the interval is 3 days, even a single missed or
// failed run still lands the next successful ping at ~6 days — still
// inside the window — so one hiccup won't let the project sleep.
//
// Configuration (Netlify environment variables):
//   SUPABASE_URL         required, e.g. https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY    required (SUPABASE_KEY also accepted)
//   SUPABASE_PING_TABLE  optional. A table name to touch. If unset,
//                        the PostgREST root is hit, whose schema
//                        introspection also queries the database.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const PING_TABLE   = process.env.SUPABASE_PING_TABLE;

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      'keep-supabase-alive: SUPABASE_URL and SUPABASE_ANON_KEY must be set.'
    );
    return new Response('Missing Supabase configuration.', { status: 500 });
  }

  const base = SUPABASE_URL.replace(/\/+$/, '');
  // Touch a real table when configured (limit=1 reads at most one row
  // but still executes a query); otherwise hit the PostgREST root,
  // whose schema introspection also queries the database. HEAD keeps
  // the response body empty — we only care that the request ran.
  const url = PING_TABLE
    ? `${base}/rest/v1/${encodeURIComponent(PING_TABLE)}?select=*&limit=1`
    : `${base}/rest/v1/`;

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    console.log(`keep-supabase-alive: pinged ${url} → ${res.status}`);
    if (!res.ok) {
      return new Response(`Ping returned ${res.status}`, { status: 502 });
    }
    return new Response('Supabase pinged.', { status: 200 });
  } catch (err) {
    console.error('keep-supabase-alive: ping failed', err);
    return new Response('Ping failed.', { status: 502 });
  }
};

// Netlify scheduled function. Cron runs in UTC.
// "0 12 */3 * *" = 12:00 UTC, every 3rd day of the month.
export const config = {
  schedule: '0 12 */3 * *',
};
