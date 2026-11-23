#!/bin/bash
# usage: run-suite.sh LABEL [after]
export PATH=/home/hatch/gbtmp/s10/pathbin:$PATH
if [ "$2" = after ]; then export PHANTOMJS_EXECUTABLE=/home/hatch/workspace/ghostbridge/bin/phantomjs; fi
cd /home/hatch/gbtmp/s10/spooky
s=$(date +%s)
npm test > ../ev/$1-npmtest.log 2>&1; echo "npm test exit $? ($(( $(date +%s)-s ))s, output bytes $(wc -c < ../ev/$1-npmtest.log))"
s=$(date +%s)
TEST_REPORTER=spec make test NODE_MODULES=/home/hatch/gbtmp/s10/nm-alt > ../ev/$1.log 2>&1; echo "make test (runner shim) exit $? ($(( $(date +%s)-s ))s)"
grep -E "passing|failing|pending|tests failed|tests complete|of [0-9]+ tests" ../ev/$1.log
