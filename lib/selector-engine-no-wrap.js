/* TODO:
  Cache individual objects, like ATTR and NTH simple selectors.
  Reorder pseudos so that the ones with highest overhead (like :hover) come last.
*/


/** @define {boolean} */
const DEBUG = false
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
  return new SelectorGroup(selector).matches(elem, elem)
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
const errInvalidSelector = new Error("Invalid selector")
,   errInternal = new Error("Internal error")

,   UNIVERSAL_TAG_TOKEN = "*"
,   PSEUDO_FUNCTION_TOKEN = 2
,   WHITESPACE_TOKEN = 3
,   COMMA_TOKEN = ','

// Combinators
,   COMBINATOR_CHILD = '>'
,   COMBINATOR_DESCENDANT = 6
,   COMBINATOR_ADJACENT = '+'
,   COMBINATOR_GENERAL = '~'


,   ID_TOKEN = 10
,   TAG_TOKEN = 11

,   PSEUDO_TOKEN = 12

,   LANG_TOKEN = 13
,   NTH_CHILD_TOKEN = 14
,   NTH_LAST_CHILD_TOKEN = 15
,   NTH_OF_TYPE_TOKEN = 16
,   NTH_LAST_OF_TYPE_TOKEN = 17

,   CLASS_TOKEN = 18
,   NOT_TOKEN = 19


,   ATTR_TOKEN = 20
// Attr SubKinds
,   HAS_ATTR_TOKEN = 21
,   INCLUDE_MATCH_TOKEN = "~="
,   DASH_MATCH_TOKEN = "|="
,   PREFIX_MATCH_TOKEN = "^="
,   SUFFIX_MATCH_TOKEN = "$="
,   SUBSTRING_MATCH_TOKEN = "*="
,   EQUAL_ATTR_TOKEN = '='

,   SCOPE = 22 // :scope pseudo class
,   MATCHES_TOKEN = 23 // :matches pseudo function
,   ATTR_INSENSITIVE_TOKEN = 24 // case insensitive attribute values

// Pseudo elements
,   PSEUDO_ELEMENT = 25 // subKind for pseudo-elements

,   re_consumeName =
      /^-?(?:[_a-zA-Z\u0080-\uFFFF]|\\[^\n]?|--\d?)(?:[-\w\u0080-\uFFFF]|\\[^\n]?)*/


  // 1: name
  // 2: equal operators
  // 3: quoted value
  // 4: unquoted value
  // 5: insensitive indicator
,   re_Attr = new RegExp(
  "^\\s*(" + re_consumeName.source.slice(1) + ")" + // name
  "\\s*(?:" + // starts optional operator and value
    "([$^*~|]?=)" + // operator
    "\\s*(?:((?:'(?:[^'\\n]|\\\\\\n)*')|(?:\"(?:[^\"\\n]|\\\\\\n)*\"))|" + // quoted val
    "(" + re_consumeName.source.slice(1) + "))" + // or unquoted val
  ")?\\s*([iI]?)\\s*]") // end of optional operator and value + `]`


  // 1: Entire string is a valid number
  // 2: First number (before `n`)
  // 3: + or - for second number
  // 4: second number (combine it with #3)
  // 5: even
  // 6: odd
,   re_makeNth =
      /^(?:([-+]?\d+)|([-+]?\d*)?n\s*(?:([-+])\s*(\d+))?|(even)|(odd))\s*\)/i

/**
 * @constructor
 * @private
 * @param {(string|number)} kind
 * @param {(string|number|!SelectorGroup)=} value
 * @param {*=} subKind
 */
function Token(kind, value, subKind) {
  this.kind = kind
  this.value = value
  this.subKind = subKind
}
Token.prototype.name = "" // Used for functions and attribute selectors
Token.prototype.a = 0
Token.prototype.b = 0


/*
  const re_lex = new RegExp(
    "^(?:" +
      "([ \t\n]+)|" + // 1. Whitespace
      "(,)|" +        // 2. Comma
      "(>)|" +        // 3. Right angle bracket
      "(\+)|" +       // 4. Plus sign
      "(~)|" +        // 5. Tilde

      // 6. Pseudo, 7. PseudoElement
      "(:(:?)" + re_consumeName.source.slice(1) + "(\(getPseudoFunction\))?)|" +

      "(\[re_Attr\])|" + // 8. Attr
      "(\*)|" +       // 9. Asterisk (universal)

      // 10. ID, 11. Class, 12. Name
      "(?:(#)|(\.)" + re_consumeName.source.slice(1) + ")" +
    ")"
  )
*/

/**
 * @constructor
 * @param {string|Lexer} source
 * @param {string=} endChar
 * @param {boolean=} prevent_not
 * @param {boolean=} prevent_combinator
 */
function Lexer(source, endChar, prevent_not, prevent_combinator) {
  if (source instanceof Lexer) {
    this.sel = source.sel
    this.i = source.i
    this.last_tok_i = source.last_tok_i
    this.origTok = source
  } else {
    this.sel = source
    this.i = -1
    this.last_tok_i = -1 // Used only for the Selector cache.
  }

  this.prevent_not = !!prevent_not
  this.prevent_combinator = !!prevent_combinator
  this.endChar = endChar || ""

  this._reconsumed = false

  this.curr = this.next() // Prime it with the first value.
  this.reconsume()        // Because we pre-fetched the first value.
}


const arrEmptyString = [""]


/**
 * @return {Token|string|number}
 */
Lexer.prototype.next = function() {
  if (this._reconsumed) {
    this._reconsumed = false
    return this.curr
  }

  // Strict equality, since `undefined` is uninitialized, and `null` is closed.
  if (this.curr === null) {
    return this.curr // May have been manually set to `null` below
  }

  var r = getChar(this.sel, this.i+=1)
  ,   temp = ""
  ,   parts

  this.last_tok_i = this.i

  if (!r || r === this.endChar) {
    if (this.origTok) {
      this.origTok.i = this.i
      this.origTok = null
    }
    this.curr = null
    return this.curr
  }

  switch(r) {
  // Comma or "*"
  case COMMA_TOKEN:
  case UNIVERSAL_TAG_TOKEN:

  // Combinators (not descendant ' ')
  case COMBINATOR_CHILD:
  case COMBINATOR_ADJACENT:
  case COMBINATOR_GENERAL:
    this.curr = r
    break

  // Pseudo
  case ':':
    var verifyPseudoElem = false
    ,   name = ""

    if (getChar(this.sel, this.i + 1) === ':') {
      this.i+=1 // Discard
      verifyPseudoElem = true
    }

    name = (re_consumeName.exec(
      this.sel.slice(this.i+1)) || arrEmptyString)[0].toLowerCase()

    this.i += name.length

    if (getChar(this.sel, this.i + 1) === '(') { // Pseudo function
      this.i+=1 // Discard
      this.curr = this.getPseudoFunction(name)

    } else {
      this.curr = new Token(PSEUDO_TOKEN, name, pseudoClassFns[name])
    }

    if (!this.curr || !this.curr.subKind) {
      switch (name) {
      case "scope":
        this.curr = SCOPE
        break
      case "first-line":
      case "first-letter":
      case "before":
      case "after":
        this.curr = PSEUDO_ELEMENT
      }
    }

    if (verifyPseudoElem && this.curr !== PSEUDO_ELEMENT) {
      throw errInvalidSelector
    }

    break

  // Attribute
  case '[':
    parts = re_Attr.exec(this.sel.slice(this.i+1))

    if (!parts) {
      throw errInvalidSelector
    }
    this.i += parts[0].length

    this.curr = new Token(
      parts[5] ? ATTR_INSENSITIVE_TOKEN : ATTR_TOKEN,
      parts[3] ? parts[3].slice(1, -1) : parts[4],
      parts[2] || HAS_ATTR_TOKEN
    )
    this.curr.name = parts[1]

    if (parts[5]) { // case insensitive
      if (parts[2]) { // checks a value
        this.curr.value = this.curr.value.toLowerCase()
      } else {
        throw errInvalidSelector
      }
    }
    break


  // ID, CLASS, TAG or Whitespace
  default:
    var t = countSpacesAt(this.sel, this.i)

    if (t > 0) {
      this.i += t-1
      this.curr = WHITESPACE_TOKEN
      break
    }

    t = r === '#' ? ID_TOKEN : r === '.' ? CLASS_TOKEN : TAG_TOKEN

    if (t === TAG_TOKEN) {
      this.i -= 1 // make sure we include the first character for a tag
    }

    if ((temp = re_consumeName.exec(this.sel.slice(this.i+1)))) {
      this.i += temp[0].length
      this.curr = new Token(t, temp[0])
      break
    }

    throw errInvalidSelector
  }

  return this.curr
}


Lexer.prototype.getPseudoFunction = function(name) {
  switch (name.toLowerCase()) {

  //case "has":

  case "not":
    if (this.prevent_not) {
      throw errInvalidSelector
    }

    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', true, true)),
      NOT_TOKEN
    )

  case "matches":
    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', false, true)),
      MATCHES_TOKEN
    )
    break

  case "lang":
    // New Lexer with the same source that halts on `)`
    const lex = new Lexer(this, ')')
    ,     n = lex.nextAfterSpace()

    if (n.kind === TAG_TOKEN && !lex.nextAfterSpace()) {
      // Comes through as a TAG, so relabel
      n.kind = PSEUDO_FUNCTION_TOKEN
      n.subKind = LANG_TOKEN
      return n

    } else {
      throw errInvalidSelector
    }


  case "nth-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_CHILD_TOKEN))

  case "nth-last-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_CHILD_TOKEN))

  case "nth-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_OF_TYPE_TOKEN))

  case "nth-last-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_OF_TYPE_TOKEN))

  default:
    throw errInvalidSelector
  }
}


Lexer.prototype.reconsume = function() {
  if (DEBUG && this._reconsumed) {
    throw errInternal
  }
  this._reconsumed = true
}

/**
 * @return {Token|string|number}
 */
Lexer.prototype.nextAfterSpace = function() {
  while (this.next() === WHITESPACE_TOKEN) {
  }

  return this.curr
}


/**
 * @param {!Token} n
 * @return {!Token}
 */
Lexer.prototype.makeNth = function(n) {
  var a = 0
  ,   b = 0

  const parts = re_makeNth.exec(this.sel.slice(this.i+1))

  if (!parts) {
    throw errInvalidSelector
  }
  this.i += parts[0].length

  if (parts[1]) {
    b = +parts[1] // When only a number, it gets assigned to `b` position

  } else if (parts[5]) {
    a = 2

  } else if (parts[6]) {
    a = 2
    b = 1

  } else {
    const aStr = parts[2]
    ,     bStr = parts[3] + parts[4]

    if (!aStr || aStr === '+' || aStr === '-') {
      // If '-', -1 else must be '+' or empty string, so 1
      a = aStr === '-' ? -1 : 1

    } else {
      a = +aStr
    }

    if (bStr) {
      b = +bStr
    }

    if (DEBUG && (isNaN(a) || isNaN(b))) {
      throw errInternal
    }
  }

  n.value = [a, b]

  return n
}


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

  var first = true
  ,   n

  // Continue to compile if any remain, and check `el` at the same time
  while ((n = source.nextAfterSpace())) {
    var isComma = n === COMMA_TOKEN

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
      this.globalQualifier = selObject.tag

    } else if (this.globalQualifier !== selObject.tag) {
      this.globalQualifier = "*"
    }

    if (!this.globalQualifier) {
      this.globalQualifier = "*"
    }
    this.checkName = this.globalQualifier === "*"

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
 * @return {boolean}
 */
SelectorGroup.prototype.matches = function(root, el) {
  for (var i = 0, len = this.selectors.length; i < len; i+=1) {
    var sel = this.selectors[i]
    ,   q = sel.parts[sel.parts.length-1].tag

    // Check the qualifer early to avoid the `compare_selector()` when possible.
    if ((!this.checkName || !q || q === nodeName(el)) && compare_selector(root, el, sel)) {
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

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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
  const resArr = []

  // TODO: Ultimately want to optimize for `gEBI`, `gEBCN`, `gEBTN`, `:root`
  // when the selector consists entirely of one of those.

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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

  this.parts = []

  while ((n = source.next())) {
    // Track if whitespace was found in case it's a descendant combinator.
    var isSpace = n === WHITESPACE_TOKEN

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
      this.parts.push(new Sequence(source, this)) // will raise if none found
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

  var n = source.nextAfterSpace()

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
  for (var j = selector.parts.length-1, combinator = 0; j > -1; j-=1) {
    var part = selector.parts[j]
    ,   haltOnFail = false
    ,   currEl = null

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

  for (var i = 0, sequence = seq.sequence; i < sequence.length; i++) {
    var simple = sequence[i]

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
        if (!simple.value["matches"](el)) { continue }
        return false

      case MATCHES_TOKEN:
        if (simple.value["matches"](el)) { continue }
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
        var tempEl = el
        while (tempEl && !tempEl.lang) { tempEl = tempEl.parentNode }

        if (tempEl && dashMatch(tempEl.lang, simple.value)) { continue }
        return false
      }


    // Attribute selectors
    case ATTR_TOKEN:
    case ATTR_INSENSITIVE_TOKEN:
      var attrVal = getAttr(el, simple.name)
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
  var idx = 0

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

    var helper = hoverHelper
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


/**
 * @param {!string} s
 * @param {!number} i
 * @return {string|undefined}
 */
function getChar(s, i) {
  return LEGACY ? s.charAt(i) : s[i]
}


/**
 * Returns the number of consecutive spaces found starting at the given index or
 * -1 if the index was out of bounds.
 *
 * @param {!string} s
 * @param {!number} i
 * @return {number}
 */
function countSpacesAt(s, i) {
  var res = 0

  for (;;) {
    switch((getChar(s, i+res) || "")) {
    case ' ': case '\t': case '\n':
      res += 1
      continue

    case "":
      return res || -1
    }
    return res
  }
}


/**
 * @param {!Array<*>} coll
 * @param {!*} target
 * @return {boolean}
 */
function contains(coll, target) {
  for (var i = 0, len = coll.length; i < len; i+=1) {
    if (coll[i] === target) {
      return true
    }
  }
  return false
}


 /**
 * @param {!Node} el
 * @return {string}
 */
function nodeName(el) {
  if (LEGACY) {
    /*
    var n = el.nodeName.toUpperCase()

    if (needTagFix && getChar(n, 0) === '/') {
      return n.slice(1)
    } else {
      return n
    }
    */
    return el.nodeName.toUpperCase()

  } else {
    return el.nodeName
  }
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
  return nodeName(el) === "INPUT" &&
        (el.type === "number" ||
         (el.type === "text" && (hasAttr(el, "min") || hasAttr(el, "max"))))
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function checkBooleanAttr(el, name) {
  return el[name] || hasAttr(el, name)
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function hasAttr(el, name) {
  if (LEGACY) {
    return !!(!el.attributes[name] && name === "class" ?
                el.attributes["className"] :
                el.attributes[name])
  } else {
    return !!el.attributes[name]
  }
}


const reuse_obj = {}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {string|undefined}
 */
function getAttr(el, name) {
  if (LEGACY) {
    return ((!el.attributes[name] && name === "class" ?
              el.attributes["className"] :
              el.attributes[name]) || reuse_obj).value
  } else {
    return (el.attributes[name] || reuse_obj).value
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function parentElement(el) {
  if (LEGACY) {
    const par = /**@type{Element}*/(el.parentNode)
    return par && par.nodeType === Node.ELEMENT_NODE ? par : null
  } else {
    return el.parentElement
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function prevElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.previousSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.previousElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function nextElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.nextSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.nextElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function firstElemChild(el) {
  if (LEGACY) {
    if (el.firstChild && el.firstChild.nodeType !== Node.ELEMENT_NODE) {
      return nextElemSib(el.firstChild)
    } else {
      return /**@type{Element}*/(el.firstChild)
    }
  } else {
    return el.firstElementChild
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function lastElemChild(el) {
  if (LEGACY) {
    if (el.lastChild && el.lastChild.nodeType !== Node.ELEMENT_NODE) {
      return prevElemSib(el.lastChild)
    } else {
      return /**@type{Element}*/(el.lastChild)
    }
  } else {
    return el.lastElementChild
  }
}
/* TODO:
  Cache individual objects, like ATTR and NTH simple selectors.
  Reorder pseudos so that the ones with highest overhead (like :hover) come last.
*/


/** @define {boolean} */
const DEBUG = false
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
  return new SelectorGroup(selector).matches(elem, elem)
}
const errInvalidSelector = new Error("Invalid selector")
,   errInternal = new Error("Internal error")

,   UNIVERSAL_TAG_TOKEN = "*"
,   PSEUDO_FUNCTION_TOKEN = 2
,   WHITESPACE_TOKEN = 3
,   COMMA_TOKEN = ','

// Combinators
,   COMBINATOR_CHILD = '>'
,   COMBINATOR_DESCENDANT = 6
,   COMBINATOR_ADJACENT = '+'
,   COMBINATOR_GENERAL = '~'


,   ID_TOKEN = 10
,   TAG_TOKEN = 11

,   PSEUDO_TOKEN = 12

,   LANG_TOKEN = 13
,   NTH_CHILD_TOKEN = 14
,   NTH_LAST_CHILD_TOKEN = 15
,   NTH_OF_TYPE_TOKEN = 16
,   NTH_LAST_OF_TYPE_TOKEN = 17

,   CLASS_TOKEN = 18
,   NOT_TOKEN = 19


,   ATTR_TOKEN = 20
// Attr SubKinds
,   HAS_ATTR_TOKEN = 21
,   INCLUDE_MATCH_TOKEN = "~="
,   DASH_MATCH_TOKEN = "|="
,   PREFIX_MATCH_TOKEN = "^="
,   SUFFIX_MATCH_TOKEN = "$="
,   SUBSTRING_MATCH_TOKEN = "*="
,   EQUAL_ATTR_TOKEN = '='

,   SCOPE = 22 // :scope pseudo class
,   MATCHES_TOKEN = 23 // :matches pseudo function
,   ATTR_INSENSITIVE_TOKEN = 24 // case insensitive attribute values

// Pseudo elements
,   PSEUDO_ELEMENT = 25 // subKind for pseudo-elements

,   re_consumeName =
      /^-?(?:[_a-zA-Z\u0080-\uFFFF]|\\[^\n]?|--\d?)(?:[-\w\u0080-\uFFFF]|\\[^\n]?)*/


  // 1: name
  // 2: equal operators
  // 3: quoted value
  // 4: unquoted value
  // 5: insensitive indicator
,   re_Attr = new RegExp(
  "^\\s*(" + re_consumeName.source.slice(1) + ")" + // name
  "\\s*(?:" + // starts optional operator and value
    "([$^*~|]?=)" + // operator
    "\\s*(?:((?:'(?:[^'\\n]|\\\\\\n)*')|(?:\"(?:[^\"\\n]|\\\\\\n)*\"))|" + // quoted val
    "(" + re_consumeName.source.slice(1) + "))" + // or unquoted val
  ")?\\s*([iI]?)\\s*]") // end of optional operator and value + `]`


  // 1: Entire string is a valid number
  // 2: First number (before `n`)
  // 3: + or - for second number
  // 4: second number (combine it with #3)
  // 5: even
  // 6: odd
,   re_makeNth =
      /^(?:([-+]?\d+)|([-+]?\d*)?n\s*(?:([-+])\s*(\d+))?|(even)|(odd))\s*\)/i

/**
 * @constructor
 * @private
 * @param {(string|number)} kind
 * @param {(string|number|!SelectorGroup)=} value
 * @param {*=} subKind
 */
function Token(kind, value, subKind) {
  this.kind = kind
  this.value = value
  this.subKind = subKind
}
Token.prototype.name = "" // Used for functions and attribute selectors
Token.prototype.a = 0
Token.prototype.b = 0


/*
  const re_lex = new RegExp(
    "^(?:" +
      "([ \t\n]+)|" + // 1. Whitespace
      "(,)|" +        // 2. Comma
      "(>)|" +        // 3. Right angle bracket
      "(\+)|" +       // 4. Plus sign
      "(~)|" +        // 5. Tilde

      // 6. Pseudo, 7. PseudoElement
      "(:(:?)" + re_consumeName.source.slice(1) + "(\(getPseudoFunction\))?)|" +

      "(\[re_Attr\])|" + // 8. Attr
      "(\*)|" +       // 9. Asterisk (universal)

      // 10. ID, 11. Class, 12. Name
      "(?:(#)|(\.)" + re_consumeName.source.slice(1) + ")" +
    ")"
  )
*/

/**
 * @constructor
 * @param {string|Lexer} source
 * @param {string=} endChar
 * @param {boolean=} prevent_not
 * @param {boolean=} prevent_combinator
 */
function Lexer(source, endChar, prevent_not, prevent_combinator) {
  if (source instanceof Lexer) {
    this.sel = source.sel
    this.i = source.i
    this.last_tok_i = source.last_tok_i
    this.origTok = source
  } else {
    this.sel = source
    this.i = -1
    this.last_tok_i = -1 // Used only for the Selector cache.
  }

  this.prevent_not = !!prevent_not
  this.prevent_combinator = !!prevent_combinator
  this.endChar = endChar || ""

  this._reconsumed = false

  this.curr = this.next() // Prime it with the first value.
  this.reconsume()        // Because we pre-fetched the first value.
}


const arrEmptyString = [""]


/**
 * @return {Token|string|number}
 */
Lexer.prototype.next = function() {
  if (this._reconsumed) {
    this._reconsumed = false
    return this.curr
  }

  // Strict equality, since `undefined` is uninitialized, and `null` is closed.
  if (this.curr === null) {
    return this.curr // May have been manually set to `null` below
  }

  var r = getChar(this.sel, this.i+=1)
  ,   temp = ""
  ,   parts

  this.last_tok_i = this.i

  if (!r || r === this.endChar) {
    if (this.origTok) {
      this.origTok.i = this.i
      this.origTok = null
    }
    this.curr = null
    return this.curr
  }

  switch(r) {
  // Comma or "*"
  case COMMA_TOKEN:
  case UNIVERSAL_TAG_TOKEN:

  // Combinators (not descendant ' ')
  case COMBINATOR_CHILD:
  case COMBINATOR_ADJACENT:
  case COMBINATOR_GENERAL:
    this.curr = r
    break

  // Pseudo
  case ':':
    var verifyPseudoElem = false
    ,   name = ""

    if (getChar(this.sel, this.i + 1) === ':') {
      this.i+=1 // Discard
      verifyPseudoElem = true
    }

    name = (re_consumeName.exec(
      this.sel.slice(this.i+1)) || arrEmptyString)[0].toLowerCase()

    this.i += name.length

    if (getChar(this.sel, this.i + 1) === '(') { // Pseudo function
      this.i+=1 // Discard
      this.curr = this.getPseudoFunction(name)

    } else {
      this.curr = new Token(PSEUDO_TOKEN, name, pseudoClassFns[name])
    }

    if (!this.curr || !this.curr.subKind) {
      switch (name) {
      case "scope":
        this.curr = SCOPE
        break
      case "first-line":
      case "first-letter":
      case "before":
      case "after":
        this.curr = PSEUDO_ELEMENT
      }
    }

    if (verifyPseudoElem && this.curr !== PSEUDO_ELEMENT) {
      throw errInvalidSelector
    }

    break

  // Attribute
  case '[':
    parts = re_Attr.exec(this.sel.slice(this.i+1))

    if (!parts) {
      throw errInvalidSelector
    }
    this.i += parts[0].length

    this.curr = new Token(
      parts[5] ? ATTR_INSENSITIVE_TOKEN : ATTR_TOKEN,
      parts[3] ? parts[3].slice(1, -1) : parts[4],
      parts[2] || HAS_ATTR_TOKEN
    )
    this.curr.name = parts[1]

    if (parts[5]) { // case insensitive
      if (parts[2]) { // checks a value
        this.curr.value = this.curr.value.toLowerCase()
      } else {
        throw errInvalidSelector
      }
    }
    break


  // ID, CLASS, TAG or Whitespace
  default:
    var t = countSpacesAt(this.sel, this.i)

    if (t > 0) {
      this.i += t-1
      this.curr = WHITESPACE_TOKEN
      break
    }

    t = r === '#' ? ID_TOKEN : r === '.' ? CLASS_TOKEN : TAG_TOKEN

    if (t === TAG_TOKEN) {
      this.i -= 1 // make sure we include the first character for a tag
    }

    if ((temp = re_consumeName.exec(this.sel.slice(this.i+1)))) {
      this.i += temp[0].length
      this.curr = new Token(t, temp[0])
      break
    }

    throw errInvalidSelector
  }

  return this.curr
}


Lexer.prototype.getPseudoFunction = function(name) {
  switch (name.toLowerCase()) {

  //case "has":

  case "not":
    if (this.prevent_not) {
      throw errInvalidSelector
    }

    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', true, true)),
      NOT_TOKEN
    )

  case "matches":
    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', false, true)),
      MATCHES_TOKEN
    )
    break

  case "lang":
    // New Lexer with the same source that halts on `)`
    const lex = new Lexer(this, ')')
    ,     n = lex.nextAfterSpace()

    if (n.kind === TAG_TOKEN && !lex.nextAfterSpace()) {
      // Comes through as a TAG, so relabel
      n.kind = PSEUDO_FUNCTION_TOKEN
      n.subKind = LANG_TOKEN
      return n

    } else {
      throw errInvalidSelector
    }


  case "nth-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_CHILD_TOKEN))

  case "nth-last-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_CHILD_TOKEN))

  case "nth-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_OF_TYPE_TOKEN))

  case "nth-last-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_OF_TYPE_TOKEN))

  default:
    throw errInvalidSelector
  }
}


Lexer.prototype.reconsume = function() {
  if (DEBUG && this._reconsumed) {
    throw errInternal
  }
  this._reconsumed = true
}

/**
 * @return {Token|string|number}
 */
Lexer.prototype.nextAfterSpace = function() {
  while (this.next() === WHITESPACE_TOKEN) {
  }

  return this.curr
}


/**
 * @param {!Token} n
 * @return {!Token}
 */
Lexer.prototype.makeNth = function(n) {
  var a = 0
  ,   b = 0

  const parts = re_makeNth.exec(this.sel.slice(this.i+1))

  if (!parts) {
    throw errInvalidSelector
  }
  this.i += parts[0].length

  if (parts[1]) {
    b = +parts[1] // When only a number, it gets assigned to `b` position

  } else if (parts[5]) {
    a = 2

  } else if (parts[6]) {
    a = 2
    b = 1

  } else {
    const aStr = parts[2]
    ,     bStr = parts[3] + parts[4]

    if (!aStr || aStr === '+' || aStr === '-') {
      // If '-', -1 else must be '+' or empty string, so 1
      a = aStr === '-' ? -1 : 1

    } else {
      a = +aStr
    }

    if (bStr) {
      b = +bStr
    }

    if (DEBUG && (isNaN(a) || isNaN(b))) {
      throw errInternal
    }
  }

  n.value = [a, b]

  return n
}


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

  var first = true
  ,   n

  // Continue to compile if any remain, and check `el` at the same time
  while ((n = source.nextAfterSpace())) {
    var isComma = n === COMMA_TOKEN

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
 * @return {boolean}
 */
SelectorGroup.prototype.matches = function(root, el) {
  const qual = this.globalQualifier
  ,     qualIsName = qual !== "*"

  for (var i = 0, len = this.selectors.length; i < len; i+=1) {
    const sel = this.selectors[i]
    ,     q = qualIsName ? qual : sel.qualifier

    // Check the qualifer early to avoid the `compare_selector()` when possible.
    if ((!q || q === nodeName(el)) && (!compare_selector(root, el, sel)) {
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

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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
  const resArr = []

  // TODO: Ultimately want to optimize for `gEBI`, `gEBCN`, `gEBTN`, `:root`
  // when the selector consists entirely of one of those.

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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

  this.parts = []

  while ((n = source.next())) {
    // Track if whitespace was found in case it's a descendant combinator.
    var isSpace = n === WHITESPACE_TOKEN

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

  var n = source.nextAfterSpace()

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
  var currEl = el

  // Process starting at the end so that we're doing a RtoL evaluation.
  for (var j = selector.parts.length-1, combinator = 0; j > -1; j-=1) {
    var part = selector.parts[j]
    ,   haltOnFail = false

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

  for (var i = 0, sequence = seq.sequence; i < sequence.length; i++) {
    var simple = sequence[i]

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
        if (!simple.value["matches"](el)) { continue }
        return false

      case MATCHES_TOKEN:
        if (simple.value["matches"](el)) { continue }
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
        var tempEl = el
        while (tempEl && !tempEl.lang) { tempEl = tempEl.parentNode }

        if (tempEl && dashMatch(tempEl.lang, simple.value)) { continue }
        return false
      }


    // Attribute selectors
    case ATTR_TOKEN:
    case ATTR_INSENSITIVE_TOKEN:
      var attrVal = getAttr(el, simple.name)
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
  var idx = 0

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

    var helper = hoverHelper
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


/**
 * @param {!string} s
 * @param {!number} i
 * @return {string|undefined}
 */
function getChar(s, i) {
  return LEGACY ? s.charAt(i) : s[i]
}


/**
 * Returns the number of consecutive spaces found starting at the given index or
 * -1 if the index was out of bounds.
 *
 * @param {!string} s
 * @param {!number} i
 * @return {number}
 */
function countSpacesAt(s, i) {
  var res = 0

  for (;;) {
    switch((getChar(s, i+res) || "")) {
    case ' ': case '\t': case '\n':
      res += 1
      continue

    case "":
      return res || -1
    }
    return res
  }
}


/**
 * @param {!Array<*>} coll
 * @param {!*} target
 * @return {boolean}
 */
function contains(coll, target) {
  for (var i = 0, len = coll.length; i < len; i+=1) {
    if (coll[i] === target) {
      return true
    }
  }
  return false
}


 /**
 * @param {!Node} el
 * @return {string}
 */
function nodeName(el) {
  if (LEGACY) {
    /*
    var n = el.nodeName.toUpperCase()

    if (needTagFix && getChar(n, 0) === '/') {
      return n.slice(1)
    } else {
      return n
    }
    */
    return el.nodeName.toUpperCase()

  } else {
    return el.nodeName
  }
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
  return nodeName(el) === "INPUT" &&
        (el.type === "number" ||
         (el.type === "text" && (hasAttr(el, "min") || hasAttr(el, "max"))))
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function checkBooleanAttr(el, name) {
  return el[name] || hasAttr(el, name)
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function hasAttr(el, name) {
  if (LEGACY) {
    return !!(!el.attributes[name] && name === "class" ?
                el.attributes["className"] :
                el.attributes[name])
  } else {
    return !!el.attributes[name]
  }
}


const reuse_obj = {}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {string|undefined}
 */
function getAttr(el, name) {
  if (LEGACY) {
    return ((!el.attributes[name] && name === "class" ?
              el.attributes["className"] :
              el.attributes[name]) || reuse_obj).value
  } else {
    return (el.attributes[name] || reuse_obj).value
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function parentElement(el) {
  if (LEGACY) {
    const par = /**@type{Element}*/(el.parentNode)
    return par && par.nodeType === Node.ELEMENT_NODE ? par : null
  } else {
    return el.parentElement
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function prevElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.previousSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.previousElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function nextElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.nextSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.nextElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function firstElemChild(el) {
  if (LEGACY) {
    if (el.firstChild && el.firstChild.nodeType !== Node.ELEMENT_NODE) {
      return nextElemSib(el.firstChild)
    } else {
      return /**@type{Element}*/(el.firstChild)
    }
  } else {
    return el.firstElementChild
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function lastElemChild(el) {
  if (LEGACY) {
    if (el.lastChild && el.lastChild.nodeType !== Node.ELEMENT_NODE) {
      return prevElemSib(el.lastChild)
    } else {
      return /**@type{Element}*/(el.lastChild)
    }
  } else {
    return el.lastElementChild
  }
}
/* TODO:
  Cache individual objects, like ATTR and NTH simple selectors.
  Reorder pseudos so that the ones with highest overhead (like :hover) come last.
*/


/** @define {boolean} */
const DEBUG = false
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
  return new SelectorGroup(selector).matches(elem, elem)
}
const errInvalidSelector = new Error("Invalid selector")
,   errInternal = new Error("Internal error")

,   UNIVERSAL_TAG_TOKEN = "*"
,   PSEUDO_FUNCTION_TOKEN = 2
,   WHITESPACE_TOKEN = 3
,   COMMA_TOKEN = ','

// Combinators
,   COMBINATOR_CHILD = '>'
,   COMBINATOR_DESCENDANT = 6
,   COMBINATOR_ADJACENT = '+'
,   COMBINATOR_GENERAL = '~'


,   ID_TOKEN = 10
,   TAG_TOKEN = 11

,   PSEUDO_TOKEN = 12

,   LANG_TOKEN = 13
,   NTH_CHILD_TOKEN = 14
,   NTH_LAST_CHILD_TOKEN = 15
,   NTH_OF_TYPE_TOKEN = 16
,   NTH_LAST_OF_TYPE_TOKEN = 17

,   CLASS_TOKEN = 18
,   NOT_TOKEN = 19


,   ATTR_TOKEN = 20
// Attr SubKinds
,   HAS_ATTR_TOKEN = 21
,   INCLUDE_MATCH_TOKEN = "~="
,   DASH_MATCH_TOKEN = "|="
,   PREFIX_MATCH_TOKEN = "^="
,   SUFFIX_MATCH_TOKEN = "$="
,   SUBSTRING_MATCH_TOKEN = "*="
,   EQUAL_ATTR_TOKEN = '='

,   SCOPE = 22 // :scope pseudo class
,   MATCHES_TOKEN = 23 // :matches pseudo function
,   ATTR_INSENSITIVE_TOKEN = 24 // case insensitive attribute values

// Pseudo elements
,   PSEUDO_ELEMENT = 25 // subKind for pseudo-elements

,   re_consumeName =
      /^-?(?:[_a-zA-Z\u0080-\uFFFF]|\\[^\n]?|--\d?)(?:[-\w\u0080-\uFFFF]|\\[^\n]?)*/


  // 1: name
  // 2: equal operators
  // 3: quoted value
  // 4: unquoted value
  // 5: insensitive indicator
,   re_Attr = new RegExp(
  "^\\s*(" + re_consumeName.source.slice(1) + ")" + // name
  "\\s*(?:" + // starts optional operator and value
    "([$^*~|]?=)" + // operator
    "\\s*(?:((?:'(?:[^'\\n]|\\\\\\n)*')|(?:\"(?:[^\"\\n]|\\\\\\n)*\"))|" + // quoted val
    "(" + re_consumeName.source.slice(1) + "))" + // or unquoted val
  ")?\\s*([iI]?)\\s*]") // end of optional operator and value + `]`


  // 1: Entire string is a valid number
  // 2: First number (before `n`)
  // 3: + or - for second number
  // 4: second number (combine it with #3)
  // 5: even
  // 6: odd
,   re_makeNth =
      /^(?:([-+]?\d+)|([-+]?\d*)?n\s*(?:([-+])\s*(\d+))?|(even)|(odd))\s*\)/i

/**
 * @constructor
 * @private
 * @param {(string|number)} kind
 * @param {(string|number|!SelectorGroup)=} value
 * @param {*=} subKind
 */
function Token(kind, value, subKind) {
  this.kind = kind
  this.value = value
  this.subKind = subKind
}
Token.prototype.name = "" // Used for functions and attribute selectors
Token.prototype.a = 0
Token.prototype.b = 0


/*
  const re_lex = new RegExp(
    "^(?:" +
      "([ \t\n]+)|" + // 1. Whitespace
      "(,)|" +        // 2. Comma
      "(>)|" +        // 3. Right angle bracket
      "(\+)|" +       // 4. Plus sign
      "(~)|" +        // 5. Tilde

      // 6. Pseudo, 7. PseudoElement
      "(:(:?)" + re_consumeName.source.slice(1) + "(\(getPseudoFunction\))?)|" +

      "(\[re_Attr\])|" + // 8. Attr
      "(\*)|" +       // 9. Asterisk (universal)

      // 10. ID, 11. Class, 12. Name
      "(?:(#)|(\.)" + re_consumeName.source.slice(1) + ")" +
    ")"
  )
*/

/**
 * @constructor
 * @param {string|Lexer} source
 * @param {string=} endChar
 * @param {boolean=} prevent_not
 * @param {boolean=} prevent_combinator
 */
function Lexer(source, endChar, prevent_not, prevent_combinator) {
  if (source instanceof Lexer) {
    this.sel = source.sel
    this.i = source.i
    this.last_tok_i = source.last_tok_i
    this.origTok = source
  } else {
    this.sel = source
    this.i = -1
    this.last_tok_i = -1 // Used only for the Selector cache.
  }

  this.prevent_not = !!prevent_not
  this.prevent_combinator = !!prevent_combinator
  this.endChar = endChar || ""

  this._reconsumed = false

  this.curr = this.next() // Prime it with the first value.
  this.reconsume()        // Because we pre-fetched the first value.
}


const arrEmptyString = [""]


/**
 * @return {Token|string|number}
 */
Lexer.prototype.next = function() {
  if (this._reconsumed) {
    this._reconsumed = false
    return this.curr
  }

  // Strict equality, since `undefined` is uninitialized, and `null` is closed.
  if (this.curr === null) {
    return this.curr // May have been manually set to `null` below
  }

  var r = getChar(this.sel, this.i+=1)
  ,   temp = ""
  ,   parts

  this.last_tok_i = this.i

  if (!r || r === this.endChar) {
    if (this.origTok) {
      this.origTok.i = this.i
      this.origTok = null
    }
    this.curr = null
    return this.curr
  }

  switch(r) {
  // Comma or "*"
  case COMMA_TOKEN:
  case UNIVERSAL_TAG_TOKEN:

  // Combinators (not descendant ' ')
  case COMBINATOR_CHILD:
  case COMBINATOR_ADJACENT:
  case COMBINATOR_GENERAL:
    this.curr = r
    break

  // Pseudo
  case ':':
    var verifyPseudoElem = false
    ,   name = ""

    if (getChar(this.sel, this.i + 1) === ':') {
      this.i+=1 // Discard
      verifyPseudoElem = true
    }

    name = (re_consumeName.exec(
      this.sel.slice(this.i+1)) || arrEmptyString)[0].toLowerCase()

    this.i += name.length

    if (getChar(this.sel, this.i + 1) === '(') { // Pseudo function
      this.i+=1 // Discard
      this.curr = this.getPseudoFunction(name)

    } else {
      this.curr = new Token(PSEUDO_TOKEN, name, pseudoClassFns[name])
    }

    if (!this.curr || !this.curr.subKind) {
      switch (name) {
      case "scope":
        this.curr = SCOPE
        break
      case "first-line":
      case "first-letter":
      case "before":
      case "after":
        this.curr = PSEUDO_ELEMENT
      }
    }

    if (verifyPseudoElem && this.curr !== PSEUDO_ELEMENT) {
      throw errInvalidSelector
    }

    break

  // Attribute
  case '[':
    parts = re_Attr.exec(this.sel.slice(this.i+1))

    if (!parts) {
      throw errInvalidSelector
    }
    this.i += parts[0].length

    this.curr = new Token(
      parts[5] ? ATTR_INSENSITIVE_TOKEN : ATTR_TOKEN,
      parts[3] ? parts[3].slice(1, -1) : parts[4],
      parts[2] || HAS_ATTR_TOKEN
    )
    this.curr.name = parts[1]

    if (parts[5]) { // case insensitive
      if (parts[2]) { // checks a value
        this.curr.value = this.curr.value.toLowerCase()
      } else {
        throw errInvalidSelector
      }
    }
    break


  // ID, CLASS, TAG or Whitespace
  default:
    var t = countSpacesAt(this.sel, this.i)

    if (t > 0) {
      this.i += t-1
      this.curr = WHITESPACE_TOKEN
      break
    }

    t = r === '#' ? ID_TOKEN : r === '.' ? CLASS_TOKEN : TAG_TOKEN

    if (t === TAG_TOKEN) {
      this.i -= 1 // make sure we include the first character for a tag
    }

    if ((temp = re_consumeName.exec(this.sel.slice(this.i+1)))) {
      this.i += temp[0].length
      this.curr = new Token(t, temp[0])
      break
    }

    throw errInvalidSelector
  }

  return this.curr
}


Lexer.prototype.getPseudoFunction = function(name) {
  switch (name.toLowerCase()) {

  //case "has":

  case "not":
    if (this.prevent_not) {
      throw errInvalidSelector
    }

    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', true, true)),
      NOT_TOKEN
    )

  case "matches":
    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', false, true)),
      MATCHES_TOKEN
    )
    break

  case "lang":
    // New Lexer with the same source that halts on `)`
    const lex = new Lexer(this, ')')
    ,     n = lex.nextAfterSpace()

    if (n.kind === TAG_TOKEN && !lex.nextAfterSpace()) {
      // Comes through as a TAG, so relabel
      n.kind = PSEUDO_FUNCTION_TOKEN
      n.subKind = LANG_TOKEN
      return n

    } else {
      throw errInvalidSelector
    }


  case "nth-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_CHILD_TOKEN))

  case "nth-last-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_CHILD_TOKEN))

  case "nth-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_OF_TYPE_TOKEN))

  case "nth-last-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_OF_TYPE_TOKEN))

  default:
    throw errInvalidSelector
  }
}


Lexer.prototype.reconsume = function() {
  if (DEBUG && this._reconsumed) {
    throw errInternal
  }
  this._reconsumed = true
}

/**
 * @return {Token|string|number}
 */
Lexer.prototype.nextAfterSpace = function() {
  while (this.next() === WHITESPACE_TOKEN) {
  }

  return this.curr
}


/**
 * @param {!Token} n
 * @return {!Token}
 */
Lexer.prototype.makeNth = function(n) {
  var a = 0
  ,   b = 0

  const parts = re_makeNth.exec(this.sel.slice(this.i+1))

  if (!parts) {
    throw errInvalidSelector
  }
  this.i += parts[0].length

  if (parts[1]) {
    b = +parts[1] // When only a number, it gets assigned to `b` position

  } else if (parts[5]) {
    a = 2

  } else if (parts[6]) {
    a = 2
    b = 1

  } else {
    const aStr = parts[2]
    ,     bStr = parts[3] + parts[4]

    if (!aStr || aStr === '+' || aStr === '-') {
      // If '-', -1 else must be '+' or empty string, so 1
      a = aStr === '-' ? -1 : 1

    } else {
      a = +aStr
    }

    if (bStr) {
      b = +bStr
    }

    if (DEBUG && (isNaN(a) || isNaN(b))) {
      throw errInternal
    }
  }

  n.value = [a, b]

  return n
}


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

  var first = true
  ,   n

  // Continue to compile if any remain, and check `el` at the same time
  while ((n = source.nextAfterSpace())) {
    var isComma = n === COMMA_TOKEN

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
 * @return {boolean}
 */
SelectorGroup.prototype.matches = function(root, el) {
  const qual = this.globalQualifier
  ,     qualIsName = qual !== "*"

  for (var i = 0, len = this.selectors.length; i < len; i+=1) {
    const sel = this.selectors[i]
    ,     q = qualIsName ? qual : sel.qualifier

    // Check the qualifer early to avoid the `compare_selector()` when possible.
    if ((!q || q === nodeName(el)) && compare_selector(root, el, sel)) {
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

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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
  const resArr = []

  // TODO: Ultimately want to optimize for `gEBI`, `gEBCN`, `gEBTN`, `:root`
  // when the selector consists entirely of one of those.

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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

  this.parts = []

  while ((n = source.next())) {
    // Track if whitespace was found in case it's a descendant combinator.
    var isSpace = n === WHITESPACE_TOKEN

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

  var n = source.nextAfterSpace()

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
  var currEl = el

  // Process starting at the end so that we're doing a RtoL evaluation.
  for (var j = selector.parts.length-1, combinator = 0; j > -1; j-=1) {
    var part = selector.parts[j]
    ,   haltOnFail = false

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

  for (var i = 0, sequence = seq.sequence; i < sequence.length; i++) {
    var simple = sequence[i]

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
        if (!simple.value["matches"](el)) { continue }
        return false

      case MATCHES_TOKEN:
        if (simple.value["matches"](el)) { continue }
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
        var tempEl = el
        while (tempEl && !tempEl.lang) { tempEl = tempEl.parentNode }

        if (tempEl && dashMatch(tempEl.lang, simple.value)) { continue }
        return false
      }


    // Attribute selectors
    case ATTR_TOKEN:
    case ATTR_INSENSITIVE_TOKEN:
      var attrVal = getAttr(el, simple.name)
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
  var idx = 0

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

    var helper = hoverHelper
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


/**
 * @param {!string} s
 * @param {!number} i
 * @return {string|undefined}
 */
function getChar(s, i) {
  return LEGACY ? s.charAt(i) : s[i]
}


/**
 * Returns the number of consecutive spaces found starting at the given index or
 * -1 if the index was out of bounds.
 *
 * @param {!string} s
 * @param {!number} i
 * @return {number}
 */
function countSpacesAt(s, i) {
  var res = 0

  for (;;) {
    switch((getChar(s, i+res) || "")) {
    case ' ': case '\t': case '\n':
      res += 1
      continue

    case "":
      return res || -1
    }
    return res
  }
}


/**
 * @param {!Array<*>} coll
 * @param {!*} target
 * @return {boolean}
 */
function contains(coll, target) {
  for (var i = 0, len = coll.length; i < len; i+=1) {
    if (coll[i] === target) {
      return true
    }
  }
  return false
}


 /**
 * @param {!Node} el
 * @return {string}
 */
function nodeName(el) {
  if (LEGACY) {
    /*
    var n = el.nodeName.toUpperCase()

    if (needTagFix && getChar(n, 0) === '/') {
      return n.slice(1)
    } else {
      return n
    }
    */
    return el.nodeName.toUpperCase()

  } else {
    return el.nodeName
  }
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
  return nodeName(el) === "INPUT" &&
        (el.type === "number" ||
         (el.type === "text" && (hasAttr(el, "min") || hasAttr(el, "max"))))
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function checkBooleanAttr(el, name) {
  return el[name] || hasAttr(el, name)
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function hasAttr(el, name) {
  if (LEGACY) {
    return !!(!el.attributes[name] && name === "class" ?
                el.attributes["className"] :
                el.attributes[name])
  } else {
    return !!el.attributes[name]
  }
}


const reuse_obj = {}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {string|undefined}
 */
function getAttr(el, name) {
  if (LEGACY) {
    return ((!el.attributes[name] && name === "class" ?
              el.attributes["className"] :
              el.attributes[name]) || reuse_obj).value
  } else {
    return (el.attributes[name] || reuse_obj).value
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function parentElement(el) {
  if (LEGACY) {
    const par = /**@type{Element}*/(el.parentNode)
    return par && par.nodeType === Node.ELEMENT_NODE ? par : null
  } else {
    return el.parentElement
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function prevElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.previousSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.previousElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function nextElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.nextSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.nextElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function firstElemChild(el) {
  if (LEGACY) {
    if (el.firstChild && el.firstChild.nodeType !== Node.ELEMENT_NODE) {
      return nextElemSib(el.firstChild)
    } else {
      return /**@type{Element}*/(el.firstChild)
    }
  } else {
    return el.firstElementChild
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function lastElemChild(el) {
  if (LEGACY) {
    if (el.lastChild && el.lastChild.nodeType !== Node.ELEMENT_NODE) {
      return prevElemSib(el.lastChild)
    } else {
      return /**@type{Element}*/(el.lastChild)
    }
  } else {
    return el.lastElementChild
  }
}
/* TODO:
  Cache individual objects, like ATTR and NTH simple selectors.
  Reorder pseudos so that the ones with highest overhead (like :hover) come last.
*/


/** @define {boolean} */
const DEBUG = false
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
  return new SelectorGroup(selector).matches(elem, elem)
}
const errInvalidSelector = new Error("Invalid selector")
,   errInternal = new Error("Internal error")

,   UNIVERSAL_TAG_TOKEN = "*"
,   PSEUDO_FUNCTION_TOKEN = 2
,   WHITESPACE_TOKEN = 3
,   COMMA_TOKEN = ','

// Combinators
,   COMBINATOR_CHILD = '>'
,   COMBINATOR_DESCENDANT = 6
,   COMBINATOR_ADJACENT = '+'
,   COMBINATOR_GENERAL = '~'


,   ID_TOKEN = 10
,   TAG_TOKEN = 11

,   PSEUDO_TOKEN = 12

,   LANG_TOKEN = 13
,   NTH_CHILD_TOKEN = 14
,   NTH_LAST_CHILD_TOKEN = 15
,   NTH_OF_TYPE_TOKEN = 16
,   NTH_LAST_OF_TYPE_TOKEN = 17

,   CLASS_TOKEN = 18
,   NOT_TOKEN = 19


,   ATTR_TOKEN = 20
// Attr SubKinds
,   HAS_ATTR_TOKEN = 21
,   INCLUDE_MATCH_TOKEN = "~="
,   DASH_MATCH_TOKEN = "|="
,   PREFIX_MATCH_TOKEN = "^="
,   SUFFIX_MATCH_TOKEN = "$="
,   SUBSTRING_MATCH_TOKEN = "*="
,   EQUAL_ATTR_TOKEN = '='

,   SCOPE = 22 // :scope pseudo class
,   MATCHES_TOKEN = 23 // :matches pseudo function
,   ATTR_INSENSITIVE_TOKEN = 24 // case insensitive attribute values

// Pseudo elements
,   PSEUDO_ELEMENT = 25 // subKind for pseudo-elements

,   re_consumeName =
      /^-?(?:[_a-zA-Z\u0080-\uFFFF]|\\[^\n]?|--\d?)(?:[-\w\u0080-\uFFFF]|\\[^\n]?)*/


  // 1: name
  // 2: equal operators
  // 3: quoted value
  // 4: unquoted value
  // 5: insensitive indicator
,   re_Attr = new RegExp(
  "^\\s*(" + re_consumeName.source.slice(1) + ")" + // name
  "\\s*(?:" + // starts optional operator and value
    "([$^*~|]?=)" + // operator
    "\\s*(?:((?:'(?:[^'\\n]|\\\\\\n)*')|(?:\"(?:[^\"\\n]|\\\\\\n)*\"))|" + // quoted val
    "(" + re_consumeName.source.slice(1) + "))" + // or unquoted val
  ")?\\s*([iI]?)\\s*]") // end of optional operator and value + `]`


  // 1: Entire string is a valid number
  // 2: First number (before `n`)
  // 3: + or - for second number
  // 4: second number (combine it with #3)
  // 5: even
  // 6: odd
,   re_makeNth =
      /^(?:([-+]?\d+)|([-+]?\d*)?n\s*(?:([-+])\s*(\d+))?|(even)|(odd))\s*\)/i

/**
 * @constructor
 * @private
 * @param {(string|number)} kind
 * @param {(string|number|!SelectorGroup)=} value
 * @param {*=} subKind
 */
function Token(kind, value, subKind) {
  this.kind = kind
  this.value = value
  this.subKind = subKind
}
Token.prototype.name = "" // Used for functions and attribute selectors
Token.prototype.a = 0
Token.prototype.b = 0


/*
  const re_lex = new RegExp(
    "^(?:" +
      "([ \t\n]+)|" + // 1. Whitespace
      "(,)|" +        // 2. Comma
      "(>)|" +        // 3. Right angle bracket
      "(\+)|" +       // 4. Plus sign
      "(~)|" +        // 5. Tilde

      // 6. Pseudo, 7. PseudoElement
      "(:(:?)" + re_consumeName.source.slice(1) + "(\(getPseudoFunction\))?)|" +

      "(\[re_Attr\])|" + // 8. Attr
      "(\*)|" +       // 9. Asterisk (universal)

      // 10. ID, 11. Class, 12. Name
      "(?:(#)|(\.)" + re_consumeName.source.slice(1) + ")" +
    ")"
  )
*/

/**
 * @constructor
 * @param {string|Lexer} source
 * @param {string=} endChar
 * @param {boolean=} prevent_not
 * @param {boolean=} prevent_combinator
 */
function Lexer(source, endChar, prevent_not, prevent_combinator) {
  if (source instanceof Lexer) {
    this.sel = source.sel
    this.i = source.i
    this.last_tok_i = source.last_tok_i
    this.origTok = source
  } else {
    this.sel = source
    this.i = -1
    this.last_tok_i = -1 // Used only for the Selector cache.
  }

  this.prevent_not = !!prevent_not
  this.prevent_combinator = !!prevent_combinator
  this.endChar = endChar || ""

  this._reconsumed = false

  this.curr = this.next() // Prime it with the first value.
  this.reconsume()        // Because we pre-fetched the first value.
}


const arrEmptyString = [""]


/**
 * @return {Token|string|number}
 */
Lexer.prototype.next = function() {
  if (this._reconsumed) {
    this._reconsumed = false
    return this.curr
  }

  // Strict equality, since `undefined` is uninitialized, and `null` is closed.
  if (this.curr === null) {
    return this.curr // May have been manually set to `null` below
  }

  var r = getChar(this.sel, this.i+=1)
  ,   temp = ""
  ,   parts

  this.last_tok_i = this.i

  if (!r || r === this.endChar) {
    if (this.origTok) {
      this.origTok.i = this.i
      this.origTok = null
    }
    this.curr = null
    return this.curr
  }

  switch(r) {
  // Comma or "*"
  case COMMA_TOKEN:
  case UNIVERSAL_TAG_TOKEN:

  // Combinators (not descendant ' ')
  case COMBINATOR_CHILD:
  case COMBINATOR_ADJACENT:
  case COMBINATOR_GENERAL:
    this.curr = r
    break

  // Pseudo
  case ':':
    var verifyPseudoElem = false
    ,   name = ""

    if (getChar(this.sel, this.i + 1) === ':') {
      this.i+=1 // Discard
      verifyPseudoElem = true
    }

    name = (re_consumeName.exec(
      this.sel.slice(this.i+1)) || arrEmptyString)[0].toLowerCase()

    this.i += name.length

    if (getChar(this.sel, this.i + 1) === '(') { // Pseudo function
      this.i+=1 // Discard
      this.curr = this.getPseudoFunction(name)

    } else {
      this.curr = new Token(PSEUDO_TOKEN, name, pseudoClassFns[name])
    }

    if (!this.curr || !this.curr.subKind) {
      switch (name) {
      case "scope":
        this.curr = SCOPE
        break
      case "first-line":
      case "first-letter":
      case "before":
      case "after":
        this.curr = PSEUDO_ELEMENT
      }
    }

    if (verifyPseudoElem && this.curr !== PSEUDO_ELEMENT) {
      throw errInvalidSelector
    }

    break

  // Attribute
  case '[':
    parts = re_Attr.exec(this.sel.slice(this.i+1))

    if (!parts) {
      throw errInvalidSelector
    }
    this.i += parts[0].length

    this.curr = new Token(
      parts[5] ? ATTR_INSENSITIVE_TOKEN : ATTR_TOKEN,
      parts[3] ? parts[3].slice(1, -1) : parts[4],
      parts[2] || HAS_ATTR_TOKEN
    )
    this.curr.name = parts[1]

    if (parts[5]) { // case insensitive
      if (parts[2]) { // checks a value
        this.curr.value = this.curr.value.toLowerCase()
      } else {
        throw errInvalidSelector
      }
    }
    break


  // ID, CLASS, TAG or Whitespace
  default:
    var t = countSpacesAt(this.sel, this.i)

    if (t > 0) {
      this.i += t-1
      this.curr = WHITESPACE_TOKEN
      break
    }

    t = r === '#' ? ID_TOKEN : r === '.' ? CLASS_TOKEN : TAG_TOKEN

    if (t === TAG_TOKEN) {
      this.i -= 1 // make sure we include the first character for a tag
    }

    if ((temp = re_consumeName.exec(this.sel.slice(this.i+1)))) {
      this.i += temp[0].length
      this.curr = new Token(t, temp[0])
      break
    }

    throw errInvalidSelector
  }

  return this.curr
}


Lexer.prototype.getPseudoFunction = function(name) {
  switch (name.toLowerCase()) {

  //case "has":

  case "not":
    if (this.prevent_not) {
      throw errInvalidSelector
    }

    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', true, true)),
      NOT_TOKEN
    )

  case "matches":
    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', false, true)),
      MATCHES_TOKEN
    )
    break

  case "lang":
    // New Lexer with the same source that halts on `)`
    const lex = new Lexer(this, ')')
    ,     n = lex.nextAfterSpace()

    if (n.kind === TAG_TOKEN && !lex.nextAfterSpace()) {
      // Comes through as a TAG, so relabel
      n.kind = PSEUDO_FUNCTION_TOKEN
      n.subKind = LANG_TOKEN
      return n

    } else {
      throw errInvalidSelector
    }


  case "nth-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_CHILD_TOKEN))

  case "nth-last-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_CHILD_TOKEN))

  case "nth-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_OF_TYPE_TOKEN))

  case "nth-last-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_OF_TYPE_TOKEN))

  default:
    throw errInvalidSelector
  }
}


Lexer.prototype.reconsume = function() {
  if (DEBUG && this._reconsumed) {
    throw errInternal
  }
  this._reconsumed = true
}

/**
 * @return {Token|string|number}
 */
Lexer.prototype.nextAfterSpace = function() {
  while (this.next() === WHITESPACE_TOKEN) {
  }

  return this.curr
}


/**
 * @param {!Token} n
 * @return {!Token}
 */
Lexer.prototype.makeNth = function(n) {
  var a = 0
  ,   b = 0

  const parts = re_makeNth.exec(this.sel.slice(this.i+1))

  if (!parts) {
    throw errInvalidSelector
  }
  this.i += parts[0].length

  if (parts[1]) {
    b = +parts[1] // When only a number, it gets assigned to `b` position

  } else if (parts[5]) {
    a = 2

  } else if (parts[6]) {
    a = 2
    b = 1

  } else {
    const aStr = parts[2]
    ,     bStr = parts[3] + parts[4]

    if (!aStr || aStr === '+' || aStr === '-') {
      // If '-', -1 else must be '+' or empty string, so 1
      a = aStr === '-' ? -1 : 1

    } else {
      a = +aStr
    }

    if (bStr) {
      b = +bStr
    }

    if (DEBUG && (isNaN(a) || isNaN(b))) {
      throw errInternal
    }
  }

  n.value = [a, b]

  return n
}


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

  var first = true
  ,   n

  // Continue to compile if any remain, and check `el` at the same time
  while ((n = source.nextAfterSpace())) {
    var isComma = n === COMMA_TOKEN

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
 * @return {boolean}
 */
SelectorGroup.prototype.matches = function(root, el) {
  const qual = this.globalQualifier
  ,     qualIsName = qual !== "*"

  for (var i = 0, len = this.selectors.length; i < len; i+=1) {
    const sel = this.selectors[i]
    ,     q = qualIsName ? qual : sel.qualifier

    // Check the qualifer early to avoid the `compare_selector()` when possible.
    if ((!q || q === nodeName(el)) && compare_selector(root, el, sel)) {
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

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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
  const resArr = []

  // TODO: Ultimately want to optimize for `gEBI`, `gEBCN`, `gEBTN`, `:root`
  // when the selector consists entirely of one of those.

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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

  this.parts = []

  while ((n = source.next())) {
    // Track if whitespace was found in case it's a descendant combinator.
    var isSpace = n === WHITESPACE_TOKEN

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

  var n = source.nextAfterSpace()

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
  var currEl = el

  // Process starting at the end so that we're doing a RtoL evaluation.
  for (var j = selector.parts.length-1, combinator = 0; j > -1; j-=1) {
    var part = selector.parts[j]
    ,   haltOnFail = false

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

  for (var i = 0, sequence = seq.sequence; i < sequence.length; i++) {
    var simple = sequence[i]

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
        if (!simple.value["matches"](el)) { continue }
        return false

      case MATCHES_TOKEN:
        if (simple.value["matches"](el)) { continue }
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
        var tempEl = el
        while (tempEl && !tempEl.lang) { tempEl = tempEl.parentNode }

        if (tempEl && dashMatch(tempEl.lang, simple.value)) { continue }
        return false
      }


    // Attribute selectors
    case ATTR_TOKEN:
    case ATTR_INSENSITIVE_TOKEN:
      var attrVal = getAttr(el, simple.name)
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
  var idx = 0

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

    var helper = hoverHelper
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


/**
 * @param {!string} s
 * @param {!number} i
 * @return {string|undefined}
 */
function getChar(s, i) {
  return LEGACY ? s.charAt(i) : s[i]
}


/**
 * Returns the number of consecutive spaces found starting at the given index or
 * -1 if the index was out of bounds.
 *
 * @param {!string} s
 * @param {!number} i
 * @return {number}
 */
function countSpacesAt(s, i) {
  var res = 0

  for (;;) {
    switch((getChar(s, i+res) || "")) {
    case ' ': case '\t': case '\n':
      res += 1
      continue

    case "":
      return res || -1
    }
    return res
  }
}


/**
 * @param {!Array<*>} coll
 * @param {!*} target
 * @return {boolean}
 */
function contains(coll, target) {
  for (var i = 0, len = coll.length; i < len; i+=1) {
    if (coll[i] === target) {
      return true
    }
  }
  return false
}


 /**
 * @param {!Node} el
 * @return {string}
 */
function nodeName(el) {
  debugger
  if (LEGACY) {
    /*
    var n = el.nodeName.toUpperCase()

    if (needTagFix && getChar(n, 0) === '/') {
      return n.slice(1)
    } else {
      return n
    }
    */
    return el.nodeName.toUpperCase()

  } else {
    return el.nodeName
  }
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
  return nodeName(el) === "INPUT" &&
        (el.type === "number" ||
         (el.type === "text" && (hasAttr(el, "min") || hasAttr(el, "max"))))
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function checkBooleanAttr(el, name) {
  return el[name] || hasAttr(el, name)
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function hasAttr(el, name) {
  if (LEGACY) {
    return !!(!el.attributes[name] && name === "class" ?
                el.attributes["className"] :
                el.attributes[name])
  } else {
    return !!el.attributes[name]
  }
}


const reuse_obj = {}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {string|undefined}
 */
function getAttr(el, name) {
  if (LEGACY) {
    return ((!el.attributes[name] && name === "class" ?
              el.attributes["className"] :
              el.attributes[name]) || reuse_obj).value
  } else {
    return (el.attributes[name] || reuse_obj).value
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function parentElement(el) {
  if (LEGACY) {
    const par = /**@type{Element}*/(el.parentNode)
    return par && par.nodeType === Node.ELEMENT_NODE ? par : null
  } else {
    return el.parentElement
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function prevElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.previousSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.previousElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function nextElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.nextSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.nextElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function firstElemChild(el) {
  if (LEGACY) {
    if (el.firstChild && el.firstChild.nodeType !== Node.ELEMENT_NODE) {
      return nextElemSib(el.firstChild)
    } else {
      return /**@type{Element}*/(el.firstChild)
    }
  } else {
    return el.firstElementChild
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function lastElemChild(el) {
  if (LEGACY) {
    if (el.lastChild && el.lastChild.nodeType !== Node.ELEMENT_NODE) {
      return prevElemSib(el.lastChild)
    } else {
      return /**@type{Element}*/(el.lastChild)
    }
  } else {
    return el.lastElementChild
  }
}
/* TODO:
  Cache individual objects, like ATTR and NTH simple selectors.
  Reorder pseudos so that the ones with highest overhead (like :hover) come last.
*/


/** @define {boolean} */
const DEBUG = false
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
  return new SelectorGroup(selector).matches(elem, elem)
}
const errInvalidSelector = new Error("Invalid selector")
,   errInternal = new Error("Internal error")

,   UNIVERSAL_TAG_TOKEN = "*"
,   PSEUDO_FUNCTION_TOKEN = 2
,   WHITESPACE_TOKEN = 3
,   COMMA_TOKEN = ','

// Combinators
,   COMBINATOR_CHILD = '>'
,   COMBINATOR_DESCENDANT = 6
,   COMBINATOR_ADJACENT = '+'
,   COMBINATOR_GENERAL = '~'


,   ID_TOKEN = 10
,   TAG_TOKEN = 11

,   PSEUDO_TOKEN = 12

,   LANG_TOKEN = 13
,   NTH_CHILD_TOKEN = 14
,   NTH_LAST_CHILD_TOKEN = 15
,   NTH_OF_TYPE_TOKEN = 16
,   NTH_LAST_OF_TYPE_TOKEN = 17

,   CLASS_TOKEN = 18
,   NOT_TOKEN = 19


,   ATTR_TOKEN = 20
// Attr SubKinds
,   HAS_ATTR_TOKEN = 21
,   INCLUDE_MATCH_TOKEN = "~="
,   DASH_MATCH_TOKEN = "|="
,   PREFIX_MATCH_TOKEN = "^="
,   SUFFIX_MATCH_TOKEN = "$="
,   SUBSTRING_MATCH_TOKEN = "*="
,   EQUAL_ATTR_TOKEN = '='

,   SCOPE = 22 // :scope pseudo class
,   MATCHES_TOKEN = 23 // :matches pseudo function
,   ATTR_INSENSITIVE_TOKEN = 24 // case insensitive attribute values

// Pseudo elements
,   PSEUDO_ELEMENT = 25 // subKind for pseudo-elements

,   re_consumeName =
      /^-?(?:[_a-zA-Z\u0080-\uFFFF]|\\[^\n]?|--\d?)(?:[-\w\u0080-\uFFFF]|\\[^\n]?)*/


  // 1: name
  // 2: equal operators
  // 3: quoted value
  // 4: unquoted value
  // 5: insensitive indicator
,   re_Attr = new RegExp(
  "^\\s*(" + re_consumeName.source.slice(1) + ")" + // name
  "\\s*(?:" + // starts optional operator and value
    "([$^*~|]?=)" + // operator
    "\\s*(?:((?:'(?:[^'\\n]|\\\\\\n)*')|(?:\"(?:[^\"\\n]|\\\\\\n)*\"))|" + // quoted val
    "(" + re_consumeName.source.slice(1) + "))" + // or unquoted val
  ")?\\s*([iI]?)\\s*]") // end of optional operator and value + `]`


  // 1: Entire string is a valid number
  // 2: First number (before `n`)
  // 3: + or - for second number
  // 4: second number (combine it with #3)
  // 5: even
  // 6: odd
,   re_makeNth =
      /^(?:([-+]?\d+)|([-+]?\d*)?n\s*(?:([-+])\s*(\d+))?|(even)|(odd))\s*\)/i

/**
 * @constructor
 * @private
 * @param {(string|number)} kind
 * @param {(string|number|!SelectorGroup)=} value
 * @param {*=} subKind
 */
function Token(kind, value, subKind) {
  this.kind = kind
  this.value = value
  this.subKind = subKind
}
Token.prototype.name = "" // Used for functions and attribute selectors
Token.prototype.a = 0
Token.prototype.b = 0


/*
  const re_lex = new RegExp(
    "^(?:" +
      "([ \t\n]+)|" + // 1. Whitespace
      "(,)|" +        // 2. Comma
      "(>)|" +        // 3. Right angle bracket
      "(\+)|" +       // 4. Plus sign
      "(~)|" +        // 5. Tilde

      // 6. Pseudo, 7. PseudoElement
      "(:(:?)" + re_consumeName.source.slice(1) + "(\(getPseudoFunction\))?)|" +

      "(\[re_Attr\])|" + // 8. Attr
      "(\*)|" +       // 9. Asterisk (universal)

      // 10. ID, 11. Class, 12. Name
      "(?:(#)|(\.)" + re_consumeName.source.slice(1) + ")" +
    ")"
  )
*/

/**
 * @constructor
 * @param {string|Lexer} source
 * @param {string=} endChar
 * @param {boolean=} prevent_not
 * @param {boolean=} prevent_combinator
 */
function Lexer(source, endChar, prevent_not, prevent_combinator) {
  if (source instanceof Lexer) {
    this.sel = source.sel
    this.i = source.i
    this.last_tok_i = source.last_tok_i
    this.origTok = source
  } else {
    this.sel = source
    this.i = -1
    this.last_tok_i = -1 // Used only for the Selector cache.
  }

  this.prevent_not = !!prevent_not
  this.prevent_combinator = !!prevent_combinator
  this.endChar = endChar || ""

  this._reconsumed = false

  this.curr = this.next() // Prime it with the first value.
  this.reconsume()        // Because we pre-fetched the first value.
}


const arrEmptyString = [""]


/**
 * @return {Token|string|number}
 */
Lexer.prototype.next = function() {
  if (this._reconsumed) {
    this._reconsumed = false
    return this.curr
  }

  // Strict equality, since `undefined` is uninitialized, and `null` is closed.
  if (this.curr === null) {
    return this.curr // May have been manually set to `null` below
  }

  var r = getChar(this.sel, this.i+=1)
  ,   temp = ""
  ,   parts

  this.last_tok_i = this.i

  if (!r || r === this.endChar) {
    if (this.origTok) {
      this.origTok.i = this.i
      this.origTok = null
    }
    this.curr = null
    return this.curr
  }

  switch(r) {
  // Comma or "*"
  case COMMA_TOKEN:
  case UNIVERSAL_TAG_TOKEN:

  // Combinators (not descendant ' ')
  case COMBINATOR_CHILD:
  case COMBINATOR_ADJACENT:
  case COMBINATOR_GENERAL:
    this.curr = r
    break

  // Pseudo
  case ':':
    var verifyPseudoElem = false
    ,   name = ""

    if (getChar(this.sel, this.i + 1) === ':') {
      this.i+=1 // Discard
      verifyPseudoElem = true
    }

    name = (re_consumeName.exec(
      this.sel.slice(this.i+1)) || arrEmptyString)[0].toLowerCase()

    this.i += name.length

    if (getChar(this.sel, this.i + 1) === '(') { // Pseudo function
      this.i+=1 // Discard
      this.curr = this.getPseudoFunction(name)

    } else {
      this.curr = new Token(PSEUDO_TOKEN, name, pseudoClassFns[name])
    }

    if (!this.curr || !this.curr.subKind) {
      switch (name) {
      case "scope":
        this.curr = SCOPE
        break
      case "first-line":
      case "first-letter":
      case "before":
      case "after":
        this.curr = PSEUDO_ELEMENT
      }
    }

    if (verifyPseudoElem && this.curr !== PSEUDO_ELEMENT) {
      throw errInvalidSelector
    }

    break

  // Attribute
  case '[':
    parts = re_Attr.exec(this.sel.slice(this.i+1))

    if (!parts) {
      throw errInvalidSelector
    }
    this.i += parts[0].length

    this.curr = new Token(
      parts[5] ? ATTR_INSENSITIVE_TOKEN : ATTR_TOKEN,
      parts[3] ? parts[3].slice(1, -1) : parts[4],
      parts[2] || HAS_ATTR_TOKEN
    )
    this.curr.name = parts[1]

    if (parts[5]) { // case insensitive
      if (parts[2]) { // checks a value
        this.curr.value = this.curr.value.toLowerCase()
      } else {
        throw errInvalidSelector
      }
    }
    break


  // ID, CLASS, TAG or Whitespace
  default:
    var t = countSpacesAt(this.sel, this.i)

    if (t > 0) {
      this.i += t-1
      this.curr = WHITESPACE_TOKEN
      break
    }

    t = r === '#' ? ID_TOKEN : r === '.' ? CLASS_TOKEN : TAG_TOKEN

    if (t === TAG_TOKEN) {
      this.i -= 1 // make sure we include the first character for a tag
    }

    if ((temp = re_consumeName.exec(this.sel.slice(this.i+1)))) {
      this.i += temp[0].length
      this.curr = new Token(t, temp[0])
      break
    }

    throw errInvalidSelector
  }

  return this.curr
}


Lexer.prototype.getPseudoFunction = function(name) {
  switch (name.toLowerCase()) {

  //case "has":

  case "not":
    if (this.prevent_not) {
      throw errInvalidSelector
    }

    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', true, true)),
      NOT_TOKEN
    )

  case "matches":
    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', false, true)),
      MATCHES_TOKEN
    )
    break

  case "lang":
    // New Lexer with the same source that halts on `)`
    const lex = new Lexer(this, ')')
    ,     n = lex.nextAfterSpace()

    if (n.kind === TAG_TOKEN && !lex.nextAfterSpace()) {
      // Comes through as a TAG, so relabel
      n.kind = PSEUDO_FUNCTION_TOKEN
      n.subKind = LANG_TOKEN
      return n

    } else {
      throw errInvalidSelector
    }


  case "nth-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_CHILD_TOKEN))

  case "nth-last-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_CHILD_TOKEN))

  case "nth-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_OF_TYPE_TOKEN))

  case "nth-last-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_OF_TYPE_TOKEN))

  default:
    throw errInvalidSelector
  }
}


Lexer.prototype.reconsume = function() {
  if (DEBUG && this._reconsumed) {
    throw errInternal
  }
  this._reconsumed = true
}

/**
 * @return {Token|string|number}
 */
Lexer.prototype.nextAfterSpace = function() {
  while (this.next() === WHITESPACE_TOKEN) {
  }

  return this.curr
}


/**
 * @param {!Token} n
 * @return {!Token}
 */
Lexer.prototype.makeNth = function(n) {
  var a = 0
  ,   b = 0

  const parts = re_makeNth.exec(this.sel.slice(this.i+1))

  if (!parts) {
    throw errInvalidSelector
  }
  this.i += parts[0].length

  if (parts[1]) {
    b = +parts[1] // When only a number, it gets assigned to `b` position

  } else if (parts[5]) {
    a = 2

  } else if (parts[6]) {
    a = 2
    b = 1

  } else {
    const aStr = parts[2]
    ,     bStr = parts[3] + parts[4]

    if (!aStr || aStr === '+' || aStr === '-') {
      // If '-', -1 else must be '+' or empty string, so 1
      a = aStr === '-' ? -1 : 1

    } else {
      a = +aStr
    }

    if (bStr) {
      b = +bStr
    }

    if (DEBUG && (isNaN(a) || isNaN(b))) {
      throw errInternal
    }
  }

  n.value = [a, b]

  return n
}


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

  var first = true
  ,   n

  // Continue to compile if any remain, and check `el` at the same time
  while ((n = source.nextAfterSpace())) {
    var isComma = n === COMMA_TOKEN

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
 * @return {boolean}
 */
SelectorGroup.prototype.matches = function(root, el) {
  const qual = this.globalQualifier
  ,     qualIsName = qual !== "*"

  for (var i = 0, len = this.selectors.length; i < len; i+=1) {
    const sel = this.selectors[i]
    ,     q = qualIsName ? qual : sel.qualifier

    // Check the qualifer early to avoid the `compare_selector()` when possible.
    if ((!q || q === nodeName(el)) && compare_selector(root, el, sel)) {
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

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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
  const resArr = []

  // TODO: Ultimately want to optimize for `gEBI`, `gEBCN`, `gEBTN`, `:root`
  // when the selector consists entirely of one of those.

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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

  this.parts = []

  while ((n = source.next())) {
    // Track if whitespace was found in case it's a descendant combinator.
    var isSpace = n === WHITESPACE_TOKEN

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

  var n = source.nextAfterSpace()

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
  for (var j = selector.parts.length-1, combinator = 0; j > -1; j-=1) {
    var part = selector.parts[j]
    ,   haltOnFail = false
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

  for (var i = 0, sequence = seq.sequence; i < sequence.length; i++) {
    var simple = sequence[i]

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
        if (!simple.value["matches"](el)) { continue }
        return false

      case MATCHES_TOKEN:
        if (simple.value["matches"](el)) { continue }
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
        var tempEl = el
        while (tempEl && !tempEl.lang) { tempEl = tempEl.parentNode }

        if (tempEl && dashMatch(tempEl.lang, simple.value)) { continue }
        return false
      }


    // Attribute selectors
    case ATTR_TOKEN:
    case ATTR_INSENSITIVE_TOKEN:
      var attrVal = getAttr(el, simple.name)
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
  var idx = 0

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

    var helper = hoverHelper
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


/**
 * @param {!string} s
 * @param {!number} i
 * @return {string|undefined}
 */
function getChar(s, i) {
  return LEGACY ? s.charAt(i) : s[i]
}


/**
 * Returns the number of consecutive spaces found starting at the given index or
 * -1 if the index was out of bounds.
 *
 * @param {!string} s
 * @param {!number} i
 * @return {number}
 */
function countSpacesAt(s, i) {
  var res = 0

  for (;;) {
    switch((getChar(s, i+res) || "")) {
    case ' ': case '\t': case '\n':
      res += 1
      continue

    case "":
      return res || -1
    }
    return res
  }
}


/**
 * @param {!Array<*>} coll
 * @param {!*} target
 * @return {boolean}
 */
function contains(coll, target) {
  for (var i = 0, len = coll.length; i < len; i+=1) {
    if (coll[i] === target) {
      return true
    }
  }
  return false
}


 /**
 * @param {!Node} el
 * @return {string}
 */
function nodeName(el) {
  debugger
  if (LEGACY) {
    /*
    var n = el.nodeName.toUpperCase()

    if (needTagFix && getChar(n, 0) === '/') {
      return n.slice(1)
    } else {
      return n
    }
    */
    return el.nodeName.toUpperCase()

  } else {
    return el.nodeName
  }
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
  return nodeName(el) === "INPUT" &&
        (el.type === "number" ||
         (el.type === "text" && (hasAttr(el, "min") || hasAttr(el, "max"))))
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function checkBooleanAttr(el, name) {
  return el[name] || hasAttr(el, name)
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function hasAttr(el, name) {
  if (LEGACY) {
    return !!(!el.attributes[name] && name === "class" ?
                el.attributes["className"] :
                el.attributes[name])
  } else {
    return !!el.attributes[name]
  }
}


const reuse_obj = {}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {string|undefined}
 */
function getAttr(el, name) {
  if (LEGACY) {
    return ((!el.attributes[name] && name === "class" ?
              el.attributes["className"] :
              el.attributes[name]) || reuse_obj).value
  } else {
    return (el.attributes[name] || reuse_obj).value
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function parentElement(el) {
  if (LEGACY) {
    const par = /**@type{Element}*/(el.parentNode)
    return par && par.nodeType === Node.ELEMENT_NODE ? par : null
  } else {
    return el.parentElement
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function prevElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.previousSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.previousElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function nextElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.nextSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.nextElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function firstElemChild(el) {
  if (LEGACY) {
    if (el.firstChild && el.firstChild.nodeType !== Node.ELEMENT_NODE) {
      return nextElemSib(el.firstChild)
    } else {
      return /**@type{Element}*/(el.firstChild)
    }
  } else {
    return el.firstElementChild
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function lastElemChild(el) {
  if (LEGACY) {
    if (el.lastChild && el.lastChild.nodeType !== Node.ELEMENT_NODE) {
      return prevElemSib(el.lastChild)
    } else {
      return /**@type{Element}*/(el.lastChild)
    }
  } else {
    return el.lastElementChild
  }
}
/* TODO:
  Cache individual objects, like ATTR and NTH simple selectors.
  Reorder pseudos so that the ones with highest overhead (like :hover) come last.
*/


/** @define {boolean} */
const DEBUG = false
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
  return new SelectorGroup(selector).matches(elem, elem)
}
const errInvalidSelector = new Error("Invalid selector")
,   errInternal = new Error("Internal error")

,   UNIVERSAL_TAG_TOKEN = "*"
,   PSEUDO_FUNCTION_TOKEN = 2
,   WHITESPACE_TOKEN = 3
,   COMMA_TOKEN = ','

// Combinators
,   COMBINATOR_CHILD = '>'
,   COMBINATOR_DESCENDANT = 6
,   COMBINATOR_ADJACENT = '+'
,   COMBINATOR_GENERAL = '~'


,   ID_TOKEN = 10
,   TAG_TOKEN = 11

,   PSEUDO_TOKEN = 12

,   LANG_TOKEN = 13
,   NTH_CHILD_TOKEN = 14
,   NTH_LAST_CHILD_TOKEN = 15
,   NTH_OF_TYPE_TOKEN = 16
,   NTH_LAST_OF_TYPE_TOKEN = 17

,   CLASS_TOKEN = 18
,   NOT_TOKEN = 19


,   ATTR_TOKEN = 20
// Attr SubKinds
,   HAS_ATTR_TOKEN = 21
,   INCLUDE_MATCH_TOKEN = "~="
,   DASH_MATCH_TOKEN = "|="
,   PREFIX_MATCH_TOKEN = "^="
,   SUFFIX_MATCH_TOKEN = "$="
,   SUBSTRING_MATCH_TOKEN = "*="
,   EQUAL_ATTR_TOKEN = '='

,   SCOPE = 22 // :scope pseudo class
,   MATCHES_TOKEN = 23 // :matches pseudo function
,   ATTR_INSENSITIVE_TOKEN = 24 // case insensitive attribute values

// Pseudo elements
,   PSEUDO_ELEMENT = 25 // subKind for pseudo-elements

,   re_consumeName =
      /^-?(?:[_a-zA-Z\u0080-\uFFFF]|\\[^\n]?|--\d?)(?:[-\w\u0080-\uFFFF]|\\[^\n]?)*/


  // 1: name
  // 2: equal operators
  // 3: quoted value
  // 4: unquoted value
  // 5: insensitive indicator
,   re_Attr = new RegExp(
  "^\\s*(" + re_consumeName.source.slice(1) + ")" + // name
  "\\s*(?:" + // starts optional operator and value
    "([$^*~|]?=)" + // operator
    "\\s*(?:((?:'(?:[^'\\n]|\\\\\\n)*')|(?:\"(?:[^\"\\n]|\\\\\\n)*\"))|" + // quoted val
    "(" + re_consumeName.source.slice(1) + "))" + // or unquoted val
  ")?\\s*([iI]?)\\s*]") // end of optional operator and value + `]`


  // 1: Entire string is a valid number
  // 2: First number (before `n`)
  // 3: + or - for second number
  // 4: second number (combine it with #3)
  // 5: even
  // 6: odd
,   re_makeNth =
      /^(?:([-+]?\d+)|([-+]?\d*)?n\s*(?:([-+])\s*(\d+))?|(even)|(odd))\s*\)/i

/**
 * @constructor
 * @private
 * @param {(string|number)} kind
 * @param {(string|number|!SelectorGroup)=} value
 * @param {*=} subKind
 */
function Token(kind, value, subKind) {
  this.kind = kind
  this.value = value
  this.subKind = subKind
}
Token.prototype.name = "" // Used for functions and attribute selectors
Token.prototype.a = 0
Token.prototype.b = 0


/*
  const re_lex = new RegExp(
    "^(?:" +
      "([ \t\n]+)|" + // 1. Whitespace
      "(,)|" +        // 2. Comma
      "(>)|" +        // 3. Right angle bracket
      "(\+)|" +       // 4. Plus sign
      "(~)|" +        // 5. Tilde

      // 6. Pseudo, 7. PseudoElement
      "(:(:?)" + re_consumeName.source.slice(1) + "(\(getPseudoFunction\))?)|" +

      "(\[re_Attr\])|" + // 8. Attr
      "(\*)|" +       // 9. Asterisk (universal)

      // 10. ID, 11. Class, 12. Name
      "(?:(#)|(\.)" + re_consumeName.source.slice(1) + ")" +
    ")"
  )
*/

/**
 * @constructor
 * @param {string|Lexer} source
 * @param {string=} endChar
 * @param {boolean=} prevent_not
 * @param {boolean=} prevent_combinator
 */
function Lexer(source, endChar, prevent_not, prevent_combinator) {
  if (source instanceof Lexer) {
    this.sel = source.sel
    this.i = source.i
    this.last_tok_i = source.last_tok_i
    this.origTok = source
  } else {
    this.sel = source
    this.i = -1
    this.last_tok_i = -1 // Used only for the Selector cache.
  }

  this.prevent_not = !!prevent_not
  this.prevent_combinator = !!prevent_combinator
  this.endChar = endChar || ""

  this._reconsumed = false

  this.curr = this.next() // Prime it with the first value.
  this.reconsume()        // Because we pre-fetched the first value.
}


const arrEmptyString = [""]


/**
 * @return {Token|string|number}
 */
Lexer.prototype.next = function() {
  if (this._reconsumed) {
    this._reconsumed = false
    return this.curr
  }

  // Strict equality, since `undefined` is uninitialized, and `null` is closed.
  if (this.curr === null) {
    return this.curr // May have been manually set to `null` below
  }

  var r = getChar(this.sel, this.i+=1)
  ,   temp = ""
  ,   parts

  this.last_tok_i = this.i

  if (!r || r === this.endChar) {
    if (this.origTok) {
      this.origTok.i = this.i
      this.origTok = null
    }
    this.curr = null
    return this.curr
  }

  switch(r) {
  // Comma or "*"
  case COMMA_TOKEN:
  case UNIVERSAL_TAG_TOKEN:

  // Combinators (not descendant ' ')
  case COMBINATOR_CHILD:
  case COMBINATOR_ADJACENT:
  case COMBINATOR_GENERAL:
    this.curr = r
    break

  // Pseudo
  case ':':
    var verifyPseudoElem = false
    ,   name = ""

    if (getChar(this.sel, this.i + 1) === ':') {
      this.i+=1 // Discard
      verifyPseudoElem = true
    }

    name = (re_consumeName.exec(
      this.sel.slice(this.i+1)) || arrEmptyString)[0].toLowerCase()

    this.i += name.length

    if (getChar(this.sel, this.i + 1) === '(') { // Pseudo function
      this.i+=1 // Discard
      this.curr = this.getPseudoFunction(name)

    } else {
      this.curr = new Token(PSEUDO_TOKEN, name, pseudoClassFns[name])
    }

    if (!this.curr || !this.curr.subKind) {
      switch (name) {
      case "scope":
        this.curr = SCOPE
        break
      case "first-line":
      case "first-letter":
      case "before":
      case "after":
        this.curr = PSEUDO_ELEMENT
      }
    }

    if (verifyPseudoElem && this.curr !== PSEUDO_ELEMENT) {
      throw errInvalidSelector
    }

    break

  // Attribute
  case '[':
    parts = re_Attr.exec(this.sel.slice(this.i+1))

    if (!parts) {
      throw errInvalidSelector
    }
    this.i += parts[0].length

    this.curr = new Token(
      parts[5] ? ATTR_INSENSITIVE_TOKEN : ATTR_TOKEN,
      parts[3] ? parts[3].slice(1, -1) : parts[4],
      parts[2] || HAS_ATTR_TOKEN
    )
    this.curr.name = parts[1]

    if (parts[5]) { // case insensitive
      if (parts[2]) { // checks a value
        this.curr.value = this.curr.value.toLowerCase()
      } else {
        throw errInvalidSelector
      }
    }
    break


  // ID, CLASS, TAG or Whitespace
  default:
    var t = countSpacesAt(this.sel, this.i)

    if (t > 0) {
      this.i += t-1
      this.curr = WHITESPACE_TOKEN
      break
    }

    t = r === '#' ? ID_TOKEN : r === '.' ? CLASS_TOKEN : TAG_TOKEN

    if (t === TAG_TOKEN) {
      this.i -= 1 // make sure we include the first character for a tag
    }

    if ((temp = re_consumeName.exec(this.sel.slice(this.i+1)))) {
      this.i += temp[0].length
      this.curr = new Token(t, temp[0])
      break
    }

    throw errInvalidSelector
  }

  return this.curr
}


Lexer.prototype.getPseudoFunction = function(name) {
  switch (name.toLowerCase()) {

  //case "has":

  case "not":
    if (this.prevent_not) {
      throw errInvalidSelector
    }

    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', true, true)),
      NOT_TOKEN
    )

  case "matches":
    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', false, true)),
      MATCHES_TOKEN
    )
    break

  case "lang":
    // New Lexer with the same source that halts on `)`
    const lex = new Lexer(this, ')')
    ,     n = lex.nextAfterSpace()

    if (n.kind === TAG_TOKEN && !lex.nextAfterSpace()) {
      // Comes through as a TAG, so relabel
      n.kind = PSEUDO_FUNCTION_TOKEN
      n.subKind = LANG_TOKEN
      return n

    } else {
      throw errInvalidSelector
    }


  case "nth-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_CHILD_TOKEN))

  case "nth-last-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_CHILD_TOKEN))

  case "nth-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_OF_TYPE_TOKEN))

  case "nth-last-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_OF_TYPE_TOKEN))

  default:
    throw errInvalidSelector
  }
}


Lexer.prototype.reconsume = function() {
  if (DEBUG && this._reconsumed) {
    throw errInternal
  }
  this._reconsumed = true
}

/**
 * @return {Token|string|number}
 */
Lexer.prototype.nextAfterSpace = function() {
  while (this.next() === WHITESPACE_TOKEN) {
  }

  return this.curr
}


/**
 * @param {!Token} n
 * @return {!Token}
 */
Lexer.prototype.makeNth = function(n) {
  var a = 0
  ,   b = 0

  const parts = re_makeNth.exec(this.sel.slice(this.i+1))

  if (!parts) {
    throw errInvalidSelector
  }
  this.i += parts[0].length

  if (parts[1]) {
    b = +parts[1] // When only a number, it gets assigned to `b` position

  } else if (parts[5]) {
    a = 2

  } else if (parts[6]) {
    a = 2
    b = 1

  } else {
    const aStr = parts[2]
    ,     bStr = parts[3] + parts[4]

    if (!aStr || aStr === '+' || aStr === '-') {
      // If '-', -1 else must be '+' or empty string, so 1
      a = aStr === '-' ? -1 : 1

    } else {
      a = +aStr
    }

    if (bStr) {
      b = +bStr
    }

    if (DEBUG && (isNaN(a) || isNaN(b))) {
      throw errInternal
    }
  }

  n.value = [a, b]

  return n
}


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

  var first = true
  ,   n

  // Continue to compile if any remain, and check `el` at the same time
  while ((n = source.nextAfterSpace())) {
    var isComma = n === COMMA_TOKEN

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
 * @return {boolean}
 */
SelectorGroup.prototype.matches = function(root, el) {
  const qual = this.globalQualifier
  ,     qualIsName = qual !== "*"

  for (var i = 0, len = this.selectors.length; i < len; i+=1) {
    const sel = this.selectors[i]
    ,     q = qualIsName ? qual : sel.qualifier

    // Check the qualifer early to avoid the `compare_selector()` when possible.
    if ((!q || q === nodeName(el)) && compare_selector(root, el, sel)) {
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

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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
  const resArr = []

  // TODO: Ultimately want to optimize for `gEBI`, `gEBCN`, `gEBTN`, `:root`
  // when the selector consists entirely of one of those.

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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

  this.parts = []

  while ((n = source.next())) {
    // Track if whitespace was found in case it's a descendant combinator.
    var isSpace = n === WHITESPACE_TOKEN

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

  var n = source.nextAfterSpace()

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
  for (var j = selector.parts.length-1, combinator = 0; j > -1; j-=1) {
    var part = selector.parts[j]
    ,   haltOnFail = false
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

  for (var i = 0, sequence = seq.sequence; i < sequence.length; i++) {
    var simple = sequence[i]

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
        if (!simple.value["matches"](root, el)) { continue }
        return false

      case MATCHES_TOKEN:
        if (simple.value["matches"](root, el)) { continue }
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
        var tempEl = el
        while (tempEl && !tempEl.lang) { tempEl = tempEl.parentNode }

        if (tempEl && dashMatch(tempEl.lang, simple.value)) { continue }
        return false
      }


    // Attribute selectors
    case ATTR_TOKEN:
    case ATTR_INSENSITIVE_TOKEN:
      var attrVal = getAttr(el, simple.name)
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
  var idx = 0

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

    var helper = hoverHelper
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


/**
 * @param {!string} s
 * @param {!number} i
 * @return {string|undefined}
 */
function getChar(s, i) {
  return LEGACY ? s.charAt(i) : s[i]
}


/**
 * Returns the number of consecutive spaces found starting at the given index or
 * -1 if the index was out of bounds.
 *
 * @param {!string} s
 * @param {!number} i
 * @return {number}
 */
function countSpacesAt(s, i) {
  var res = 0

  for (;;) {
    switch((getChar(s, i+res) || "")) {
    case ' ': case '\t': case '\n':
      res += 1
      continue

    case "":
      return res || -1
    }
    return res
  }
}


/**
 * @param {!Array<*>} coll
 * @param {!*} target
 * @return {boolean}
 */
function contains(coll, target) {
  for (var i = 0, len = coll.length; i < len; i+=1) {
    if (coll[i] === target) {
      return true
    }
  }
  return false
}


 /**
 * @param {!Node} el
 * @return {string}
 */
function nodeName(el) {
  debugger
  if (LEGACY) {
    /*
    var n = el.nodeName.toUpperCase()

    if (needTagFix && getChar(n, 0) === '/') {
      return n.slice(1)
    } else {
      return n
    }
    */
    return el.nodeName.toUpperCase()

  } else {
    return el.nodeName
  }
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
  return nodeName(el) === "INPUT" &&
        (el.type === "number" ||
         (el.type === "text" && (hasAttr(el, "min") || hasAttr(el, "max"))))
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function checkBooleanAttr(el, name) {
  return el[name] || hasAttr(el, name)
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function hasAttr(el, name) {
  if (LEGACY) {
    return !!(!el.attributes[name] && name === "class" ?
                el.attributes["className"] :
                el.attributes[name])
  } else {
    return !!el.attributes[name]
  }
}


const reuse_obj = {}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {string|undefined}
 */
function getAttr(el, name) {
  if (LEGACY) {
    return ((!el.attributes[name] && name === "class" ?
              el.attributes["className"] :
              el.attributes[name]) || reuse_obj).value
  } else {
    return (el.attributes[name] || reuse_obj).value
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function parentElement(el) {
  if (LEGACY) {
    const par = /**@type{Element}*/(el.parentNode)
    return par && par.nodeType === Node.ELEMENT_NODE ? par : null
  } else {
    return el.parentElement
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function prevElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.previousSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.previousElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function nextElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.nextSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.nextElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function firstElemChild(el) {
  if (LEGACY) {
    if (el.firstChild && el.firstChild.nodeType !== Node.ELEMENT_NODE) {
      return nextElemSib(el.firstChild)
    } else {
      return /**@type{Element}*/(el.firstChild)
    }
  } else {
    return el.firstElementChild
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function lastElemChild(el) {
  if (LEGACY) {
    if (el.lastChild && el.lastChild.nodeType !== Node.ELEMENT_NODE) {
      return prevElemSib(el.lastChild)
    } else {
      return /**@type{Element}*/(el.lastChild)
    }
  } else {
    return el.lastElementChild
  }
}
/* TODO:
  Cache individual objects, like ATTR and NTH simple selectors.
  Reorder pseudos so that the ones with highest overhead (like :hover) come last.
*/


/** @define {boolean} */
const DEBUG = false
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
  return new SelectorGroup(selector).matches(elem, elem)
}
const errInvalidSelector = new Error("Invalid selector")
,   errInternal = new Error("Internal error")

,   UNIVERSAL_TAG_TOKEN = "*"
,   PSEUDO_FUNCTION_TOKEN = 2
,   WHITESPACE_TOKEN = 3
,   COMMA_TOKEN = ','

// Combinators
,   COMBINATOR_CHILD = '>'
,   COMBINATOR_DESCENDANT = 6
,   COMBINATOR_ADJACENT = '+'
,   COMBINATOR_GENERAL = '~'


,   ID_TOKEN = 10
,   TAG_TOKEN = 11

,   PSEUDO_TOKEN = 12

,   LANG_TOKEN = 13
,   NTH_CHILD_TOKEN = 14
,   NTH_LAST_CHILD_TOKEN = 15
,   NTH_OF_TYPE_TOKEN = 16
,   NTH_LAST_OF_TYPE_TOKEN = 17

,   CLASS_TOKEN = 18
,   NOT_TOKEN = 19


,   ATTR_TOKEN = 20
// Attr SubKinds
,   HAS_ATTR_TOKEN = 21
,   INCLUDE_MATCH_TOKEN = "~="
,   DASH_MATCH_TOKEN = "|="
,   PREFIX_MATCH_TOKEN = "^="
,   SUFFIX_MATCH_TOKEN = "$="
,   SUBSTRING_MATCH_TOKEN = "*="
,   EQUAL_ATTR_TOKEN = '='

,   SCOPE = 22 // :scope pseudo class
,   MATCHES_TOKEN = 23 // :matches pseudo function
,   ATTR_INSENSITIVE_TOKEN = 24 // case insensitive attribute values

// Pseudo elements
,   PSEUDO_ELEMENT = 25 // subKind for pseudo-elements

,   re_consumeName =
      /^-?(?:[_a-zA-Z\u0080-\uFFFF]|\\[^\n]?|--\d?)(?:[-\w\u0080-\uFFFF]|\\[^\n]?)*/


  // 1: name
  // 2: equal operators
  // 3: quoted value
  // 4: unquoted value
  // 5: insensitive indicator
,   re_Attr = new RegExp(
  "^\\s*(" + re_consumeName.source.slice(1) + ")" + // name
  "\\s*(?:" + // starts optional operator and value
    "([$^*~|]?=)" + // operator
    "\\s*(?:((?:'(?:[^'\\n]|\\\\\\n)*')|(?:\"(?:[^\"\\n]|\\\\\\n)*\"))|" + // quoted val
    "(" + re_consumeName.source.slice(1) + "))" + // or unquoted val
  ")?\\s*([iI]?)\\s*]") // end of optional operator and value + `]`


  // 1: Entire string is a valid number
  // 2: First number (before `n`)
  // 3: + or - for second number
  // 4: second number (combine it with #3)
  // 5: even
  // 6: odd
,   re_makeNth =
      /^(?:([-+]?\d+)|([-+]?\d*)?n\s*(?:([-+])\s*(\d+))?|(even)|(odd))\s*\)/i

/**
 * @constructor
 * @private
 * @param {(string|number)} kind
 * @param {(string|number|!SelectorGroup)=} value
 * @param {*=} subKind
 */
function Token(kind, value, subKind) {
  this.kind = kind
  this.value = value
  this.subKind = subKind
}
Token.prototype.name = "" // Used for functions and attribute selectors
Token.prototype.a = 0
Token.prototype.b = 0


/*
  const re_lex = new RegExp(
    "^(?:" +
      "([ \t\n]+)|" + // 1. Whitespace
      "(,)|" +        // 2. Comma
      "(>)|" +        // 3. Right angle bracket
      "(\+)|" +       // 4. Plus sign
      "(~)|" +        // 5. Tilde

      // 6. Pseudo, 7. PseudoElement
      "(:(:?)" + re_consumeName.source.slice(1) + "(\(getPseudoFunction\))?)|" +

      "(\[re_Attr\])|" + // 8. Attr
      "(\*)|" +       // 9. Asterisk (universal)

      // 10. ID, 11. Class, 12. Name
      "(?:(#)|(\.)" + re_consumeName.source.slice(1) + ")" +
    ")"
  )
*/

/**
 * @constructor
 * @param {string|Lexer} source
 * @param {string=} endChar
 * @param {boolean=} prevent_not
 * @param {boolean=} prevent_combinator
 */
function Lexer(source, endChar, prevent_not, prevent_combinator) {
  if (source instanceof Lexer) {
    this.sel = source.sel
    this.i = source.i
    this.last_tok_i = source.last_tok_i
    this.origTok = source
  } else {
    this.sel = source
    this.i = -1
    this.last_tok_i = -1 // Used only for the Selector cache.
  }

  this.prevent_not = !!prevent_not
  this.prevent_combinator = !!prevent_combinator
  this.endChar = endChar || ""

  this._reconsumed = false

  this.curr = this.next() // Prime it with the first value.
  this.reconsume()        // Because we pre-fetched the first value.
}


const arrEmptyString = [""]


/**
 * @return {Token|string|number}
 */
Lexer.prototype.next = function() {
  if (this._reconsumed) {
    this._reconsumed = false
    return this.curr
  }

  // Strict equality, since `undefined` is uninitialized, and `null` is closed.
  if (this.curr === null) {
    return this.curr // May have been manually set to `null` below
  }

  var r = getChar(this.sel, this.i+=1)
  ,   temp = ""
  ,   parts

  this.last_tok_i = this.i

  if (!r || r === this.endChar) {
    if (this.origTok) {
      this.origTok.i = this.i
      this.origTok = null
    }
    this.curr = null
    return this.curr
  }

  switch(r) {
  // Comma or "*"
  case COMMA_TOKEN:
  case UNIVERSAL_TAG_TOKEN:

  // Combinators (not descendant ' ')
  case COMBINATOR_CHILD:
  case COMBINATOR_ADJACENT:
  case COMBINATOR_GENERAL:
    this.curr = r
    break

  // Pseudo
  case ':':
    var verifyPseudoElem = false
    ,   name = ""

    if (getChar(this.sel, this.i + 1) === ':') {
      this.i+=1 // Discard
      verifyPseudoElem = true
    }

    name = (re_consumeName.exec(
      this.sel.slice(this.i+1)) || arrEmptyString)[0].toLowerCase()

    this.i += name.length

    if (getChar(this.sel, this.i + 1) === '(') { // Pseudo function
      this.i+=1 // Discard
      this.curr = this.getPseudoFunction(name)

    } else {
      this.curr = new Token(PSEUDO_TOKEN, name, pseudoClassFns[name])
    }

    if (!this.curr || !this.curr.subKind) {
      switch (name) {
      case "scope":
        this.curr = SCOPE
        break
      case "first-line":
      case "first-letter":
      case "before":
      case "after":
        this.curr = PSEUDO_ELEMENT
      }
    }

    if (verifyPseudoElem && this.curr !== PSEUDO_ELEMENT) {
      throw errInvalidSelector
    }

    break

  // Attribute
  case '[':
    parts = re_Attr.exec(this.sel.slice(this.i+1))

    if (!parts) {
      throw errInvalidSelector
    }
    this.i += parts[0].length

    this.curr = new Token(
      parts[5] ? ATTR_INSENSITIVE_TOKEN : ATTR_TOKEN,
      parts[3] ? parts[3].slice(1, -1) : parts[4],
      parts[2] || HAS_ATTR_TOKEN
    )
    this.curr.name = parts[1]

    if (parts[5]) { // case insensitive
      if (parts[2]) { // checks a value
        this.curr.value = this.curr.value.toLowerCase()
      } else {
        throw errInvalidSelector
      }
    }
    break


  // ID, CLASS, TAG or Whitespace
  default:
    var t = countSpacesAt(this.sel, this.i)

    if (t > 0) {
      this.i += t-1
      this.curr = WHITESPACE_TOKEN
      break
    }

    t = r === '#' ? ID_TOKEN : r === '.' ? CLASS_TOKEN : TAG_TOKEN

    if (t === TAG_TOKEN) {
      this.i -= 1 // make sure we include the first character for a tag
    }

    if ((temp = re_consumeName.exec(this.sel.slice(this.i+1)))) {
      this.i += temp[0].length
      this.curr = new Token(t, temp[0])
      break
    }

    throw errInvalidSelector
  }

  return this.curr
}


Lexer.prototype.getPseudoFunction = function(name) {
  switch (name.toLowerCase()) {

  //case "has":

  case "not":
    if (this.prevent_not) {
      throw errInvalidSelector
    }

    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', true, true)),
      NOT_TOKEN
    )

  case "matches":
    return new Token(
      PSEUDO_FUNCTION_TOKEN,
      // New Lexer with the same source that halts on `)`
      new SelectorGroup(new Lexer(this, ')', false, true)),
      MATCHES_TOKEN
    )
    break

  case "lang":
    // New Lexer with the same source that halts on `)`
    const lex = new Lexer(this, ')')
    ,     n = lex.nextAfterSpace()

    if (n.kind === TAG_TOKEN && !lex.nextAfterSpace()) {
      // Comes through as a TAG, so relabel
      n.kind = PSEUDO_FUNCTION_TOKEN
      n.subKind = LANG_TOKEN
      return n

    } else {
      throw errInvalidSelector
    }


  case "nth-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_CHILD_TOKEN))

  case "nth-last-child":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_CHILD_TOKEN))

  case "nth-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_OF_TYPE_TOKEN))

  case "nth-last-of-type":
    return this.makeNth(new Token(PSEUDO_FUNCTION_TOKEN, 0, NTH_LAST_OF_TYPE_TOKEN))

  default:
    throw errInvalidSelector
  }
}


Lexer.prototype.reconsume = function() {
  if (DEBUG && this._reconsumed) {
    throw errInternal
  }
  this._reconsumed = true
}

/**
 * @return {Token|string|number}
 */
Lexer.prototype.nextAfterSpace = function() {
  while (this.next() === WHITESPACE_TOKEN) {
  }

  return this.curr
}


/**
 * @param {!Token} n
 * @return {!Token}
 */
Lexer.prototype.makeNth = function(n) {
  var a = 0
  ,   b = 0

  const parts = re_makeNth.exec(this.sel.slice(this.i+1))

  if (!parts) {
    throw errInvalidSelector
  }
  this.i += parts[0].length

  if (parts[1]) {
    b = +parts[1] // When only a number, it gets assigned to `b` position

  } else if (parts[5]) {
    a = 2

  } else if (parts[6]) {
    a = 2
    b = 1

  } else {
    const aStr = parts[2]
    ,     bStr = parts[3] + parts[4]

    if (!aStr || aStr === '+' || aStr === '-') {
      // If '-', -1 else must be '+' or empty string, so 1
      a = aStr === '-' ? -1 : 1

    } else {
      a = +aStr
    }

    if (bStr) {
      b = +bStr
    }

    if (DEBUG && (isNaN(a) || isNaN(b))) {
      throw errInternal
    }
  }

  n.value = [a, b]

  return n
}


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

  var first = true
  ,   n

  // Continue to compile if any remain, and check `el` at the same time
  while ((n = source.nextAfterSpace())) {
    var isComma = n === COMMA_TOKEN

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
 * @return {boolean}
 */
SelectorGroup.prototype.matches = function(root, el) {
  const qual = this.globalQualifier
  ,     qualIsName = qual !== "*"

  for (var i = 0, len = this.selectors.length; i < len; i+=1) {
    const sel = this.selectors[i]
    ,     q = qualIsName ? qual : sel.qualifier

    // Check the qualifer early to avoid the `compare_selector()` when possible.
    if ((!q || q === nodeName(el)) && compare_selector(root, el, sel)) {
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

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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
  const resArr = []

  // TODO: Ultimately want to optimize for `gEBI`, `gEBCN`, `gEBTN`, `:root`
  // when the selector consists entirely of one of those.

  for (var i = 0, len = p.length; i < len; i+=1) {
    if (needCommentFilter && p[i].nodeType !== 1) {
      continue
    }

    // If not an element, or an element but not a match, try the next elem
    if (this.matches(root, p[i])) {
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

  this.parts = []

  while ((n = source.next())) {
    // Track if whitespace was found in case it's a descendant combinator.
    var isSpace = n === WHITESPACE_TOKEN

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

  var n = source.nextAfterSpace()

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
  for (var j = selector.parts.length-1, combinator = 0; j > -1; j-=1) {
    var part = selector.parts[j]
    ,   haltOnFail = false
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

  for (var i = 0, sequence = seq.sequence; i < sequence.length; i++) {
    var simple = sequence[i]

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
        if (!simple.value["matches"](root, el)) { continue }
        return false

      case MATCHES_TOKEN:
        if (simple.value["matches"](root, el)) { continue }
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
        var tempEl = el
        while (tempEl && !tempEl.lang) { tempEl = tempEl.parentNode }

        if (tempEl && dashMatch(tempEl.lang, simple.value)) { continue }
        return false
      }


    // Attribute selectors
    case ATTR_TOKEN:
    case ATTR_INSENSITIVE_TOKEN:
      var attrVal = getAttr(el, simple.name)
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
  var idx = 0

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

    var helper = hoverHelper
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


/**
 * @param {!string} s
 * @param {!number} i
 * @return {string|undefined}
 */
function getChar(s, i) {
  return LEGACY ? s.charAt(i) : s[i]
}


/**
 * Returns the number of consecutive spaces found starting at the given index or
 * -1 if the index was out of bounds.
 *
 * @param {!string} s
 * @param {!number} i
 * @return {number}
 */
function countSpacesAt(s, i) {
  var res = 0

  for (;;) {
    switch((getChar(s, i+res) || "")) {
    case ' ': case '\t': case '\n':
      res += 1
      continue

    case "":
      return res || -1
    }
    return res
  }
}


/**
 * @param {!Array<*>} coll
 * @param {!*} target
 * @return {boolean}
 */
function contains(coll, target) {
  for (var i = 0, len = coll.length; i < len; i+=1) {
    if (coll[i] === target) {
      return true
    }
  }
  return false
}


 /**
 * @param {!Node} el
 * @return {string}
 */
function nodeName(el) {
  if (LEGACY) {
    /*
    var n = el.nodeName.toUpperCase()

    if (needTagFix && getChar(n, 0) === '/') {
      return n.slice(1)
    } else {
      return n
    }
    */
    return el.nodeName.toUpperCase()

  } else {
    return el.nodeName
  }
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
  return nodeName(el) === "INPUT" &&
        (el.type === "number" ||
         (el.type === "text" && (hasAttr(el, "min") || hasAttr(el, "max"))))
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function checkBooleanAttr(el, name) {
  return el[name] || hasAttr(el, name)
}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {boolean}
 */
function hasAttr(el, name) {
  if (LEGACY) {
    return !!(!el.attributes[name] && name === "class" ?
                el.attributes["className"] :
                el.attributes[name])
  } else {
    return !!el.attributes[name]
  }
}


const reuse_obj = {}

/**
 * @param {!Element} el
 * @param {!string} name
 * @return {string|undefined}
 */
function getAttr(el, name) {
  if (LEGACY) {
    return ((!el.attributes[name] && name === "class" ?
              el.attributes["className"] :
              el.attributes[name]) || reuse_obj).value
  } else {
    return (el.attributes[name] || reuse_obj).value
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function parentElement(el) {
  if (LEGACY) {
    const par = /**@type{Element}*/(el.parentNode)
    return par && par.nodeType === Node.ELEMENT_NODE ? par : null
  } else {
    return el.parentElement
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function prevElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.previousSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.previousElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function nextElemSib(el) {
  if (LEGACY) {
    let sib = el
    do {
      sib = sib.nextSibling
    } while (sib && sib.nodeType !== Node.ELEMENT_NODE)

    return /**@type{Element}*/(sib)
  } else {
    return el.nextElementSibling
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function firstElemChild(el) {
  if (LEGACY) {
    if (el.firstChild && el.firstChild.nodeType !== Node.ELEMENT_NODE) {
      return nextElemSib(el.firstChild)
    } else {
      return /**@type{Element}*/(el.firstChild)
    }
  } else {
    return el.firstElementChild
  }
}


/**
 * @param {!Node} el
 * @return {Element}
 */
function lastElemChild(el) {
  if (LEGACY) {
    if (el.lastChild && el.lastChild.nodeType !== Node.ELEMENT_NODE) {
      return prevElemSib(el.lastChild)
    } else {
      return /**@type{Element}*/(el.lastChild)
    }
  } else {
    return el.lastElementChild
  }
}
