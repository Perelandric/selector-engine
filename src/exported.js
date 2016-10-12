/* TODO:
  Cache individual objects, like ATTR and NTH simple selectors.
  Reorder pseudos so that the ones with highest overhead (like :hover) come last.
*/


/** @define {boolean} */
const DEBUG_MODE = false
,     LEGACY = false

const Query = global["Query"] = {}
,     re_trim = /(?:^\s+|\s+$)/g
,     cache = {}
,     selCache = {}

//  ,   re_simpleTagSelector = /^[a-zA-Z][-\w]+(?:\s*,\s*|$)/
//  ,   re_simpleIdSelector = /^#[a-zA-Z][-\w]+(?:\s*,\s*|$)/
//  ,   re_simpleClassSelector = /^.[a-zA-Z][-\w]+(?:\s*,\s*|$)/

Query["one"] = function(elem, selector) {
  if (arguments.length === 1) {
    selector = elem
    elem = document
  }
  return new SelectorGroup(selector).selectFirstFrom(elem)
}
Query["all"] = function(elem, selector) {
  if (arguments.length === 1) {
    selector = elem
    elem = document
  }
  return new SelectorGroup(selector).selectFrom(elem)
}
Query["matches"] = function(elem, selector) {
  return new SelectorGroup(selector).matches(elem)
}


//const e_proto = (global.HTMLElement || global.Element || {}).prototype
//if (e_proto && !e_proto.matches) {
//  e_proto.matches =
//    e_proto.matchesSelector ||
//    e_proto.webkitMatchesSelector ||
//    e_proto.mozMatchesSelector ||
//    e_proto.msMatchesSelector ||
//    e_proto.oMatchesSelector ||
//    function(sel) {
//      return Query["matches"](/**{!Element}*/(this), sel)
//    }
//}
