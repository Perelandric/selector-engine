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
                 "[data-t^=foo][data-t$=bar][data-t|=foo][data-t=foo-bar]" +
                 "[data-t~=foo-bar]:not(p):nth-child(1)"

    const outer = Query.one(doc, "div")

    QuickTest({
      name: "All selector tests"
    },
      function simple_div(t) {
        t.equal(doc.body.firstElementChild, outer)
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
      }
    )
  }
)
