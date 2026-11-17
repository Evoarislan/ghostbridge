# GhostBridge: Session 3 Result (Phase 2: drop-in shim + README positioning)

## Built

- `bin/phantomjs` (executable, Node shebang). It spawns `node gb-host.js <args>` with `stdio: 'inherit'`, so script arguments, `system.args`, and console output (stdout and stderr) pass through unchanged. It forwards SIGINT/SIGTERM/SIGHUP to the child and exits with the child's exit code (128+n if the child dies on a signal). If the host cannot be launched it prints `phantomjs: failed to launch GhostBridge host: ...` to stderr and exits 1.
- `package.json`: `"bin": {"phantomjs": "bin/phantomjs"}`. `package-lock.json`: the root entry's stale `bin` block (`ghostbridge`, `phantomjs: bin/phantomjs.js`, neither file existing) now reads `phantomjs: bin/phantomjs`, matching package.json.
- Gate (`.kiro/hooks/scripts/run-tests.sh`): syntax check of `bin/phantomjs`; the shim runs listed below; an md5 check of the three examples.
- README: opening sentence and tagline verbatim, "The family" section with "Eight ghosts. One bridge.", "Examples: UNCHANGED" section with the three md5s, shim usage and layout entry.

## Parity through the shim

Run against the local test page (`proofs/serve-test-page.js`), outputs and exit codes:

| Run | Result through `./bin/phantomjs` | Session 2 result |
| --- | --- | --- |
| `examples/loadspeed.js <url>` | `Page title is GhostBridge Loadspeed Test Page`, `Loading time 326 msec`, exit 0 | same text, exit 0 |
| `examples/rasterize.js <url> r.png` | exit 0, PNG header, 13679 bytes | exit 0, PNG, size > 1000 |
| `examples/rasterize.js <url> r.pdf A4` | exit 0, `%PDF-` header, 16898 bytes | exit 0, PDF, size > 1000 |
| `examples/injectme.js` | both Phantom-context lines, `Script running in the Page context.`, `... done injecting itself!`, exit 0 | same lines, exit 0 |
| `test/exit-code.js` | exit 7, post-exit line not printed | exit 7 |
| `test/require-test.js alpha beta` | `system.args: [".../require-test.js","alpha","beta"]`, `phantom.args: ["alpha","beta"]`, also from cwd `/tmp` | same |
| `nope.js` (missing) | stderr `cannot read script`, exit 1, no hang | same as gb-host |
| no arguments | stderr usage line, exit 1 | same as gb-host |

Session 2 comparison is on exit codes and the gate's conditions (Session 2 did not record byte sizes for the PNG/PDF, so the sizes above are not compared to earlier values). Pixel content is not checked. Error text still says `ghostbridge:` (it comes from gb-host, unchanged).

## Gate

Default environment (no TMPDIR/GB_TEST_LOG overrides; `/tmp` had space this time): `bash .kiro/hooks/scripts/run-tests.sh` gave **ALL TESTS PASS**, exit 0, **28 checks** (19 before, plus 9 new: syntax `bin/phantomjs`, shim loadspeed, shim rasterize png, shim rasterize pdf, shim injectme, shim exit code 7, shim args passthrough, shim missing script, examples md5). Runtime about 38 s.

## Not done / caveats

- `--version` is not implemented. Real phantomjs prints a version; I did not invent one. Tasks.md Phase 2 bullet 1 is therefore PARTIAL and stays unchecked (it also asks for placement at phantomjs-prebuilt's exported binary path, which needs that package). Bullets 2 (phantomjs-prebuilt's smoke tests) and 3 (Proof of Life + receipt) are not started.
- Piping the shim into a command that closes early (`... | head -5`) makes gb-host crash with an unhandled `EPIPE` on stdout (gb-host.js `handleChannel`, the stdout write). This is existing gb-host behavior, now visible through the shim. Not changed (out of scope); worth a small fix later.
- The md5 gate check proves the three files match the recorded hashes. It does not compare to upstream at run time. The claim "byte-identical to upstream" rests on the Session 2 fetch comparison.
- Run-tests-on-change hook matcher still omits `gb-fs.js`, `gb-page.js` and now `bin/phantomjs` (noted in tasks.md; not changed).
- Untracked `CHAMBER-BRIEF.md` and `SESSION-3-PROMPT-1.txt` existed before this session and are not part of this commit.

## Open question: fs relative-path base (no behavior change made)

Current: relative paths in `fs` (and `render`, `injectJs`) resolve against the script's directory; `fs.workingDirectory` returns the process cwd. Real PhantomJS resolves against the process cwd.

**Recommendation: switch the default to the working directory (cwd), keep injectJs/`require` of local modules script-relative.**

Risk if we keep script-relative:
- Any script doing `fs.write('out.txt', ...)` or `page.render('shot.png')` run from another directory writes next to the script, not where the user ran it. Callers that run `phantomjs /abs/path/script.js` from a project root (the usual pattern for html-pdf, node-webshot, casperjs wrappers) will look for output in cwd and not find it. This is the likelier real-world break in the family.
- `fs.workingDirectory` and the actual base disagree, which the Session 2 notes already flag.

Risk if we switch to cwd:
- Scripts that were only ever run as `phantomjs script.js` from their own directory are unaffected. Scripts that read sibling files relying on our current behavior (our own tests, e.g. `test/fs-test.js`, and anything written during Sessions 1-2 that assumed script-relative) break when run from elsewhere. The gate runs from the repo root, so tests that use script-relative names would need checking.
- Outputs land in cwd, which may be unwritable for some callers (the failure would then match real PhantomJS).

Suggested plan for a later session: change the base to cwd for `fs.*` and `page.render`, leave `phantom.injectJs`/`require` search order as is (real PhantomJS searches the script's library path and cwd), then run the gate from the repo root and from a different cwd. Needs your go-ahead since it changes behavior.
