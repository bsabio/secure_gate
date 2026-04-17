import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { AuthRequest } from './types';
import { SecureGateResponse, SecureGateResponseType } from './schema';

// ─── System Prompt ────────────────────────────────────────────────────────────

/**
 * Instructs the model to behave as a Senior Security Architect.
 *
 * The prompt is deliberately precise about:
 * 1. The role and decision authority.
 * 2. The three mandatory analytical dimensions.
 * 3. The strict action-threshold enforcement rule.
 * 4. The exact JSON output shape (matching {@link SecureGateResponse}).
 */
const SYSTEM_PROMPT = `You are a Senior Security Architect operating as the core decision engine
for an enterprise Zero-Trust authentication gateway called Secure-Gate.

Your sole responsibility is to evaluate incoming login attempts and return a
structured JSON risk assessment. You have no other function.

## Analytical Framework

Evaluate EVERY request across ALL THREE dimensions:

### 1. Geographic Velocity
- Compute the great-circle distance between the user's last known login location
  and the current login location.
- Estimate the elapsed time since the last login.
- Derive an implied travel speed (distance ÷ time).
- Flag IMPOSSIBLE VELOCITY if the required speed exceeds 900 km/h (commercial
  jet ceiling). Score: 0.85–0.95.
- Flag CROSS-COUNTRY travel even when speed is plausible. Score: 0.20–0.70.
- Same-country, low-speed travel is LOW RISK. Score: 0.0–0.15.
- Unknown or unresolvable location: Score 0.75.
- No prior baseline available: Score 0.5 (inconclusive).

### 2. Temporal Anomaly
- Identify the user's typical active-hours window (UTC).
- Measure how many hours the current login deviates from that window.
- Penalise 0.08 per hour outside the window, capped at 0.60.
- Within active window: Score 0.0.
- No prior baseline available: Score 0.3.

### 3. Device Integrity
- Exact User-Agent match against known devices: Score 0.0.
- Same browser family, different version (likely auto-update): Score 0.15.
- Unknown UA, no suspicious patterns: Score 0.45.
- Automation / headless patterns (HeadlessChrome, Selenium, PhantomJS,
  python-requests, curl, Playwright, Puppeteer, go-http-client): Score 0.85.
- No prior device baseline: Score 0.25.

## Scoring

Aggregate riskScore = (GeographicVelocity × 0.45) + (TemporalAnomaly × 0.25) + (DeviceIntegrity × 0.30)
Round to 4 decimal places.

## Strict Action Threshold Rule — THIS IS NON-NEGOTIABLE

| riskScore        | action      |
|------------------|-------------|
| > 0.7            | BLOCK       |
| ≥ 0.4 and ≤ 0.7  | CHALLENGE   |
| < 0.4            | ALLOW       |

Violating this rule is a critical security defect. Always enforce it exactly.

## Output

You MUST respond ONLY with a valid JSON object conforming to the SecureGateResponse schema.
Do NOT include any preamble, explanation, or markdown outside the JSON object.`;

// ─── Request Serializer ────────────────────────────────────────────────────────

/**
 * Converts an {@link AuthRequest} into a structured prompt string that gives
 * the model all the context it needs to perform the three-dimensional analysis.
 */
function buildUserPrompt(request: AuthRequest): string {
  const baseline = request.userBaseline;

  const locationSummary = request.location.label === 'Unknown'
    ? 'Unknown (geolocation resolution failed)'
    : `${request.location.label} (${request.location.countryCode}) — lat: ${request.location.lat}, lon: ${request.location.lon}`;

  const baselineSummary = baseline
    ? `
Last Login Location : ${baseline.lastLoginLocation.label} (${baseline.lastLoginLocation.countryCode}) — lat: ${baseline.lastLoginLocation.lat}, lon: ${baseline.lastLoginLocation.lon}
Last Login Time     : ${baseline.lastLoginTimestamp}
Active Hours (UTC)  : ${baseline.typicalActiveHoursUTC[0]}:00 – ${baseline.typicalActiveHoursUTC[1]}:00
Known User-Agents   : ${baseline.knownUserAgents.length > 0 ? baseline.knownUserAgents.join(' | ') : '(none on record)'}`.trim()
    : '(No historical baseline — first login or baseline unavailable)';

  return `
## Incoming Authentication Attempt

IP Address          : ${request.ip}
User-Agent          : ${request.userAgent}
Current Location    : ${locationSummary}
Attempt Timestamp   : ${request.timestamp}

## User Historical Baseline

${baselineSummary}

Evaluate this attempt using all three analytical dimensions and return your SecureGateResponse JSON.
`.trim();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Options for {@link evaluateAuthAttempt}.
 */
export interface EvaluateOptions {
  /**
   * Override the default language model. Accepts any `LanguageModelV3`-compatible
   * instance, including `MockLanguageModelV3` from `ai/test`.
   *
   * Defaults to `openai('gpt-4o-mini')` when not provided.
   */
  model?: LanguageModelV3;
}

/**
 * **Secure-Gate AI Agent Entry Point**
 *
 * Submits an {@link AuthRequest} to a language model acting as a Senior Security
 * Architect and returns a fully-typed, schema-validated {@link SecureGateResponseType}.
 *
 * The model is instructed to apply a three-dimensional behavioral analysis:
 * - **Geographic Velocity** — Haversine-based travel speed check.
 * - **Temporal Anomaly** — Active-hours deviation penalty.
 * - **Device Integrity** — UA fingerprint and automation detection.
 *
 * The Vercel AI SDK's `generateObject` enforces that the response exactly matches
 * the {@link SecureGateResponse} Zod schema — the call throws if the model returns
 * a non-conforming payload.
 *
 * @param request - The incoming authentication attempt to evaluate.
 * @param options - Optional overrides (e.g., a mock model for unit testing).
 * @returns A promise resolving to a validated {@link SecureGateResponseType}.
 *
 * @example
 * ```typescript
 * const result = await evaluateAuthAttempt({
 *   ip: '1.2.3.4',
 *   userAgent: 'Mozilla/5.0 Chrome/124.0',
 *   location: { label: 'Tokyo, JP', lat: 35.6895, lon: 139.6917, countryCode: 'JP' },
 *   timestamp: new Date().toISOString(),
 * });
 * console.log(result.action); // 'ALLOW' | 'CHALLENGE' | 'BLOCK'
 * ```
 */
export async function evaluateAuthAttempt(
  request: AuthRequest,
  options: EvaluateOptions = {},
): Promise<SecureGateResponseType> {
  const model = options.model ?? openai('gpt-4o-mini');

  const { object } = await generateObject({
    model,
    schema: SecureGateResponse,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(request),
  });

  return object;
}
