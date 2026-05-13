import { z } from 'zod';

// ─── Shared Geo/Baseline Types ────────────────────────────────────────────────

export const GeoLocationSchema = z.object({
  label: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  countryCode: z.string().max(2),
});

export const UserBaselineSchema = z.object({
  lastLoginLocation: GeoLocationSchema,
  lastLoginTimestamp: z.string().min(1),
  typicalActiveHoursUTC: z.tuple([
    z.number().int().min(0).max(23),
    z.number().int().min(0).max(23),
  ]),
  knownUserAgents: z.array(z.string().min(1)),
});

export const AuthRequestSchema = z.object({
  ip: z.string().min(1),
  userAgent: z.string().min(1),
  location: GeoLocationSchema,
  timestamp: z.string().min(1),
  userBaseline: UserBaselineSchema.optional(),
});

export type GeoLocation = z.infer<typeof GeoLocationSchema>;
export type UserBaseline = z.infer<typeof UserBaselineSchema>;
export type AuthRequest = z.infer<typeof AuthRequestSchema>;

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

export const EvaluateRequestSchema = z.object({
  request: AuthRequestSchema,
  scenario: z.string().min(1).optional(),
});

export type EvaluateRequestBody = z.infer<typeof EvaluateRequestSchema>;

export interface EvaluateResponseBody {
  result: SecureGateResponseType;
  durationMs: number;
}
