# node-webshot: RESURRECTED, scoped (Session 9, 2026-11-22)

Package: `node-webshot` **1.0.4**, published **2020-05-30** (npm registry
`time` field; `npm view node-webshot@1.0.4 time`). Repo
github.com/Grace951/node-webshot, default branch `master` at `e3a5cbf`
("Update version", 2020-05-30). The registry lineage is the Grace951 fork
only (1.0.0 2017-12-04, 1.0.3 2018-07-06, 1.0.4 2020-05-30). The "0.18.0,
2018" figure in the early concept notes was wrong; use the figures above.
Not archived (GitHub API `archived: false`), 5 stars.

## Verdict: scoped

The member's own `npm test` (mocha, 28 tests) passes **18 of 28** under the
GhostBridge shim. The 10 failures are all tests that render google.com or
example.com, and this sandbox has no internet. Zero failures come from a
local fixture. That meets the family gate ("fully green, egress-blocked tests
aside"), and it is a scoped result, not a full-suite pass. What is and is not
shown is spelled out below. Proof of Life steps 1, 2 and 5 are not done in a
separate clean room yet (see "Proof of Life status").

## License soft spot

`package.json` declares `"license": "MIT"` (npm metadata for 1.0.4 says the
same). The repo has **no LICENSE file** at `e3a5cbf` (`git ls-files` lists
none; the npm tarball has none either: 7 files, see
`evidence/npm-tarball-md5.txt`), and the GitHub license API returns 404 /
`license: null` for the repo (checked 2026-11-22). The README's License
section is a code fence with no text. So MIT is a declaration, with no
license text to point at. Public copy must say "declares MIT in package.json"
and nothing stronger.

## How the member was obtained and kept untouched

- `npm pack node-webshot@1.0.4` (tarball, 7 files, md5s in
  `evidence/npm-tarball-md5.txt`). The tarball has no `test/` directory, so
  the suite was run from a clone of the repo at `e3a5cbf`. `lib/*.js` in the
  tarball differ from the repo only in line endings (CRLF in the tarball, LF
  in git; `diff` after `tr -d '\r'` is empty for `webshot.js`; `package.json`
  is byte-identical).
- 32 repo files (excluding `.git`, `node_modules`, `package-lock.json`)
  hashed before anything ran (`evidence/repo-md5-before.txt`), and again after
  all runs (`evidence/repo-md5-after.txt`): **identical, 32 of 32**.
- `npm install --ignore-scripts`. This creates `package-lock.json` (not in the
  repo; copy in `evidence/package-lock.install-artifact.json`) and
  `node_modules/`; neither is a member file. `phantomjs-prebuilt` 2.1.16 is
  installed without its binary, so its `path` export is `null`.
- One suite artifact: the suite leaves `test/test.png` behind (its
  `test/helper.js` `afterEach` cleanup calls `fs` without requiring it, so the
  cleanup silently never runs). I deleted it before the "after" hash.
- Substitution is in memory: `proofs/node-webshot-substitute.js` (a `node -r`
  preload) returns the real `phantomjs-prebuilt` with `path` set to
  `bin/phantomjs`. `proofs/node-webshot-suite-check.js` runs `npm test` with
  it (or without it, with `--before`). No member file is edited.

## Environment the suite needs

- The README says the tests need the ImageMagick CLI tools, because
  `node-imagemagick` shells out to `identify`. The sandbox did not have them.
  I unpacked the Ubuntu `imagemagick-6.q16` 6.9.12.98 packages into scratch
  and put wrappers for `identify`/`convert` on PATH. No system change.
- The `paperSize` test reads a PDF with `identify`, which needs Ghostscript.
  That is not installed either. This test is egress-blocked anyway, but it
  would fail on a missing Ghostscript even with internet.
- `devDependencies` pull `imagemagick` from `git://github.com/rsms/...`; npm
  resolved it to commit `8ad6a7f` (0.1.3). `mocha` and
  `should` are `*`: mocha 12.0.3 and should 13.2.3 were current today.
- Node v24.22.1.

## Counts (outputs in `evidence/`)

`npm test` = `mocha --ui bdd --reporter spec --require should ./test/core.js ./test/options/*`.
28 tests in 13 files; none skipped.

| Run | Pass | Fail | Not run | File |
| --- | --- | --- | --- | --- |
| Before 1: `path` = null (no binary) | 2 | 26 | 0 | `before-run1.txt` |
| Before 2 | 2 | 26 | 0 | `before-run2.txt` |
| After 1: `path` = `bin/phantomjs` | 18 | 10 | 0 | `after-run1.txt` |
| After 2 | 18 | 10 | 0 | `after-run2.txt` |

The two after runs are identical test by test (same 18 pass, same 10 fail).
Wall time 104.6 s and 46.6 s; the first run was on a cold machine. Before
runs: 0.9 s and 0.6 s. The two tests that pass before are the ones that
return an error before spawning anything (invalid extension, invalid
`siteType`).

A diagnostic after run made on the bridge as it stood before this session's
fix: 17 pass, 11 fail (`prefix-after-diagnostic.txt`). The extra failure,
`shotSize ... if larger than the body`, hit mocha's default 2000 ms timeout
because of the bridge defect described below.

## Tests that need external hosts (reported separately)

The sandbox has no egress. `google.com` returns `net::ERR_EMPTY_RESPONSE`
from the shim; the member exits with code 1.

**Failing because the host is unreachable: 10 tests.** None counted as a
bridge failure.

1. core: creates a screenshot (google.com)
2. core: overwrites existing screenshots (google.com)
3. core: streams a screenshot (google.com)
4. core: streams a screenshot with the old callback interface (google.com)
5. cookies: do not break page rendering (google.com)
6. customHeaders: do not break page rendering (google.com)
7. errorIfStatusIsNot200: screenshots a non-200 page status when not set to true (google.com)
8. paperSize: creates a properly-sized page for pdf shots (example.com; also needs Ghostscript)
9. shotOffset: creates a properly-sized image for partial shots (google.com)
10. windowSize: sets the size of the window the page is rendered in (google.com)

**Passing, but without evidence about rendering: 4 tests.** They pass because
an unreachable host looks like the expected error or an absent file.
`errors on non-200 page status when set to true` asserts that no file
exists, which is also true when the network is down. `misformatted address`
and `no webpage exists at the address` expect an error, and DNS fails here.
`streams an error message on a timeout` (google.com) passes through the
member's own kill timer. Two more tests mention a URL but never reach the
network (`invalid extension`, `invalid siteType` throw/return first).

**Passing on local fixtures (file: URLs and inline HTML): 12 tests.** These
are the evidence: JS-error HTML, captureSelector, errorIfJSException,
shotOffset right/bottom, shotSize x2, siteType x3, timeout (file), zoomFactor
x2 (dimensions only; see gaps).

### Supplementary: the external tests' calls against a local server

Not part of the suite and not in its counts.
`proofs/node-webshot-local-equivalents.js` makes the same webshot calls those
tests make (same options) against a local HTTP server, through the unmodified
package and the shim (`evidence/local-equivalents.txt`): 10 pass, 0 fail,
1 known gap, of 11. Covered: render to file, overwrite, stream, old callback
interface, cookies reach the server, 404 with and without
`errorIfStatusIsNot200`, Letter PDF (MediaBox 612x792 pt, read with pdf-lib
since `identify` has no Ghostscript), `windowSize` 1000x1000, partial shot
500x500. The gap is `customHeaders` (next section).

## Known gaps (not fixed; none makes a suite test fail)

1. **`page.customHeaders` is not implemented.** webshot sets
   `page.customHeaders` from its `customHeaders` option; the bridge ignores
   it, and the `X-Test` header never reached the local server. The member's
   own test only checks that a render happens, so it cannot see this. The
   fix is a missing surface, not a suite failure, so it was left for a
   decision (SESSION-9-RESULT.md, open question 1).
2. **`zoomFactor` is stored, not applied** (a recorded Session 2 limit,
   `gb-runtime.js`). webshot multiplies the clip rectangle by `zoomFactor`.
   With zoom 2, the suite checks only the image size and passes, but the
   content is not zoomed, so a zoomed `captureSelector` shot would frame the
   wrong area. Needs a design call (open question 2).
3. The README's usage examples say `require('webshot')`; the package name is
   `node-webshot`. Documentation bug in the member; not touched.

## The bridge fix (commit c365e1d)

Failure addressed: `shotSize` "resolves 'all' to the full length of the page,
if larger than the body" timed out at mocha's 2000 ms default. Cause: after
`webshot.phantom.js` runs `page.close(); phantom.exit(0)` from a timer
callback, the host's idle check could run between the runtime's
`exitRequested` notice and its deferred `exit` op. It then terminated with a
console probe that the runtime, by then blocked in the `exit` op, could not
answer, so it waited out the 3000 ms console drain bound. It happened
intermittently: 1 slow run in 6 traced runs of the render script (a temporary
print showed `expected=null` on the slow run and `expected=0` on the others;
the print was reverted). Fix, `gb-host.js` idle check:
after the pending-timer probe, if an exit is pending and under 1 s old, wait
for the real `exit` op. Gate check 9k (`test/exit-after-close-check.js`)
reproduces the window deterministically: 22 s stall before the fix, about
2.3 s after. Gate: 48 PASS before, 49 PASS and 0 FAIL after
(`evidence/gate-after.log`).

## Proof of Life status

Done in scratch by the same session that did the surgery: install from the
repo with `npm install --ignore-scripts` (README says `npm install
node-webshot`; the repo checkout was used because the tarball has no tests),
suite before/after, a smoke render (first row of the supplementary run:
`core: creates a screenshot`, and the suite's local `siteType` tests).
Not done: a fresh-clone run by something other than this session, and an
independent diff review. Muse verifies independently before the node is
treated as alive in the graph.

## Not checked

- `npm audit`: blocked by sandbox policy
  (`POST /-/npm/v1/security/audits/quick not permitted by policy`). No CVE
  count is claimed for the dependency tree.
- No oracle run with real PhantomJS 2.1.1 this session.
- Pixel content is never compared; dimensions and file formats only.

## Receipt

rcpt-0004 in `receipts/bridge-core.jsonl`. Chain verified after append.
