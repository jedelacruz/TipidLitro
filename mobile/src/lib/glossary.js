// Plain-language help shared by every screen (same wording as the web app's ui.js).

export const GLOSSARY = {
  common: ['Common price', 'The price most stations in an area charge that week, from the Department of Energy\'s weekly price monitoring.'],
  range: ['Price range', 'The cheapest and most expensive prices DOE saw at stations in the area that week.'],
  ron: ['RON 91 / 95 / 97', 'Gasoline grades. RON 91 is regular unleaded (most motorcycles and cars). RON 95 is premium. RON 97/100 is premium plus.'],
  dieselPlus: ['Diesel Plus', 'Premium diesel with additives. Costs a few pesos more than regular diesel.'],
  adjustment: ['Price adjustment', 'Oil companies change pump prices every Tuesday at 6 AM. They announce the change (per liter) on Monday.'],
  rollback: ['Rollback / hike', 'A rollback is a price decrease; a hike is an increase.'],
  kmpl: ['km/L (fuel economy)', 'How many kilometers your vehicle goes on one liter. Higher is cheaper. For electric vehicles we use km per kWh.'],
  estimate: ['Estimate', 'Calculated by TipidLitro (for example from a regional report), not a single number published by DOE.'],
  coding: ['Number coding', 'MMDA bans private cars from Metro Manila roads on one weekday (based on the plate\'s last digit), 7–10 AM and 5–8 PM.'],
  brent: ['Brent crude', 'The world benchmark price of crude oil, in US dollars per barrel. Philippine pump prices follow world oil prices with about a week\'s delay.'],
  mops: ['MOPS', 'Mean of Platts Singapore — the regional fuel price oil companies base weekly adjustments on. It is paid data, so we use Brent as a free stand-in.'],
  confidence: ['Confidence', 'How much to trust the estimate: based on how well the model matched past adjustments and how fresh the oil data is.'],
  trueCost: ['True cost', 'What you pay for the fill-up plus the fuel used to drive to the station and back.'],
  brandRange: ['DOE brand range', 'The lowest and highest price DOE recorded for that brand in your city this week.'],
  community: ['Community price', 'A price reported by a TipidLitro user at that station in the last 14 days.'],
  pressure: ['News pressure', 'Whether recent headlines point to higher prices (e.g. "hike", "OPEC cuts output") or lower prices ("rollback").'],
  tankToTank: ['Tank-to-tank', 'Fill up to full, note the odometer, then at the next full fill-up divide kilometers driven by liters added. That is your real km/L.'],
  integration: ['Integration', 'An outside system TipidLitro talks to (DOE website, map services, weather, news…).'],
  latency: ['Latency', 'How long an outside service took to answer, in milliseconds. Lower is better.'],
  cacheHit: ['Cache hit', 'An answer reused from TipidLitro\'s own copy instead of calling the outside service again. Saves time and free-tier limits.'],
  job: ['Scheduled job', 'A task the server runs automatically on a timer, like checking DOE for new prices every hour.'],
};
export const ADMIN_TERMS = ['integration', 'latency', 'cacheHit', 'job'];

export const HELP = {
  plan: {
    title: 'Trip Planner',
    intro: 'Find out how much fuel (or electricity) a trip will cost, using this week\'s official DOE pump price for your city.',
    steps: [
      'Tap "Starting point" and search a place, or use your location. You can also tap the map.',
      'Set your destination. Add stops for errands or deliveries.',
      'Pick your vehicle. Typical fuel economy is filled in; tap "Adjust" if you know yours.',
      'Optional: open "More options" for passengers, departure time, tolls, parking, your plate number and more.',
      'Tap Calculate. You get the peso cost first; the tabs below explain how it was worked out.',
    ],
    terms: ['kmpl', 'common', 'ron', 'coding'],
  },
  prices: {
    title: 'Fuel prices',
    intro: 'Official retail pump prices from the Department of Energy (DOE). DOE checks stations every week and publishes the results; TipidLitro reads those reports automatically.',
    steps: [
      'Pick a region at the top (NCR has the most detail: every city and brand).',
      '"This week" shows the price most stations charge for each fuel, and how it changed.',
      '"History" shows prices over time, back to 2017. You can share the numbers as a CSV file.',
      '"By city" shows which city and brand is cheapest.',
      '"Adjustments" shows the weekly changes oil companies announce every Monday.',
    ],
    terms: ['common', 'range', 'ron', 'dieselPlus', 'adjustment', 'rollback', 'estimate'],
  },
  watch: {
    title: 'Price Watch',
    intro: 'Philippine pump prices change every Tuesday. Price Watch estimates next Tuesday\'s change so you can decide whether to fill up now or wait.',
    steps: [
      'Read the answer at the top: whether prices will likely go up or down, and by about how much per liter.',
      'Follow the tip: fill up before Tuesday if a hike is coming, or wait for a rollback if your tank allows.',
      'On Monday, oil companies announce the official numbers; Price Watch switches to those automatically.',
    ],
    terms: ['rollback', 'adjustment', 'brent', 'mops', 'confidence', 'pressure'],
  },
  stations: {
    title: 'Nearby stations',
    intro: 'Find fuel stations near you and see which one is really the cheapest once you count the fuel it takes to get there.',
    steps: [
      'Tap the location button or search an area. You can also tap the map.',
      'Choose your fuel. Prices come from DOE brand ranges for your city, or from recent reports by other users.',
      'Sort by "Best value" (fill-up + detour fuel) or "Nearest".',
      'Tap "Go" for directions in Google Maps, Waze or Apple Maps.',
      'Saw the actual price? Tap "Report price" to help others.',
    ],
    terms: ['trueCost', 'brandRange', 'community', 'common'],
  },
  news: {
    title: 'Fuel news',
    intro: 'Fuel-related headlines from several Philippine and global sources, collected every hour, so you can see why prices are moving.',
    steps: ['Tap a topic to filter.', 'The ▲ / ▼ mark shows whether a headline points to higher or lower pump prices.', 'Tap a headline to read the full article.'],
    terms: ['pressure', 'rollback', 'brent'],
  },
  garage: {
    title: 'My Garage',
    intro: 'Your personal space: your vehicles, a log of your fill-ups, a monthly fuel budget, price alerts and saved trips.',
    steps: ['Add your vehicle under Vehicles (start from a common model, then adjust).', 'Each time you fill up, add it under Fuel log. Fill to full and note the odometer to learn your real km/L.', 'Set a monthly budget under Settings.', 'Under Alerts, ask to be notified when prices drop below an amount or a rollback is coming.'],
    terms: ['tankToTank', 'kmpl', 'coding', 'rollback'],
  },
  admin: {
    title: 'Integration Monitor',
    intro: 'Shows how TipidLitro\'s connections to outside systems are doing, keeps the data pipeline running, and gives you usage numbers.',
    steps: [
      'Overview: anything that needs attention, plus headline numbers.',
      'Integrations: each outside system with speed and reliability charts. Tap one for its recent calls.',
      'Data & jobs: price freshness, stored history and the automatic jobs. Run a job or import more history.',
      'Usage: anonymous statistics about trips and assistant questions.',
      'Users: change roles and remove bad community price reports. Tools: type in prices by hand. System: server details.',
    ],
    terms: ['integration', 'latency', 'cacheHit', 'job'],
  },
};

export const FAQ = [
  ['Where do the prices come from?', 'From the Department of Energy (DOE). DOE monitors pump prices every week and publishes PDF reports. TipidLitro downloads and reads them automatically every hour.'],
  ['Why is my station cheaper or pricier?', 'DOE\'s "common price" is what most stations charge. Individual stations, brands and promos differ. Use Stations to compare, or type your own price under More options.'],
  ['How accurate is the trip cost?', 'Usually close for normal driving. It adjusts for traffic, hills, weather, aircon and load. Log your fill-ups in My Garage to use your real km/L.'],
  ['Do I need an account?', 'No. Everything works without one. An account lets you save vehicles, trips, fill-ups, a budget and price alerts — the same account works on the website and the app.'],
  ['Does it work for motorcycles and jeepneys?', 'Yes — motorcycles, tricycles, cars, SUVs, vans, jeepneys and electric vehicles. Motorcycles get two-wheeler directions and expressway warnings.'],
  ['Will it know about next week\'s rollback?', 'Price Watch estimates it from world oil prices during the week, then shows the official numbers once oil companies announce them on Monday.'],
  ['The app says it can\'t reach the server', 'The app talks to the TipidLitro server running on a computer. Make sure it is running (npm start) and your phone is on the same Wi-Fi, then check the address in Settings → Server.'],
];
