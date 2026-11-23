# TipidLitro — An Integrated Fuel Cost Planning System for the Philippines

**INTE 301 · Smart Cities and Sustainable Transportation · SDG 11**

TipidLitro integrates official DOE pump prices (every week back to 2017), routing, geocoding, weather, elevation, fuel stations, oil-market data, fuel news and an AI assistant into one web system. Enter where you're going and what you drive. You get distance, travel time, liters (or kWh), and peso cost from the latest DOE price for **your city**, with every assumption shown.

---

## 1. Quick start (5 minutes, no database install)

**Requirements:** [Node.js](https://nodejs.org) **22.13 or newer** (this was built and tested on Node 25). Nothing else: the default database is SQLite, built into Node.

```bash
npm install
```

```bash
npm start
```

Open **http://localhost:3000**.

On first start the server syncs data in the background. The latest ~26 weeks of DOE prices usually land within a minute or two, followed by Brent, USD/PHP, news and about 2,100 fuel stations.

Then **create an account** (top-right *Sign in → Create an account*). **The first account becomes the admin** and unlocks the **Integration Monitor** (`#/admin`).

### Load the full price history (recommended, about 3–4 minutes)
DOE's archive goes back to **January 2017** (450+ weekly reports). Import it once, either from **Integration Monitor → Price history → Everything since 2017** or with:

```bash
npm run backfill -- all
```

Use `npm run backfill -- 52` for just the last year. To check that every external API is reachable from your network:

```bash
npm run check
```

### Mobile app (Android and iOS)
The `mobile/` folder has a **React Native + Expo** app with the same features and design as the website. It uses the same server and accounts. With the server running (`npm start`), open a second terminal:

```bash
cd mobile
```

```bash
npm install
```

```bash
npx expo start
```

Install **Expo Go** on your phone, sign in to a free Expo account in Expo Go and with `npx expo login`, then scan the QR code. The phone and computer must be on the same Wi-Fi, and Windows Firewall must allow Node.js on private networks. Full guide and troubleshooting: **[mobile/README.md](mobile/README.md)**.

---

## 2. Does TipidLitro pick up new DOE data automatically?

**Yes.** Nobody has to do anything:

| What | How often | Notes |
|---|---|---|
| NCR prices + weekly adjustment notices | **every hour** | Already-imported reports are skipped, so each check is cheap. A new PDF on doe.gov.ph is usually in the database within about 1–2 hours of DOE posting it. |
| Regional reports (North/South Luzon, Visayas, Mindanao) | every 12 hours | |
| **Check DOE now** button (Fuel Prices page) | on demand | Anyone can trigger an immediate check (at most once per 10 minutes). |

When new data arrives:
- the ticker updates and returning visitors see a **"New from DOE"** banner
- the price forecast recalibrates
- **price alerts** fire into each user's notifications (bell icon)

If a download fails because of a network problem, the report is retried on the next run. If DOE changes its PDF layout and a report can't be read, it shows as *unreadable* in the Integration Monitor (with *Re-import*), and an admin can type that week's prices in by hand.

---

## 3. Using MySQL / MariaDB (XAMPP) instead of SQLite

The proposal specifies MySQL. TipidLitro supports both engines through one adapter. Switch with a single setting:

1. Open the **XAMPP Control Panel** and click **Start** next to **MySQL**.
2. Copy `.env.example` to `.env` and set:
   ```ini
   DB_CLIENT=mysql
   MYSQL_HOST=127.0.0.1
   MYSQL_PORT=3306
   MYSQL_USER=root
   MYSQL_PASSWORD=
   MYSQL_DATABASE=tipidlitro
   ```
3. Run `npm start`. The `tipidlitro` database and all tables are **created automatically** (and upgraded automatically when new columns are added). Browse them in phpMyAdmin at http://localhost/phpmyadmin.

---

## 4. API keys and settings (all optional)

Copy `.env.example` to `.env`. Everything works without keys.

| Setting | What it adds | Get one (free) |
|---|---|---|
| `GEMINI_API_KEY` | Natural-language assistant (free-form English/Filipino/Taglish). Without it, a rule-based parser answers the same question types. | https://aistudio.google.com/apikey |
| `EIA_API_KEY` or `FRED_API_KEY` | Official API access for Brent crude (otherwise FRED's public CSV) | https://www.eia.gov/opendata/register.php · https://fred.stlouisfed.org/docs/api/api_key.html |
| `GNEWS_API_KEY`, `NEWSDATA_API_KEY` | Extra news sources | https://gnews.io · https://newsdata.io |
| `CONTACT_EMAIL` | Identifies the app to Nominatim/OSM (their usage policy asks for this) | — |
| `ELECTRICITY_RATE` | Default ₱/kWh for electric vehicles (default 12.50) | — |
| `DOE_BACKFILL_WEEKS` | Recent weeks the hourly check covers (default 26) | — |

Restart the server after editing `.env`.

---

## 5. Features

### Made for first-time users
- **Welcome card and a 1-minute guided tour** on the first visit. Restart it any time from **Help → Take the tour**.
- **A "?" button on every page** explains what the page is for, how to use it, and the words it uses.
- **Tap-to-explain tips (ⓘ)** next to jargon such as *common price*, *RON 91*, *km/L*, *rollback* and *number coding*.
- **Only the essentials first.** The planner asks just *Where?* and *Vehicle*; everything else sits under **More options**, with a badge showing how many you've set. Results open with one plain sentence, and the details are in tabs.
- **Help page** (`#/about`): FAQ, full glossary, and how the system works.
- **The same building blocks on every page:** header, help button, tabs, sections and tiles.

### Trip Planner (`#/plan`)
- **Place search** with autocomplete, **My location**, or **click the map**. Drag the A/B pins to adjust.
  - **Saved places** (★ Home, Work…) and **Recent trips** are one tap away.
- **Multi-stop routes** (up to 8 stops) and **up to 3 alternatives**, tagged recommended / fastest / cheapest.
- **Vehicles:**
  - **32 PH vehicle presets**, including **electric**: e-scooter, e-trike, BYD Dolphin, Nissan Leaf, BYD Atto 3, e-jeepney
  - your **garage vehicles**
  - or any custom km/L or km/kWh
- **Price from your city.** The origin is reverse-geocoded to pick that NCR city's DOE common price (else the region's). You can also choose:
  - **any past DOE week** ("what would this trip have cost in June 2022?")
  - your own ₱/L
- **"This trip over the years"** chart: the same trip priced at every DOE week on file (1Y / 3Y / All), with the cost a year ago and the cheapest and priciest weeks.
- **A transparent fuel model** ("Why this estimate"):
  - city/highway blend
  - traffic (auto from Manila rush hours, or manual)
  - climb and descent (elevation)
  - rain and head/tailwind (weather)
  - aircon, load, driving style
  - EV regenerative braking
- **Total trip cost:** fuel or electricity, plus **toll**, **parking**, and other costs.
- **PH-specific warnings:**
  - **MMDA number coding** (enter your plate's last digit)
  - motorcycles under 400cc on expressways
  - toll roads, ferry legs, rain, stale prices
- **Extras:**
  - round trip
  - split cost per person
  - monthly commute cost
  - rider/driver mode (earnings vs costs)
  - CO₂
  - elevation chart and weather
- **Compare vehicles** on the same route, gas vs diesel vs EV.
- **Budget range ring** ("How far can ₱300 take me?").
- **Open in Google Maps / Waze / Apple Maps / OpenStreetMap**: remembers your favorite app, uses two-wheeler mode for motorcycles, and includes stops on Google.
  - Also **copy coordinates** or **download GPX** for OsmAnd, Organic Maps, Garmin and others.
- **Share link**, **copy summary** (paste into a group chat to split costs), **save trip**, **print**.

### Fuel Prices (`#/prices`)
- **Any week from 2017 to now**, with a **compare-with** picker: previous week, 4 weeks, 1/3/5 years, or any week. Shows ₱ and % change.
- Regions: NCR, North Luzon, South Luzon, Visayas, Mindanao.
- **Price history** chart with **6M / 1Y / 3Y / 5Y / All** ranges, product toggles, a **per-city** view, low/high stats, and **CSV download**.
- **NCR by city** (heat-mapped) and **price range by brand** per city.
- **Weekly adjustments** with a per-company breakdown and source PDFs.
- **Check DOE now** button, plus when the DOE site was last checked.

### Price Watch (`#/watch`)
- Next Tuesday's adjustment estimate per product, with a range and confidence level.
- **Fill-up advice**, projected NCR pump prices, and the market drivers behind the estimate.
- A news pressure gauge, and model accuracy (predicted vs actual).

### Stations (`#/stations`)
- Nearby stations (OpenStreetMap), priced with **DOE brand ranges for that city** or **community-reported prices**.
- Ranked by **true cost**: the fill-up plus the detour fuel there and back.
- **Open in** any navigation app, and report prices.

### News (`#/news`)
Headlines from Google News, Inquirer, Philstar, GMA, Rappler and GDELT. They're tagged by topic and ▲/▼ price pressure.

### My Garage (`#/garage`, sign-in)
- **Vehicles**, including EVs and an optional plate digit for coding checks.
- **Fuel log** with your real km/L (tank-to-tank method).
- **Monthly budget**.
- **Saved trips**.
- **Price alerts:**
  - RON91 at or below ₱X
  - diesel at or above ₱Y
  - "a rollback is expected"
  - "every adjustment notice"

  Alerts arrive in the **bell** menu, and optionally as desktop notifications while the site is open.

### Assistant (button at bottom-right)
English or Taglish. Every number comes from the database; Gemini (if configured) only understands the question and phrases the answer. Examples:
- *"Magkano from Cubao to Tagaytay by Vios?"*
- *"₱300 sa Click, gaano kalayo?"*
- *"Will diesel go up next week?"*
- *"Magkano ang diesel noong June 2022?"*
- *"How much was RON91 last year?"*
- *"Vios vs Click vs BYD Dolphin for 40 km"*

### Integration Monitor (`#/admin`, admin)
A tabbed dashboard. Every section starts with a one-line explanation.

| Tab | What's there |
|---|---|
| **Overview** | KPI tiles: price freshness, last DOE check, integrations healthy, jobs OK, trips, assistant questions, users, history weeks. An **"attention" list** with links to the right tab. Charts of API calls per hour (by source) and trips per day. |
| **Integrations** | Status legend. Charts of median vs 95th-percentile response time, success rate (7 days) and calls per day with errors. A card per integration (calls, latency, cache-hit share, last error); **click a card** for its recent calls and a response-time chart. |
| **Data & jobs** | Freshness table for every region, Brent and USD/PHP. DOE reports stored per year (and unreadable ones). Job run-time chart. **History import** with live progress. Scheduled jobs with **Run now**. News collected per day. Every DOE document, with **Re-import**. |
| **Usage** | Anonymous 30-day stats: trips per day and average cost, vehicle types, most-used vehicles, trips by region, assistant question types, price alerts, community reports. No locations or place names are stored. |
| **Users & reports** | Every account with its activity and a **role switch** (at least one admin is enforced). Active alerts by type. **Moderation** of community price reports. |
| **Tools** | Manual price entry, CSV import, clear cache. |
| **System** | Server (Node, OS, uptime, memory), database engine and size, which API keys are set (never their values), settings, rows per table, recent outbound calls. |

### Also
Orange theme with dark mode, phone layout (bottom navigation + menu), offline support for the last prices (service worker), installable as an app (PWA).

---

## 6. How the integration works

```
 External systems                      Middleware (Node.js / Express)                 Single source of truth
 ────────────────                      ─────────────────────────────                  ──────────────────────
 DOE pages + weekly PDFs ──scrape──┐   integrations/*  one adapter per source         MySQL or SQLite
 OSRM routing (REST)               │   lib/http.js     timeouts, retries, per-host     fuel_prices (2017→now)
 Photon / Nominatim (REST)         ├──▶                rate limits, call logging  ──▶  price_adjustments
 Open-Meteo weather + elevation    │   lib/cache.js    memory + DB cache               market_series, news_articles
 Overpass (OSM stations)           │   services/jobs   scheduled sync + alerts         stations, users, fuel_logs
 EIA / FRED, Frankfurter           │   services/*      trip model, prices,             saved_trips, price_alerts
 Google News RSS, outlets, GDELT   │                   forecast, assistant             notifications, integration_log
 Google Gemini (language only) ────┘                          │
                                                             ▼
                                         REST API (/api/*) ──▶ Web app + chat assistant
                     Browser: Leaflet + OSM tiles, Geolocation, Google Maps / Waze / Apple Maps / OSM links, GPX
```

| Job | Every | What it does |
|---|---|---|
| `doe_latest` | 1 h | New NCR price reports and adjustment notices → recalibrate forecast → evaluate alerts |
| `doe_regional` | 12 h | Regional field-office reports |
| `doe_backfill` | manual | Imports the DOE archive (history back to 2017) |
| `market` | 6 h | Brent crude (EIA → FRED API → FRED CSV) and USD/PHP (Frankfurter) |
| `news` | 1 h | All news sources → dedupe → topic + direction tagging |
| `forecast` | 3 h | Next Tuesday's adjustment estimate, then alerts |
| `stations` | 7 d | Every fuel station in Metro Manila, Cebu and Davao from OpenStreetMap |
| `cleanup` | 24 h | Prunes old logs, sessions, cache, notifications |

**DOE parsing.** DOE publishes PDFs, not an API, and the layout changed several times between 2017 and 2026. `server/integrations/doe.js` reads each PDF's text **with x/y positions** (pdf.js) and rebuilds the tables. It handles:

| Years | Layout |
|---|---|
| 2017 | brand min–max ranges; brand table + "common prices" table |
| 2018 | printed sideways (rotated page) |
| 2019–2022 | city × brand tables, no NCR summary |
| 2023–2026 | city × brand tables with an NCR summary |

It also handles weekly adjustment notices and the very different regional reports. Every document and its outcome is recorded in `doe_documents`. Scanned (image-only) PDFs can't be read without OCR; they're listed in the Monitor.

---

## 7. Project structure

```
server/
  index.js              Express app, security headers, static files, startup
  config.js             .env loading and defaults
  cli.js                npm run sync / backfill / check / make-admin
  db/                   adapter (SQLite + MySQL), schema + migrations, vehicle presets
  lib/                  http (logging, throttling), cache, auth, utils
  integrations/         doe, pdf, osrm, geocode, openmeteo, overpass, market, news, gemini
  services/             trip model, prices, forecast, alerts, assistant, jobs, monitor, analytics
  routes/api.js         REST API
public/
  index.html, css/app.css, sw.js, manifest.webmanifest
  js/app.js, lib.js (helpers), ui.js (headers, help, tips, tabs, tour), chat.js
  js/views/             planner, prices, forecast, stations, news, garage, admin, about
mobile/                 React Native + Expo app (Android + iOS) — see mobile/README.md
```

### REST API (selection)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | Health, data freshness, last DOE check |
| POST | `/api/trip/estimate` | Routes + liters/kWh + cost (+ `compare`, `priceWeek`, `tollFee`, `plateDigit`, …) |
| GET | `/api/prices/region/:region?week=&compare=` | Prices for any week, compared with any other |
| GET | `/api/prices/weeks?region=` | Every week on file |
| GET | `/api/prices/history?products=&from=&to=&area=` | Weekly history |
| GET | `/api/prices/export.csv?region=&from=&to=&area=` | CSV download |
| POST | `/api/prices/check` | Check the DOE website now |
| GET | `/api/forecast` · `/api/market` · `/api/news` | Forecast, Brent and USD/PHP, headlines |
| GET | `/api/stations?lat=&lng=&radius=&product=` | Stations with DOE/community prices |
| POST | `/api/chat` | Assistant |
| * | `/api/me/*` | Garage, fuel log, alerts, notifications, budget, saved trips |
| * | `/api/admin/*` | Dashboard stats, monitor, jobs, history import, documents, users & roles, report moderation, manual prices |

---

## 8. Commands

| Command | Does |
|---|---|
| `npm start` | Run the server (port 3000, or `PORT`) |
| `npm run dev` | Run with auto-restart on file changes |
| `npm run sync` | Run every sync job once and exit |
| `npm run backfill -- all` | Import DOE history back to 2017 (or `-- 52` for one year) |
| `npm run check` | Test every external integration from your network |
| `npm run make-admin -- someone@email.com` | Promote a registered user to admin |
| `cd mobile` then `npx expo start` | Run the mobile app in Expo Go (scan the QR code) |

## 9. Troubleshooting

- **Old Node / `node:sqlite` error.** Install Node 22.13+.
- **Port 3000 in use.** Set `PORT=3001` in `.env`.
- **MySQL "ECONNREFUSED".** Start MySQL in XAMPP. **"Access denied"**: set `MYSQL_PASSWORD`.
- **No prices after a few minutes.** Integration Monitor → jobs and *DOE documents*. Press *Check DOE now* on the Fuel Prices page, or enter prices manually.
- **Stations slow outside Metro Manila/Cebu/Davao.** Public Overpass servers are sometimes overloaded. Results are cached, with stored stations as a fallback.
- **GDELT failures.** GDELT rate-limits heavily. The other news sources cover it.
- **Assistant says "Offline mode".** No `GEMINI_API_KEY` is set; answers still come from the same data.
- **Old styling after an update.** Hard-refresh (Ctrl+F5) once to update the offline cache.

## 10. Data notes and limits

- DOE prices are **weekly monitoring results**; individual stations vary. Each price is shown with its week and source PDF.
- **Regional prices** are computed from field-office reports and labelled as estimates.
- **History coverage:**
  - Reports before 2019 have NCR-wide prices only.
  - Early-2017 "common prices" are estimated from brand ranges.
  - About 30 of the 480+ archived reports are scans and can't be read.
- The **forecast** uses Brent as a free proxy for MOPS, which is paid data. It is indicative only.
- **EV electricity** uses a typical residential rate; public chargers cost more.
- **Toll fees** must be entered by the user.
- The **number coding check** follows the MMDA window: weekdays 7–10 AM and 5–8 PM. Holidays and LGU exceptions vary.

## 11. References

Department of Energy. (n.d.). *Retail pump prices.* https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices ·
Federal Reserve Bank of St. Louis. (n.d.). *FRED API.* https://fred.stlouisfed.org/docs/api/fred/ ·
Frankfurter. (n.d.). https://frankfurter.dev ·
Google. (n.d.). *Gemini API documentation.* https://ai.google.dev/gemini-api/docs ·
Google. (n.d.). *Google Maps URLs.* https://developers.google.com/maps/documentation/urls/get-started ·
Waze. (n.d.). *Deep links.* https://developers.google.com/waze/deeplinks ·
Apple. (n.d.). *Map links.* https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html ·
Komoot. (n.d.). *Photon.* https://photon.komoot.io/ ·
Leaflet. (n.d.). https://leafletjs.com/ ·
Open-Meteo. (n.d.). *Weather forecast API* and *Elevation API.* https://open-meteo.com/en/docs ·
OpenStreetMap Foundation. (n.d.). *Nominatim usage policy.* https://operations.osmfoundation.org/policies/nominatim/ ·
OpenStreetMap contributors. (n.d.). *Copyright and license.* https://www.openstreetmap.org/copyright ·
OpenStreetMap Wiki. (n.d.). *Overpass API.* https://wiki.openstreetmap.org/wiki/Overpass_API ·
Project OSRM. (n.d.). *API documentation.* http://project-osrm.org/docs/v5.24.0/api/ ·
The GDELT Project. (n.d.). https://www.gdeltproject.org/ ·
U.S. Energy Information Administration. (n.d.). *Open data.* https://www.eia.gov/opendata/ ·
United Nations. (n.d.). *Goal 11.* https://sdgs.un.org/goals/goal11
