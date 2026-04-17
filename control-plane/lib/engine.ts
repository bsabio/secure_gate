import { AuthRequest, SecureGateResponseType } from './types';

// ─── Constants (mirrors gatekeeper.ts) ───────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const MAX_PLAUSIBLE_SPEED_KMH = 900;
const UNKNOWN_LOCATION_SCORE = 0.75;
const TEMPORAL_PENALTY_PER_HOUR = 0.08;
const TEMPORAL_MAX_SCORE = 0.6;

// ─── Haversine ────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Signal Analyzers ─────────────────────────────────────────────────────────

function analyzeGeoVelocity(req: AuthRequest) {
  const dim = 'GeographicVelocity' as const;
  if (!req.userBaseline) return { dimension: dim, score: 0.5, finding: 'No historical baseline available; geographic velocity is inconclusive.' };

  const { lastLoginLocation, lastLoginTimestamp } = req.userBaseline;
  const cur = req.location;
  if (cur.label === 'Unknown' || cur.countryCode === '') return { dimension: dim, score: UNKNOWN_LOCATION_SCORE, finding: 'Current geolocation could not be resolved. Treating as high-risk origin.' };

  const dist = haversineKm(lastLoginLocation.lat, lastLoginLocation.lon, cur.lat, cur.lon);
  const elapsed = (new Date(req.timestamp).getTime() - new Date(lastLoginTimestamp).getTime()) / 3_600_000;

  if (elapsed <= 0) {
    const score = dist > 50 ? 0.95 : 0.0;
    return { dimension: dim, score, finding: dist > 50 ? `Impossible teleportation: ${dist.toFixed(0)} km between ${lastLoginLocation.label} and ${cur.label} at identical timestamps.` : 'Same timestamp and consistent location.' };
  }

  const speed = dist / elapsed;
  if (speed > MAX_PLAUSIBLE_SPEED_KMH) return { dimension: dim, score: 0.9, finding: `Impossible velocity: ${dist.toFixed(0)} km in ${elapsed.toFixed(2)}h (${speed.toFixed(0)} km/h). ${lastLoginLocation.label} → ${cur.label}.` };
  if (lastLoginLocation.countryCode !== cur.countryCode) {
    const score = Math.min(0.7, 0.2 + (speed / MAX_PLAUSIBLE_SPEED_KMH) * 0.5);
    return { dimension: dim, score, finding: `Cross-country: ${lastLoginLocation.countryCode} → ${cur.countryCode}. ${dist.toFixed(0)} km at ${speed.toFixed(0)} km/h — within physical limits.` };
  }
  const score = Math.min(0.15, dist / 10_000);
  return { dimension: dim, score, finding: `Consistent origin: ${cur.label} (${dist.toFixed(0)} km, ${speed.toFixed(0)} km/h from last login).` };
}

function analyzeTemporal(req: AuthRequest) {
  const dim = 'TemporalAnomaly' as const;
  if (!req.userBaseline) return { dimension: dim, score: 0.3, finding: 'No historical baseline available; temporal pattern is inconclusive.' };
  const [start, end] = req.userBaseline.typicalActiveHoursUTC;
  const h = new Date(req.timestamp).getUTCHours();
  const inWindow = start <= end ? h >= start && h < end : h >= start || h < end;
  if (inWindow) return { dimension: dim, score: 0.0, finding: `Login at ${h}:00 UTC is within the user's typical active window (${start}:00–${end}:00 UTC).` };
  const distToStart = ((h - start) % 24 + 24) % 24;
  const distToEnd = ((end - h) % 24 + 24) % 24;
  const hoursOut = Math.min(distToStart, distToEnd);
  const score = Math.min(TEMPORAL_MAX_SCORE, hoursOut * TEMPORAL_PENALTY_PER_HOUR);
  return { dimension: dim, score, finding: `Login at ${h}:00 UTC is ${hoursOut}h outside the active window (${start}:00–${end}:00 UTC). Penalty: ${score.toFixed(2)}.` };
}

function analyzeDevice(req: AuthRequest) {
  const dim = 'DeviceIntegrity' as const;
  const ua = req.userAgent.trim();
  const suspicious = [/headlesschrome/i, /phantomjs/i, /selenium/i, /webdriver/i, /puppeteer/i, /playwright/i, /python-requests/i, /curl\//i, /go-http-client/i];
  for (const p of suspicious) {
    if (p.test(ua)) return { dimension: dim, score: 0.85, finding: `Automation fingerprint detected: "${ua}" matches pattern ${p.source}.` };
  }
  if (!req.userBaseline || req.userBaseline.knownUserAgents.length === 0) return { dimension: dim, score: 0.25, finding: 'No known device baseline; UA is unverified but shows no automation signals.' };
  const known = req.userBaseline.knownUserAgents;
  if (known.includes(ua)) return { dimension: dim, score: 0.0, finding: 'User-Agent exactly matches a known trusted device fingerprint.' };
  const fam = (s: string) => { const m = s.match(/(Chrome|Firefox|Safari|Edge|Edg|OPR|Opera)\/[\d.]+/i); return m ? m[1].toLowerCase() : null; };
  const inFam = fam(ua);
  if (inFam && known.some(k => fam(k) === inFam)) return { dimension: dim, score: 0.15, finding: `Browser family "${inFam}" is known but version differs — likely an auto-update.` };
  return { dimension: dim, score: 0.45, finding: `UA "${ua}" does not match any known device fingerprint for this account.` };
}

function resolveAction(score: number): 'ALLOW' | 'CHALLENGE' | 'BLOCK' {
  if (score > 0.7) return 'BLOCK';
  if (score >= 0.4) return 'CHALLENGE';
  return 'ALLOW';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function evaluateRisk(request: AuthRequest): SecureGateResponseType {
  const geo = analyzeGeoVelocity(request);
  const temporal = analyzeTemporal(request);
  const device = analyzeDevice(request);
  const riskScore = parseFloat((geo.score * 0.45 + temporal.score * 0.25 + device.score * 0.30).toFixed(4));
  const action = resolveAction(riskScore);
  const reasoning =
    `Aggregate risk: ${riskScore.toFixed(4)} → ${action}. ` +
    `[GeoVelocity×0.45: ${geo.score.toFixed(2)} — ${geo.finding}] ` +
    `[TemporalAnomaly×0.25: ${temporal.score.toFixed(2)} — ${temporal.finding}] ` +
    `[DeviceIntegrity×0.30: ${device.score.toFixed(2)} — ${device.finding}]`;
  return { riskScore, reasoning, action, signals: [geo, temporal, device] };
}
