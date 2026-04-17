import { z } from 'zod';

// ─── Zod Schema ───────────────────────────────────────────────────────────────

/**
 * The action the Secure-Gate engine must take after evaluating a session.
 *
 * Strict thresholds (enforced by the model's system prompt):
 * - `'BLOCK'`     — riskScore > 0.7
 * - `'CHALLENGE'` — riskScore ≥ 0.4 and ≤ 0.7
 * - `'ALLOW'`     — riskScore < 0.4
 */
export const ActionSchema = z.enum(['ALLOW', 'CHALLENGE', 'BLOCK']).describe(
  "Security decision: 'BLOCK' if riskScore > 0.7, 'CHALLENGE' if 0.4–0.7, 'ALLOW' if < 0.4",
);

/**
 * A single analytical signal output by one dimension of the risk engine.
 */
export const RiskSignalSchema = z.object({
  /** Which analytical dimension produced this signal */
  dimension: z
    .enum(['GeographicVelocity', 'TemporalAnomaly', 'DeviceIntegrity'])
    .describe('The analytical dimension that produced this signal'),

  /** Contribution of this signal to the aggregate risk score (0.0 – 1.0) */
  score: z
    .number()
    .min(0)
    .max(1)
    .describe('Signal score between 0.0 (no risk) and 1.0 (maximum risk)'),

  /** Human-readable technical finding for this dimension */
  finding: z
    .string()
    .min(1)
    .describe('Technical explanation of the finding for this dimension'),
});

/**
 * **SecureGateResponse** — the canonical structured output contract for the
 * Secure-Gate AI agent. Every field is required and validated.
 *
 * This schema is shared between:
 * - `agent.ts`  (passed to `generateObject` as the extraction target)
 * - `agent.test.ts` (used to validate mock model responses)
 */
export const SecureGateResponse = z.object({
  /**
   * Aggregate risk score: a float between 0.0 (no risk) and 1.0 (maximum risk).
   * Derived as the weighted mean of all per-dimension signal scores.
   */
  riskScore: z
    .number()
    .min(0)
    .max(1)
    .describe('Aggregate risk score between 0.0 and 1.0'),

  /**
   * Technical narrative explaining how the aggregate score was reached,
   * referencing each analytical dimension and its contribution.
   */
  reasoning: z
    .string()
    .min(1)
    .describe(
      'Technical explanation of the risk assessment covering all three analytical dimensions',
    ),

  /**
   * The security action to enforce based on the aggregate risk score.
   * Must strictly follow the threshold rules defined in ActionSchema.
   */
  action: ActionSchema,

  /**
   * Per-dimension breakdown for audit trails and logging.
   * Must always contain exactly three entries: one per analytical dimension.
   */
  signals: z
    .array(RiskSignalSchema)
    .length(3)
    .describe('Exactly three per-dimension signals: GeographicVelocity, TemporalAnomaly, DeviceIntegrity'),
});

/** TypeScript type inferred from the Zod schema — use this in function signatures. */
export type SecureGateResponseType = z.infer<typeof SecureGateResponse>;
