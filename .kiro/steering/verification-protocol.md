# Proof of Life: clean-room verification protocol

A resurrection counts only when all of these pass, in a fresh environment
that did not perform the surgery:

1. Fresh clone of the resurrected branch.
2. Install strictly per the project's own README. No extra undocumented
   steps; if the README is wrong, fixing the README is part of the surgery.
3. Run the project's test suite. Record pass/fail counts, before and after.
4. Run one smoke command that exercises the project's main function.
5. Review the diff independently: minimal, spec-faithful, no unrelated
   changes.

On pass: write the hash-chained receipt and mark the node alive.
On fail: mark the node failed, append the failing step and output to the
autopsy, and write no receipt. There is no partial credit and no override.
