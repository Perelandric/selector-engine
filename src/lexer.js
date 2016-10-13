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
 * @param {string=} value
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
 * @private
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
 * @return {Token}
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
    var t = getSpaceAt(this.sel, this.i)

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
      new SelectorGroup(new Lexer(this, ')', true, false)),
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
    var n = new Lexer(this, ')', true, true).nextAfterSpace()

    if (n.kind === TAG_TOKEN) { // Comes through as a TAG, so relabel
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
  if (DEBUG_MODE && this._reconsumed) {
    throw errInternal
  }
  this._reconsumed = true
}

/**
 * @return {Token}
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

    if (DEBUG_MODE && (isNaN(a) || isNaN(b))) {
      throw errInternal
    }
  }

  n.value = [a, b]

  return n
}
