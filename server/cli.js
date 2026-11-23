// Command-line helpers:
//   node server/cli.js sync      run every sync job once (DOE, market, news, forecast)
//   node server/cli.js prices    DOE prices only
//   node server/cli.js backfill [weeks|all]   import older DOE weekly reports (history back to 2017)
//   node server/cli.js check     test every external integration and print a status table
//   node server/cli.js admin <email>   promote an existing user to admin
import { config } from './config.js';
import { closeDb, db, initDb } from './db/index.js';
import { listDocuments } from './integrations/doe.js';
import { generate, geminiEnabled } from './integrations/gemini.js';
import { reverseGeocode, searchPlaces } from './integrations/geocode.js';
import { fetchBrent, fetchUsdPhp } from './integrations/market.js';
import { elevations, weatherAlong } from './integrations/openmeteo.js';
import { getRoutes } from './integrations/osrm.js';
import { stationsNear } from './integrations/overpass.js';
import { addDays, manilaDate } from './lib/util.js';
import { runJob } from './services/jobs.js';

const [cmd, arg] = process.argv.slice(2);

async function check() {
  const cubao = { lat: 14.6199, lng: 121.0509 }; const tagaytay = { lat: 14.1153, lng: 120.9621 };
  const tests = [
    ['DOE listing (doe.gov.ph)', async () => `${(await listDocuments('ncr')).length} NCR reports listed`],
    ['OSRM routing', async () => { const r = await getRoutes([cubao, tagaytay]); return `${r.length} route(s), ${r[0].distanceKm.toFixed(1)} km`; }],
    ['Photon search', async () => `${(await searchPlaces('SM North EDSA')).length} results`],
    ['Nominatim reverse', async () => (await reverseGeocode(cubao.lat, cubao.lng)).label],
    ['Open-Meteo weather', async () => { const w = await weatherAlong([cubao]); return `${w[0].text}, ${w[0].tempC}°C`; }],
    ['Open-Meteo elevation', async () => `${(await elevations([cubao, tagaytay])).join(' m, ')} m`],
    ['Overpass stations', async () => { const r = await stationsNear(cubao.lat, cubao.lng, 1500); return `${r.stations.length} stations within 1.5 km (${r.source})`; }],
    ['Brent crude', async () => { const b = await fetchBrent(addDays(manilaDate(), -20)); const last = b.rows.at(-1); return `${b.source}: $${last.value} on ${last.date}`; }],
    ['Frankfurter USD/PHP', async () => { const f = await fetchUsdPhp(addDays(manilaDate(), -7)); const last = f.at(-1); return `₱${last.value} on ${last.date}`; }],
    ['Gemini', async () => (geminiEnabled() ? `replied: ${(await generate({ system: 'Reply with one word.', messages: [{ role: 'user', text: 'Say OK' }] })).slice(0, 30)}` : 'skipped (no GEMINI_API_KEY)')],
  ];
  console.log(`\nChecking integrations (database: ${config.db.client})...\n`);
  let failed = 0;
  for (const [name, fn] of tests) {
    const t0 = Date.now();
    try { console.log(`  ✔ ${name.padEnd(26)} ${await fn()}  (${Date.now() - t0} ms)`); } catch (err) { failed++; console.log(`  ✘ ${name.padEnd(26)} ${err.message}`); }
  }
  console.log(failed ? `\n${failed} check(s) failed. The app still runs; affected features fall back or show an error.\n` : '\nAll integrations reachable.\n');
}

async function main() {
  await initDb();
  if (cmd === 'sync') { for (const j of ['market', 'news', 'doe_latest', 'doe_regional', 'forecast', 'stations']) console.log(j, await runJob(j)); }
  else if (cmd === 'prices') { console.log(await runJob('doe_latest')); console.log(await runJob('doe_regional')); }
  else if (cmd === 'backfill') {
    const weeks = arg === 'all' ? 'all' : Number(arg) || 52;
    console.log(`Importing ${weeks === 'all' ? 'every' : weeks} weekly DOE NCR report(s) and adjustment notices… (one at a time, be patient)`);
    console.log(await runJob('doe_backfill', { params: { weeks } }));
    console.log(await runJob('forecast'));
  }
  else if (cmd === 'check') await check();
  else if (cmd === 'admin' && arg) {
    const r = await db.run("UPDATE users SET role = 'admin' WHERE email = ?", [arg.toLowerCase()]);
    console.log(r.changes ? `${arg} is now an admin.` : `No user with email ${arg}.`);
  } else console.log('Usage: node server/cli.js sync | prices | backfill [weeks|all] | check | admin <email>');
  await closeDb();
}

main().catch((err) => { console.error(err); process.exit(1); });
