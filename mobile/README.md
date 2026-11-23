# TipidLitro mobile app (React Native + Expo)

The Android and iOS version of TipidLitro. It has the same features, colors and plain-language help as the website. It reads everything from **your TipidLitro server** through the same REST API, so prices, history, the assistant and your account are shared with the web app.

- **Expo SDK 58** · React Native 0.88 · Expo Router · JavaScript.
- The Expo Go app in the App Store and Play Store only opens projects on the **latest** SDK (58), which this app uses. You can test on an iPhone from Windows without a Mac.

---

## 1. Run it on your phone (about 10 minutes)

### What you need

| | |
|---|---|
| Computer | Node.js 22.13+ (the same one the server uses) |
| Phone | **Expo Go**. iPhone: [App Store](https://apps.apple.com/app/expo-go/id982107779). Android: [Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent) |
| Expo account | Free, from [expo.dev/signup](https://expo.dev/signup). The current Expo Go asks you to sign in. |
| Network | Phone and computer on the **same Wi-Fi** |

> **"Project is incompatible with this version of Expo Go".** The app and Expo Go must use the same SDK (58). Update Expo Go from the store. If the message names a different SDK, the project and the store app are out of step. Run `npx expo install expo@latest --fix` in `mobile`, then `npx expo-doctor`.

### Step 1 — start the TipidLitro server (project root)

```bash
npm install
```

```bash
npm start
```

The server listens on port 3000 on every network interface, so phones on your Wi-Fi can reach it. The first time Node runs, **Windows Firewall** asks whether to allow it. Tick **Private networks** and click *Allow*.

### Step 2 — start the app (the `mobile` folder)

```bash
cd mobile
```

```bash
npm install
```

Sign in to your Expo account in the terminal (once per computer):

```bash
npx expo login
```

Also open **Expo Go** on your phone and sign in with the **same** account. Then start the app:

```bash
npx expo start
```

A QR code appears in the terminal.

- **Android:** open Expo Go and tap *Scan QR code*.
- **iPhone:** open the **Camera** app, point it at the QR code, and tap the banner.

The first build takes about a minute. After that, saving a file reloads the app instantly.

### Step 3 — first launch

1. A short intro (5 slides) explains the app. Tap **Get started**.
2. The app finds the server by itself. It uses your computer's address from the Expo dev server, for example `http://192.168.1.13:3000`.
3. If you see *"Can't reach the TipidLitro server"*, open **More → Settings → Server**, tap **Test**, and see section 4.
4. Sign in with the **same account** as the website. The first account on a server is the admin, and admins see **More → Admin dashboard** on the phone too.

---

## 2. What's in the app

| Web page | In the app | Notes |
|---|---|---|
| Trip Planner | **Plan** tab | Native map (tap to set A → B, drag the pins). Stops, saved places, vehicle picker (presets, your garage, EVs, custom km/L). All the *More options*: round trip, aircon, departure time, traffic, style, people, cargo, cost split, toll, parking, past DOE week, your own price, plate number coding, trips per week, rider earnings. Results include routes, warnings, *Why this cost*, *Over the years*, hills, weather, compare vehicles and the budget reach ring. |
| Open in Google Maps / Waze / Apple Maps | **Open in…** | Google Maps, Waze, Apple Maps (iOS), OpenStreetMap, copy coordinates, **share a GPX file** |
| Share / save trip | **Share**, **Save** | Uses the phone's share sheet (Messenger, Viber…). Saved trips appear in My Garage. |
| Fuel Prices | **Prices** tab | Regions; *This week* (any week back to 2017, compare with any week); *History* chart (6M–All, by fuel and city, **CSV** through the share sheet); *By city & brand* (green = cheaper); *Adjustments*; *Check DOE now* |
| Price Watch | **Watch** tab | Next Tuesday's estimate, fill-up tip, pump prices after the change, drivers, Brent/peso charts, accuracy chart, method |
| Stations | **Stations** tab | Brand-colored price pins, *Best value* (fill-up + detour fuel) or *Nearest*, directions, report a price |
| News | More → **Fuel news** | Topic filters, up/down pressure gauge. Articles open in an in-app browser. |
| My Garage | More → **My Garage** | Overview (budget, spending chart, real km/L), fuel log, vehicles (with plate digit and EVs), price alerts, saved trips, settings |
| Assistant | Orange **chat button** on every screen | English or Taglish. *Open in Trip Planner* fills the planner and calculates. |
| Notifications (bell) | Bell at the top right | Opening an item goes to the right screen. You can also turn on **phone notifications** for price alerts (checked every 2 minutes while the app is open). |
| Help, tour, glossary | **?** on every screen, More → **Help** | Step-by-step help per screen, *i* tips on terms, FAQ, glossary, *Show the intro again* |
| Integration Monitor | More → **Admin dashboard** (admins) | All 7 tabs: Overview, Integrations (tap for recent calls), Data & jobs (run jobs, import history, re-import PDFs), Usage, Users & reports, Tools (manual prices, CSV import, cache), System |
| Dark mode | More → Settings → Appearance | Automatic, light or dark |

**Offline:** the app saves the last prices, forecast, news and vehicle list. When the server can't be reached, those screens still open and show an *offline* note.

---

## 3. How it connects

```
Phone (Expo Go)  ──HTTP──▶  TipidLitro server :3000  ──▶  DOE, OSRM, Photon, Open-Meteo, Overpass, EIA/FRED, news, Gemini
                              (same REST API and database as the website)
```

- **Server address:** taken from Settings, then `EXPO_PUBLIC_API_URL`, then your computer's LAN IP on port 3000.
- **Sign-in:** the app sends `x-client: tipidlitro-mobile`. The server then returns a session token, which is kept in the phone's secure storage (Keychain / Keystore) and sent as `Authorization: Bearer …`. The website keeps using its HTTP-only cookie.
- **Maps:** `react-native-maps` uses Apple Maps on iOS and Google Maps on Android. No API key is needed in Expo Go.

---

## 4. Troubleshooting

| Problem | Fix |
|---|---|
| *Can't reach the TipidLitro server* | Check the server is running (`npm start` in the project root). On the phone, open `http://<computer-ip>:3000` in its browser. If that fails too, it's the network (next rows). |
| Phone browser can't open the server | Same Wi-Fi? Some routers block devices from seeing each other (guest Wi-Fi / "AP isolation"); use a normal network or your phone's hotspot. Windows: set the Wi-Fi network to **Private** and allow **Node.js** in *Windows Defender Firewall → Allow an app*. |
| Wrong address | Find your IP with `ipconfig` (look for *IPv4 Address*), then type `http://THAT-IP:3000` in Settings → Server and tap **Test**. |
| The QR code doesn't load the app | Try `npx expo start --tunnel` (this tunnels the app bundle only; the server still has to be reachable as above). |
| *Incompatible with this version of Expo Go* | Update Expo Go from the store; the app needs the SDK 58 version. |
| Expo Go asks you to log in, or the project doesn't appear | Sign in to the same Expo account in Expo Go and with `npx expo login` in the terminal. Then run `npx expo start` again. |
| Location doesn't work | Allow location for Expo Go in the phone's settings. |
| No phone notifications | Turn them on in Settings → Notifications and allow them when asked. They are checked while the app is open. |
| Something looks stale | Pull down on any screen to refresh. |

Check the project for problems:

```bash
npx expo-doctor
```

```bash
npx expo lint
```

---

## 5. Installable app (optional, EAS Build)

Expo Go is enough for testing and demos. To make a real app file:

1. Put the server where phones can reach it over the internet (a VPS or cloud host with HTTPS). Then build with its address:
   `EXPO_PUBLIC_API_URL=https://your-server.example`
2. **Android:** add a Google Maps API key in `app.json` under `android.config.googleMaps.apiKey`. Build an APK you can share:

```bash
npx eas-cli@latest build -p android --profile preview
```

3. **iOS:** needs an Apple Developer account. Run `npx eas-cli@latest build -p ios`.

The app already allows plain `http://` server addresses (handy on a LAN). For a public build, use `https://`.

---

## 6. Project structure

```
mobile/
  app.json                 name, icons, permissions, plugins (location, notifications, cleartext HTTP)
  assets/                  orange TipidLitro icon, adaptive icon, splash
  src/app/                 screens (Expo Router: every file is a screen)
    _layout.js             app state, theme, sign-in sheet, toasts, first-run intro
    (tabs)/                Plan (index), Prices, Watch, Stations, More
    news.js  garage.js  chat.js  help.js  admin.js  settings.js  notifications.js
  src/components/
    ui.js                  shared building blocks: header with ?, cards, sections, tabs, chips, tips, sheets, tables, toasts
    charts.js              line, bar, horizontal bar and donut charts (touch to read values)
    shared.js              place search, price strip, "new from DOE" banner, sign-in, Open in…, date pickers
    Onboarding.js          the intro slides
  src/lib/
    api.js                 server address, token, offline cache, preferences
    app-context.js         signed-in user, theme, status, location, notifications
    theme.js  format.js  glossary.js  nav.js
```
