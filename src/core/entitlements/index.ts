/**
 * Entitlements (PRD §34).
 *
 * Monetization is explicitly not central to the initial build, and there is no
 * paywall. What matters architecturally is that the *check* exists at exactly one
 * boundary — AI imports — so that adding a real plan later does not mean threading
 * billing state through the app.
 *
 * Nothing outside the import flow imports this module. Manually created workouts and
 * the workout player are never gated.
 */

export * from './usage';

export type Plan = 'free' | 'pro';

export interface Entitlements {
  plan: Plan;
  /** null means unlimited. */
  monthlyAiImportLimit: number | null;
}

export const FREE_ENTITLEMENTS: Entitlements = { plan: 'free', monthlyAiImportLimit: null };
export const PRO_ENTITLEMENTS: Entitlements = { plan: 'pro', monthlyAiImportLimit: null };

export interface EntitlementService {
  current(): Entitlements;
  canImport(importsThisMonth: number): boolean;
}

/**
 * The MVP adapter.
 *
 * The free tier's limit is deliberately null, so nothing is gated today: per PRD §34
 * we do not put a paywall in front of behaviour we have not validated yet.
 *
 * What is *not* stubbed is the counting. `canImport` receives a real number of
 * imports used this month, so introducing a limit is a one-line change to
 * `FREE_ENTITLEMENTS` rather than a feature to build under time pressure — and the
 * usage data needed to choose that number is already being collected.
 */
export class PlanEntitlements implements EntitlementService {
  constructor(private readonly plan: Entitlements = FREE_ENTITLEMENTS) {}

  current(): Entitlements {
    return this.plan;
  }

  canImport(importsThisMonth: number): boolean {
    const limit = this.current().monthlyAiImportLimit;
    return limit === null || importsThisMonth < limit;
  }

  /** How many are left, or null when unlimited. Drives what the UI can say. */
  remaining(importsThisMonth: number): number | null {
    const limit = this.current().monthlyAiImportLimit;
    return limit === null ? null : Math.max(0, limit - importsThisMonth);
  }
}

export const entitlements = new PlanEntitlements();
