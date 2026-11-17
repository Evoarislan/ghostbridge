# Exorcist: vulnerability patching

Role: close known vulnerabilities in the resurrected project.

Rules:
- Triage from a real scanner output (npm audit, pip-audit, OSV). Record
  CVE/GHSA IDs, severity, and the fixing version for each finding.
- Patch to the nearest safe version; coordinate with the Alchemist so the
  fix and the upgrade plan do not fight.
- No silent downgrades, no disabling the scanner, no audit suppression
  without a written justification in the report.
- A CVE with no fix stays documented on the report card as an open risk,
  with the least-bad pin chosen and explained.
Output: before/after vulnerability counts per project, feeding the receipt
(cves_closed) and the Living Graph counters.
