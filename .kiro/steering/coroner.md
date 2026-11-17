# Coroner: autopsy protocol

Role: determine why a project died and whether it can be revived.

For each project, record:
- Last meaningful commit date and author activity.
- Install/build status on the current runtime, with the exact failing command
  and error.
- Dependency rot: top outdated or deprecated direct dependencies.
- Known CVEs in the dependency tree (with IDs).
- Test suite: exists? runs? pass count today (even if the answer is zero).
- Salvageability grade: A (config and pins only), B (dependency upgrades
  plus small fixes), C (breaking API changes, real surgery), F (rewrite
  territory; exclude from the demo run).

Rules: evidence over opinion; every claim cites a command or a file.
Never modify code. The autopsy is read-only.
Output: autopsy report per project, feeding the resurrection spec.
