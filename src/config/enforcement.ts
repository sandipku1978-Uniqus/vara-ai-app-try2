/**
 * The enforcement route reads two official SEC indexes: the litigation-release
 * index (civil actions) and the Accounting and Auditing Enforcement Release
 * (AAER) index. Route-level copy names both; the litigation tab's own copy
 * (the SCOPE constants) stays specific to the litigation-release index. Keep
 * every surface explicit about these source contracts.
 */

/** The /enforcement route: navigation label, page title, palette entry. */
export const ENFORCEMENT_ROUTE_LABEL = 'SEC Litigation Releases & AAERs';

export const ENFORCEMENT_ROUTE_KEYWORDS =
  'litigation releases civil actions aaer aaers accounting and auditing enforcement releases';

export const ENFORCEMENT_ROUTE_DESCRIPTION =
  'Official SEC litigation releases covering civil actions filed by the Commission, and Accounting and Auditing Enforcement Releases (AAERs) for actions involving accountants, auditors and financial reporting.';

export const ENFORCEMENT_ROUTE_LOADING_LABEL = 'Loading SEC litigation releases and AAERs';

/** Route-level limits: what neither index covers. */
export const ENFORCEMENT_ROUTE_LIMITATION =
  'Coverage is limited to the SEC litigation-release and AAER indexes; other administrative proceedings and trading suspensions are not included.';

/** The litigation-release tab. */
export const ENFORCEMENT_SCOPE_LABEL = 'SEC Litigation Releases';

export const ENFORCEMENT_SCOPE_DESCRIPTION =
  'Official SEC litigation releases covering civil actions filed by the Commission.';

export const ENFORCEMENT_SCOPE_LIMITATION =
  'Coverage is limited to the SEC litigation-release index; it does not include administrative proceedings or trading suspensions.';

export const ENFORCEMENT_LANDING_CAPABILITY = 'SEC litigation releases, civil actions and AAERs';
