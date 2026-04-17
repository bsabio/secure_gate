/**
 * @file agent.test.ts
 *
 * Unit tests for {@link evaluateAuthAttempt}.
 *
 * All tests use `MockLanguageModelV3` from `ai/test` — no real OpenAI API key
 * is needed. The mock is injected via the `options.model` override so the
 * function under test remains identical to production usage.
 */

import { MockLanguageModelV3 } from 'ai/test';
import { evaluateAuthAttempt } from './agent';
import { SecureGateResponseType } from './schema';
import { AuthRequest, GeoLocation, UserBaseline } from './types';

// ─── Shared Geo Fixtures ──────────────────────────────────────────────────────

const NYC: GeoLocation = {
  label: 'New York, US',
  lat: 40.7128,
  lon: -74.006,
  countryCode: 'US',
};

const LON: GeoLocation = {
  label: 'London, UK',
  lat: 51.5074,
  lon: -0.1278,
  countryCode: 'GB',
};

const UNKNOWN_LOC: GeoLocation = {
  label: 'Unknown',
  lat: 0,
  lon: 0,
  countryCode: '',
};

// ─── Shared Baseline ──────────────────────────────────────────────────────────

const nycBaseline: UserBaseline = {
  lastLoginLocation: NYC,
  lastLoginTimestamp: '2026-04-17T09:00:00.000Z',
  typicalActiveHoursUTC: [8, 18],
  knownUserAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
  ],
};

// ─── Base Request ─────────────────────────────────────────────────────────────

const lowRiskRequest: AuthRequest = {
  ip: '192.168.1.100',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
  location: NYC,
  timestamp: '2026-04-17T10:00:00.000Z',
  userBaseline: nycBaseline,
};

// ─── Mock Factory ─────────────────────────────────────────────────────────────

/**
 * Builds a `MockLanguageModelV3` that returns the given payload as a
 * JSON text block. The `generateObject` call will parse and validate it
 * against the `SecureGateResponse` Zod schema.
 */
function mockModel(payload: SecureGateResponseType): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens:  { total: 50, noCache: 50, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 30, text: 30, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

// ─── Canonical Payloads ───────────────────────────────────────────────────────

const ALLOW_RESPONSE: SecureGateResponseType = {
  riskScore: 0.0,
  reasoning:
    'Geo: exact same location (score 0.0). Temporal: within active hours (score 0.0). Device: known UA match (score 0.0). Aggregate: 0.0 → ALLOW.',
  action: 'ALLOW',
  signals: [
    { dimension: 'GeographicVelocity', score: 0.0, finding: 'Same location as last login.' },
    { dimension: 'TemporalAnomaly',    score: 0.0, finding: 'Within user active hours (08:00–18:00 UTC).' },
    { dimension: 'DeviceIntegrity',    score: 0.0, finding: 'Exact User-Agent match on record.' },
  ],
};

const CHALLENGE_RESPONSE: SecureGateResponseType = {
  riskScore: 0.565,
  reasoning:
    'Geo: cross-country login (US→GB) with plausible speed (score 0.7). Temporal: within window (score 0.0). Device: known UA family (score 0.15). Aggregate: 0.565 → CHALLENGE.',
  action: 'CHALLENGE',
  signals: [
    { dimension: 'GeographicVelocity', score: 0.7,  finding: 'Cross-country login (US → GB); speed within limits.' },
    { dimension: 'TemporalAnomaly',    score: 0.0,  finding: 'Within active hours.' },
    { dimension: 'DeviceIntegrity',    score: 0.15, finding: 'Browser family known; version changed — likely update.' },
  ],
};

const BLOCK_RESPONSE: SecureGateResponseType = {
  riskScore: 0.8825,
  reasoning:
    'Geo: impossible velocity NYC→LON at same timestamp (score 0.95). Temporal: within window (score 0.0). Device: python-requests automation UA (score 0.85). Aggregate: 0.8825 → BLOCK.',
  action: 'BLOCK',
  signals: [
    { dimension: 'GeographicVelocity', score: 0.95, finding: 'Impossible velocity: NYC → London in 0 hours.' },
    { dimension: 'TemporalAnomaly',    score: 0.0,  finding: 'Within active hours.' },
    { dimension: 'DeviceIntegrity',    score: 0.85, finding: 'Automation fingerprint: python-requests/2.28.0.' },
  ],
};

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('evaluateAuthAttempt — Vercel AI SDK agent (mock provider)', () => {

  // ── Output contract ─────────────────────────────────────────────────────────

  describe('SecureGateResponse schema contract', () => {
    it('should resolve to a well-formed SecureGateResponseType for an ALLOW scenario', async () => {
      const result = await evaluateAuthAttempt(lowRiskRequest, {
        model: mockModel(ALLOW_RESPONSE),
      });
      expect(typeof result.riskScore).toBe('number');
      expect(typeof result.reasoning).toBe('string');
      expect(['ALLOW', 'CHALLENGE', 'BLOCK']).toContain(result.action);
      expect(Array.isArray(result.signals)).toBe(true);
      expect(result.signals).toHaveLength(3);
    });

    it('riskScore should be a finite float between 0 and 1', async () => {
      const result = await evaluateAuthAttempt(lowRiskRequest, {
        model: mockModel(ALLOW_RESPONSE),
      });
      expect(Number.isFinite(result.riskScore)).toBe(true);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(1);
    });

    it('signals should contain all three required dimensions', async () => {
      const result = await evaluateAuthAttempt(lowRiskRequest, {
        model: mockModel(CHALLENGE_RESPONSE),
      });
      const dims = result.signals.map((s) => s.dimension);
      expect(dims).toContain('GeographicVelocity');
      expect(dims).toContain('TemporalAnomaly');
      expect(dims).toContain('DeviceIntegrity');
    });

    it('each signal score should be a number between 0 and 1', async () => {
      const result = await evaluateAuthAttempt(lowRiskRequest, {
        model: mockModel(BLOCK_RESPONSE),
      });
      for (const signal of result.signals) {
        expect(signal.score).toBeGreaterThanOrEqual(0);
        expect(signal.score).toBeLessThanOrEqual(1);
      }
    });

    it('reasoning should be a non-empty string', async () => {
      const result = await evaluateAuthAttempt(lowRiskRequest, {
        model: mockModel(ALLOW_RESPONSE),
      });
      expect(result.reasoning.length).toBeGreaterThan(0);
    });
  });

  // ── ALLOW path ──────────────────────────────────────────────────────────────

  describe('ALLOW path', () => {
    it('should return ALLOW for a zero-risk trusted session', async () => {
      const result = await evaluateAuthAttempt(lowRiskRequest, {
        model: mockModel(ALLOW_RESPONSE),
      });
      expect(result.action).toBe('ALLOW');
      expect(result.riskScore).toBeLessThan(0.4);
    });

    it('should surface all three zero-score signals', async () => {
      const result = await evaluateAuthAttempt(lowRiskRequest, {
        model: mockModel(ALLOW_RESPONSE),
      });
      for (const signal of result.signals) {
        expect(signal.score).toBe(0);
      }
    });
  });

  // ── CHALLENGE path ──────────────────────────────────────────────────────────

  describe('CHALLENGE path', () => {
    it('should return CHALLENGE for a cross-country session within travel limits', async () => {
      const result = await evaluateAuthAttempt(
        { ...lowRiskRequest, location: LON },
        { model: mockModel(CHALLENGE_RESPONSE) },
      );
      expect(result.action).toBe('CHALLENGE');
      expect(result.riskScore).toBeGreaterThanOrEqual(0.4);
      expect(result.riskScore).toBeLessThanOrEqual(0.7);
    });

    it('GeographicVelocity signal should be elevated for a cross-country login', async () => {
      const result = await evaluateAuthAttempt(
        { ...lowRiskRequest, location: LON },
        { model: mockModel(CHALLENGE_RESPONSE) },
      );
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBeGreaterThan(0);
    });
  });

  // ── BLOCK path ──────────────────────────────────────────────────────────────

  describe('BLOCK path', () => {
    it('should return BLOCK for an impossible-velocity + automation combo', async () => {
      const result = await evaluateAuthAttempt(
        {
          ip: '0.0.0.0',
          userAgent: 'python-requests/2.28.0',
          location: LON,
          timestamp: '2026-04-17T09:00:00.000Z',
          userBaseline: nycBaseline,
        },
        { model: mockModel(BLOCK_RESPONSE) },
      );
      expect(result.action).toBe('BLOCK');
      expect(result.riskScore).toBeGreaterThan(0.7);
    });

    it('impossible-velocity signal should score 0.95', async () => {
      const result = await evaluateAuthAttempt(
        { ...lowRiskRequest, location: LON },
        { model: mockModel(BLOCK_RESPONSE) },
      );
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBe(0.95);
    });

    it('automation UA signal should score 0.85', async () => {
      const result = await evaluateAuthAttempt(
        { ...lowRiskRequest, userAgent: 'python-requests/2.28.0' },
        { model: mockModel(BLOCK_RESPONSE) },
      );
      const device = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(device.score).toBe(0.85);
    });
  });

  // ── Action-threshold enforcement ─────────────────────────────────────────────

  describe('action-threshold enforcement', () => {
    it.each<[string, SecureGateResponseType]>([
      ['ALLOW response',     ALLOW_RESPONSE],
      ['CHALLENGE response', CHALLENGE_RESPONSE],
      ['BLOCK response',     BLOCK_RESPONSE],
    ])('action must be consistent with riskScore for %s', async (_label, payload) => {
      const result = await evaluateAuthAttempt(lowRiskRequest, {
        model: mockModel(payload),
      });
      if (result.riskScore > 0.7)       expect(result.action).toBe('BLOCK');
      else if (result.riskScore >= 0.4) expect(result.action).toBe('CHALLENGE');
      else                              expect(result.action).toBe('ALLOW');
    });
  });

  // ── No-baseline handling ─────────────────────────────────────────────────────

  describe('no-baseline handling', () => {
    const noBaselineResponse: SecureGateResponseType = {
      riskScore: 0.3275,
      reasoning: 'No baseline: Geo inconclusive (0.5), Temporal inconclusive (0.3), Device unknown (0.25). Aggregate: 0.3275 → ALLOW.',
      action: 'ALLOW',
      signals: [
        { dimension: 'GeographicVelocity', score: 0.5,  finding: 'No historical baseline; geographic velocity inconclusive.' },
        { dimension: 'TemporalAnomaly',    score: 0.3,  finding: 'No historical baseline; temporal pattern inconclusive.' },
        { dimension: 'DeviceIntegrity',    score: 0.25, finding: 'No known device baseline; UA unverified but not suspicious.' },
      ],
    };

    it('should handle a request with no userBaseline without throwing', async () => {
      const requestWithoutBaseline: AuthRequest = {
        ip: '10.0.0.1',
        userAgent: 'Mozilla/5.0 Safari/17',
        location: NYC,
        timestamp: '2026-04-17T12:00:00.000Z',
      };
      await expect(
        evaluateAuthAttempt(requestWithoutBaseline, {
          model: mockModel(noBaselineResponse),
        }),
      ).resolves.toBeDefined();
    });

    it('should return inconclusive-scored signals when no baseline is present', async () => {
      const requestWithoutBaseline: AuthRequest = {
        ip: '10.0.0.1',
        userAgent: 'Mozilla/5.0 Safari/17',
        location: NYC,
        timestamp: '2026-04-17T12:00:00.000Z',
      };
      const result = await evaluateAuthAttempt(requestWithoutBaseline, {
        model: mockModel(noBaselineResponse),
      });
      const geo     = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      const temporal = result.signals.find((s) => s.dimension === 'TemporalAnomaly')!;
      const device  = result.signals.find((s) => s.dimension === 'DeviceIntegrity')!;
      expect(geo.score).toBe(0.5);
      expect(temporal.score).toBe(0.3);
      expect(device.score).toBe(0.25);
    });
  });

  // ── Unknown location handling ────────────────────────────────────────────────

  describe('unknown location handling', () => {
    const unknownLocResponse: SecureGateResponseType = {
      riskScore: 0.4125,
      reasoning: 'Geo: unknown location (score 0.75). Temporal: within window (score 0.0). Device: exact UA match (score 0.0). Aggregate: 0.4125 → CHALLENGE.',
      action: 'CHALLENGE',
      signals: [
        { dimension: 'GeographicVelocity', score: 0.75, finding: 'Current geolocation could not be resolved.' },
        { dimension: 'TemporalAnomaly',    score: 0.0,  finding: 'Within active hours.' },
        { dimension: 'DeviceIntegrity',    score: 0.0,  finding: 'Exact User-Agent match.' },
      ],
    };

    it('should CHALLENGE when current location is Unknown', async () => {
      const result = await evaluateAuthAttempt(
        { ...lowRiskRequest, location: UNKNOWN_LOC },
        { model: mockModel(unknownLocResponse) },
      );
      expect(result.action).toBe('CHALLENGE');
    });

    it('GeographicVelocity signal should score 0.75 for unknown location', async () => {
      const result = await evaluateAuthAttempt(
        { ...lowRiskRequest, location: UNKNOWN_LOC },
        { model: mockModel(unknownLocResponse) },
      );
      const geo = result.signals.find((s) => s.dimension === 'GeographicVelocity')!;
      expect(geo.score).toBe(0.75);
    });
  });

  // ── Mock model injection ─────────────────────────────────────────────────────

  describe('model injection', () => {
    it('should accept any LanguageModelV3-compatible mock without type errors', async () => {
      const customMock = new MockLanguageModelV3({
        doGenerate: {
          content: [{ type: 'text', text: JSON.stringify(ALLOW_RESPONSE) }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens:  { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        },
      });
      const result = await evaluateAuthAttempt(lowRiskRequest, { model: customMock });
      expect(result.action).toBe('ALLOW');
    });

    it('doGenerateCalls should record the call made by evaluateAuthAttempt', async () => {
      const trackedMock = new MockLanguageModelV3({
        doGenerate: {
          content: [{ type: 'text', text: JSON.stringify(ALLOW_RESPONSE) }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens:  { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        },
      });
      await evaluateAuthAttempt(lowRiskRequest, { model: trackedMock });
      expect(trackedMock.doGenerateCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
