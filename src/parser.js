
var re_trim = /(?:^\s+|\s+$)/g
,   cache = {}
,   selCache = {}

//  ,   re_simpleTagSelector = /^[a-zA-Z][-\w]+(?:\s*,\s*|$)/
//  ,   re_simpleIdSelector = /^#[a-zA-Z][-\w]+(?:\s*,\s*|$)/
//  ,   re_simpleClassSelector = /^.[a-zA-Z][-\w]+(?:\s*,\s*|$)/


/**
 * Represents a group of selectors. If there is more than one selector in the
 * group, they will be consolidated into sub-groups based on the `qualifier`
 * of the selector, if possible.
 *
 * @private
 * @constructor
 * @param {string|Lexer} strTok
 */
function SelectorGroup(strTok) {
  const isLexer = strTok instanceof Lexer

  if (!isLexer && cache.hasOwnProperty(strTok)) {
    return cache[strTok]
  }

  // Selectors with matching qualifiers are put together into a subgroup.
  const subGroups = {}
  ,   source = new Lexer(strTok)

  var first = true
  ,   hasUniversal = false
  ,   n

  // Continue to compile if any remain, and check `el` at the same time
  while ((n = source.nextAfterSpace())) {
    var isComma = n.kind === ','

    if (!first && !isComma && DEBUG_MODE) {
      throw errInternal
    }

    if (first) {
      if (!n || isComma) {
        throw errInvalidSelector
      }

      first = false
      source.reconsume()
    }

    const selObject = new Selector(source, true)

    hasUniversal = hasUniversal || selObject.qualifier === "*"

    if (!subGroups.hasOwnProperty(selObject.qualifier)) {
      subGroups[selObject.qualifier] = []
    }
    subGroups[selObject.qualifier].push(selObject)
  }

  // Convert the subGroups object into an Array of subGroup Arrays
  this._doSubGroups(subGroups, hasUniversal)

  // Cache the selector if it wasn't a Lexer.
  if (!isLexer) {
    cache[strTok] = this
  }
}


/**
 * Takes the object holding the subGroups, and converts it into an Array of
 * subGroups for this SelectorGroup. If there's at least one "universal"
 * selector, all selectors are grouped into a single subGroup.
 */
SelectorGroup.prototype._doSubGroups = function(subGroups, hasUniversal) {
  this.subGroups = []

  for (var key in subGroups) {
    if (!subGroups.hasOwnProperty(key)) { continue }

    // If at least one had a universal selector, put them all in one subgroup.
    if (hasUniversal) {
      if (this.subGroups[0]) {
        this.subGroups[0].push.apply(this.subGroups[0], subGroups[key])
      } else {
        this.subGroups[0] = subGroups[key]
      }

    } else {
      this.subGroups.push(subGroups[key])
    }
  }

  if (hasUniversal) {
    // The qualifier for all selectors in a subgroup should match, so make
    // them all the universal qualifier.
    for (var i = 0, sg = this.subGroups[0]; i < sg.length; i = i + 1) {
      sg[i].qualifier = "*"
    }
  }
}


/**
 * Attempts to match the given element against any of the subGroups in this
 * SelectorGroup.
 *
 * @param {!Element} el
 * @return {boolean}
 */
SelectorGroup.prototype.matches = function(el) {
  for(var i = 0; i < this.subGroups.length; i+=1) {
    if (_matches(el, this.subGroups[i])) {
      return true
    }
  }

  return false
}

/**
 * Fetches the first element that matches any of the subGroups in this
 * SelectorGroup from the context of the `root` argument.
 *
 * @param {!Element} root
 * @return {Element}
 */
SelectorGroup.prototype.selectFirstFrom = function(root) {
  // Having quantity of variables here equal to `selectFrom` helps compression
  const sgLen = this.subGroups.length
  var res = null

  for (var i = 0; i < sgLen; i+=1) {
    this.potentialsLoop(i, null, function(el) {
      // Keep the one that appears first on the DOM
      res = res && sorter(res, el) < 0 ? res : el
      return true
    })
  }

  return res
}



/**
 * Fetches all elements that match any of the subGroups in this SelectorGroup
 * from the context of the `root` argument.
 *
 * The result is guaranteed to be unique and in document order.
 *
 * @param {!Element} root
 * @return {Array<!Element>}
 */
SelectorGroup.prototype.selectFrom = function(root) {
  const resArr = []

  // Track if elements are located in more than one selector subGroup
  var matchedSubGroups = 0

  // When checking if unique, we only need to search until the end of the
  // results of the previous subgroup's results.
  ,   prevLen = 0


  // TODO: Ultimately want to optimize for `gEBI`, `gEBCN`, `gEBTN`, `:root`
  // when the selector consists entirely of one of those.
  for (var i = 0; i < this.subGroups.length; i+=1) {
    this.potentialsLoop(i, resArr, function(el) {
      for (var k = 0; k < prevLen; k+=1) {
        if (resArr[k] === el) {
          return
        }
      }

      resArr.push(el)
    })

    // Current subGroup must have added at least one unique element
    if (resArr.length !== prevLen) {
      matchedSubGroups+=1
      prevLen = resArr.length
    }
  }

  // Don't bother sorting if all elems came from a single subGroup.
  return matchedSubGroups ? resArr.sort(sorter) : resArr
}


/**
 * @param {!Number} i
 * @param {Array<!Element>} resArr
 * @param {func(!Element)} cb
 */
SelectorGroup.prototype.potentialsLoop = function(i, resArr, cb) {
  const subGroup = this.subGroups[i]
  ,   potentials =
        root.getElementsByTagName(needTagFix ? "*" : subGroup[0].qualifier)

  // Check each potential element to see if they match a selector
  for (var j = 0; j < potentials.length; j+=1) {
    var el = potentials[j]

    // If not an element, or an element but not a match, try the next elem
    if ((!needCommentFilter || el.nodeType === 1) && _matches(el, subGroup)) {
      if (cb(el)) {
        // selectFirstFrom only needs the first match from each subgroup.
        break
      }
    }
  }
}


/**
 * Parses an individual selector in a selector group, where a selector is a
 * sequence of simple selectors followed by an optional list of [combinator/
 * simple selector sequence] pairs.
 *
 * The sequences are actually added in reverse order, so that when we do our
 * right-to-left traversal on the overall selector, each sequence part will
 * maintain its left-to-right ordering.
 *
 * @constructor
 * @private
 * @param {Lexer} source input source for this selector
 * @param {boolean} guarantee_tag ensures that a sequence will start with a
 * TAG or UNIVERSAL selector when `true`
 */
function Selector(source, guarantee_tag) {
  var startIdx = source._reconsumed ? source.last_tok_i : source.i + 1
  ,   endIdx = source.sel.indexOf(source.endChar || ',', startIdx)

  if (endIdx === -1) {
    endIdx = source.sel.length
  }

  const potentialSel = source.sel.slice(startIdx, endIdx).replace(re_trim, "")

  if (selCache.hasOwnProperty(potentialSel)) {
    source._reconsumed = false
    source.i = endIdx-1 // Move ahead to just before the terminating token

    return selCache[potentialSel]
  }

  var doCombinator = false
  ,   n

  this.source = source
  this.parts = []
  this.qualifier = "" // Will hold the right-most tagName to be fetched.

  while ((n = source.next())) {
    // Track if whitespace was found in case it's a descendant combinator.
    var isSpace = n.kind === WHITESPACE_TOKEN

    if (isSpace) {
      n = source.nextAfterSpace()
    }

    if (!n || n.kind === ',') {
      source.reconsume()
      break

    } else if (doCombinator) {
      switch (n) {
      case COMBINATOR_CHILD_REUSE:
      case COMBINATOR_ADJACENT_REUSE:
      case COMBINATOR_GENERAL_REUSE:
        this.parts.push(n)
        break

      default:
        if (isSpace) {
          source.reconsume() // reconsume the one after the space
          this.parts.push(COMBINATOR_DESCENDANT_REUSE)

        } else {
          throw errInvalidSelector
        }
      }

      doCombinator = false

    } else {
      source.reconsume()
      this.makeSimpleSequence(guarantee_tag) // will raise if none found
      doCombinator = true
    }
  }

  if (doCombinator === false) { // Ended after a combinator
    throw errInvalidSelector
  }

  this.parts.push(COMBINATOR_NONE_REUSE)

  this.source = null

  // We only cache the selector if the endIdx did make a full selector.
  if (endIdx === source.i) {
    selCache[potentialSel] = this
  }
}


const temp_sequence = []


/**
 * Parses the stream of tokens into a valid sequence of simple selectors to be
 * added to the current Selector.
 */
Selector.prototype.makeSimpleSequence = function(guarantee_tag) {
  temp_sequence.length = 0 // Just to be certain

  // The previous qualifier was not the last sequence, so erase it
  this.qualifier = ""

  var n = this.source.nextAfterSpace()

  if (!n || n.kind === ',') {
    throw errInvalidSelector
  }

  switch (n.kind) {
  case TAG_TOKEN:
    n.value = n.value.toUpperCase()
    /*falls through*/

  case UNIVERSAL_TAG_TOKEN:
    this.qualifier = n.value || "*"
    temp_sequence.push(n)
    break

  default:
    this.source.reconsume()
    this.qualifier = "*"

    if (guarantee_tag) {
      temp_sequence.push(UNIVERSAL_TAG_REUSE)
    }
  }

  OUTER:
  while ((n = this.source.next())) {
    switch (n.kind) {
    case ',': case WHITESPACE_TOKEN: case COMBINATOR:
      // Comma is needed by the GroupSelector, and Combinators (including
      //  whitespace) is needed by the main loop, so reconsume
      this.source.reconsume()
      break OUTER

    case ID_TOKEN: case ATTR_TOKEN: case CLASS_TOKEN: case PSEUDO_FUNCTION_TOKEN:
    case PSEUDO_TOKEN:
      temp_sequence.push(n)
      break

    default:
      throw errInvalidSelector
    }
  }

  // Add each part of the sequence to the full result in reverse. This is so
  // that when we traverse a full selector, we can use a right-to-left loop
  // WRT the order of sequences and combinators, but when within a sequence,
  // it will still be as though we were going left to right.
  for (var i = temp_sequence.length-1; i > -1; i-=1) {
    this.parts.push(temp_sequence[i])
  }

  temp_sequence.length = 0
}


/*
`onOrAfter` is used by `sorter()` and checks to see if `b` is on or after `a`
in the DOM by checking to see if it's a match, a next sibling or a descendant
of either.
*/
function onOrAfter(a, b) {
  if (a === b || (a.firstChild && onOrAfter(a.firstChild, b))) {
    return true
  }
  while ((a = a.nextSibling)) {
    if (a.nodeType === 1 && onOrAfter(a, b)) {
      return true
    }
  }
  return false
}

function sorter(a, b) {
  return a === b ? 0 :
          (a.compareDocumentPosition ?
          (a.compareDocumentPosition(b) & 4 ? -1 : 1) :

          a.contains(b) ? -1 :
          b.contains(a) ? 1 :

          // IE 6 supports `.contains()`, so start on the `.nextSibling`
          onOrAfter(a.nextSibling, b) ? -1 : 1)
}
