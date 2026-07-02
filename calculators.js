// ============================================================
// TipidLitro — Calculators
// Pure functions, no DOM/API dependencies, so they're easy to
// unit-test and also easy for the Gemini chatbot to call.
// ============================================================

/**
 * @param {number} distanceKm
 * @param {number} efficiencyKmPerL
 * @param {number} pricePerL
 */
function calcTripCost(distanceKm, efficiencyKmPerL, pricePerL) {
  const liters = distanceKm / efficiencyKmPerL;
  const cost = liters * pricePerL;
  return { liters, cost };
}

/**
 * @param {number} fuelLiters
 * @param {number} efficiencyKmPerL
 */
function calcRange(fuelLiters, efficiencyKmPerL) {
  return fuelLiters * efficiencyKmPerL;
}

function formatPesos(value) {
  return "₱" + value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatKm(km) {
  if (km < 1) return Math.round(km * 1000) + " m";
  return km.toLocaleString("en-PH", { maximumFractionDigits: 1 }) + " km";
}

function formatLiters(l) {
  return l.toLocaleString("en-PH", { maximumFractionDigits: 2 }) + " L";
}

function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h <= 0) return `${m} min`;
  return `${h} hr ${m} min`;
}

// ---------- Fuel gauge SVG (signature dashboard dial) ----------
// Renders a semi-circular gauge like a car fuel dial, needle position
// driven by `fraction` (0 = Empty, 1 = Full).
function renderFuelGauge(containerEl, fraction, rangeKmLabel) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const angle = -90 + clamped * 180; // -90deg (E) to +90deg (F)
  const needleColor = clamped < 0.15 ? "var(--red)" : clamped < 0.4 ? "var(--amber)" : "var(--orange)";

  containerEl.innerHTML = `
    <svg viewBox="0 0 220 130" width="220" height="130">
      <path d="M20,110 A90,90 0 0,1 200,110" fill="none" stroke="var(--border)" stroke-width="14" stroke-linecap="round"/>
      <path d="M20,110 A90,90 0 0,1 200,110" fill="none" stroke="var(--orange)" stroke-width="14"
            stroke-linecap="round"
            stroke-dasharray="${clamped * 283} 283"/>
      <text x="20" y="128" fill="var(--text-faint)" font-size="11" font-family="JetBrains Mono">E</text>
      <text x="192" y="128" fill="var(--text-faint)" font-size="11" font-family="JetBrains Mono">F</text>
      <g transform="rotate(${angle} 110 110)">
        <line x1="110" y1="110" x2="110" y2="35" stroke="${needleColor}" stroke-width="3" stroke-linecap="round"/>
      </g>
      <circle cx="110" cy="110" r="7" fill="${needleColor}"/>
      <text x="110" y="98" text-anchor="middle" fill="var(--text)" font-size="15" font-weight="600" font-family="Space Grotesk">${rangeKmLabel}</text>
    </svg>
  `;
}
