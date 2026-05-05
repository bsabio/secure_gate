import { z } from 'zod';

// ─── Shared Geo/Baseline Types ────────────────────────────────────────────────

export interface GeoLocation {
  label: string;
  lat: number;
  lon: number;
  countryCode: string;
}

export interface UserBaseline {
  lastLoginLocation: GeoLocation;
  lastLoginTimestamp: string;
  typicalActiveHoursUTC: [number, number];
  knownUserAgents: string[];
}

export interface AuthRequest {
  ip: string;
  userAgent: string;
  location: GeoLocation;
  timestamp: string;
  userBaseline?: UserBaseline;
}

// ─── SecureGate Response Schema (Zod) ────────────────────────────────────────

export const SecureGateResponse = z.object({
  riskScore: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  action: z.enum(['ALLOW', 'CHALLENGE', 'BLOCK']),
  signals: z
    .array(
      z.object({
        dimension: z.enum(['GeographicVelocity', 'TemporalAnomaly', 'DeviceIntegrity']),
        score: z.number().min(0).max(1),
        finding: z.string().min(1),
      }),
    )
    .length(3),
});

export type SecureGateResponseType = z.infer<typeof SecureGateResponse>;

// ─── API Payloads ────────────────────────────────────────────────────────────

export interface EvaluateRequestBody {
  request: AuthRequest;
  scenario?: string;
}

export interface EvaluateResponseBody {
  result: SecureGateResponseType;
  durationMs: number;
}
