#!/bin/bash
# Session 11 capture wrapper: sits ahead of the real launcher on PATH. Passes args and stdio
# through, logs timestamped stdout/stderr chunks and the exit status. Touches no spooky/casperjs file.
CAPDIR=${CAPDIR:-/home/hatch/gbtmp/s11/cap}
id=$(date +%s%N)-$$
log=$CAPDIR/child-$id.log
echo "[$(date +%s%3N) wrapper] START pid=$$ cwd=$PWD args=$*" >> "$log"
python3 /home/hatch/gbtmp/s10/casper/bin/casperjs "$@" <&0 \
  > >(node /home/hatch/gbtmp/s11/tee.js "$log" OUT 1) \
  2> >(node /home/hatch/gbtmp/s11/tee.js "$log" ERR 2) &
child=$!
trap 'echo "[$(date +%s%3N) wrapper] got TERM, forwarding" >> "$log"; kill -TERM $child 2>/dev/null' TERM INT HUP
wait $child; rc=$?
# a trapped signal interrupts the first wait; wait again for the real status
while kill -0 $child 2>/dev/null; do wait $child; rc=$?; done
echo "[$(date +%s%3N) wrapper] EXIT rc=$rc" >> "$log"
exit $rc
