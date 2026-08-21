# Adversarial behavior lens

Try to falsify the happy path. A finding needs a reproducible sequence or clear invariant violation.

Probe:

- empty, missing, malformed, stale, and unauthorized route parameters;
- initial auth restoration, sign-in/sign-out mid-request, session expiry, and account switching;
- double taps, repeated submissions, retries, out-of-order completions, and concurrent devices;
- reconnects, app background/foreground, process restart, and partial external failures;
- query `undefined` versus `null` versus empty results and errors;
- records deleted or changed while a screen is open;
- large histories, pagination boundaries, duplicate items, and unstable ordering;
- timezone, locale, daylight-saving, clock-skew, Unicode, and long-text assumptions;
- permission denial, missing native capability, and platform divergence;
- optimistic updates that fail or roll back;
- destructive operations invoked twice or after state has changed.

Prefer boundary scenarios introduced or materially affected by the target. Do not turn every hypothetical into a finding.
