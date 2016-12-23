
/*
const needTagFix = function() {
  if (LEGACY) {
    const testElem = document.createElement("div")
    const tempTagName = "div123"

    // Needed for old IE--v
    testElem.innerHTML = "1<" + tempTagName + "></" + tempTagName + ">"

    return getChar(testElem.getElementsByTagName("*")[0].nodeName, 0) === '/'

  } else {
    return false
  }
}()
*/


const needCommentFilter = LEGACY ?
    document.createElement("div")
      .appendChild(document.createComment(""))
      .parentNode
      .getElementsByTagName("*").length !== 0 :
    false




/**
 * Check if the given element matches the given Selector.
 *
 * @param {!Element|Document} root
 * @param {!Element} el
 * @param {!Selector} selector
 * @return {boolean}
 */
function compare_selector(root, el, selector) {
  // Process starting at the end so that we're doing a RtoL evaluation.
  for (let j = selector.parts.length-1, combinator = 0; j > -1; j-=1) {
    const part = selector.parts[j]

    let haltOnFail = false
    ,   currEl = el

    if (part instanceof Sequence) {
      switch (combinator) {
      case 0:                     haltOnFail = true; break
      case COMBINATOR_CHILD:      haltOnFail = true; /*falls through*/
      case COMBINATOR_DESCENDANT: currEl = parentElement(el); break
      case COMBINATOR_ADJACENT:   haltOnFail = true; /*falls through*/
      case COMBINATOR_GENERAL:    currEl = prevElemSib(el); break
      default: if (DEBUG) { throw errInternal }
      }

      if (!currEl) {
        return false
      }
      el = currEl

      if (compare_sequence(root, el, part)) {
        continue
      }

      if (haltOnFail) {
        return false
      }

      j+=1 // So that we retry the same combinator

    } else {
      combinator = part
    }
  }

  return true
}



/**
 * Check if the given element matches the given Sequence
 *
 * @param {!Element|Document} root
 * @param {!Element} el
 * @param {!Sequence} seq
 * @return {boolean}
 */
function compare_sequence(root, el, seq) {
  if (seq.hasScope && el !== root) {
    return false
  }
  if (seq.tag && nodeName(el) !== seq.tag) {
    return false
  }

  for (let i = 0, sequence = seq.sequence; i < sequence.length; i++) {
    const simple = sequence[i]

    switch (simple.kind) {
    case CLASS_TOKEN:
      if (fieldMatch(el.className, simple.value)) { continue }
      return false

    case ID_TOKEN:
      if (el.id === simple.value) { continue }
      return false


    // Simple pseudos
    case PSEUDO_TOKEN:
      if (simple.subKind(el)) { continue }
      return false


    // Function pseudos
    case PSEUDO_FUNCTION_TOKEN:
      switch (simple.subKind) {
      case NOT_TOKEN:
        if (!simple.value["matches"](root, el, true)) { continue }
        return false

      case MATCHES_TOKEN:
        if (simple.value["matches"](root, el, true)) { continue }
        return false

      case NTH_CHILD_TOKEN:
        if (isNth(el, simple, "", false)) { continue }
        return false

      case NTH_LAST_CHILD_TOKEN:
        if (isNth(el, simple, "", true)) { continue }
        return false

      case NTH_OF_TYPE_TOKEN: // First item in a sequence is always tag
        if (isNth(el, simple, seq.tag, false)) { continue }
        return false

      case NTH_LAST_OF_TYPE_TOKEN:
        if (isNth(el, simple, seq.tag, true)) { continue }
        return false

      case LANG_TOKEN:
        let tempEl = el
        while (tempEl && !tempEl.lang) { tempEl = tempEl.parentNode }

        if (tempEl && dashMatch(tempEl.lang, simple.value)) { continue }
        return false
      }


    // Attribute selectors
    case ATTR_TOKEN:
    case ATTR_INSENSITIVE_TOKEN:
      let attrVal = getAttr(el, simple.name)
      if (attrVal == null) {
        return false
      }

      if (simple.kind === ATTR_INSENSITIVE_TOKEN) {
        attrVal = attrVal.toLowerCase()
      }

      switch (simple.subKind) {
      case EQUAL_ATTR_TOKEN:
        if (attrVal === simple.value) { continue }
        return false

      case PREFIX_MATCH_TOKEN:
        if (attrVal.lastIndexOf(simple.value, 0) === 0) { continue }
        return false

      case SUFFIX_MATCH_TOKEN:
        if (attrVal.lastIndexOf(simple.value)+simple.value.length === attrVal.length) {
          continue
        }
        return false

      case DASH_MATCH_TOKEN:
        if (dashMatch(attrVal, simple.value)) { continue }
        return false

      case INCLUDE_MATCH_TOKEN:
        if (fieldMatch(attrVal, simple.value)) { continue }
        return false

      case HAS_ATTR_TOKEN:
        continue // Already know it isn't null, so it has the attr

      case SUBSTRING_MATCH_TOKEN:
        if (attrVal.indexOf(simple.value) !== -1) { continue }
        return false
      }
    }

    if (DEBUG) {
      throw errInternal // Everything above should return or continue
    }
  }

  return true
}


/**
 * Matches a prefix followed by a dash. ("foo-bar" matches "foo" but not "f")
 *
 * @param {!string} target
 * @param {!string} pattern
 * @return {!boolean}
 */
function dashMatch(target, pattern) {
  const last = getChar(target, pattern.length)
  return (!last || last === '-') && target.lastIndexOf(pattern, 0) === 0
}


/**
 * Matches `pattern` if it has space or start of string before it and space or
 * end of string after it.
 *
 * @param {!string} target
 * @param {!string} pattern
 * @return {!boolean}
 */
function fieldMatch(target, pattern) {
  let idx = 0

  while ((idx = target.indexOf(pattern, idx)) !== -1) {
    if (!countSpacesAt(target, idx+pattern.length)) { // Fail, non-space after
      idx += pattern.length + 2

    } else if (!countSpacesAt(target, idx-1)) { // Fail, non-space before
      idx += pattern.length + 1

    } else {
      return true
    }
  }

  return false
}


/**
 * Checks that the element matches as the nth described by the nth selector.
 *
 * @param {!Element} el
 * @param {!Token} simple
 * @param {!string} nn
 * @param {!boolean} fromEnd
 * @return {!boolean}
 */
function isNth(el, simple, nn, fromEnd) {
  const nth = simple.value[0]
//  ,   offset = simple.b
//  ,   cap = nth <= 0 ? offset : Infinity // Don't traverse farther than needed

  if (!el.parentNode) {
    return false
  }

  let idx = 1-simple.value[1] // 1-based index, less the offset
  ,   curr = fromEnd ? lastElemChild(el.parentNode) : firstElemChild(el.parentNode)

  while (curr !== el /*&& idx <= cap*/) {
    // `curr` will never be `null` because the traversal will find `el` first.
    curr = /** @type{!Node} */(curr)

    if (!nn || nodeName(curr) === nn) {
      idx += 1
    }

    curr = fromEnd ? prevElemSib(curr) : nextElemSib(curr)
  }

  return idx === 0 || (idx % nth === 0 && idx / nth >= 0)
}


const formControls = {
  "INPUT":1, "TEXTAREA":1, "SELECT":1, "BUTTON":1, "OPTION":1, "OPTGROUP":1
}
const hiddenOrButton = {
  "hidden":1, "image": 1, "button": 1, "submit": 1, "reset": 1
}
const linkNodes = ["A", "AREA", "LINK"]



/**
 * Selector engine matcher functions for pseudo classes.
 */
const pseudoClassFns = {
  "root": function(el) {
    return el.ownerDocument.documentElement === el
  },
  "empty": function(el) {
    return !el.firstChild
  },
  "optional": function(el) {
    return !pseudoClassFns["required"](el)
  },
  "required": function(el) {
    return checkBooleanAttr(el, "required") &&
            formControls[nodeName(el)] &&
            !hiddenOrButton[el.type]

  },
  "checked": function(el) {
    return (el.checked && (el.type === "checkbox" || el.type === "radio")) ||
           (el.selected && nodeName(el) === "OPTION")
  },
  "indeterminate": function(el) {
    return checkBooleanAttr(el, "indeterminate") &&
            el.type === "checkbox" &&
            nodeName(el) === "INPUT"
  },
  "out-of-range": function(el) {
    return !pseudoClassFns["in-range"](el)
  },
  "in-range": function(el) {
    return isNumberInput(el) &&
            // no min or GTE min, and...
            ((+el.min !== +el.min || +el.value >= +el.min) &&
            // no max or LTE max
            (+el.max !== +el.max || +el.value <= +el.max)) === true
  },
  "default-option": function(el) {
    if (el.defaultChecked || el.defaultSelected) { return true }

    const sel = "BUTTON, INPUT[type=submit]"

    return el.form && el.form.nodeType === 1 &&
            Query["matches"](el, sel) &&
            Query["one"](el.form, sel) === el
  },
  "enabled": function(el) {
    return !pseudoClassFns["disabled"](el)
  },
  "disabled": function(el) {
    return checkBooleanAttr(el, "disabled") && formControls[nodeName(el)]
  },
  "target": function(el) {
    return el.id && window.location.hash.slice(1) === el.id
  },
  "any-link": function(el) {
    // TODO: Maybe in the parser, rewrite this so that if there's already a
    // qualified name give, it fails immediately, and if not, it gets written to
    // 3 separate selectors, with `A`, `AREA` and `LINK` as the qualified names
    // and `[href]`. That is better than using a recursive call into the selector
    // engine here.
    // Maybe with other ones that make a recursive call into the engine too.
    return hasAttr(el, "href") && contains(linkNodes, nodeName(el))
  },
  "hover": function(el) {
    // We only add the mouseover handler if absolutely necessary.
    if (needHoverHelperSetup) {
      hoverHelperSetup()
    }

    if (el.contains) {
      return el.contains(hoverHelper)
    }

    let helper = hoverHelper
    do {
      if (el === helper) {
        return true
      }
    } while(helper && (helper = parentElement(helper)))

    /*
      Alternate solution would be to force a mouseover event on a temporary handler
      whenever this is needed. It gets the target element using `.elementFromPoint`.
      Advantage is that there's no continuous `mouseover` event taking place, and no
      traversal to check the element. Would need to test to make sure the removal and
      append of the `body` fires the `mouseover` handler in all browsers.

      This would only be done once for each group of elements to be tested for qSA.

      Would there be problems with other handlers firing?

      const body = document.body
      if (body) {
        let sib = body.nextSibling
        ,   par = body.parentNode
        ,   prev_handler = window.onmouseover

        window.onmouseover = function(event) {
          hoverHelper=document.elementFromPoint(event.clientX, event.clientY)
        }

        par.removeChild(body)
        par.insertBefore(body, sib)

        window.onmouseover = prev_handler
        return hoverHelper
      }
    */

    return false
  },
  "focus": function(el) {
    return el === el.ownerDocument.activeElement
  },
  "first-child": function(el) {
    return !prevElemSib(el)
  },
  "last-child": function(el) {
    return !nextElemSib(el)
  },
  "only-child": function(el) {
    return !prevElemSib(el) && !nextElemSib(el)
  },
  "first-of-type": function(el) {
    const name = nodeName(el)

    while ((el = prevElemSib(el)) && (nodeName(el) !== name)) {
    }
    return !el
  },
  "last-of-type": function(el) {
    const name = nodeName(el)

    while ((el = nextElemSib(el)) && (nodeName(el) !== name)) {
    }
    return !el
  },
  "only-of-type": function(el) {
    return pseudoClassFns["first-of-type"](el) &&
            pseudoClassFns["last-of-type"](el)
  }
}



let needHoverHelperSetup = true
,   hoverHelper = null

/*
Used by the :hover fix to track the currently hovered element, if needed.
*/
function hoverHelperSetup() {
  if (!needHoverHelperSetup) {
    return
  }

  needHoverHelperSetup = false

  if (!LEGACY || window.addEventListener) {
    window.addEventListener("mouseover", function(event) {
      hoverHelper = event.target
    }, true)

  } else if (window.attachEvent) {
    window.attachEvent("onmouseover", function(event) {
      hoverHelper = event.srcElement
    })
  }

  // Try to force a "mouseover" event after the handler is set up.
  const body = document.body
  if (body) {
    const sib = body.nextSibling
    ,   par = body.parentNode

    par.removeChild(body)
    par.insertBefore(body, sib)
  }
}
