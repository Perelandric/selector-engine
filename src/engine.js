
var testElem = document.createElement("div")
// Needed for old IE--v

const randTagName = "x" + ("00000000" + ~~(Math.random() * 1e9)).slice(-9)

testElem.innerHTML = "1<" + randTagName + "></" + randTagName + ">"

const needTagFix = testElem.getElementsByTagName("*")[0].nodeName.charAt(0) === '/'

testElem.innerHTML = ""

const needCommentFilter = testElem.appendChild(document.createComment(""))
        .parentNode
        .getElementsByTagName("*").length !== 0

const re_twoSpaceOnceSpaceOrEmpty = /^\s\s?$|^$/

testElem = null



/**
 * General function to check if the given element matches any of the selectors
 * in the given subGroup.
 *
 * @param {!Element} origEl
 * @param {!Array<!Selector>} subGroup
 * @return {boolean}
 */
function _matches(origEl, subGroup) {

  SUBGROUP_LOOP:
  for (var i = 0; i < subGroup.length; i+=1) {
    var selector = subGroup[i]
    ,   el = origEl
    ,   haltOnFail = false
    ,   lastCombinatorIdx = -1


    // Process starting at the end so that we're doing a RtoL evaluation.
    for (var j = selector.parts.length-1; j > -1; j-=1) {
      var part = selector.parts[j]

      if (part.kind === COMBINATOR) {
      // If we have a combinator, traverse to the related element
        haltOnFail = false

        switch (part.subKind) {
        case NO_COMB:           haltOnFail = true; break // Far right end
        case CHILD_COMB:        haltOnFail = true; /*falls through*/
        case DESCENDANT_COMB:   el = el.parentNode; break
        case ADJACENT_SIB_COMB: haltOnFail = true; /*falls through*/
        case GENERAL_SIB_COMB:
          while ((el = el.previousSibling) && el.nodeType !== 1) {}
          break
        default: if (DEBUG_MODE) { throw errInternal }
        }

        if (!el || el.nodeType !== 1) { // No more elems to traverse, so fail
          return false
        }
        el = /**@type {!Element}*/(el)

        // Set to go back to this combinator if needed (+1 for the decrement)
        lastCombinatorIdx = j + 1

        continue
      }


      var temp = ""
      ,   thisSeqQualName = ""

      switch (part.kind) {
      case UNIVERSAL_TAG_TOKEN:
        thisSeqQualName = ""
        continue // Always matches

      case TAG_TOKEN:
        temp = el.nodeName.toUpperCase()
        thisSeqQualName = part.value

        if (needTagFix && temp.charAt(0) === '/') {
          temp = temp.slice(1)
        }
        if (temp === thisSeqQualName) { continue }
        break

      case CLASS_TOKEN:
        if (fieldMatch(el.className, part.value)) { continue }
        break

      case ID_TOKEN:
        if (el.id === part.value) { continue }
        break

      // A selector that doesn't return any element (e.g. ::first-letter)
      case NO_TOKEN:
        break


      // Simple pseudos
      case PSEUDO_TOKEN:
        if (part.subKind(el)) { continue }
        break


      // Function pseudos
      case PSEUDO_FUNCTION_TOKEN:

        switch (part.subKind) {
        case NOT_TOKEN:
          if (!_matches(el, part.subSelector)) { continue }
          break

        case NTH_CHILD_TOKEN:
          if (isNth(el, part, "", false)) { continue }
          break

        case NTH_LAST_CHILD_TOKEN:
          if (isNth(el, part, "", true)) { continue }
          break

        case NTH_OF_TYPE_TOKEN: // First item in a sequence is always tag
          if (isNth(el, part, thisSeqQualName, false)) { continue }
          break

        case NTH_LAST_OF_TYPE_TOKEN:
          if (isNth(el, part, thisSeqQualName, true)) { continue }
          break

        case LANG_TOKEN:
          var tempEl = el
          while (tempEl && !tempEl.lang) { tempEl = tempEl.parentNode }

          if (tempEl && dashMatch(tempEl.lang, part.value)) { continue }
          break

        default:
          if (DEBUG_MODE) {
            throw errInternal // Should have been caught while parsing
          }
        } // End function pseudos
        break


      // Attribute selectors
      case ATTR_TOKEN:
        var attrVal = el.getAttribute(part.name)

        if (attrVal == null) {
          return false
        }

        switch (part.subKind) {
        case EQUAL_ATTR_TOKEN:
          if (attrVal === part.value) { continue }
          break

        case PREFIX_MATCH_TOKEN:
          if (attrVal.lastIndexOf(part.value, 0) === 0) { continue }
          break

        case SUFFIX_MATCH_TOKEN:
          if (attrVal.lastIndexOf(part.value) + part.value.length ===
                                                            attrVal.length) {
            continue
          }
          break

        case DASH_MATCH_TOKEN:
          if (dashMatch(attrVal, part.value)) { continue }
          break

        case INCLUDE_MATCH_TOKEN:
          if (fieldMatch(attrVal, part.value)) { continue }
          break

        case HAS_ATTR_TOKEN:
          continue // Already know it isn't null, so it has the attr

        case SUBSTRING_MATCH_TOKEN:
          if (attrVal.indexOf(part.value) !== -1) { continue }
          break

        default:
          if (DEBUG_MODE) {
            throw errInternal // Should have been caught while parsing
          }
        } // End attribute selectors

        break

      default:
        if (DEBUG_MODE) {
          throw errInternal // Unknown kind
        }
      }

      if (haltOnFail) {
        continue SUBGROUP_LOOP // Try the next selector in the subGroup
      }

      // A simple selector failed, so go back to the last combinator.
      j = lastCombinatorIdx
    }

    return true // Success for all parts
  } // end SUBGROUP_LOOP

  return false // No successful selectors in the group
}


/**
 * Matches a prefix followed by a dash. ("foo-bar" matches "foo" but not "f")
 *
 * @param {!string} target
 * @param {!string} pattern
 * @return {!boolean}
 */
function dashMatch(target, pattern) {
  const last = target.charAt(pattern.length)
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
  var idx = -1

  while ((idx = target.indexOf(pattern, idx+1)) !== -1) {
    if (re_twoSpaceOnceSpaceOrEmpty.test(
                target.charAt(idx-1) + target.charAt(idx + pattern.length))) {
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
  const nth = simple.a
  ,   offset = simple.b
  ,   cap = nth <= 0 ? offset : Infinity // Don't traverse farther than needed

  if (!el.parentNode || (nth <= 0 && offset <= 0)) {
    return false
  }

  var idx = 1 // 1-based index
  ,   curr = fromEnd ? el.parentNode.lastChild : el.parentNode.firstChild

  if (!curr) {
    return false
  }

  nn = nn.toUpperCase()

  while (curr !== el && idx <= cap) {
    if (curr.nodeType === 1 && (!nn || curr.nodeName.toUpperCase() === nn)) {
      idx += 1
    }

    curr = fromEnd ? curr.previousSibling : curr.nextSibling
  }

  // If not on an `nth`, then it's not a match
  if (idx % nth !== offset) {
    return false
  }

  // If the `nth >= 0`, the `idx` must be checked for `>= offset`,
  // otherwise, we know already that `nth < 0` and therefore `idx < offset`.
  return nth >= 0 && idx >= offset
}


const formControls = {
  "INPUT":1, "TEXTAREA":1, "SELECT":1, "BUTTON":1, "OPTION":1, "OPTGROUP":1
}
const hiddenOrButton = {
  "hidden":1, "image": 1, "button": 1, "submit": 1, "reset": 1
}


/**
 * Because `<input type=number>` gets turned into `type=text` in browsers that
 * don't supporter `type=number`, we check for the existence of a `min` or a
 * `max` property as an indicator that it's a number.
 *
 * @param {!Element} el
 * @return {boolean}
 */
function isNumberInput(el) {
  return el.nodeName.toUpperCase() === "INPUT" &&
        (el.type === "number" ||
         el.type === "text" && ("min" in el || "max" in el))
}


/**
 * Selector engine matcher functions for pseudo classes.
 */
var pseudoClassFns = {
  "root": function(el) {
    return el.ownerDocument.documentElement === el
  },
  "empty": function(el) {
    return !el.firstChild
  },
  "optional": function(el) {
    return formControls[el.nodeName.toUpperCase()] &&
            !hiddenOrButton[el.type] &&
            !pseudoClassFns["required"](el)
  },
  "required": function(el) {
    return formControls[el.nodeName.toUpperCase()] &&
            !hiddenOrButton[el.type] &&
            (typeof el.required === "string" ||
              (typeof el.required === "boolean" && el.required))
  },
  "checked": function(el) {
    return (el.checked && (el.type === "checkbox" || el.type === "radio")) ||
           (el.selected && el.nodeName === "OPTION")
  },
  "indeterminate": function(el) {
    return !!el.indeterminate &&
            el.type === "checkbox" &&
            el.nodeName.toUpperCase() === "INPUT"
  },
  "out-of-range": function(el) {
    return isNumberInput(el) &&
            // no min or GTE min, and...
            ((+el.min !== +el.min || +el.value >= +el.min) &&
            // no max or LTE max
            (+el.max !== +el.max || +el.value <= +el.max)) === false
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
    return !el.disabled && formControls[el.nodeName.toUpperCase()]
  },
  "disabled": function(el) {
    return el.disabled && formControls[el.nodeName.toUpperCase()]
  },
  "target": function(el) {
    return el.id && window.location.hash.slice(1) === el.id
  },
  "hover": function(el) {
    // We only add the mouseover handler if absolutely necessary.
    if (needHoverHelperSetup) {
      hoverHelperSetup()
    }

    if (el.contains) {
      return el.contains(hoverHelper)
    }

    var helper = hoverHelper
    do {
      if (el === helper) {
        return true
      }
    } while(helper && (helper = helper.parentNode))

    /*
      Alternate solution would be to force a mouseover event on a temporary handler
      whenever this is needed. It gets the target element using `.elementFromPoint`.
      Advantage is that there's no continuous `mouseover` event taking place, and no
      traversal to check the element. Would need to test to make sure the removal and
      append of the `body` fires the `mouseover` handler in all browsers.

      This would only be done once for each group of elements to be tested for qSA.

      Would there be problems with other handlers firing?

      var body = document.body
      if (body) {
        var sib = body.nextSibling
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
    while ((el = el.previousSibling) && el.nodeType !== 1) {
    }
    return !el
  },
  "last-child": function(el) {
    while ((el = el.nextSibling) && el.nodeType !== 1) {
    }
    return !el
  },
  "only-child": function(el) {
    return pseudoClassFns["first-child"](el) &&
            pseudoClassFns["last-child"](el)
  },
  "first-of-type": function(el) {
    const name = el.nodeName.toUpperCase()

    while ((el = el.previousSibling) && (el.nodeType !== 1 ||
            el.nodeName.toUpperCase() !== name)) {
    }
    return !el
  },
  "last-of-type": function(el) {
    const name = el.nodeName.toUpperCase()

    while ((el = el.nextSibling) && (el.nodeType !== 1 ||
            el.nodeName.toUpperCase() !== name)) {
    }
    return !el
  },
  "only-of-type": function(el) {
    return pseudoClassFns["first-of-type"](el) &&
            pseudoClassFns["last-of-type"](el)
  },
  "no-tok": function() {
    return false // Valid, but won't match anything
  }
}



var needHoverHelperSetup = true
,   hoverHelper = null

/*
Used by the :hover fix to track the currently hovered element, if needed.
*/
function hoverHelperSetup() {
  if (!needHoverHelperSetup) {
    return
  }

  needHoverHelperSetup = false

  if (window.addEventListener) {
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
