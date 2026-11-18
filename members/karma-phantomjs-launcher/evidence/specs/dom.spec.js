/* globals describe, it, expect, document, setTimeout */
describe('dom + async in PhantomJS browser', function () {
  it('creates and reads a DOM node', function () {
    var el = document.createElement('div')
    el.id = 'x'
    el.textContent = 'hello'
    document.body.appendChild(el)
    expect(document.getElementById('x').textContent).toBe('hello')
  })
  it('runs an async callback', function (done) {
    setTimeout(function () { expect(1 + 1).toBe(2); done() }, 20)
  })
  it('reports a user agent', function () {
    expect(typeof navigator.userAgent).toBe('string')
  })
})
