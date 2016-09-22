
var DEBUG_MODE = false
,   EXTEND_PROTOS = true


/* TODO:
  Cache individual objects, like ATTR and NTH simple selectors.
  Reorder pseudos so that the ones with highest overhead (like :hover) come last.
*/


var errInvalidSelector = new Error("Invalid selector")
,   errInternal = new Error("Internal error")
,   Document = window.HTMLDocument || window.Document
,   Element = window.HTMLElement || window.Element
,   Query = {"proto":{}}

window["Query"] = Query


// Create and return the exported methods
for (var i = 0, arr = ["matches", "", "All"]; i < arr.length; i+=1) {
  makeFn(arr[i], i === 0)
}


/*
Generates the public `querySelector[All]` and `matches` functions, and adds
to DOM prototypes if instructed to
*/
function makeFn(name, isMatches) {
  var nativeName = isMatches ? name : ("querySelector" + name)
  ,   thisName = name.toLowerCase() || "one"
  ,   originals = {}

  if (Document && Element) {
    if (isMatches) {
      originals[1] = Element.prototype.matches ||
                      Element.prototype.matchesSelector ||
                      Element.prototype.webkitMatchesSelector ||
                      Element.prototype.mozMatchesSelector ||
                      Element.prototype.msMatchesSelector ||
                      Element.prototype.oMatchesSelector

    } else {
      originals[9] = Document.prototype[nativeName]
      originals[1] = Element.prototype[nativeName]
    }

    if (EXTEND_PROTOS && Element) {
      Element.prototype[nativeName] = proto_query_fix

      if (!isMatches && Document) {
        Document.prototype[nativeName] = proto_query_fix
      }
    }
  } else {
    originals = null
  }


  Query[thisName] = function(root, sel) {
    if (!isMatches && arguments.length === 1) {
      sel = root
      root = document
    }
    return proto_query_fix.call(root, sel)
  }

  Query["proto"][thisName] = proto_query_fix


  var firstOnly = thisName === "one"

  function proto_query_fix(sel) {
    var fn = originals[this.nodeType]

    // Try to call the native method if found and if not in DEBUG_MODE
    if (!DEBUG_MODE && fn) {
      try {
        return fn.call(this, sel)
      } catch(e) {}
    }

    if (isMatches) {
      return new SelectorGroup(sel).matches(this)
    }
    if (firstOnly) {
      return new SelectorGroup(sel).selectFirstFrom(this)
    }
    return new SelectorGroup(sel).selectFrom(this)
  }
}
