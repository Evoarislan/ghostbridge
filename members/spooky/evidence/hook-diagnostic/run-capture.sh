#!/bin/bash
# usage: run-capture.sh LABEL [mocha args...]   (spooky Session 10 setup, child captured via PATH wrapper)
L=$1; shift
export PATH=/home/hatch/gbtmp/s11/pathcap:/usr/local/bin:/usr/bin:/bin:$(dirname $(which node))
export PHANTOMJS_EXECUTABLE=/home/hatch/workspace/ghostbridge/bin/phantomjs
export CAPDIR=/home/hatch/gbtmp/s11/cap/$L; mkdir -p $CAPDIR
cd /home/hatch/gbtmp/s10/spooky
( cd tests/fixtures; /home/hatch/gbtmp/s10/spooky/node_modules/.bin/http-server -s -p 8080 & echo $! > /home/hatch/gbtmp/s11/http.pid; wait ) &
sleep 1
s=$(date +%s)
/home/hatch/gbtmp/s10/nm-alt/.bin/mocha "$@" --globals define --timeout 4000 --slow 2000 -R spec > /home/hatch/gbtmp/s11/ev/$L.log 2>&1
echo "mocha exit $? ($(( $(date +%s)-s ))s)"
kill -9 $(cat /home/hatch/gbtmp/s11/http.pid) 2>/dev/null
grep -E "passing|failing|pending" /home/hatch/gbtmp/s11/ev/$L.log
