// test/exit-code.js
// Verifies phantom.exit(code) produces the correct process exit code and
// actually stops the script (the line after exit must not run).
console.log('about to exit with code 7');
phantom.exit(7);
console.log('THIS MUST NOT PRINT');
