#!/bin/bash
# usage: run-chunks.sh LABEL [after|before]
# Runs casperjs 1.1.4's own selftest one file per chunk, in the runner's own order
# (Tester.findTestFiles: .js files under tests/suites, recursive, sorted by absolute path),
# with `casperjs selftest <file>` (bin/bootstrap.js:339-347). Member files are not touched.
# "after": PHANTOMJS_EXECUTABLE = GhostBridge shim. "before": no phantomjs anywhere.
L=$1; MODE=${2:-after}
PKG=/home/hatch/gbtmp/s11/cj/pkg/package
OUT=/home/hatch/gbtmp/s11/ev/$L; mkdir -p $OUT
export PATH=/home/hatch/gbtmp/s11/pathnone:/usr/bin:/bin
unset PHANTOMJS_EXECUTABLE ENGINE_EXECUTABLE
[ "$MODE" = after ] && export PHANTOMJS_EXECUTABLE=/home/hatch/workspace/ghostbridge/bin/phantomjs
cd $PKG
python3 -c "
import os
r=[]
for d,_,fs in os.walk(os.path.abspath('tests/suites')):
    r+= [os.path.join(d,f) for f in fs if f.endswith('.js')]
print('\n'.join(sorted(r)))" > $OUT/files.txt
: > $OUT/summary.tsv
T0=$(date +%s)
while read -r f; do
  rel=${f#$PKG/}; name=$(echo "$rel" | tr '/' '_')
  s=$(date +%s)
  timeout -k 10 180 ./bin/casperjs selftest "$rel" > "$OUT/$name.log" 2>&1; rc=$?
  d=$(( $(date +%s)-s ))
  line=$(sed 's/\x1b\[[0-9;]*m//g' "$OUT/$name.log" | grep -E "tests? executed in" | tail -1)
  if [ -n "$line" ]; then
    ex=$(echo "$line" | grep -oE "[0-9]+ tests? executed" | grep -oE "^[0-9]+")
    p=$(echo "$line" | grep -oE "[0-9]+ passed" | grep -oE "^[0-9]+")
    fl=$(echo "$line" | grep -oE "[0-9]+ failed" | grep -oE "^[0-9]+")
    du=$(echo "$line" | grep -oE "[0-9]+ dubious" | grep -oE "^[0-9]+")
    sk=$(echo "$line" | grep -oE "[0-9]+ skipped" | grep -oE "^[0-9]+")
    st=completed
  else
    ex=-; p=-; fl=-; du=-; sk=-; st=$([ $rc -eq 124 ] || [ $rc -eq 137 ] && echo timeout || echo "no-summary")
  fi
  printf "%s\t%s\trc=%s\t%ss\texecuted=%s\tpassed=%s\tfailed=%s\tdubious=%s\tskipped=%s\n" "$rel" "$st" "$rc" "$d" "$ex" "$p" "$fl" "$du" "$sk" | tee -a $OUT/summary.tsv
done < $OUT/files.txt
echo "TOTAL $(( $(date +%s)-T0 ))s" | tee -a $OUT/summary.tsv
