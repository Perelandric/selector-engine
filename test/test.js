var jsdom = require("jsdom")
var QuickTest = require("quick-test")

jsdom.env(
  '<div>' +
    '<div id=foo class="foo bar" data-t="foo-bar">' +
      '' +
    '</div>' +
  '</div>',
  ["lib/selector-engine.js"],
  function (err, window) {
    const Query = window.Query
    const doc = window.document

    var sel = "div#foo.foo.bar:first-of-type:last-of-type:only-of-type" +
                 ":first-child:last-child:only-child[data-t][data-t*='-']" +
                 "[data-t^=\"FOO\" i][data-t$='bar'][data-t|=foo][data-t=foo-bar]" +
                 "[data-t~=foo-bar]:not(p, dl > dd):nth-child(1):matches(div, #foo)"

    Query.log = console.log

    const outer = Query.one(doc, "div")

    QuickTest({
      name: "All selector tests"
    },
    function simple_div(t) {
      t.equal(doc.body.firstElementChild, outer)
    },

    function scope(t) {
      const fc = outer.firstElementChild

      t.equal(Query.one(outer, ":scope div"), fc)
      t.not_equal(Query.one(outer, ":scope"), outer)

      t.true(Query.matches(fc, ":scope"))
      t.true(Query.matches(fc, "div#foo:scope"))
      t.false(Query.matches(fc, "p#foo:scope"))
    },

    function complex_div(t) {
      t.true(Query.matches(outer.firstElementChild, sel))
      t.equal(outer.firstElementChild, Query.one(outer, "div"))
    },

    function span_in_complex_div(t) {
      sel += " span"

      const div = outer.firstElementChild
      const span = div.appendChild(doc.createElement("span"))

      t.true(Query.matches(span, sel))
      t.equal(span, Query.one(outer, sel))
    },

    function multi_with_p(t) {
      sel += ", p"

      const p = outer.insertBefore(doc.createElement("p"), outer.firstChild)

      t.true(Query.matches(p, sel))
      t.equal(p, Query.one(outer, sel))
    })
  }
)
