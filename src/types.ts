/**
 * Geographic coordinate pair used to calculate travel velocity between sessions.
 */
export interface GeoLocation {
  /** Human-readable city/region label */
  label: string;
  /** Decimal latitude */
  lat: number;
  /** Decimal longitude */
  lon: number;
  /** ISO 3166-1 alpha-2 country code (e.g. 'US', 'CN') */
  countryCode: string;
}

/**
 * Snapshot of the user's last known good session, used as the behavioral baseline.
 */
export interface UserBaseline {
  /** Location of the user's most recent successful login */
  lastLoginLocation: GeoLocation;
  /** ISO 8601 timestamp of the most recent successful login */
  lastLoginTimestamp: string;
  /**
   * The user's typical active-hours window expressed as UTC hours [start, end].
   * Example: [8, 18] means the user normally logs in between 08:00–18:00 UTC.
   */
  typicalActiveHoursUTC: [number, number];
  /** Known good User-Agent strings for this account */
  knownUserAgents: string[];
}

/**
 * Represents an incoming authentication request with full contextual metadata
 * sufficient for multi-signal behavioral analysis.
 */
export interface AuthRequest {
  /** The originating IP address of the request */
  ip: string;
  /** The User-Agent string from the client's HTTP headers */
  userAgent: string;
  /** Resolved geolocation of the current request */
  location: GeoLocation;
  /** ISO 8601 timestamp of when the request was received */
  timestamp: string;
  /**
   * Historical baseline for this user account.
   * When undefined the engine has no prior context and weights signals conservatively.
   */
  userBaseline?: UserBaseline;
}

/**
 * A single analytical signal produced by one dimension of the risk engine.
 */
export interface RiskSignal {
  /** Short label identifying the analysis dimension */
  dimension: 'GeographicVelocity' | 'TemporalAnomaly' | 'DeviceIntegrity';
  /** Contribution of this signal to the aggregate risk score (0.0 – 1.0) */
  score: number;
  /** Human-readable explanation of this signal's finding */
  finding: string;
}

/**
 * The structured output produced by the Secure-Gate risk evaluation engine.
 *
 * - `riskScore`: Aggregate normalized value between 0.0 (no risk) and 1.0 (maximum risk).
 * - `reasoning`: Technical narrative explaining how the score was derived.
 * - `action`:
 *   - `'ALLOW'`     — riskScore < 0.4  → Request passes with no friction.
 *   - `'CHALLENGE'` — 0.4 ≤ riskScore ≤ 0.7 → Requires additional verification (MFA / CAPTCHA).
 *   - `'BLOCK'`     — riskScore > 0.7  → Request denied outright.
 * - `signals`: Individual per-dimension scores for audit/logging purposes.
 */
export type EvaluationResult = {
  riskScore: number;
  reasoning: string;
  action: 'ALLOW' | 'CHALLENGE' | 'BLOCK';
  signals: RiskSignal[];
};
