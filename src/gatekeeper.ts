import { AuthRequest, EvaluationResult, RiskSignal } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Earth's mean radius in kilometres — used for Haversine distance calculation. */
const EARTH_RADIUS_KM = 6371;

/**
 * Maximum physically plausible travel speed between two login locations (km/h).
 * Set to the cruising speed of a commercial jet so even air travel is considered
 * legitimate. Anything exceeding this threshold is flagged as impossible velocity.
 */
const MAX_PLAUSIBLE_SPEED_KMH = 900;

/** Risk score returned when geolocation data is completely absent. */
const UNKNOWN_LOCATION_SCORE = 0.75;

/** Penalty applied per hour outside the user's established active-hours window. */
const TEMPORAL_PENALTY_PER_HOUR = 0.08;

/** Maximum temporal anomaly contribution to the aggregate score. */
const TEMPORAL_MAX_SCORE = 0.6;

// ─── Haversine Helper ────────────────────────────────────────────────────────

/**
 * Computes the great-circle distance between two coordinate pairs using the
 * Haversine formula.
 *
 * @returns Distance in kilometres.
 */
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Signal Analyzers ────────────────────────────────────────────────────────

/**
 * **Geographic Velocity Analysis**
 *
 * Measures whether the distance covered between the last login and the current
 * attempt is physically achievable within the elapsed time.
 *
 * Score:
 * - No baseline: 0.5 (inconclusive — neither safe nor certain threat)
 * - Unknown current location: UNKNOWN_LOCATION_SCORE
 * - Same country, plausible speed: 0.0–0.15
 * - Impossible velocity (speed > MAX_PLAUSIBLE_SPEED_KMH): 0.9
 * - High speed but sub-threshold: linearly scaled 0.2–0.7
 */
function analyzeGeographicVelocity(request: AuthRequest): RiskSignal {
  const dimension = 'GeographicVelocity' as const;

  if (!request.userBaseline) {
    return {
      dimension,
      score: 0.5,
      finding: 'No historical baseline available; geographic velocity is inconclusive.',
    };
  }

  const { lastLoginLocation, lastLoginTimestamp } = request.userBaseline;
  const current = request.location;

  // Guard: location labelled Unknown
  if (current.label === 'Unknown' || current.countryCode === '') {
    return {
      dimension,
      score: UNKNOWN_LOCATION_SCORE,
      finding:
        'Current geolocation could not be resolved. Treating as high-risk origin.',
    };
  }

  const distanceKm = haversineKm(
    lastLoginLocation.lat, lastLoginLocation.lon,
    current.lat, current.lon,
  );

  const elapsedMs =
    new Date(request.timestamp).getTime() -
    new Date(lastLoginTimestamp).getTime();
  const elapsedHours = elapsedMs / 3_600_000;

  // Avoid division by zero; if timestamps are identical treat as same-location
  if (elapsedHours <= 0) {
    const score = distanceKm > 50 ? 0.95 : 0.0;
    return {
      dimension,
      score,
      finding:
        distanceKm > 50
          ? `Login from ${current.label} occurred at the same timestamp as the previous login from ${lastLoginLocation.label} — impossible teleportation (${distanceKm.toFixed(0)} km).`
          : 'Login timestamp identical to last session; location is consistent.',
    };
  }

  const speedKmh = distanceKm / elapsedHours;

  if (speedKmh > MAX_PLAUSIBLE_SPEED_KMH) {
    return {
      dimension,
      score: 0.9,
      finding:
        `Impossible velocity detected: ${distanceKm.toFixed(0)} km covered in ` +
        `${elapsedHours.toFixed(2)} h (${speedKmh.toFixed(0)} km/h). ` +
        `Previous login: ${lastLoginLocation.label}; current: ${current.label}.`,
    };
  }

  // Cross-country but sub-threshold: scale proportionally
  if (lastLoginLocation.countryCode !== current.countryCode) {
    const score = Math.min(0.7, 0.2 + (speedKmh / MAX_PLAUSIBLE_SPEED_KMH) * 0.5);
    return {
      dimension,
      score,
      finding:
        `Cross-country login detected (${lastLoginLocation.countryCode} → ${current.countryCode}). ` +
        `Travel speed: ${speedKmh.toFixed(0)} km/h over ${distanceKm.toFixed(0)} km. ` +
        `Within physical limits but outside home country.`,
    };
  }

  // Same country, reasonable distance
  const score = Math.min(0.15, distanceKm / 10_000);
  return {
    dimension,
    score,
    finding:
      `Login origin (${current.label}) is consistent with last known location ` +
      `(${lastLoginLocation.label}, ${distanceKm.toFixed(0)} km, ${speedKmh.toFixed(0)} km/h).`,
  };
}

/**
 * **Temporal Anomaly Analysis**
 *
 * Evaluates whether the login timestamp falls within the user's established
 * active-hours window. Penalises attempts that deviate from the norm.
 *
 * Score:
 * - No baseline: 0.3 (mild uncertainty)
 * - Within active window: 0.0–0.05
 * - Outside window: TEMPORAL_PENALTY_PER_HOUR × hours_outside, capped at TEMPORAL_MAX_SCORE
 */
function analyzeTemporalAnomaly(request: AuthRequest): RiskSignal {
  const dimension = 'TemporalAnomaly' as const;

  if (!request.userBaseline) {
    return {
      dimension,
      score: 0.3,
      finding: 'No historical baseline available; temporal pattern is inconclusive.',
    };
  }

  const { typicalActiveHoursUTC } = request.userBaseline;
  const utcHour = new Date(request.timestamp).getUTCHours();
  const [start, end] = typicalActiveHoursUTC;

  // Handle windows that wrap around midnight (e.g. 22–06)
  const isWithinWindow =
    start <= end
      ? utcHour >= start && utcHour < end
      : utcHour >= start || utcHour < end;

  if (isWithinWindow) {
    return {
      dimension,
      score: 0.0,
      finding: `Login at ${utcHour}:00 UTC is within the user's typical active window (${start}:00–${end}:00 UTC).`,
    };
  }

  // Calculate hours outside window
  const distToStart = ((utcHour - start) % 24 + 24) % 24;
  const distToEnd   = ((end - utcHour) % 24 + 24) % 24;
  const hoursOutside = Math.min(distToStart, distToEnd);

  const score = Math.min(TEMPORAL_MAX_SCORE, hoursOutside * TEMPORAL_PENALTY_PER_HOUR);

  return {
    dimension,
    score,
    finding:
      `Login at ${utcHour}:00 UTC is ${hoursOutside} hour(s) outside the user's ` +
      `typical active window (${start}:00–${end}:00 UTC). Temporal anomaly penalty: ${score.toFixed(2)}.`,
  };
}

/**
 * **Device Integrity Analysis**
 *
 * Cross-references the incoming User-Agent against the user's list of known
 * devices and inspects for signals of automation, headless browsers, and
 * header inconsistencies.
 *
 * Score:
 * - No baseline: 0.25 (mild uncertainty — new users always start here)
 * - Known UA exact match: 0.0
 * - Known UA family but version change: 0.15 (browser update is normal)
 * - Unknown UA: 0.45
 * - Automation / headless signals: 0.85
 */
function analyzeDeviceIntegrity(request: AuthRequest): RiskSignal {
  const dimension = 'DeviceIntegrity' as const;
  const ua = request.userAgent.trim();

  // Headless / automation fingerprints
  const suspiciousPatterns = [
    /headlesschrome/i,
    /phantomjs/i,
    /selenium/i,
    /webdriver/i,
    /puppeteer/i,
    /playwright/i,
    /python-requests/i,
    /curl\//i,
    /go-http-client/i,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(ua)) {
      return {
        dimension,
        score: 0.85,
        finding: `User-Agent matches automation fingerprint pattern "${pattern.source}": "${ua}".`,
      };
    }
  }

  if (!request.userBaseline || request.userBaseline.knownUserAgents.length === 0) {
    return {
      dimension,
      score: 0.25,
      finding: 'No known device baseline; User-Agent is unverified but shows no automation signals.',
    };
  }

  const knownUAs = request.userBaseline.knownUserAgents;

  // Exact match — fully trusted device
  if (knownUAs.includes(ua)) {
    return {
      dimension,
      score: 0.0,
      finding: 'User-Agent exactly matches a known trusted device fingerprint.',
    };
  }

  // Same browser family, different version (common after browser auto-update)
  const extractFamily = (s: string) => {
    const m = s.match(/(Chrome|Firefox|Safari|Edge|Edg|OPR|Opera)\/[\d.]+/i);
    return m ? m[1].toLowerCase() : null;
  };

  const incomingFamily = extractFamily(ua);
  if (incomingFamily) {
    const familyMatch = knownUAs.some(
      (k) => extractFamily(k) === incomingFamily,
    );
    if (familyMatch) {
      return {
        dimension,
        score: 0.15,
        finding:
          `Browser family "${incomingFamily}" is known but the exact version differs — ` +
          `likely a browser update. Minor risk elevation applied.`,
      };
    }
  }

  return {
    dimension,
    score: 0.45,
    finding: `User-Agent "${ua}" does not match any known device fingerprint for this account.`,
  };
}

// ─── Action Resolver ────────────────────────────────────────────────────────

/**
 * Maps an aggregate risk score to an action according to the strict protocol:
 * - score > 0.7  → `'BLOCK'`
 * - score ≥ 0.4  → `'CHALLENGE'`
 * - score < 0.4  → `'ALLOW'`
 */
function resolveAction(score: number): 'ALLOW' | 'CHALLENGE' | 'BLOCK' {
  if (score > 0.7) return 'BLOCK';
  if (score >= 0.4) return 'CHALLENGE';
  return 'ALLOW';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * **Secure-Gate Behavioral Analysis Engine**
 *
 * Evaluates the risk of an incoming authentication request across three
 * independent analytical dimensions:
 *
 * 1. **Geographic Velocity** — Is travel between last and current login location
 *    physically possible within the elapsed time?
 * 2. **Temporal Anomaly** — Does the login timestamp deviate from the user's
 *    established active-hours baseline?
 * 3. **Device Integrity** — Is the User-Agent known, trustworthy, and free from
 *    automation fingerprints?
 *
 * The aggregate `riskScore` is the weighted mean of the three signals:
 * - Geographic Velocity: **45%**
 * - Temporal Anomaly:    **25%**
 * - Device Integrity:    **30%**
 *
 * Action thresholds (strict rule):
 * - `> 0.7`   → `'BLOCK'`
 * - `0.4–0.7` → `'CHALLENGE'`
 * - `< 0.4`   → `'ALLOW'`
 *
 * @param request - The incoming {@link AuthRequest} to evaluate.
 * @returns A structured {@link EvaluationResult} with score, reasoning, action and per-signal audit data.
 */
export function evaluateRisk(request: AuthRequest): EvaluationResult {
  const geoSignal      = analyzeGeographicVelocity(request);
  const temporalSignal = analyzeTemporalAnomaly(request);
  const deviceSignal   = analyzeDeviceIntegrity(request);

  // Weighted combination
  const riskScore = parseFloat(
    (
      geoSignal.score      * 0.45 +
      temporalSignal.score * 0.25 +
      deviceSignal.score   * 0.30
    ).toFixed(4),
  );

  const action = resolveAction(riskScore);

  const reasoning =
    `Aggregate risk score: ${riskScore.toFixed(4)} → action: ${action}. ` +
    `[GeoVelocity(×0.45): ${geoSignal.score.toFixed(2)} — ${geoSignal.finding}] ` +
    `[TemporalAnomaly(×0.25): ${temporalSignal.score.toFixed(2)} — ${temporalSignal.finding}] ` +
    `[DeviceIntegrity(×0.30): ${deviceSignal.score.toFixed(2)} — ${deviceSignal.finding}]`;

  return {
    riskScore,
    reasoning,
    action,
    signals: [geoSignal, temporalSignal, deviceSignal],
  };
}
