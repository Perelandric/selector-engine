const errInvalidSelector = new Error("Invalid selector")
,   errInternal = new Error("Internal error")

,   NO_TOKEN = 0
,   UNIVERSAL_TAG_TOKEN = 1
,   PSEUDO_FUNCTION_TOKEN = 2
,   WHITESPACE_TOKEN = 3


,   COMBINATOR = 4
// Combinator subKinds
,   CHILD_COMB = 5
,   DESCENDANT_COMB = 6
,   ADJACENT_SIB_COMB = 7
,   GENERAL_SIB_COMB = 8
,   NO_COMB = 9

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


// Reusable, stateless objects
,   COMBINATOR_DESCENDANT_REUSE = new Token(COMBINATOR)
,   COMBINATOR_CHILD_REUSE = new Token(COMBINATOR)
,   COMBINATOR_ADJACENT_REUSE = new Token(COMBINATOR)
,   COMBINATOR_GENERAL_REUSE = new Token(COMBINATOR)
,   COMBINATOR_NONE_REUSE = new Token(COMBINATOR)

,   UNIVERSAL_TAG_REUSE = new Token(UNIVERSAL_TAG_TOKEN)
//,   NO_TOKEN_REUSE = new Token(NO_TOKEN, "no-tok")
,   COMMA_TOKEN_REUSE = new Token(',', ',')
,   WHITESPACE_TOKEN_REUSE = new Token(WHITESPACE_TOKEN, ' ')

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

COMBINATOR_DESCENDANT_REUSE.subKind = DESCENDANT_COMB
COMBINATOR_CHILD_REUSE.subKind = CHILD_COMB
COMBINATOR_ADJACENT_REUSE.subKind = ADJACENT_SIB_COMB
COMBINATOR_GENERAL_REUSE.subKind = GENERAL_SIB_COMB
COMBINATOR_NONE_REUSE.subKind = NO_COMB

/**
 * @constructor
 * @private
 * @param {(string|number)} kind
 * @param {string=} value
 */
function Token(kind, value) {
  this.kind = kind
  this.value = value
}
Token.prototype.kind = NO_TOKEN
Token.prototype.subKind = NO_TOKEN
Token.prototype.subSelector = null
Token.prototype.name = "" // Used for functions and attribute selectors
Token.prototype.value = ""
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


var arrEmptyString = [""]


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
  // Whitespace
  case ' ': case '\t': case '\n':
    for (;;) { // Discard any subsequent whitespace
      switch(getChar(this.sel, this.i += 1)) {
      case ' ': case '\t': case '\n':
        continue
      }
      this.i-=1 // Reset to before the last non-space
      break
    }

    this.curr = WHITESPACE_TOKEN_REUSE
    break


  // Comma
  case ',':
    this.curr = COMMA_TOKEN_REUSE
    break


  // Combinators (not descendant ' ')
  case '>': this.curr = COMBINATOR_CHILD_REUSE
    break
  case '+': this.curr = COMBINATOR_ADJACENT_REUSE
    break
  case '~': this.curr = COMBINATOR_GENERAL_REUSE
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

    if (verifyPseudoElem) { // Verify valid pseudo-element for 2 colons
      switch (name) {
      case "first-line":
      case "first-letter":
      case "before":
      case "after":
        this.curr = new Token(PSEUDO_TOKEN, name)
        this.curr.subKind = pseudoClassFns["no-tok"]
        break

      default:
        throw errInvalidSelector
      }

    } else if (getChar(this.sel, this.i + 1) === '(') { // Pseudo function
      this.i+=1 // Discard
      this.curr = this.getPseudoFunction(name)

    } else {
      this.curr = new Token(PSEUDO_TOKEN, name)
      this.curr.subKind = name === "scope" ? SCOPE : pseudoClassFns[name]

      if (!this.curr.subKind) {
        throw errInvalidSelector
      }
    }
    break

  // Attribute
  case '[':
    parts = re_Attr.exec(this.sel.slice(this.i+1))

    if (!parts) {
      throw errInvalidSelector
    }
    this.i += parts[0].length

    this.curr = new Token(parts[5] ? ATTR_INSENSITIVE_TOKEN : ATTR_TOKEN)
    this.curr.name = parts[1]

    if (parts[2]) {
      this.curr.subKind = parts[2]
      this.curr.value = parts[3] ? parts[3].slice(1, -1) : parts[4]
      if (parts[5]) {
        this.curr.value = this.curr.value.toLowerCase()
      }

    } else {
      this.curr.subKind = HAS_ATTR_TOKEN
      if (parts[5]) { // Case insensitivity makes no sense with no value
        throw errInvalidSelector
      }
    }
    break


  // Universal tag
  case '*':
    this.curr = UNIVERSAL_TAG_REUSE
    break


  default: // ID, CLASS or TAG
    var tok = r === '#' ? ID_TOKEN : r === '.' ? CLASS_TOKEN : TAG_TOKEN

    if (tok === TAG_TOKEN) {
      this.i -= 1 // make sure we include the first character for a tag
    }

    if ((temp = re_consumeName.exec(this.sel.slice(this.i+1)))) {
      this.i += temp[0].length
      this.curr = new Token(tok, temp[0])
      break
    }

    throw errInvalidSelector
  }

  return this.curr
}


Lexer.prototype.getPseudoFunction = function(name) {
  var n = new Token(PSEUDO_FUNCTION_TOKEN, name.toLowerCase())
  ,   block

  switch (n.value) {
  case "not":
    if (this.prevent_not) {
      throw errInvalidSelector
    }

    // New Lexer with the same source that halts on `)`
    block = new Lexer(this, ')', true, false)

    n.subSelector = new SelectorGroup(block)
    n.subKind = NOT_TOKEN
    break

  case "matches":
    // New Lexer with the same source that halts on `)`
    block = new Lexer(this, ')', false, true)

    n.subSelector = new SelectorGroup(block)
    n.subKind = MATCHES_TOKEN
    break

  //case "has":

  case "lang":
    // New Lexer with the same source that halts on `)`
    block = new Lexer(this, ')', true, true)

    n = block.nextAfterSpace()

    if (n.kind === TAG_TOKEN) { // Comes through as a TAG, so  relabel
      n.kind = PSEUDO_FUNCTION_TOKEN
      n.subKind = LANG_TOKEN

    } else {
      throw errInvalidSelector
    }
    break

  case "nth-child":
    n.subKind = NTH_CHILD_TOKEN
    return this.makeNth(n)

  case "nth-last-child":
    n.subKind = NTH_LAST_CHILD_TOKEN
    return this.makeNth(n)

  case "nth-of-type":
    n.subKind = NTH_OF_TYPE_TOKEN
    return this.makeNth(n)

  case "nth-last-of-type":
    n.subKind = NTH_LAST_OF_TYPE_TOKEN
    return this.makeNth(n)

  default:
    throw errInvalidSelector
  }

  if (block.next()) {
    throw errInvalidSelector // There was more in the block, so it's invalid
  }

  return n
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
  var n

  while ((n = this.next()) && n.kind === WHITESPACE_TOKEN) {
  }

  return n
}


/**
 * @param {!Token} n
 * @return {!Token}
 */
Lexer.prototype.makeNth = function(n) {
  n.a = 0
  n.b = 0

  const parts = re_makeNth.exec(this.sel.slice(this.i+1))

  if (!parts) {
    throw errInvalidSelector
  }
  this.i += parts[0].length

  if (parts[1]) {
    n.b = +parts[1] // When only a number, it gets assigned to `b` position

  } else if (parts[5]) {
    n.a = 2

  } else if (parts[6]) {
    n.a = 2
    n.b = 1

  } else {
    const aStr = parts[2]
    ,     bStr = parts[3] + parts[4]

    if (!aStr || aStr === '+' || aStr === '-') {
      // If '-', -1 else must be '+' or empty string, so 1
      n.a = aStr === '-' ? -1 : 1

    } else {
      n.a = +aStr
    }

    if (bStr) {
      n.b = +bStr
    }

    if (DEBUG_MODE && (isNaN(n.a) || isNaN(n.b))) {
      throw errInternal
    }
  }

  return n
}
