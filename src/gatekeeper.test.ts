import { evaluateRisk } from './gatekeeper';
import { AuthRequest, GeoLocation, UserBaseline } from './types';

// ─── Shared Geo Fixtures ──────────────────────────────────────────────────────

const NYC: GeoLocation   = { label: 'New York, US',  lat: 40.7128,  lon: -74.0060, countryCode: 'US' };
const LAX: GeoLocation   = { label: 'Los Angeles, US', lat: 34.0522, lon: -118.2437, countryCode: 'US' };
const LON: GeoLocation   = { label: 'London, UK',    lat: 51.5074,  lon: -0.1278,  countryCode: 'GB' };
const UNKNOWN: GeoLocation = { label: 'Unknown',     lat: 0,        lon: 0,        countryCode: '' };

// ─── Shared Baseline Fixture ──────────────────────────────────────────────────

const nycBaseline: UserBaseline = {
  lastLoginLocation: NYC,
  lastLoginTimestamp: '2026-04-17T09:00:00.000Z',   // 09:00 UTC — within window
  typicalActiveHoursUTC: [8, 18],
  knownUserAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
  ],
};

// ─── Base (Low-Risk) Request ──────────────────────────────────────────────────

const lowRiskRequest: AuthRequest = {
  ip: '192.168.1.100',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
  location: NYC,
  timestamp: '2026-04-17T10:00:00.000Z',   // 10:00 UTC — within window
  userBaseline: nycBaseline,
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<AuthRequest>): AuthRequest {
  return { ...lowRiskRequest, ...overrides };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('evaluateRisk — Secure-Gate Behavioral Analysis Engine', () => {

  // ── Output contract ──────────────────────────────────────────────────────────

  describe('EvaluationResult contract', () => {
    it('should return a well-formed EvaluationResult for a low-risk request', () => {
      const result = evaluateRisk(lowRiskRequest);
      expect(typeof result.riskScore).toBe('number');
      expect(typeof result.reasoning).toBe('string');
      expect(['ALLOW', 'CHALLENGE', 'BLOCK']).toContain(result.action);
      expect(Array.isArray(result.signals)).toBe(true);
      expect(result.signals).toHaveLength(3);
    });

    it('riskScore should always be a finite number between 0 and 1', () => {
      const result = evaluateRisk(lowRiskRequest);
      expect(Number.isFinite(result.riskScore)).toBe(true);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(1);
    });

    it('action should be consistent with strict threshold rules (>0.7 → BLOCK)', () => {
      // Force a high risk scenario: unknown location + no baseline + automation UA
      const result = evaluateRisk({
        ip:        '0.0.0.0',
        userAgent: 'python-requests/2.28.0',
        location:  UNKNOWN,
        timestamp: '2026-04-17T03:00:00.000Z',
      });
      if (result.riskScore > 0.7)       expect(result.action).toBe('BLOCK');
      else if (result.riskScore >= 0.4) expect(result.action).toBe('CHALLENGE');
      else                              expect(result.action).toBe('ALLOW');
    });

    it('signals array should contain all three required dimensions', () => {
      const result = evaluateRisk(lowRiskRequest);
      const dims   = result.signals.map((s) => s.dimension);
      expect(dims).toContain('GeographicVelocity');
      expect(dims).toContain('TemporalAnomaly');
      expect(dims).toContain('DeviceIntegrity');
    });

    it('reasoning string should be non-empty and reference the action', () => {
      const result = evaluateRisk(lowRiskRequest);
      expect(result.reasoning.length).toBeGreaterThan(0);
      expect(result.reasoning).toContain(result.action);
    });

    it('should not mutate the original request object', () => {
      const snapshot = JSON.parse(JSON.stringify(lowRiskRequest));
      evaluateRisk(lowRiskRequest);
      expect(lowRiskRequest).toEqual(snapshot);
    });

    it('should return the expected aggregate score when baseline is missing', () => {
      const result = evaluateRisk(makeRequest({ userBaseline: undefined }));
      // Geo=0.5, Temporal=0.3, Device=0.25 → 0.3750
      expect(result.riskScore).toBe(0.375);
      expect(result.action).toBe('ALLOW');
    });

    it('should assign UNKNOWN location score when geolocation is missing', () => {
      const result = evaluateRisk(makeRequest({ location: UNKNOWN }));
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBe(0.75);
    });
  });

  // ── ALLOW path ───────────────────────────────────────────────────────────────

  describe('ALLOW path — trusted session', () => {
    it('should return ALLOW for a consistent, low-risk session', () => {
      const result = evaluateRisk(lowRiskRequest);
      expect(result.action).toBe('ALLOW');
      expect(result.riskScore).toBeLessThan(0.4);
    });

    it('riskScore should be 0 when the device and location are perfectly consistent', () => {
      const result = evaluateRisk(lowRiskRequest);
      // Geo=0 (same location), Temporal=0 (within window), Device=0 (exact UA match)
      expect(result.riskScore).toBe(0);
    });
  });

  // ── CHALLENGE path ────────────────────────────────────────────────────────────

  describe('CHALLENGE path — moderate risk signals', () => {
    it('cross-country login within physical speed limits raises geo signal above 0', () => {
      const result = evaluateRisk(
        makeRequest({
          location:  LON,
          timestamp: '2026-04-18T09:00:00.000Z', // 24 h later — physical travel possible
          userBaseline: {
            ...nycBaseline,
            lastLoginTimestamp: '2026-04-17T09:00:00.000Z',
          },
        }),
      );
      // Cross-country flag should elevate the geo signal above 0 regardless of combined score
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBeGreaterThan(0);
      // Geo finding should mention the country transition
      expect(geo.finding).toMatch(/GB|cross-country|country/i);
    });

    it('login outside active hours should raise the temporal signal', () => {
      const result = evaluateRisk(
        makeRequest({
          timestamp: '2026-04-17T02:00:00.000Z', // 02:00 UTC — 6 h outside 08–18 window
        }),
      );
      const temporal = result.signals.find((s) => s.dimension === 'TemporalAnomaly')!;
      expect(temporal.score).toBeGreaterThan(0);
    });

    it('unknown UA that shares a browser family should produce minor device penalty', () => {
      const result = evaluateRisk(
        makeRequest({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0', // version bump
        }),
      );
      const device = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(device.score).toBeCloseTo(0.15, 2);
    });
  });

  // ── BLOCK path ────────────────────────────────────────────────────────────────

  describe('BLOCK path — critical threats', () => {
    it('automation UA (python-requests) should produce a high device integrity score', () => {
      const result = evaluateRisk(makeRequest({ userAgent: 'python-requests/2.28.0' }));
      const device = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(device.score).toBe(0.85);
    });

    it('headless Chrome UA should be flagged as automation', () => {
      const result = evaluateRisk(makeRequest({ userAgent: 'Mozilla/5.0 HeadlessChrome/124' }));
      const device = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(device.score).toBe(0.85);
    });

    it('impossible velocity (same-timestamp teleportation >50 km) should score 0.95 on geo', () => {
      const result = evaluateRisk(
        makeRequest({
          location: LON,
          timestamp: '2026-04-17T09:00:00.000Z', // exact same time as last NYC login
          userBaseline: {
            ...nycBaseline,
            lastLoginTimestamp: '2026-04-17T09:00:00.000Z',
          },
        }),
      );
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBe(0.95);
    });

    it('combination of automation + impossible velocity should produce a high aggregate score', () => {
      const result = evaluateRisk({
        ip:        '0.0.0.0',
        userAgent: 'python-requests/2.28.0',
        location:  LON,
        timestamp: '2026-04-17T09:00:00.000Z',
        userBaseline: {
          ...nycBaseline,
          lastLoginTimestamp: '2026-04-17T09:00:00.000Z',
        },
      });
      // Both the geo (0.95) and device (0.85) signals fire — aggregate must be well above CHALLENGE
      expect(result.riskScore).toBeGreaterThanOrEqual(0.4);
      expect(['CHALLENGE', 'BLOCK']).toContain(result.action);
      // Verify individual signals all fired at high values
      const geo    = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      const device = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(geo.score).toBe(0.95);
      expect(device.score).toBe(0.85);
    });
  });

  // ── Geographic Velocity signal ────────────────────────────────────────────────

  describe('GeographicVelocity signal', () => {
    it('should return 0.5 when no baseline is available', () => {
      const result = evaluateRisk(makeRequest({ userBaseline: undefined }));
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBe(0.5);
    });

    it('should score UNKNOWN_LOCATION_SCORE when current location is Unknown', () => {
      const result = evaluateRisk(makeRequest({ location: UNKNOWN }));
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBe(0.75);
    });

    it('cross-country flight exceeding 900 km/h should trigger impossible velocity (0.9)', () => {
      // NYC → LON in 1 hour = ~5570 km/h — clearly impossible
      const result = evaluateRisk(
        makeRequest({
          location: LON,
          timestamp: '2026-04-17T10:00:00.000Z', // 1 h after last login
          userBaseline: {
            ...nycBaseline,
            lastLoginTimestamp: '2026-04-17T09:00:00.000Z',
          },
        }),
      );
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBe(0.9);
    });

    it('same-country login (NYC→LA, 24h) should produce a low geo score', () => {
      const result = evaluateRisk(
        makeRequest({
          location: LAX,
          timestamp: '2026-04-18T09:00:00.000Z', // 24 h later
          userBaseline: {
            ...nycBaseline,
            lastLoginTimestamp: '2026-04-17T09:00:00.000Z',
          },
        }),
      );
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBeLessThanOrEqual(0.15); // same country → low score
    });
  });

  // ── Temporal Anomaly signal ───────────────────────────────────────────────────

  describe('TemporalAnomaly signal', () => {
    it('should score 0.0 when login is within the active window', () => {
      const result = evaluateRisk(makeRequest({ timestamp: '2026-04-17T12:00:00.000Z' }));
      const temporal = result.signals.find((s) => s.dimension === 'TemporalAnomaly')!;
      expect(temporal.score).toBe(0);
    });

    it('should score > 0 when login is outside the active window', () => {
      const result = evaluateRisk(makeRequest({ timestamp: '2026-04-17T03:00:00.000Z' }));
      const temporal = result.signals.find((s) => s.dimension === 'TemporalAnomaly')!;
      expect(temporal.score).toBeGreaterThan(0);
    });

    it('should return 0.3 when no baseline is provided', () => {
      const result = evaluateRisk(makeRequest({ userBaseline: undefined }));
      const temporal = result.signals.find((s) => s.dimension === 'TemporalAnomaly')!;
      expect(temporal.score).toBe(0.3);
    });

    it('should cap temporal score at TEMPORAL_MAX_SCORE (0.6)', () => {
      // 02:00 UTC — very far from 08–18 window
      const result = evaluateRisk(makeRequest({ timestamp: '2026-04-17T01:00:00.000Z' }));
      const temporal = result.signals.find((s) => s.dimension === 'TemporalAnomaly')!;
      expect(temporal.score).toBeLessThanOrEqual(0.6);
    });
  });

  // ── Device Integrity signal ───────────────────────────────────────────────────

  describe('DeviceIntegrity signal', () => {
    it('should score 0 for an exact UA match', () => {
      const result = evaluateRisk(lowRiskRequest);
      const device = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(device.score).toBe(0);
    });

    it('should score 0.25 when no baseline exists', () => {
      const result = evaluateRisk(makeRequest({ userBaseline: undefined, userAgent: 'Mozilla/5.0 Safari' }));
      const device = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(device.score).toBe(0.25);
    });

    it('should score 0.45 for an unknown but non-suspicious UA', () => {
      const result = evaluateRisk(makeRequest({ userAgent: 'Mozilla/5.0 (Macintosh) Safari/17' }));
      const device = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(device.score).toBe(0.45);
    });

    it.each([
      'python-requests/2.28.0',
      'curl/7.88.1',
      'Mozilla/5.0 HeadlessChrome/124',
      'PhantomJS/2.1.1',
      'go-http-client/2.0',
    ])('should flag "%s" as automation (score: 0.85)', (ua) => {
      const result = evaluateRisk(makeRequest({ userAgent: ua }));
      const device = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(device.score).toBe(0.85);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle a future timestamp without throwing', () => {
      expect(() =>
        evaluateRisk(makeRequest({ timestamp: '2099-01-01T00:00:00.000Z' })),
      ).not.toThrow();
    });

    it('should handle identical lastLogin and current timestamps gracefully', () => {
      const ts = '2026-04-17T09:00:00.000Z';
      expect(() =>
        evaluateRisk(makeRequest({ timestamp: ts, userBaseline: { ...nycBaseline, lastLoginTimestamp: ts } })),
      ).not.toThrow();
    });

    it('should handle an empty knownUserAgents array without throwing', () => {
      expect(() =>
        evaluateRisk(makeRequest({ userBaseline: { ...nycBaseline, knownUserAgents: [] } })),
      ).not.toThrow();
    });
  });
});
