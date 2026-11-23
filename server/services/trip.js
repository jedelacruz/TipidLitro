// Trip fuel-cost model. Combines OSRM routes, Open-Meteo elevation and weather, Nominatim
// region lookup and DOE prices into liters and pesos, and explains every adjustment it makes.
// Electric vehicles use the same model in kWh with an electricity rate.
import { config } from '../config.js';
import { db } from '../db/index.js';
import { doeRegionFor, reverseGeocode } from '../integrations/geocode.js';
import { climbStats, elevations, weatherAlong } from '../integrations/openmeteo.js';
import { getRoutes } from '../integrations/osrm.js';
import { bearing, clamp, haversineKm, HttpError, isFiniteCoord, manilaParts, round, samplePolyline } from '../lib/util.js';
import { history, priceFor } from './prices.js';

// Energy per unit of "fuel" and drivetrain efficiency. Electricity is per kWh.
const ENERGY_J = { gasoline: 34.2e6, diesel: 38.6e6, electric: 3.6e6 };
const ENGINE_EFF = { gasoline: 0.24, diesel: 0.3, electric: 0.85 };
// kg CO2 per liter of fuel, or per kWh from the Philippine grid (≈0.69 t/MWh).
export const CO2_PER_UNIT = { gasoline: 2.31, diesel: 2.68, electric: 0.69 };
const TWO_WHEEL = new Set(['motorcycle', 'tricycle']);
const HAS_AC = new Set(['car', 'suv', 'mpv', 'pickup', 'van', 'truck']);
// Private vehicles covered by the MMDA Unified Vehicular Volume Reduction Program ("number coding").
const CODING_CATEGORIES = new Set(['car', 'suv', 'mpv', 'pickup', 'van']);
const CODING_DIGITS = { 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9, 0] };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const unitOf = (fuelType) => (fuelType === 'electric' ? 'kWh' : 'L');

/** Resolve the vehicle from a preset, a saved garage vehicle, or custom numbers. */
export async function resolveVehicle(v = {}, user = null) {
  if (v.userVehicleId && user) {
    const uv = await db.get('SELECT * FROM user_vehicles WHERE id = ? AND user_id = ?', [v.userVehicleId, user.id]);
    if (uv) {
      const ev = uv.fuel_type === 'electric';
      return {
        name: uv.name, category: uv.category, fuelType: uv.fuel_type, product: uv.product, massKg: uv.mass_kg || defaultMass(uv.category), engineCc: uv.engine_cc,
        kmplCity: uv.kmpl * (ev ? 1.1 : 0.88), kmplHighway: uv.kmpl * (ev ? 0.92 : 1.15), kmplStated: uv.kmpl, plateDigit: uv.plate_digit, source: 'garage',
      };
    }
  }
  if (v.presetSlug) {
    const p = await db.get('SELECT * FROM vehicle_presets WHERE slug = ?', [v.presetSlug]);
    if (p) {
      const custom = Number(v.kmpl);
      // A user-edited economy overrides the preset but keeps its city/highway spread.
      const scale = custom > 0 ? custom / ((p.kmpl_city + p.kmpl_highway) / 2) : 1;
      return {
        name: p.name, slug: p.slug, category: p.category, fuelType: p.fuel_type, product: p.product, massKg: p.mass_kg, engineCc: p.engine_cc,
        kmplCity: p.kmpl_city * scale, kmplHighway: p.kmpl_highway * scale, kmplStated: custom > 0 ? custom : (p.kmpl_city + p.kmpl_highway) / 2, source: 'preset',
      };
    }
  }
  const kmpl = Number(v.kmpl);
  const fuelType = ['diesel', 'electric'].includes(v.fuelType) ? v.fuelType : 'gasoline';
  if (!(kmpl > 0 && kmpl < 200)) throw new HttpError(400, fuelType === 'electric' ? 'Enter your EV\'s efficiency in km per kWh (for example 7).' : 'Enter your vehicle\'s fuel economy in km per liter (for example 20).');
  const category = v.category || 'car';
  const ev = fuelType === 'electric';
  return {
    name: v.name || `Custom ${category} (${kmpl} km/${unitOf(fuelType)})`, category, fuelType,
    product: ev ? 'ELECTRICITY' : fuelType === 'diesel' ? 'DIESEL' : 'RON91', massKg: Number(v.massKg) || defaultMass(category), engineCc: Number(v.engineCc) || (TWO_WHEEL.has(category) && !ev ? 125 : null),
    kmplCity: kmpl * (ev ? 1.1 : 0.88), kmplHighway: kmpl * (ev ? 0.92 : 1.15), kmplStated: kmpl, source: 'custom',
  };
}
const defaultMass = (cat) => ({ motorcycle: 180, tricycle: 420, car: 1150, suv: 1700, mpv: 1500, pickup: 2000, van: 2100, truck: 2600, jeepney: 3200 }[cat] || 1200);

/** Traffic level from departure time (Manila) when the user leaves it on "auto". */
export function autoTraffic(when, inMetro) {
  const p = manilaParts(when);
  const weekday = p.dow >= 1 && p.dow <= 5;
  const hour = p.h + p.min / 60;
  const rush = (hour >= 6.5 && hour < 10) || (hour >= 16.5 && hour < 20.5);
  if (inMetro) {
    if (weekday && rush) return 'heavy';
    if ((weekday && hour >= 10 && hour < 16.5) || (!weekday && hour >= 10 && hour < 21)) return 'moderate';
    return 'light';
  }
  return weekday && rush ? 'moderate' : 'light';
}

const TRAFFIC = {
  light: { time: 1.05, effCar: 1, effMoto: 1, effEv: 1 },
  moderate: { time: 1.3, effCar: 0.9, effMoto: 0.96, effEv: 0.97 },
  heavy: { time: 1.75, effCar: 0.78, effMoto: 0.9, effEv: 0.92 },
};
const STYLE = { eco: 1.08, normal: 1, aggressive: 0.85 };
const inNcr = (lat, lng) => lat > 14.35 && lat < 14.79 && lng > 120.9 && lng < 121.14;

/**
 * Energy for one direction of one route (liters, or kWh for EVs).
 * @returns {{liters, kmpl, baseKmpl, durationMin, drivingKm, avgSpeed, factors: Array<{key,label,factor?,liters?,detail}>}}
 */
function legFuel({ route, vehicle, opts, climb, wind, rainy, heavyRain, trafficLevel, reverse = false }) {
  const twoWheel = TWO_WHEEL.has(vehicle.category);
  const ev = vehicle.fuelType === 'electric';
  const unit = unitOf(vehicle.fuelType);
  const drivingKm = Math.max(route.distanceKm - route.ferryKm, 0);
  const freeSpeed = drivingKm / Math.max(route.durationMin / 60, 0.01);
  const urban = clamp((70 - freeSpeed) / 45, 0, 1);
  const t = TRAFFIC[trafficLevel];
  const timeMult = 1 + (t.time - 1) * (0.35 + 0.65 * urban);
  const durationMin = route.durationMin * timeMult;
  const avgSpeed = drivingKm / Math.max(durationMin / 60, 0.01);
  const cityness = clamp((60 - avgSpeed) / 40, 0, 1);
  const baseKmpl = vehicle.kmplCity * cityness + vehicle.kmplHighway * (1 - cityness);

  const factors = [];
  const add = (key, label, factor, detail) => { if (Math.abs(factor - 1) > 0.001) factors.push({ key, label, factor: round(factor, 3), detail }); };

  const eff = ev ? t.effEv : twoWheel ? t.effMoto : t.effCar;
  add('traffic', `Traffic: ${trafficLevel}`, 1 - (1 - eff) * (0.35 + 0.65 * urban), ev ? `~${Math.round(avgSpeed)} km/h average; regenerative braking recovers part of stop-and-go losses` : `Stop-and-go driving at ~${Math.round(avgSpeed)} km/h average`);

  if (rainy) add('rain', heavyRain ? 'Heavy rain' : 'Rain', heavyRain ? 0.92 : 0.96, 'Wet roads add rolling resistance and slower, uneven driving');

  if (wind) {
    const dir = reverse ? (wind.bearing + 180) % 360 : wind.bearing;
    const head = wind.speed * Math.cos(((wind.from - dir) * Math.PI) / 180);
    const sens = twoWheel ? 300 : 450;
    const f = head > 0 ? 1 - Math.min(0.07, head / sens) : 1 + Math.min(0.02, -head / (sens * 2));
    add('wind', head > 0 ? `Headwind ~${Math.round(head)} km/h` : `Tailwind ~${Math.round(-head)} km/h`, f, `Wind ${Math.round(wind.speed)} km/h from ${Math.round(wind.from)}°`);
  }

  if (HAS_AC.has(vehicle.category) && opts.ac !== false) {
    add('ac', 'Aircon on', 0.88 * cityness + 0.95 * (1 - cityness), 'Compressor load, larger at low speed');
  }

  const occupants = clamp(Number(opts.passengers) || 1, 1, 30);
  const extraKg = (occupants - 1) * 70 + clamp(Number(opts.cargoKg) || 0, 0, 5000);
  if (extraKg > 0) add('load', `Load +${Math.round(extraKg)} kg`, 1 / (1 + 0.35 * (extraKg / vehicle.massKg)), `${occupants} occupant(s)${opts.cargoKg ? ` and ${opts.cargoKg} kg cargo` : ''}`);

  const style = STYLE[opts.style] || 1;
  add('style', `Driving style: ${opts.style || 'normal'}`, style, opts.style === 'eco' ? 'Smooth throttle, early upshifts, steady speed' : 'Hard acceleration and braking');

  const kmpl = baseKmpl * factors.reduce((p, f) => p * f.factor, 1);
  let liters = drivingKm / kmpl;

  // Hills: energy to lift the loaded vehicle; part comes back downhill (much more with regen).
  const up = reverse ? climb.descentM : climb.climbM;
  const down = reverse ? climb.climbM : climb.descentM;
  const mass = vehicle.massKg + extraKg;
  const effHill = ev ? ENGINE_EFF.electric : twoWheel ? 0.2 : ENGINE_EFF[vehicle.fuelType];
  const perMeter = (mass * 9.81) / (ENERGY_J[vehicle.fuelType] * effHill);
  const climbL = up * perMeter;
  const descentL = Math.min(down * perMeter * (ev ? 0.6 : 0.35), liters * (ev ? 0.2 : 0.05));
  if (climbL > 0.005) factors.push({ key: 'climb', label: `Climbing +${up} m`, liters: round(climbL, 3), detail: `Extra ${unit} to lift the vehicle and load` });
  if (descentL > 0.005) factors.push({ key: 'descent', label: `Descending −${down} m`, liters: round(-descentL, 3), detail: ev ? 'Regenerative braking downhill' : 'Engine braking / coasting downhill' });
  liters += climbL - descentL;

  return { liters, kmpl: drivingKm / liters, baseKmpl, durationMin, drivingKm, avgSpeed, factors };
}

/** MMDA number coding check for private 4-wheelers in Metro Manila. */
function codingCheck({ vehicle, plateDigit, departAt, durationMin, touchesNcr }) {
  if (!touchesNcr || !CODING_CATEGORIES.has(vehicle.category)) return null;
  const p = manilaParts(departAt);
  const banned = CODING_DIGITS[p.dow];
  if (!banned) return null;
  const start = p.h * 60 + p.min; const end = start + durationMin;
  const windows = [[7 * 60, 10 * 60], [17 * 60, 20 * 60]];
  const overlaps = windows.some(([a, b]) => start < b && end > a);
  if (!overlaps) return null;
  const day = DAY_NAMES[p.dow];
  const digit = plateDigit === '' || plateDigit == null ? null : Number(plateDigit);
  if (digit == null || Number.isNaN(digit)) {
    return { level: 'info', text: `Number coding is in effect on Metro Manila roads during your trip (${day}: plates ending in ${banned.join(' or ')}, 7–10 AM and 5–8 PM). Add your plate's last digit under Trip options to check.` };
  }
  if (!banned.includes(digit)) return null;
  return { level: 'danger', text: `Number coding: plates ending in ${digit} cannot use Metro Manila roads on ${day} 7–10 AM and 5–8 PM, and your trip overlaps that window. Leave before 7:00 AM or between 10:00 AM and 5:00 PM. (Holidays are exempt; some LGUs have their own rules.)` };
}

/**
 * Main entry: estimate fuel (or electricity) and cost for every route alternative.
 */
export async function estimateTrip(input, user = null) {
  const points = (input.points || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), label: p.label ? String(p.label).slice(0, 160) : null }));
  if (points.length < 2 || points.length > 10) throw new HttpError(400, 'Give an origin, a destination and up to 8 stops.');
  if (!points.every((p) => isFiniteCoord(p.lat, p.lng))) throw new HttpError(400, 'Invalid coordinates.');

  const vehicle = await resolveVehicle(input.vehicle, user);
  const ev = vehicle.fuelType === 'electric';
  const unit = unitOf(vehicle.fuelType);
  const product = ev ? 'ELECTRICITY' : (input.product && input.product !== 'ELECTRICITY' ? input.product : vehicle.product);
  const opts = { ac: input.ac, passengers: input.passengers, cargoKg: input.cargoKg, style: input.style || 'normal' };
  const when = input.departAt ? new Date(input.departAt) : new Date();
  const departAt = Number.isNaN(+when) ? new Date() : when;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(input.priceWeek || '') ? input.priceWeek : null;

  const routes = await getRoutes(points, { alternatives: input.alternatives !== false });
  const origin = points[0]; const dest = points[points.length - 1];
  const mid = (() => { const g = routes[0].geometry; const m = g[Math.floor(g.length / 2)]; return { lat: m[1], lng: m[0] }; })();

  const [place, weather, elevList] = await Promise.all([
    reverseGeocode(origin.lat, origin.lng).catch(() => null),
    weatherAlong([origin, mid, dest], departAt).catch(() => null),
    Promise.all(routes.map((r) => {
      const samples = samplePolyline(r.geometry, 100);
      return elevations(samples).then((e) => ({ samples, e })).catch(() => null);
    })),
  ]);

  const region = input.region || doeRegionFor({ region: place?.region, state: place?.state, lat: origin.lat, lng: origin.lng });
  let priceInfo;
  if (Number(input.priceOverride) > 0) priceInfo = { price: Number(input.priceOverride), product, basis: ev ? 'Your electricity rate' : 'Your price', region, ageDays: 0, stale: false, custom: true };
  else if (ev) priceInfo = { price: Number(input.electricityRate) > 0 ? Number(input.electricityRate) : config.electricityRate, product, basis: Number(input.electricityRate) > 0 ? 'Your electricity rate' : 'Typical residential rate (edit in Trip options)', region, ageDays: 0, stale: false, electricity: true };
  else priceInfo = await priceFor({ region, city: place?.city, product, asOf });
  if (!priceInfo) throw new HttpError(503, asOf ? `No DOE price on file for the week of ${asOf}. Import more history in the Integration Monitor, or pick a later week.` : 'No fuel price data yet. The DOE sync may still be running — try again in a minute, or enter your own price per liter.');
  priceInfo.unit = unit;

  const touchesNcr = routes.some((r) => r.geometry.some(([lng, lat], i) => i % 10 === 0 && inNcr(lat, lng)));
  const trafficLevel = TRAFFIC[input.traffic] ? input.traffic : autoTraffic(departAt, touchesNcr);
  const rainy = weather?.some((w) => w.precipMm >= 0.5 || (w.precipProb ?? 0) >= 70) || false;
  const heavyRain = weather?.some((w) => w.precipMm >= 4) || false;
  const wind = weather ? { speed: weather[1].windKmh, from: weather[1].windDir, bearing: bearing(origin, dest) } : null;
  const roundTrip = Boolean(input.roundTrip);
  const split = clamp(Number(input.splitWays) || 1, 1, 30);
  const tripsPerWeek = clamp(Number(input.tripsPerWeek) || 0, 0, 100);
  const earnings = Number(input.earningsPerTrip) || 0;
  const twoWheel = TWO_WHEEL.has(vehicle.category);
  const motorwayBanned = twoWheel && !ev && (vehicle.engineCc || 0) < 400;
  const toll = clamp(Number(input.tollFee) || 0, 0, 20000) * (roundTrip ? 2 : 1);
  const parking = clamp(Number(input.parkingFee) || 0, 0, 20000);
  const otherCost = clamp(Number(input.otherCost) || 0, 0, 100000);
  const extrasTotal = toll + parking + otherCost;

  const results = routes.map((route, i) => {
    const el = elevList[i];
    const climb = el ? climbStats(el.e) : { climbM: 0, descentM: 0, minM: null, maxM: null };
    const out = legFuel({ route, vehicle, opts, climb, wind, rainy, heavyRain, trafficLevel });
    const back = roundTrip ? legFuel({ route, vehicle, opts, climb, wind, rainy, heavyRain, trafficLevel, reverse: true }) : null;
    const liters = out.liters + (back?.liters || 0);
    const distanceKm = route.distanceKm * (roundTrip ? 2 : 1);
    const cost = liters * priceInfo.price;
    const total = cost + extrasTotal;
    const simpleLiters = (Math.max(route.distanceKm - route.ferryKm, 0) * (roundTrip ? 2 : 1)) / vehicle.kmplStated;
    return {
      index: i,
      distanceKm: round(distanceKm, 1),
      oneWayKm: round(route.distanceKm, 1),
      durationMin: Math.round(out.durationMin + (back?.durationMin || 0)),
      oneWayMin: Math.round(out.durationMin),
      freeFlowMin: Math.round(route.durationMin * (roundTrip ? 2 : 1)),
      liters: round(liters, 2),
      cost: round(cost, 2),
      totalCost: round(total, 2),
      simple: { liters: round(simpleLiters, 2), cost: round(simpleLiters * priceInfo.price, 2) },
      costPerKm: round(cost / Math.max(distanceKm, 0.1), 2),
      perPerson: round(total / split, 2),
      co2Kg: round(liters * CO2_PER_UNIT[vehicle.fuelType], 1),
      effectiveKmpl: round(out.kmpl, 1),
      baseKmpl: round(out.baseKmpl, 1),
      avgSpeed: Math.round(out.avgSpeed),
      factors: out.factors,
      returnFactors: back?.factors || null,
      climb,
      elevationProfile: el ? el.samples.map((s, k) => [round(s.km ?? 0, 2), Math.round(el.e[k])]) : [],
      motorwayKm: round(route.motorwayKm, 1),
      tollKm: round(route.tollKm, 1),
      ferryKm: round(route.ferryKm, 1),
      roads: route.roads,
      geometry: route.geometry,
      monthly: tripsPerWeek ? round(total * tripsPerWeek * 4.33, 0) : null,
      net: earnings ? round(earnings - total, 2) : null,
      fuelShare: earnings ? round((total / earnings) * 100, 1) : null,
      motorwayIssue: motorwayBanned && route.motorwayKm > 0.5,
    };
  });

  // Tags: fastest / cheapest; recommend the cheapest route a two-wheeler may legally use.
  const fastest = results.reduce((a, b) => (b.durationMin < a.durationMin ? b : a));
  const cheapest = results.reduce((a, b) => (b.cost < a.cost ? b : a));
  const legal = results.filter((r) => !r.motorwayIssue);
  const recommended = (legal.length ? legal : results).reduce((a, b) => (b.cost < a.cost ? b : a));
  for (const r of results) {
    r.tags = [];
    if (r === recommended) r.tags.push('recommended');
    if (r === fastest) r.tags.push('fastest');
    if (r === cheapest) r.tags.push('cheapest');
  }

  // The same trip priced at every week on file: the city's own series when it has one (so "now"
  // matches the estimate above), otherwise the region-wide common price.
  let costHistory = [];
  let costHistoryBasis = null;
  if (!ev && !priceInfo.custom) {
    const histRegion = priceInfo.region || region;
    const usable = (rows) => rows.filter((r) => r.common != null);
    let rows = [];
    if (priceInfo.area && priceInfo.area !== 'ALL') {
      rows = usable(await history(histRegion, product, { area: priceInfo.area, weeks: 52 * 10 }).catch(() => []));
      costHistoryBasis = `${priceInfo.area} common price`;
    }
    if (rows.length < 8) {
      rows = usable(await history(histRegion, product, { weeks: 52 * 10 }).catch(() => []));
      costHistoryBasis = `${histRegion} common price`;
    }
    const liters = results[recommended.index].liters;
    costHistory = rows.map((r) => ({ week: r.week_start, price: r.common, cost: round(liters * r.common, 2) }));
  }

  const warnings = [];
  const coding = codingCheck({ vehicle, plateDigit: input.plateDigit ?? vehicle.plateDigit, departAt, durationMin: results[recommended.index].oneWayMin, touchesNcr });
  if (coding) warnings.push(coding);
  if (results.some((r) => r.motorwayIssue)) {
    warnings.push({ level: legal.length ? 'warn' : 'danger', text: `${legal.length ? 'Some routes use' : 'This route uses'} expressways. Motorcycles below 400cc are not allowed on NLEX, SLEX, Skyway, TPLEX, STAR, CALAX and similar tollways.${legal.length ? ' The recommended route avoids them.' : ' Plan a route via national roads (add a stop to steer it).'}` });
  }
  if (results[recommended.index].tollKm > 0.5 && !toll) warnings.push({ level: 'info', text: `Recommended route has ~${results[recommended.index].tollKm} km of toll road. Add the toll fee under Trip options to include it.` });
  if (results.some((r) => r.ferryKm > 0)) warnings.push({ level: 'info', text: 'Includes a ferry / RoRo crossing. Fares are not included and no fuel is counted for the sea leg.' });
  if (heavyRain) warnings.push({ level: 'warn', text: 'Heavy rain expected along the route. Watch for flooded roads and allow extra time.' });
  else if (rainy) warnings.push({ level: 'info', text: 'Rain is likely during your trip. Consumption estimate includes a wet-road penalty.' });
  if (priceInfo.historical) warnings.push({ level: 'info', text: `Using the DOE price from the week of ${priceInfo.weekStart} (historical), not this week's.` });
  if (priceInfo.stale) warnings.push({ level: 'warn', text: `Latest DOE price on file is ${priceInfo.ageDays} days old (week of ${priceInfo.weekStart}). Actual pump prices may differ.` });
  if (priceInfo.fallback) warnings.push({ level: 'info', text: `No ${region} price for this product on file. Using the NCR price instead.` });
  if (results[recommended.index].distanceKm > 250 && !roundTrip) warnings.push({ level: 'info', text: 'Long drive: plan a rest stop every 2 hours.' });
  if (ev && results[recommended.index].distanceKm > 250) warnings.push({ level: 'info', text: 'Long EV trip: check charging stops along the way (public chargers usually cost more per kWh than home charging).' });

  const p = manilaParts(departAt);
  return {
    generatedAt: new Date().toISOString(),
    points: points.map((pt, i) => ({ ...pt, label: pt.label || (i === 0 ? place?.label : null) })),
    vehicle: { ...vehicle, kmplCity: round(vehicle.kmplCity, 1), kmplHighway: round(vehicle.kmplHighway, 1), twoWheel, electric: ev },
    unit,
    product,
    price: priceInfo,
    region,
    roundTrip, splitWays: split, tripsPerWeek, earningsPerTrip: earnings || null,
    extras: { toll, parking, other: otherCost, total: extrasTotal },
    conditions: {
      departAt: departAt.toISOString(), departLocal: `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`,
      traffic: trafficLevel, trafficAuto: !TRAFFIC[input.traffic], rainy, heavyRain, weather, wind, inMetroManila: touchesNcr,
    },
    routes: results,
    recommendedIndex: recommended.index,
    costHistory,
    costHistoryBasis,
    warnings,
    straightLineKm: round(haversineKm(origin, dest), 1),
  };
}

/** Same route and conditions, different vehicles: a quick comparison table. */
export async function compareVehicles(trip, slugs) {
  const presets = await db.all(`SELECT * FROM vehicle_presets WHERE slug IN (${slugs.map(() => '?').join(',') || "''"})`, slugs);
  const route = trip.routes[trip.recommendedIndex];
  const out = [];
  for (const p of presets) {
    const v = { name: p.name, category: p.category, fuelType: p.fuel_type, massKg: p.mass_kg, engineCc: p.engine_cc, kmplCity: p.kmpl_city, kmplHighway: p.kmpl_highway };
    let price;
    if (p.fuel_type === 'electric') price = trip.vehicle.electric ? trip.price.price : config.electricityRate;
    else {
      const city = trip.price.area && trip.price.area !== 'ALL' ? trip.price.area : null;
      price = (await priceFor({ region: trip.region, city, product: p.product }))?.price;
    }
    if (!price) continue;
    const r = { distanceKm: route.oneWayKm, durationMin: route.freeFlowMin / (trip.roundTrip ? 2 : 1), ferryKm: route.ferryKm };
    const leg = legFuel({ route: r, vehicle: v, opts: {}, climb: route.climb, wind: null, rainy: trip.conditions.rainy, heavyRain: trip.conditions.heavyRain, trafficLevel: trip.conditions.traffic });
    const amount = leg.liters * (trip.roundTrip ? 2 : 1);
    out.push({ slug: p.slug, name: p.name, category: p.category, product: p.product, unit: unitOf(p.fuel_type), price, liters: round(amount, 2), cost: round(amount * price, 2), co2Kg: round(amount * CO2_PER_UNIT[p.fuel_type], 1) });
  }
  return out.sort((a, b) => a.cost - b.cost);
}
