import '~/Documents/projects/javascript/simple-test'
import '../lib/selector-engine.js'

function log() {
  return window.console && console.log.apply(console, arguments)
}

var div = document.createElement("div")
div.id = "foo"
div.className = "foo bar"
div.setAttribute("data-t", "foo-bar")

var outer = document.createElement("div")
outer.appendChild(div)

var sel = "div#foo.foo.bar:first-of-type:last-of-type:only-of-type" +
             ":first-child:last-child:only-child[data-t][data-t*='-']" +
             "[data-t^=foo][data-t$=bar][data-t|=foo][data-t=foo-bar]" +
             "[data-t~=foo-bar]:not(p):nth-child(1)"

log("Matches:", Query.matches(div, sel))
log("querySelector:", Query.one(outer, sel))

sel += " span"

var span = div.appendChild(document.createElement("span"))

log("Matches:", Query.matches(span, sel))
log("querySelector:", Query.one(outer, sel))

sel += ", p"

var p = outer.insertBefore(document.createElement("p"), outer.firstChild)

log("Matches:", Query.matches(p, sel))
log("querySelector:", Query.one(outer, sel))
