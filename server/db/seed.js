// Typical real-world consumption for vehicles common on Philippine roads.
// City/highway km/L are conservative owner-reported averages, not brochure figures.
export const VEHICLE_PRESETS = [
  // slug, name, category, fuel, product, city, highway, mass kg (incl. driver), cc, seats
  ['honda-beat', 'Honda BeAT 110', 'motorcycle', 'gasoline', 'RON91', 52, 60, 160, 110, 2],
  ['honda-click-125', 'Honda Click 125', 'motorcycle', 'gasoline', 'RON91', 46, 54, 175, 125, 2],
  ['yamaha-mio-125', 'Yamaha Mio i 125', 'motorcycle', 'gasoline', 'RON91', 45, 52, 170, 125, 2],
  ['honda-tmx-125', 'Honda TMX 125 Alpha', 'motorcycle', 'gasoline', 'RON91', 55, 65, 180, 125, 2],
  ['yamaha-nmax-155', 'Yamaha NMAX 155', 'motorcycle', 'gasoline', 'RON95', 38, 45, 200, 155, 2],
  ['honda-adv-160', 'Honda ADV / PCX 160', 'motorcycle', 'gasoline', 'RON95', 40, 47, 200, 160, 2],
  ['suzuki-raider-150', 'Suzuki Raider R150 Fi', 'motorcycle', 'gasoline', 'RON95', 36, 44, 185, 150, 2],
  ['kawasaki-barako-175', 'Kawasaki Barako 175 (tricycle)', 'tricycle', 'gasoline', 'RON91', 28, 34, 420, 175, 4],
  ['toyota-wigo', 'Toyota Wigo 1.0', 'car', 'gasoline', 'RON91', 14, 19, 950, 998, 5],
  ['mitsubishi-mirage-g4', 'Mitsubishi Mirage G4 1.2', 'car', 'gasoline', 'RON91', 14, 20, 1000, 1193, 5],
  ['toyota-vios', 'Toyota Vios 1.3', 'car', 'gasoline', 'RON91', 11, 17, 1150, 1329, 5],
  ['honda-city', 'Honda City 1.5', 'car', 'gasoline', 'RON91', 11, 17, 1200, 1498, 5],
  ['toyota-raize', 'Toyota Raize 1.0 Turbo', 'suv', 'gasoline', 'RON91', 11, 16, 1150, 996, 5],
  ['suzuki-ertiga', 'Suzuki Ertiga 1.5 Hybrid', 'mpv', 'gasoline', 'RON91', 11, 16, 1250, 1462, 7],
  ['toyota-corolla-cross-hev', 'Toyota Corolla Cross Hybrid', 'suv', 'gasoline', 'RON91', 18, 21, 1450, 1798, 5],
  ['toyota-innova-diesel', 'Toyota Innova 2.8 Diesel', 'mpv', 'diesel', 'DIESEL', 8.5, 12, 1800, 2755, 8],
  ['mitsubishi-xpander', 'Mitsubishi Xpander 1.5', 'mpv', 'gasoline', 'RON91', 10, 15, 1350, 1499, 7],
  ['toyota-fortuner-diesel', 'Toyota Fortuner 2.4 Diesel', 'suv', 'diesel', 'DIESEL', 8, 12, 2100, 2393, 7],
  ['mitsubishi-montero', 'Mitsubishi Montero Sport 2.4 Diesel', 'suv', 'diesel', 'DIESEL', 8, 12.5, 2050, 2442, 7],
  ['toyota-hilux-diesel', 'Toyota Hilux 2.4 Diesel', 'pickup', 'diesel', 'DIESEL', 8.5, 12.5, 1950, 2393, 5],
  ['ford-ranger-diesel', 'Ford Ranger 2.0 Diesel', 'pickup', 'diesel', 'DIESEL', 8.5, 12.5, 2050, 1996, 5],
  ['toyota-hiace', 'Toyota Hiace Commuter Diesel', 'van', 'diesel', 'DIESEL', 7, 10, 2300, 2755, 15],
  ['mitsubishi-l300', 'Mitsubishi L300 Diesel', 'van', 'diesel', 'DIESEL', 7, 10, 1900, 2268, 3],
  ['isuzu-traviz', 'Isuzu Traviz (light truck)', 'truck', 'diesel', 'DIESEL', 7, 10, 2500, 2499, 3],
  ['jeepney-traditional', 'Traditional jeepney (diesel)', 'jeepney', 'diesel', 'DIESEL', 4.5, 6.5, 3000, 4000, 20],
  ['modern-jeepney', 'Modern PUJ (Class 2, Euro 4 diesel)', 'jeepney', 'diesel', 'DIESEL', 5, 7, 4500, 3000, 24],
  // Electric: the two economy columns are km per kWh (EVs are more efficient in the city).
  ['e-scooter', 'Electric scooter (e-motorcycle)', 'motorcycle', 'electric', 'ELECTRICITY', 30, 26, 170, null, 2],
  ['e-trike', 'E-trike (3-wheeler)', 'tricycle', 'electric', 'ELECTRICITY', 13, 11, 650, null, 6],
  ['byd-dolphin', 'BYD Dolphin (EV)', 'car', 'electric', 'ELECTRICITY', 7.4, 6.2, 1500, null, 5],
  ['nissan-leaf', 'Nissan Leaf (EV)', 'car', 'electric', 'ELECTRICITY', 6.8, 5.8, 1650, null, 5],
  ['byd-atto3', 'BYD Atto 3 (EV SUV)', 'suv', 'electric', 'ELECTRICITY', 6.3, 5.2, 1800, null, 5],
  ['e-jeepney', 'E-jeepney (electric PUJ)', 'jeepney', 'electric', 'ELECTRICITY', 4.2, 3.6, 4200, null, 22],
];

export async function seedVehicles(db) {
  for (const [slug, name, category, fuel, product, city, hwy, mass, cc, seats] of VEHICLE_PRESETS) {
    await db.upsert('vehicle_presets', {
      slug, name, category, fuel_type: fuel, product, kmpl_city: city, kmpl_highway: hwy, mass_kg: mass, engine_cc: cc, seats, notes: null,
    }, ['slug']);
  }
}
