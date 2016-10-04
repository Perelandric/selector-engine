var jsdom = require("jsdom")
var QuickTest = require("quick-test")
var Query = require("selector-engine")

jsdom.env(
  '<div>' +
    '<div id=foo class="foo bar" data-t="foo-bar">' +
      '' +
    '</div>' +
  '</div>',
  [],
  function (err, window) {
    const Query = window.Query
    const doc = window.document
    var sel = "div#foo.foo.bar:first-of-type:last-of-type:only-of-type" +
                 ":first-child:last-child:only-child[data-t][data-t*='-']" +
                 "[data-t^=foo][data-t$=bar][data-t|=foo][data-t=foo-bar]" +
                 "[data-t~=foo-bar]:not(p):nth-child(1)"

    const outer = Query.one(doc, "div")
    var div = null

    QuickTest({
      name: "All selector tests"
    },
      t => {
        t.equal(doc.body.firstElementChild, outer)

        div = outer.firstElementChild

        t.equal(true, Query.matches(div, sel))
        t.equal(div, Query.one(outer, "div"))

        sel += " span"

        const span = div.appendChild(document.createElement("span"))

        t.equal(true, Query.matches(span, sel))
        t.equal(span, Query.one(outer, sel))

        sel += ", p"

        const p = outer.insertBefore(document.createElement("p"), outer.firstChild)

        t.equal(true, Query.matches(p, sel))
        t.equal(p, Query.one(outer, sel))
      }
    )
  }
)
