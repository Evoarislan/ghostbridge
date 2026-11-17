// test/epipe-test.js: writes lots of output; used with a consumer that closes early (`| head -n 1`).
for (var i = 1; i <= 20000; i++) console.log('line ' + i);
phantom.exit(0);
