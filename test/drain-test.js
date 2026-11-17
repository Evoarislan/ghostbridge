// Prints a burst of console and system.stdout lines immediately before
// phantom.exit(). The gate runs this repeatedly and requires every line
// (see "console drain" in .kiro/hooks/scripts/run-tests.sh).
var system = require('system');
for (var i = 1; i <= 300; i++) console.log('drain line ' + i);
system.stdout.writeLine('drain stdout line');
console.error('drain stderr line');
console.log('drain last');
// 'idle' mode ends without phantom.exit(): the host's idle exit must drain too.
if (system.args[1] !== 'idle') phantom.exit(3);
