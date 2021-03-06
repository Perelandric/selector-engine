

/**
 * Represents a group of selectors.
 *
 * @constructor
 * @param {string|Lexer} strLex
 */
function SelectorGroup(strLex) {
  const isLexer = strLex instanceof Lexer

  if (!isLexer && cache.hasOwnProperty(strLex)) {
    return cache[strLex]
  }

  const source = isLexer ? /** @type{!Lexer} */(strLex) : new Lexer(strLex)

  // The selector engine always does a single DOM selection, so if there's more
  // than one distinct qualified name, it does a 'universal' selection.
  this.globalQualifier = ""
  this.selectors = []

  let first = true
  ,   n

  // Continue to compile if any remain, and check `el` at the same time
  while ((n = source.nextAfterSpace())) {
    const isComma = n === COMMA_TOKEN

    if (!first && !isComma && DEBUG) {
      throw errInternal
    }

    if (first) {
      if (!n || isComma) {
        throw errInvalidSelector
      }

      first = false
      source.reconsume()
    }

    const selObject = new Selector(source)

    if (selObject.autoFail) {
      continue // Selectors that will always fail are ignored.
    }

    if (!this.globalQualifier) {
      this.globalQualifier = selObject.qualifier || "*"

    } else if (this.globalQualifier !== selObject.qualifier) {
      this.globalQualifier = "*"
    }

    this.selectors.push(selObject)
  }

  // Cache the selector if it wasn't a Lexer.
  if (!isLexer) {
    cache[strLex] = this
  }
}


/**
 * Attempts to match the given element against any of the selectors in this
 * SelectorGroup.
 *
 * @param {!Element|!Document} root
 * @param {!Element} el
 * @param {boolean} checkQualName
 * @return {boolean}
 */
SelectorGroup.prototype.matches = function(root, el, checkQualName) {
  for (let i = 0, len = this.selectors.length; i < len; i+=1) {
    const sel = this.selectors[i]
    ,     q = sel.qualifier

    // Check the qualifer early to avoid the `compare_selector()` when possible.
    if ((!checkQualName || !q || q === nodeName(el)) &&
      compare_selector(root, el, sel)) {
      return true
    }
  }

  return false
}


/**
 * Fetches the first element that matches any of the selectors in this
 * SelectorGroup from the context of the `root` argument.
 *
 * @param {!Element|!Document} root
 * @return {Element}
 */
SelectorGroup.prototype.selectFirstFrom = function(root) {
  const p = root.getElementsByTagName(this.globalQualifier)
  ,     checkQualName = this.globalQualifier === "*"

  for (let i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i], checkQualName)) {
      return p[i]
    }
  }

  return null
}


/**
 * Fetches all elements that match any of the selectors in this SelectorGroup
 * from the context of the `root` argument.
 *
 * The result is guaranteed to be unique and in document order.
 *
 * @param {!Element|!Document} root
 * @return {Array<!Element>}
 */
SelectorGroup.prototype.selectFrom = function(root) {
  const p = root.getElementsByTagName(this.globalQualifier)
  ,     checkQualName = this.globalQualifier === "*"
  ,     resArr = []

  // TODO: Ultimately want to optimize for `gEBI`, `gEBCN`, `gEBTN`, `:root`
  // when the selector consists entirely of one of those.

  for (let i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i], checkQualName)) {
      resArr.push(p[i])
    }
  }

  return resArr
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
 * @param {!Lexer} source input source for this selector
 */
function Selector(source) {
  const startIdx = source._reconsumed ? source.last_tok_i : source.i + 1
  let endIdx = source.sel.indexOf(source.endChar || ',', startIdx)

  if (endIdx === -1) {
    endIdx = source.sel.length
  }

  const potentialSel = source.sel.slice(startIdx, endIdx).replace(re_trim, "")

  if (selCache.hasOwnProperty(potentialSel)) {
    source._reconsumed = false
    source.i = endIdx-1 // Move ahead to just before the terminating token

    return selCache[potentialSel]
  }

  let doCombinator = false
  ,   n

  this.parts = []

  while ((n = source.next())) {
    // Track if whitespace was found in case it's a descendant combinator.
    const isSpace = n === WHITESPACE_TOKEN

    if (isSpace) {
      n = source.nextAfterSpace()
    }

    if (!n || n === COMMA_TOKEN) {
      source.reconsume()
      break
    }

    if (this.hasPseudoElem) { // A pseudo-element must be the last simple selector
      throw errInvalidSelector
    }

    if (doCombinator) {
      if (source.prevent_combinator) {
        throw errInvalidSelector
      }

      switch (n) {
      case COMBINATOR_CHILD:
      case COMBINATOR_ADJACENT:
      case COMBINATOR_GENERAL:
        this.parts.push(n)
        break

      default:
        if (isSpace) {
          source.reconsume() // reconsume the one after the space
          this.parts.push(COMBINATOR_DESCENDANT)

        } else {
          throw errInvalidSelector
        }
      }

      doCombinator = false

    } else {
      source.reconsume()
      const seq = new Sequence(source, this)
      this.parts.push(seq) // will raise if none found
      this.qualifier = seq.tag
      doCombinator = true
    }
  }

  if (!doCombinator) { // Ended after a combinator
    throw errInvalidSelector
  }

  if (this.autoFail) {
    this.parts = null // Was deemed that it'll never match, so drop all the data
  }

  // We only cache the selector if the endIdx did make a full selector.
  if (endIdx === source.i) {
    selCache[potentialSel] = this
  }
}

// Will hold the right-most tagName to be fetched.
Selector.prototype.autoFail = false
Selector.prototype.hasScope = false
Selector.prototype.hasPseudoElem = false
Selector.prototype.qualifier = ""


/**
 * Parses the stream of tokens into a valid sequence of simple selectors to be
 * added to the current Selector.
 *
 * @constructor
 * @private
 * @param {!Lexer} source input source for this selector
 * @param {!Selector} selector
 */
function Sequence(source, selector) {
  this.sequence = []

  let n = source.nextAfterSpace()

  if (!n || n === COMMA_TOKEN) {
    throw errInvalidSelector
  }

  if (n !== UNIVERSAL_TAG_TOKEN) {
    if (n.kind === TAG_TOKEN) {
      this.tag = n.value.toUpperCase()
    } else {
      source.reconsume()
    }
  }

  OUTER:
  while ((n = source.next())) {
    switch (n) {
    case COMMA_TOKEN: case WHITESPACE_TOKEN: case COMBINATOR_CHILD:
    case COMBINATOR_ADJACENT: case COMBINATOR_GENERAL:
      // Comma is needed by the GroupSelector, and Combinators (including
      //  whitespace) is needed by the main loop, so reconsume
      source.reconsume()
      break OUTER
    }

    if (selector.hasPseudoElem) {
      throw errInvalidSelector
    }

    if (n === PSEUDO_ELEMENT) {
      selector.hasPseudoElem = true
      selector.autoFail = true

    } else if (n === SCOPE) {
      if (selector.hasScope) { // `:scope` in 2 different Sequences fails
        selector.autoFail = true
      }
      this.hasScope = true

    } else {
      switch (n.kind) {
      case PSEUDO_TOKEN: case ID_TOKEN: case ATTR_TOKEN:
      case ATTR_INSENSITIVE_TOKEN: case CLASS_TOKEN: case PSEUDO_FUNCTION_TOKEN:
        this.sequence.push(n)
        break

      default:
        throw errInvalidSelector
      }
    }
  }

  if (this.hasScope) { // Needs to be set down here, to allow `:scope:scope`
    selector.hasScope = true
  }
}

Sequence.prototype.tag = ""
Sequence.prototype.hasScope = false



/*
`onOrAfter` is used by `sorter()` and checks to see if `b` is on or after `a`
in the DOM by checking to see if it's a match, a next sibling or a descendant
of either.
*/
/*
function onOrAfter(a, b) {
  if (a === b || (firstElemChild(a) && onOrAfter(firstElemChild(a), b))) {
    return true
  }
  while ((a = nextElemSib(a))) {
    if (onOrAfter(a, b)) {
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

          // IE 6 supports `.contains()`, so start on the next sibling
          onOrAfter(nextElemSib(a), b) ? -1 : 1)
}
*/
