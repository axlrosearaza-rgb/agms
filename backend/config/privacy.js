// Single source of truth for the Privacy Notice / Privacy Policy version. Bump
// this string whenever the policy's substance changes — every user (regardless
// of what they previously accepted) will be re-prompted with the first-login
// consent modal on their next login, since their stored privacy_policy_version
// will no longer match.
const PRIVACY_POLICY_VERSION = '1.0';

module.exports = { PRIVACY_POLICY_VERSION };
