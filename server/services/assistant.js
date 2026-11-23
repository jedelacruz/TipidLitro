// Chat assistant. Gemini only (1) extracts what the user wants and (2) phrases the answer.
// Every number comes from this server's own data and calculators. Without a Gemini key a
// rule-based extractor and templates (English / Taglish) give the same facts.
import { db } from '../db/index.js';
import { geminiEnabled, generate } from '../integrations/gemini.js';
import { searchPlaces } from '../integrations/geocode.js';
import { NEWS_CATEGORIES, latestNews } from '../integrations/news.js';
import { PRODUCTS, REGIONS } from '../integrations/doe.js';
import { config } from '../config.js';
import { addDays, isoDate, manilaDate, monthIndex, nowSql, round } from '../lib/util.js';
import { getForecast } from './forecast.js';
import { adjustments, latestWeek, priceFor, regionSummary } from './prices.js';
import { estimateTrip, resolveVehicle, unitOf } from './trip.js';

const INTENTS = ['trip_cost', 'budget_range', 'price_lookup', 'forecast', 'news', 'compare_vehicles', 'detour', 'fuel_log_summary', 'help', 'out_of_scope'];

/** "last month", "a year ago", "noong 2022", "March 2024" ... -> YYYY-MM-DD (or null). */
export function asOfFromText(t) {
  const today = manilaDate();
  let m;
  if (/\b(last week|nakaraang linggo|noong isang linggo)\b/.test(t)) return addDays(today, -7);
  if (/\b(last month|nakaraang buwan|noong isang buwan)\b/.test(t)) return addDays(today, -30);
  if (/\b(last year|a year ago|one year ago|nakaraang taon|noong isang taon)\b/.test(t)) return addDays(today, -365);
  if ((m = t.match(/\b(\d{1,2})\s*(weeks?|months?|years?|linggo|buwan|taon)\s*(ago|na ang nakalipas|nakaraan)/))) {
    const per = /^(w|linggo)/.test(m[2]) ? 7 : /^(m|buwan)/.test(m[2]) ? 30 : 365;
    return addDays(today, -Number(m[1]) * per);
  }
  const month = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  if ((m = t.match(new RegExp(`\\b${month}\\.?\\s+(?:(\\d{1,2}),?\\s+)?(20[12]\\d)\\b`, 'i')))) return isoDate(+m[3], monthIndex(m[1]), m[2] ? +m[2] : 15);
  if ((m = t.match(/\b(?:in|noong|nung|sa|year|taong)\s+(20[12]\d)\b/))) return `${m[1]}-07-01`;
  return null;
}

// keyword -> preset slug (order matters: specific before generic)
const VEHICLE_WORDS = [
  [/\bmodern (puj|jeep\w*)/, 'modern-jeepney'], [/\bjeep(ney)?\b|\bdyip\b/, 'jeepney-traditional'],
  [/\bclick\b/, 'honda-click-125'], [/\bbeat\b/, 'honda-beat'], [/\bmio\b/, 'yamaha-mio-125'], [/\bn-?max\b/, 'yamaha-nmax-155'],
  [/\btmx\b/, 'honda-tmx-125'], [/\b(adv|pcx)\b/, 'honda-adv-160'], [/\braider\b/, 'suzuki-raider-150'],
  [/\b(tricycle|trike|barako|traysikel)\b/, 'kawasaki-barako-175'], [/\bwigo\b/, 'toyota-wigo'], [/\bmirage\b/, 'mitsubishi-mirage-g4'],
  [/\bvios\b/, 'toyota-vios'], [/\bhonda city\b/, 'honda-city'], [/\braize\b/, 'toyota-raize'], [/\bertiga\b/, 'suzuki-ertiga'],
  [/\bcorolla cross\b|\bhybrid\b/, 'toyota-corolla-cross-hev'], [/\binnova\b/, 'toyota-innova-diesel'], [/\bxpander\b/, 'mitsubishi-xpander'],
  [/\bfortuner\b/, 'toyota-fortuner-diesel'], [/\bmontero\b/, 'mitsubishi-montero'], [/\bhilux\b/, 'toyota-hilux-diesel'], [/\branger\b/, 'ford-ranger-diesel'],
  [/\bhiace\b/, 'toyota-hiace'], [/\bl300\b/, 'mitsubishi-l300'], [/\btraviz\b|\btruck\b/, 'isuzu-traviz'],
  [/\b(motor(cycle|siklo)?|scooter|moto|single)\b/, 'honda-click-125'], [/\b(suv)\b/, 'toyota-fortuner-diesel'], [/\b(van)\b/, 'toyota-hiace'],
  [/\b(car|kotse|sedan|auto)\b/, 'toyota-vios'],
];
export const vehicleFromText = (s) => {
  const t = String(s || '').toLowerCase();
  return (VEHICLE_WORDS.find(([re]) => re.test(t)) || [null, null])[1];
};
const productFromText = (s) => {
  const t = String(s || '').toLowerCase();
  if (/diesel plus|premium diesel|turbo diesel/.test(t)) return 'DIESEL_PLUS';
  if (/diesel|krudo/.test(t)) return 'DIESEL';
  if (/ron ?(97|100)|premium plus|blaze|v-?power racing/.test(t)) return 'RON97_100';
  if (/ron ?95|premium|xcs|v-?power/.test(t)) return 'RON95';
  if (/kerosene|gaas/.test(t)) return 'KEROSENE';
  if (/ron ?91|unleaded|regular|gasolina|gasoline|\bgas\b/.test(t)) return 'RON91';
  return null;
};
const regionFromText = (s) => {
  const t = String(s || '').toLowerCase();
  if (/\b(ncr|metro manila|manila|quezon city|makati|pasig|taguig|caloocan|pasay|marikina|para[nñ]aque|muntinlupa|valenzuela|navotas|mandaluyong|san juan|las pi[nñ]as)\b/.test(t)) return 'NCR';
  if (/\b(north luzon|ilocos|baguio|pampanga|bulacan|tarlac|pangasinan|nueva ecija|cagayan|isabela|zambales|bataan|la union)\b/.test(t)) return 'North Luzon';
  if (/\b(south luzon|calabarzon|cavite|laguna|batangas|rizal|quezon province|bicol|naga|legazpi|mimaropa|palawan|mindoro)\b/.test(t)) return 'South Luzon';
  if (/\b(visayas|cebu|iloilo|bacolod|tacloban|bohol|negros|samar|leyte)\b/.test(t)) return 'Visayas';
  if (/\b(mindanao|davao|cagayan de oro|cdo|zamboanga|general santos|gensan|butuan|cotabato|iligan)\b/.test(t)) return 'Mindanao';
  return null;
};
const NCR_CITY = /\b(quezon city|makati|manila|pasig|taguig|caloocan|pasay|marikina|para[nñ]aque|muntinlupa|valenzuela|navotas)\b/i;

const TL_WORDS = /\b(magkano|ilan|papunta|papuntang|galing|mula|saan|gaano|ba|po|yung|ang|ng|aabot|kaya|presyo|ngayon|bukas|linggo|tataas|bababa|gasolina|krudo|kotse|sakay|gamit|balita|bakit|tipid|mas)\b/i;

/** Rule-based intent extraction (no AI): handles common English and Taglish phrasing. */
export function ruleExtract(message) {
  const m = message.trim(); const t = m.toLowerCase();
  const out = { intent: 'help', language: TL_WORDS.test(t) ? 'tl' : 'en', stops: [] };
  const kmpl = t.match(/(\d+(?:\.\d+)?)\s*(?:km\s*\/\s*l(?:iter)?|kmpl|km per l(?:iter)?|kilometers? per liter|km\/litro)/);
  if (kmpl) out.km_per_liter = +kmpl[1];
  const dist = t.replace(kmpl?.[0] || '\u0000', ' ').match(/(\d+(?:\.\d+)?)\s*(?:km|kilometers?|kilometro)\b/);
  if (dist) out.distance_km = +dist[1];
  const budget = t.match(/(?:₱|php|\bp)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:pesos?|php|piso)\b/);
  if (budget) out.budget_php = +(budget[1] || budget[2]).replace(/,/g, '');
  out.vehicle = vehicleFromText(t);
  out.vehicles = VEHICLE_WORDS.filter(([re]) => re.test(t)).map(([, s]) => s).filter((v, i, a) => a.indexOf(v) === i);
  out.product = productFromText(t);
  out.region = regionFromText(t);
  out.city = (t.match(NCR_CITY) || [])[1] || null;
  out.round_trip = /\b(round ?trip|balikan|back and forth|pabalik|vice versa)\b/.test(t);
  const pax = t.match(/(\d+)\s*(?:people|persons|pax|passengers|kami|tao)/);
  if (pax) out.passengers = +pax[1];

  out.as_of_date = asOfFromText(t);
  const stopWords = '(?:\\s+(?:using|with|by|on|in|via|sakay|gamit|tapos|round|balikan|for|ng|na)\\b|[?.!,]|$)';
  const tripEn = m.match(new RegExp(`\\bfrom\\s+(.+?)\\s+to\\s+(.+?)${stopWords}`, 'i'));
  // "pa" alone is a common particle ("magkano pa"), so only "papunta"/"hanggang" count as "to".
  const tripTl = m.match(new RegExp(`\\b(?:mula|galing)(?:\\s+sa)?\\s+(.+?)\\s+(?:papunta(?:ng)?|hanggang|to)(?:\\s+sa)?\\s+(.+?)${stopWords}`, 'i'));
  const toOnly = m.match(new RegExp(`\\b(?:to|papunta(?:ng)?(?:\\s+sa)?|going to)\\s+(.+?)${stopWords}`, 'i'));
  const trip = tripEn || tripTl;

  if (out.as_of_date && !trip && (out.product || /\b(price|prices|presyo|how much|magkano|gas|gasolina|diesel|krudo)\b/.test(t))) out.intent = 'price_lookup';
  else if (/\b(forecast|next week|susunod na linggo|predict|hula|tataas ba|bababa ba|will (gas|diesel|prices?|fuel)|rollback ba|oil price hike)\b/.test(t) && !trip) out.intent = 'forecast';
  else if (trip) { out.intent = 'trip_cost'; out.origin = trip[1].trim(); out.destination = trip[2].trim(); }
  else if (out.budget_php && /\b(budget|aabot|how far|gaano kalayo|kaya|reach|makakarating|range|layo)\b/.test(t)) out.intent = 'budget_range';
  else if (/\b(news|balita|headlines?|bakit|why)\b/.test(t)) out.intent = 'news';
  else if (/\b(compare|vs\.?|versus|mas tipid|which is cheaper|alin ang)\b/.test(t) && out.vehicles.length >= 2) out.intent = 'compare_vehicles';
  else if (toOnly && /\b(magkano|how much|cost|gastos|gagastusin|liters?|litro)\b/.test(t)) { out.intent = 'trip_cost'; out.destination = toOnly[1].trim(); out.use_current_location_as_origin = true; }
  else if (out.distance_km && (out.km_per_liter || out.vehicle) && /\b(magkano|how much|cost|gastos|liters?|litro|fuel)\b/.test(t)) out.intent = 'trip_cost';
  else if (/\b(price|prices|presyo|per liter|kada litro|how much is|magkano (ang|na ang|ba ang)|pump)\b/.test(t) || (out.product && /\b(magkano|how much)\b/.test(t))) out.intent = 'price_lookup';
  else if (/\b(fuel log|my spending|gastos ko|my consumption)\b/.test(t)) out.intent = 'fuel_log_summary';
  else if (/\b(hi|hello|help|tulong|kumusta|what can you do|ano kaya mo)\b/.test(t)) out.intent = 'help';
  else out.intent = /\b(fuel|gas|diesel|oil|gasolina|litro|liter|trip|biyahe)\b/.test(t) ? 'help' : 'out_of_scope';
  return out;
}

const EXTRACT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: INTENTS },
    language: { type: 'STRING', enum: ['en', 'tl', 'taglish'] },
    origin: { type: 'STRING', nullable: true },
    destination: { type: 'STRING', nullable: true },
    stops: { type: 'ARRAY', items: { type: 'STRING' } },
    use_current_location_as_origin: { type: 'BOOLEAN', nullable: true },
    distance_km: { type: 'NUMBER', nullable: true },
    vehicle: { type: 'STRING', nullable: true, description: 'Vehicle make/model or type as the user said it' },
    vehicles: { type: 'ARRAY', items: { type: 'STRING' } },
    km_per_liter: { type: 'NUMBER', nullable: true },
    product: { type: 'STRING', nullable: true, enum: ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS', 'KEROSENE'] },
    region: { type: 'STRING', nullable: true, enum: REGIONS },
    city: { type: 'STRING', nullable: true },
    budget_php: { type: 'NUMBER', nullable: true },
    round_trip: { type: 'BOOLEAN', nullable: true },
    passengers: { type: 'INTEGER', nullable: true },
    liters_to_buy: { type: 'NUMBER', nullable: true },
    price_difference: { type: 'NUMBER', nullable: true, description: 'Peso per liter cheaper at the farther station' },
    detour_km: { type: 'NUMBER', nullable: true, description: 'Extra one-way kilometers to reach the cheaper station' },
    news_topic: { type: 'STRING', nullable: true, enum: Object.keys(NEWS_CATEGORIES) },
    as_of_date: { type: 'STRING', nullable: true, description: 'For questions about past prices: the date asked about, YYYY-MM-DD' },
  },
  required: ['intent', 'language'],
};

const extractPrompt = () => `You convert a Filipino commuter's message (English, Filipino or Taglish) into a structured request for TipidLitro, a fuel cost planner for the Philippines.
Intents: trip_cost (fuel cost of a trip: needs origin+destination OR distance_km), budget_range (how far a peso budget goes), price_lookup (current pump prices),
forecast (next week's price adjustment / rollback / hike), news (why prices move, headlines), compare_vehicles (two or more vehicles), detour (is a cheaper but farther station worth it),
fuel_log_summary (the user's own fill-up records), help (greetings / what can you do), out_of_scope (anything not about fuel, driving costs or oil prices).
For past prices ("last year", "noong 2022", "March 2024") use price_lookup with as_of_date (today is ${manilaDate()}).
Rules: copy place names as the user wrote them (add ", Philippines" never). If the user says "from here", "dito", "my location" or gives only a destination, set use_current_location_as_origin=true.
"gas"/"gasolina" means gasoline (RON91 unless they say premium/95). "krudo" means DIESEL. Use earlier turns for missing details (e.g. "how about by motorcycle?").`;

const PHRASE_PROMPT = `You are TipidLitro's assistant for Filipino commuters, riders, drivers and delivery workers.
Write the reply using ONLY the FACTS JSON. Never invent or adjust prices, distances, dates, percentages or news. If FACTS has "error" or lacks something, say what is missing and suggest the Trip Planner or what detail to add.
Always say which DOE price week a price comes from (e.g. "DOE NCR prices, week of Oct 13"). Money as ₱ with 2 decimals. Liters with 1-2 decimals.
Reply in the user's language (English, Filipino or Taglish; match their message). Under 120 words. Friendly and practical; short bullets for several numbers. One tipid (money-saving) tip at most, only if relevant. Never mention JSON or "facts".`;

const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const weekLabel = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'unknown');

async function geocodeOne(q, near) {
  const res = await searchPlaces(q, near ? { lat: near.lat, lng: near.lng, limit: 1 } : { limit: 1 });
  return res[0] || null;
}

/** Vehicle from the message, else the planner's current vehicle, else an assumed sedan. Returns the resolved vehicle plus the input that produced it. */
async function vehicleFor(req, ctx, user) {
  const slug = vehicleFromText(req.vehicle || '') || (req.vehicle ? null : ctx.vehicle?.presetSlug) || null;
  const kmpl = req.km_per_liter || undefined;
  let input;
  if (slug) input = { presetSlug: slug, kmpl };
  else if (kmpl) input = { kmpl, category: ctx.vehicle?.category || 'car', fuelType: req.product === 'DIESEL' ? 'diesel' : 'gasoline' };
  else if (ctx.vehicle) input = ctx.vehicle;
  if (input) { try { return { ...(await resolveVehicle(input, user)), input }; } catch { /* fall through */ } }
  input = { presetSlug: 'toyota-vios' };
  return { ...(await resolveVehicle(input, user)), input, assumed: true };
}

/** Price per unit for a vehicle: DOE price per liter, or the electricity rate per kWh for EVs. */
async function energyPrice(vehicle, product, region) {
  if (vehicle.fuelType === 'electric') return { price: config.electricityRate, label: 'Electricity', basis: 'typical residential rate', weekStart: null };
  const p = await priceFor({ region, product: product === 'ELECTRICITY' ? vehicle.product : product });
  return p ? { ...p, label: PRODUCTS[p.product] || p.product } : null;
}

/** Compute the facts for an extracted request. */
async function computeFacts(req, ctx, user) {
  switch (req.intent) {
    case 'trip_cost': {
      const vehicle = await vehicleFor(req, ctx, user);
      const unit = unitOf(vehicle.fuelType);
      if (!req.destination && req.distance_km) {
        const region = req.region || ctx.region || 'NCR';
        const product = req.product || vehicle.product;
        const price = await energyPrice(vehicle, product, region);
        if (!price) return { error: 'No DOE price data on file yet.' };
        const km = req.distance_km * (req.round_trip ? 2 : 1);
        const kmpl = vehicle.kmplStated;
        const liters = km / kmpl;
        return { type: 'distance_estimate', unit, distanceKm: km, vehicle: vehicle.name, vehicleAssumed: Boolean(vehicle.assumed), kmpl: round(kmpl, 1), liters: round(liters, 2), cost: round(liters * price.price, 2), pricePerLiter: price.price, product: price.label, priceBasis: price.basis, priceWeek: price.weekStart, roundTrip: Boolean(req.round_trip) };
      }
      let origin = null;
      if (req.origin && !req.use_current_location_as_origin) origin = await geocodeOne(req.origin, ctx.location);
      else if (ctx.location) origin = { ...ctx.location, label: 'your location' };
      if (!origin) return { error: req.origin ? `I couldn't find "${req.origin}" on the map.` : 'I need a starting point. Tell me where you are leaving from, or allow location access.' };
      const dest = req.destination ? await geocodeOne(req.destination, origin) : null;
      if (!dest) return { error: req.destination ? `I couldn't find "${req.destination}" on the map.` : 'Where are you going?' };
      const trip = await estimateTrip({
        points: [{ lat: origin.lat, lng: origin.lng, label: origin.label }, { lat: dest.lat, lng: dest.lng, label: dest.label }],
        vehicle: vehicle.input,
        product: req.product || undefined, roundTrip: Boolean(req.round_trip), passengers: req.passengers || 1, alternatives: true,
      }, user);
      const r = trip.routes[trip.recommendedIndex];
      return {
        type: 'trip', unit: trip.unit, origin: origin.label, destination: dest.label, vehicle: trip.vehicle.name, vehicleAssumed: Boolean(vehicle.assumed),
        distanceKm: r.distanceKm, durationMin: r.durationMin, traffic: trip.conditions.traffic, liters: r.liters, cost: r.cost, effectiveKmpl: r.effectiveKmpl,
        pricePerLiter: trip.price.price, product: PRODUCTS[trip.product] || 'Electricity', priceBasis: trip.price.basis, priceWeek: trip.price.weekStart || null,
        roundTrip: trip.roundTrip, co2Kg: r.co2Kg, climbM: r.climb.climbM, alternatives: trip.routes.length,
        cheapestAltCost: Math.min(...trip.routes.map((x) => x.cost)), warnings: trip.warnings.map((w) => w.text),
        _action: { type: 'open_trip', params: { o: [origin.lat, origin.lng, origin.label], d: [dest.lat, dest.lng, dest.label], v: vehicle.slug || null, k: vehicle.input.kmpl || null, rt: trip.roundTrip ? 1 : 0 } },
      };
    }
    case 'budget_range': {
      const vehicle = await vehicleFor(req, ctx, user);
      const region = req.region || ctx.region || 'NCR';
      const price = await energyPrice(vehicle, req.product || vehicle.product, region);
      if (!price) return { error: 'No DOE price data on file yet.' };
      if (!req.budget_php) return { error: 'How much is your fuel budget in pesos?' };
      const liters = req.budget_php / price.price;
      const km = liters * vehicle.kmplStated;
      return { type: 'budget', unit: unitOf(vehicle.fuelType), budget: req.budget_php, vehicle: vehicle.name, vehicleAssumed: Boolean(vehicle.assumed), kmpl: round(vehicle.kmplStated, 1), liters: round(liters, 2), oneWayKm: round(km, 1), roundTripRadiusKm: round(km / 2, 1), pricePerLiter: price.price, product: price.label, priceBasis: price.basis, priceWeek: price.weekStart };
    }
    case 'price_lookup': {
      const region = req.region || regionFromText(req.city || '') || ctx.region || 'NCR';
      const asOf = /^\d{4}-\d{2}-\d{2}$/.test(req.as_of_date || '') && req.as_of_date < manilaDate() ? req.as_of_date : null;
      const summary = await regionSummary(region, { week: asOf });
      if (!summary.weekStart) {
        const first = await db.get("SELECT MIN(week_start) AS w FROM fuel_prices WHERE region = ? AND area = 'ALL'", [region]);
        return { error: asOf ? `I don't have DOE ${region} prices that far back (asked: ${asOf}). Stored history starts ${first?.w || 'later'}; an admin can import more years in the Integration Monitor.` : `No DOE price data for ${region} yet.` };
      }
      const prods = summary.products.filter((p) => !req.product || p.product === req.product);
      if (asOf) {
        const now = await regionSummary(region);
        const nowBy = new Map(now.products.map((p) => [p.product, p.common]));
        return {
          type: 'prices_past', region, asked: asOf, week: `${summary.weekStart} to ${summary.weekEnd}`, latestWeek: now.weekStart,
          prices: prods.map((p) => ({ product: p.label, then: p.common, now: nowBy.get(p.product) ?? null, change: nowBy.get(p.product) != null && p.common != null ? round(nowBy.get(p.product) - p.common) : null })),
        };
      }
      let city = null;
      if (req.city) { const p = await priceFor({ region, city: req.city, product: req.product || 'RON91' }); if (p && p.area !== 'ALL') city = { area: p.area, product: p.productLabel, common: p.price, min: p.min, max: p.max }; }
      const adj = (await adjustments(1))[0] || null;
      return {
        type: 'prices', region, week: `${summary.weekStart} to ${summary.weekEnd}`, estimatedRegional: summary.estimated,
        prices: prods.map((p) => ({ product: p.label, common: p.common, min: p.min, max: p.max, changeVsLastWeek: p.change })),
        city, latestAdjustment: adj ? { effective: adj.weekStart, gasoline: adj.GASOLINE, diesel: adj.DIESEL, kerosene: adj.KEROSENE } : null,
      };
    }
    case 'forecast': {
      const f = await getForecast();
      return {
        type: 'forecast', nextAdjustment: f.targetWeekStart, dataNote: f.basis.lagged ? `Brent data only up to ${f.basis.latestBrentDate}` : null,
        brentAvg: f.basis.brentAvg, brentPrevAvg: f.basis.brentPrevAvg, usdPhp: f.basis.fxAvg,
        products: f.products.map((p) => ({ product: p.product, estimatePerLiter: p.estimate, range: [p.low, p.high], confidence: p.confidence, announced: p.announced, advice: p.advice.text })),
        newsPressure: f.pressure ? { upHeadlines: f.pressure.up, downHeadlines: f.pressure.down } : null,
        disclaimer: 'Indicative estimate from Brent and USD/PHP; oil companies announce the official adjustment on Monday.',
      };
    }
    case 'news': {
      const items = await latestNews({ category: req.news_topic || undefined, limit: 6, days: 7 });
      return { type: 'news', topic: req.news_topic ? NEWS_CATEGORIES[req.news_topic].label : 'fuel and oil', headlines: items.map((n) => ({ title: n.title, source: n.source, published: n.published_at, pressure: n.direction })) };
    }
    case 'compare_vehicles': {
      const slugs = (req.vehicles || []).map((v) => vehicleFromText(v) || v).filter(Boolean).slice(0, 5);
      const km = req.distance_km || 100;
      const region = req.region || ctx.region || 'NCR';
      const rows = [];
      for (const slug of [...new Set(slugs)]) {
        let v; try { v = await resolveVehicle({ presetSlug: slug }, user); } catch { continue; }
        if (!v.slug) continue;
        const price = await priceFor({ region, product: v.product });
        if (!price) continue;
        const liters = km / v.kmplStated;
        rows.push({ vehicle: v.name, kmpl: round(v.kmplStated, 1), product: PRODUCTS[v.product], pricePerLiter: price.price, liters: round(liters, 2), cost: round(liters * price.price, 2) });
      }
      if (rows.length < 2) return { error: 'Name at least two vehicles to compare, e.g. "Vios vs Click for 50 km".' };
      return { type: 'compare', distanceKm: km, distanceAssumed: !req.distance_km, region, rows: rows.sort((a, b) => a.cost - b.cost) };
    }
    case 'detour': {
      const vehicle = await vehicleFor(req, ctx, user);
      const liters = req.liters_to_buy || (vehicle.category === 'motorcycle' ? 4 : 30);
      const diff = req.price_difference;
      const detour = req.detour_km;
      if (!diff || !detour) return { error: 'Tell me how much cheaper per liter the other station is and how many extra km it is.' };
      const price = await priceFor({ region: req.region || ctx.region || 'NCR', product: req.product || vehicle.product });
      const extraL = (detour * 2) / vehicle.kmplStated;
      const extraCost = extraL * (price?.price || 90);
      const savings = liters * diff;
      return { type: 'detour', litersToBuy: liters, priceDifference: diff, detourKmEachWay: detour, vehicle: vehicle.name, extraFuelLiters: round(extraL, 2), extraFuelCost: round(extraCost, 2), grossSavings: round(savings, 2), netSavings: round(savings - extraCost, 2), worthIt: savings - extraCost > 5, breakEvenLiters: round(extraCost / diff, 1) };
    }
    case 'fuel_log_summary': {
      if (!user) return { error: 'Sign in and add fill-ups in My Garage to get a summary of your own fuel spending.' };
      const since = new Date(); since.setUTCDate(1);
      const rows = await db.all('SELECT liters, total_cost FROM fuel_logs WHERE user_id = ? AND filled_on >= ?', [user.id, since.toISOString().slice(0, 10)]);
      return { type: 'fuel_log', monthFillUps: rows.length, monthLiters: round(rows.reduce((s, r) => s + r.liters, 0), 2), monthSpend: round(rows.reduce((s, r) => s + r.total_cost, 0), 2), monthlyBudget: user.monthly_budget || null };
    }
    case 'out_of_scope':
      return { type: 'out_of_scope', note: 'I only help with fuel costs, pump prices, price forecasts, fuel news and trip planning in the Philippines.' };
    default:
      return { type: 'help', canDo: ['Trip fuel cost (e.g. "Magkano from Cubao to Tagaytay by Vios?")', 'How far a budget goes ("₱300 budget, Click 125, gaano kalayo?")', 'Current DOE pump prices by region or NCR city', 'Next Tuesday rollback/hike estimate', 'Why prices are moving (news)', 'Compare vehicles', 'Is a cheaper but farther station worth it?'] };
  }
}

/** Template replies for when Gemini is not configured or fails. */
function templateReply(f, lang) {
  const tl = lang !== 'en';
  if (f.error) return f.error;
  switch (f.type) {
    case 'trip': {
      const u = f.unit || 'L';
      const src = f.priceWeek ? `${f.priceBasis}, week of ${weekLabel(f.priceWeek)}` : f.priceBasis;
      const lines = [
        `${tl ? 'Biyahe' : 'Trip'}: ${f.origin} → ${f.destination}${f.roundTrip ? (tl ? ' (balikan)' : ' (round trip)') : ''}`,
        `• ${f.distanceKm} km, ~${Math.round(f.durationMin)} min (${f.traffic} traffic)`,
        `• ${f.vehicle}${f.vehicleAssumed ? (tl ? ' (assumed — sabihin kung ano ang sasakyan mo)' : ' (assumed — tell me your vehicle)') : ''}: ~${f.liters} ${u} at ${f.effectiveKmpl} km/${u}`,
        `• ${tl ? 'Tantyang gastos' : u === 'kWh' ? 'Estimated charging cost' : 'Estimated fuel cost'}: **${peso(f.cost)}** (${f.product} @ ${peso(f.pricePerLiter)}/${u}, ${src})`,
      ];
      if (f.warnings?.length) lines.push(`⚠️ ${f.warnings[0]}`);
      return lines.join('\n');
    }
    case 'distance_estimate': {
      const u = f.unit || 'L';
      const src = f.priceWeek ? `${f.priceBasis}, week of ${weekLabel(f.priceWeek)}` : f.priceBasis;
      return `${f.distanceKm} km ÷ ${f.kmpl} km/${u} = ${f.liters} ${u} → **${peso(f.cost)}** (${f.product} @ ${peso(f.pricePerLiter)}/${u}, ${src}).${f.vehicleAssumed ? ' Vehicle assumed: tell me your km/L for a better estimate.' : ''}`;
    }
    case 'budget': {
      const u = f.unit || 'L';
      return `${tl ? 'Sa' : 'With'} ${peso(f.budget)}: ~${f.liters} ${u} of ${f.product} (${peso(f.pricePerLiter)}/${u}${f.priceWeek ? `, week of ${weekLabel(f.priceWeek)}` : ''}).\n• ${f.vehicle} @ ${f.kmpl} km/${u} → **~${f.oneWayKm} km** ${tl ? 'na biyahe' : 'of driving'}\n• ${tl ? 'Balikan: hanggang' : 'Round trip: up to'} ~${f.roundTripRadiusKm} km ${tl ? 'ang layo' : 'away'}`;
    }
    case 'prices_past': {
      const lines = [`DOE ${f.region} prices, week of ${weekLabel(f.week.slice(0, 10))} (${tl ? 'ngayon' : 'now'}: week of ${weekLabel(f.latestWeek)}):`];
      for (const p of f.prices) lines.push(`• ${p.product}: ${peso(p.then)}${p.now != null ? ` → now ${peso(p.now)} (${fmtAdj(p.change)})` : ''}`);
      return lines.join('\n');
    }
    case 'prices': {
      const lines = [`DOE ${f.region} pump prices (${f.week})${f.estimatedRegional ? ' — computed from the field office report' : ''}:`];
      for (const p of f.prices) lines.push(`• ${p.product}: ${peso(p.common)} (range ${peso(p.min)}–${peso(p.max)})${p.changeVsLastWeek ? ` ${p.changeVsLastWeek > 0 ? '▲' : '▼'}${Math.abs(p.changeVsLastWeek).toFixed(2)}` : ''}`);
      if (f.city) lines.push(`• ${f.city.area} ${f.city.product}: ${peso(f.city.common)}`);
      if (f.latestAdjustment) lines.push(`Latest adjustment (${weekLabel(f.latestAdjustment.effective)}): gasoline ${fmtAdj(f.latestAdjustment.gasoline)}, diesel ${fmtAdj(f.latestAdjustment.diesel)}`);
      return lines.join('\n');
    }
    case 'forecast': {
      const lines = [`${tl ? 'Tantya para sa' : 'Estimate for'} ${weekLabel(f.nextAdjustment)}:`];
      for (const p of f.products) lines.push(`• ${p.product}: ${p.announced != null ? `announced ${fmtAdj(p.announced)}` : `${fmtAdj(p.estimatePerLiter)}/L (range ${fmtAdj(p.range[0])} to ${fmtAdj(p.range[1])}, ${p.confidence} confidence)`}`);
      const g = f.products.find((p) => p.product === 'GASOLINE');
      if (g) lines.push(`💡 ${g.advice}`);
      lines.push(`_${f.disclaimer}${f.dataNote ? ` ${f.dataNote}.` : ''}_`);
      return lines.join('\n');
    }
    case 'news':
      return f.headlines.length ? [`${tl ? 'Mga balita tungkol sa' : 'Latest on'} ${f.topic}:`, ...f.headlines.map((h) => `• ${h.title}${h.source ? ` — ${h.source}` : ''}`)].join('\n') : 'No recent headlines stored yet.';
    case 'compare':
      return [`${f.distanceKm} km${f.distanceAssumed ? ' (example distance)' : ''} in ${f.region}:`, ...f.rows.map((r, i) => `${i === 0 ? '🏆' : '•'} ${r.vehicle}: ${r.liters} L → ${peso(r.cost)}`)].join('\n');
    case 'detour':
      return `${f.worthIt ? '✅ Worth it' : '❌ Not worth it'}: saving ${peso(f.grossSavings)} on ${f.litersToBuy} L, but the ${f.detourKmEachWay} km detour (each way) burns ~${f.extraFuelLiters} L (${peso(f.extraFuelCost)}). Net: **${peso(f.netSavings)}**. Break-even at ${f.breakEvenLiters} L.`;
    case 'fuel_log':
      return `This month: ${f.monthFillUps} fill-ups, ${f.monthLiters} L, ${peso(f.monthSpend)}${f.monthlyBudget ? ` of your ${peso(f.monthlyBudget)} budget` : ''}.`;
    case 'out_of_scope':
      return tl ? 'Pasensya na, fuel costs, presyo ng gasolina, forecast at trip planning lang ang kaya kong sagutin. 🙂' : f.note;
    default:
      return `${tl ? 'Kaya kong tumulong sa:' : 'I can help with:'}\n${f.canDo.map((c) => `• ${c}`).join('\n')}`;
  }
}
const fmtAdj = (v) => (v == null ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}₱${Math.abs(v).toFixed(2)}`);

export async function chat({ message, history = [], context = {} }, user = null) {
  const text = String(message || '').trim().slice(0, 800);
  if (!text) return { reply: 'Ask me about a trip, a budget, or fuel prices.', intent: 'help', provider: 'rules' };
  const hist = (Array.isArray(history) ? history : []).slice(-6).map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', text: String(h.text || '').slice(0, 800) })).filter((h) => h.text);

  let req; let provider = 'rules';
  if (geminiEnabled()) {
    try {
      req = await generate({ system: extractPrompt(), messages: [...hist, { role: 'user', text }], schema: EXTRACT_SCHEMA, temperature: 0 });
      provider = 'gemini';
    } catch (err) {
      console.warn('[assistant] Gemini extraction failed, using rules:', err.message);
    }
  }
  if (!req || !INTENTS.includes(req.intent)) req = ruleExtract(text);

  let facts;
  try { facts = await computeFacts(req, context || {}, user); } catch (err) { facts = { error: err.message }; }
  const action = facts._action || null;
  delete facts._action;

  let reply = null;
  if (provider === 'gemini') {
    try {
      reply = await generate({ system: PHRASE_PROMPT, messages: [{ role: 'user', text: `User message: ${text}\nUser language: ${req.language}\nFACTS: ${JSON.stringify(facts)}` }], temperature: 0.4 });
    } catch (err) { console.warn('[assistant] Gemini phrasing failed, using template:', err.message); provider = 'gemini+template'; }
  }
  if (!reply) reply = templateReply(facts, req.language);

  db.insert('chat_logs', { user_id: user?.id || null, message: text.slice(0, 990), intent: req.intent, provider, created_at: nowSql() }).catch(() => {});
  return { reply, intent: req.intent, facts, action, provider };
}
