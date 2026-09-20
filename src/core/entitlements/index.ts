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
 * The MVP adapter: everything is allowed.
 *
 * The free tier's limit is deliberately null today. Per PRD §34 we do not gate
 * before repeated import → workout behaviour has been validated; flipping this to a
 * number is the entire change required to introduce one.
 */
export class AlwaysAllowEntitlements implements EntitlementService {
  current(): Entitlements {
    return FREE_ENTITLEMENTS;
  }
  canImport(importsThisMonth: number): boolean {
    const limit = this.current().monthlyAiImportLimit;
    return limit === null || importsThisMonth < limit;
  }
}

export const entitlements: EntitlementService = new AlwaysAllowEntitlements();
