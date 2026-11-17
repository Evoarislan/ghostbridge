// test/inject-test.js: phantom.injectJs runs a file in the runtime context.
var ok = phantom.injectJs('lib/injected.js');
console.log('injectJs returned: ' + ok);
console.log('INJECTED_VALUE: ' + INJECTED_VALUE);
console.log('injectedAdd(2,3): ' + injectedAdd(2, 3));
var missing = phantom.injectJs('lib/does-not-exist.js');
console.log('missing injectJs returned: ' + missing);
phantom.exit(ok === true && missing === false && INJECTED_VALUE === 'injected-ok-42' ? 0 : 1);
