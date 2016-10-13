/* selector-engine | (c) 2016 Perelandric | MIT License */
;(function(global) {var DEBUG_MODE = false;
var LEGACY = false;
var Query = global["Query"] = {};
var re_trim = /(?:^\s+|\s+$)/g;
var cache = {};
var selCache = {};
Query["one"] = function(elem, selector) {
  if (arguments.length === 1) {
    selector = elem;
    elem = document;
  }
  return (new SelectorGroup(selector)).selectFirstFrom(elem);
};
Query["all"] = function(elem, selector) {
  if (arguments.length === 1) {
    selector = elem;
    elem = document;
  }
  return (new SelectorGroup(selector)).selectFrom(elem);
};
Query["matches"] = function(elem, selector) {
  return (new SelectorGroup(selector)).matches(elem);
};
var errInvalidSelector = new Error("Invalid selector");
var errInternal = new Error("Internal error");
var NO_TOKEN = 0;
var UNIVERSAL_TAG_TOKEN = 1;
var PSEUDO_FUNCTION_TOKEN = 2;
var WHITESPACE_TOKEN = 3;
var COMMA_TOKEN = 4;
var COMBINATOR_CHILD = 5;
var COMBINATOR_DESCENDANT = 6;
var COMBINATOR_ADJACENT = 7;
var COMBINATOR_GENERAL = 8;
var ID_TOKEN = 10;
var TAG_TOKEN = 11;
var PSEUDO_TOKEN = 12;
var LANG_TOKEN = 13;
var NTH_CHILD_TOKEN = 14;
var NTH_LAST_CHILD_TOKEN = 15;
var NTH_OF_TYPE_TOKEN = 16;
var NTH_LAST_OF_TYPE_TOKEN = 17;
var CLASS_TOKEN = 18;
var NOT_TOKEN = 19;
var ATTR_TOKEN = 20;
var HAS_ATTR_TOKEN = 21;
var INCLUDE_MATCH_TOKEN = "~=";
var DASH_MATCH_TOKEN = "|=";
var PREFIX_MATCH_TOKEN = "^=";
var SUFFIX_MATCH_TOKEN = "$=";
var SUBSTRING_MATCH_TOKEN = "*=";
var EQUAL_ATTR_TOKEN = "=";
var SCOPE = 22;
var MATCHES_TOKEN = 23;
var ATTR_INSENSITIVE_TOKEN = 24;
var PSEUDO_ELEMENT = 25;
var re_consumeName = /^-?(?:[_a-zA-Z\u0080-\uFFFF]|\\[^\n]?|--\d?)(?:[-\w\u0080-\uFFFF]|\\[^\n]?)*/;
var re_Attr = new RegExp("^\\s*(" + re_consumeName.source.slice(1) + ")" + "\\s*(?:" + "([$^*~|]?=)" + "\\s*(?:((?:'(?:[^'\\n]|\\\\\\n)*')|(?:\"(?:[^\"\\n]|\\\\\\n)*\"))|" + "(" + re_consumeName.source.slice(1) + "))" + ")?\\s*([iI]?)\\s*]");
var re_makeNth = /^(?:([-+]?\d+)|([-+]?\d*)?n\s*(?:([-+])\s*(\d+))?|(even)|(odd))\s*\)/i;
function Token(kind, value) {
  this.kind = kind;
  this.value = value;
}
Token.prototype.kind = NO_TOKEN;
Token.prototype.subKind = NO_TOKEN;
Token.prototype.subSelector = null;
Token.prototype.name = "";
Token.prototype.value = "";
Token.prototype.a = 0;
Token.prototype.b = 0;
function Lexer(source, endChar, prevent_not, prevent_combinator) {
  if (source instanceof Lexer) {
    this.sel = source.sel;
    this.i = source.i;
    this.last_tok_i = source.last_tok_i;
    this.origTok = source;
  } else {
    this.sel = source;
    this.i = -1;
    this.last_tok_i = -1;
  }
  this.prevent_not = !!prevent_not;
  this.prevent_combinator = !!prevent_combinator;
  this.endChar = endChar || "";
  this._reconsumed = false;
  this.curr = this.next();
  this.reconsume();
}
var arrEmptyString = [""];
Lexer.prototype.next = function() {
  if (this._reconsumed) {
    this._reconsumed = false;
    return this.curr;
  }
  if (this.curr === null) {
    return this.curr;
  }
  var r = getChar(this.sel, this.i += 1), temp = "", parts;
  this.last_tok_i = this.i;
  if (!r || r === this.endChar) {
    if (this.origTok) {
      this.origTok.i = this.i;
      this.origTok = null;
    }
    this.curr = null;
    return this.curr;
  }
  switch(r) {
    case ",":
      this.curr = COMMA_TOKEN;
      break;
    case ">":
      this.curr = COMBINATOR_CHILD;
      break;
    case "+":
      this.curr = COMBINATOR_ADJACENT;
      break;
    case "~":
      this.curr = COMBINATOR_GENERAL;
      break;
    case ":":
      var verifyPseudoElem = false, name = "";
      if (getChar(this.sel, this.i + 1) === ":") {
        this.i += 1;
        verifyPseudoElem = true;
      }
      name = (re_consumeName.exec(this.sel.slice(this.i + 1)) || arrEmptyString)[0].toLowerCase();
      this.i += name.length;
      if (getChar(this.sel, this.i + 1) === "(") {
        this.i += 1;
        this.curr = this.getPseudoFunction(name);
      } else {
        this.curr = new Token(PSEUDO_TOKEN, name);
        this.curr.subKind = name === "scope" ? SCOPE : pseudoClassFns[name];
      }
      if (!this.curr || !this.curr.subKind) {
        switch(name) {
          case "first-line":
          ;
          case "first-letter":
          ;
          case "before":
          ;
          case "after":
            this.curr = PSEUDO_ELEMENT;
        }
      }
      if (verifyPseudoElem && this.curr !== PSEUDO_ELEMENT) {
        throw errInvalidSelector;
      }
      break;
    case "[":
      parts = re_Attr.exec(this.sel.slice(this.i + 1));
      if (!parts) {
        throw errInvalidSelector;
      }
      this.i += parts[0].length;
      this.curr = new Token(parts[5] ? ATTR_INSENSITIVE_TOKEN : ATTR_TOKEN);
      this.curr.name = parts[1];
      if (parts[2]) {
        this.curr.subKind = parts[2];
        this.curr.value = parts[3] ? parts[3].slice(1, -1) : parts[4];
        if (parts[5]) {
          this.curr.value = this.curr.value.toLowerCase();
        }
      } else {
        this.curr.subKind = HAS_ATTR_TOKEN;
        if (parts[5]) {
          throw errInvalidSelector;
        }
      }
      break;
    case "*":
      this.curr = UNIVERSAL_TAG_TOKEN;
      break;
    default:
      var t = getSpaceAt(this.sel, this.i);
      if (t > 0) {
        this.i += t - 1;
        this.curr = WHITESPACE_TOKEN;
        break;
      }
      t = r === "#" ? ID_TOKEN : r === "." ? CLASS_TOKEN : TAG_TOKEN;
      if (t === TAG_TOKEN) {
        this.i -= 1;
      }
      if (temp = re_consumeName.exec(this.sel.slice(this.i + 1))) {
        this.i += temp[0].length;
        this.curr = new Token(t, temp[0]);
        break;
      }
      throw errInvalidSelector;;
  }
  return this.curr;
};
Lexer.prototype.getPseudoFunction = function(name) {
  var n = new Token(PSEUDO_FUNCTION_TOKEN, name.toLowerCase()), block;
  switch(n.value) {
    case "not":
      if (this.prevent_not) {
        throw errInvalidSelector;
      }
      block = new Lexer(this, ")", true, false);
      n.subSelector = new SelectorGroup(block);
      n.subKind = NOT_TOKEN;
      break;
    case "matches":
      block = new Lexer(this, ")", false, true);
      n.subSelector = new SelectorGroup(block);
      n.subKind = MATCHES_TOKEN;
      break;
    case "lang":
      block = new Lexer(this, ")", true, true);
      n = block.nextAfterSpace();
      if (n.kind === TAG_TOKEN) {
        n.kind = PSEUDO_FUNCTION_TOKEN;
        n.subKind = LANG_TOKEN;
      } else {
        throw errInvalidSelector;
      }
      break;
    case "nth-child":
      n.subKind = NTH_CHILD_TOKEN;
      return this.makeNth(n);
    case "nth-last-child":
      n.subKind = NTH_LAST_CHILD_TOKEN;
      return this.makeNth(n);
    case "nth-of-type":
      n.subKind = NTH_OF_TYPE_TOKEN;
      return this.makeNth(n);
    case "nth-last-of-type":
      n.subKind = NTH_LAST_OF_TYPE_TOKEN;
      return this.makeNth(n);
    default:
      throw errInvalidSelector;;
  }
  if (block.next()) {
    throw errInvalidSelector;
  }
  return n;
};
Lexer.prototype.reconsume = function() {
  if (DEBUG_MODE && this._reconsumed) {
    throw errInternal;
  }
  this._reconsumed = true;
};
Lexer.prototype.nextAfterSpace = function() {
  var n;
  while ((n = this.next()) && n === WHITESPACE_TOKEN) {
  }
  return n;
};
Lexer.prototype.makeNth = function(n) {
  n.a = 0;
  n.b = 0;
  var parts = re_makeNth.exec(this.sel.slice(this.i + 1));
  if (!parts) {
    throw errInvalidSelector;
  }
  this.i += parts[0].length;
  if (parts[1]) {
    n.b = +parts[1];
  } else {
    if (parts[5]) {
      n.a = 2;
    } else {
      if (parts[6]) {
        n.a = 2;
        n.b = 1;
      } else {
        var aStr = parts[2];
        var bStr = parts[3] + parts[4];
        if (!aStr || aStr === "+" || aStr === "-") {
          n.a = aStr === "-" ? -1 : 1;
        } else {
          n.a = +aStr;
        }
        if (bStr) {
          n.b = +bStr;
        }
        if (DEBUG_MODE && (isNaN(n.a) || isNaN(n.b))) {
          throw errInternal;
        }
      }
    }
  }
  return n;
};
function SelectorGroup(strTok) {
  var isLexer = strTok instanceof Lexer;
  if (!isLexer && cache.hasOwnProperty(strTok)) {
    return cache[strTok];
  }
  var subGroups = {};
  var source = isLexer ? strTok : new Lexer(strTok);
  var first = true, hasUniversal = false, n;
  while (n = source.nextAfterSpace()) {
    var isComma = n === COMMA_TOKEN;
    if (!first && !isComma && DEBUG_MODE) {
      throw errInternal;
    }
    if (first) {
      if (!n || isComma) {
        throw errInvalidSelector;
      }
      first = false;
      source.reconsume();
    }
    var selObject = new Selector(source);
    if (selObject.autoFail) {
      continue;
    }
    hasUniversal = hasUniversal || selObject.qualifier === "*";
    if (!subGroups.hasOwnProperty(selObject.qualifier)) {
      subGroups[selObject.qualifier] = [];
    }
    subGroups[selObject.qualifier].push(selObject);
  }
  this.subGroups = [];
  for (var key in subGroups) {
    var sg = subGroups[key];
    if (!subGroups.hasOwnProperty(key) || !sg.length) {
      continue;
    }
    if (hasUniversal) {
      for (var i = 0;i < sg.length;i += 1) {
        sg[i].qualifier = "*";
      }
      if (this.subGroups[0]) {
        this.subGroups[0].push.apply(this.subGroups[0], sg);
      } else {
        this.subGroups[0] = sg;
      }
    } else {
      this.subGroups.push(sg);
    }
  }
  if (!isLexer) {
    cache[strTok] = this;
  }
}
SelectorGroup.prototype.matches = function(el) {
  for (var i = 0;i < this.subGroups.length;i += 1) {
    if (_matches(el, el, this.subGroups[i])) {
      return true;
    }
  }
  return false;
};
SelectorGroup.prototype.selectFirstFrom = function(root) {
  var res = null;
  for (var i = 0;i < this.subGroups.length;i += 1) {
    this.potentialsLoop(root, i, function(el) {
      res = res && sorter(res, el) < 0 ? res : el;
      return true;
    });
  }
  return res;
};
SelectorGroup.prototype.selectFrom = function(root) {
  var resArr = [];
  var matchedSubGroups = 0, prevLen = 0;
  for (var i = 0;i < this.subGroups.length;i += 1) {
    this.potentialsLoop(root, i, function(el) {
      for (var k = 0;k < prevLen;k += 1) {
        if (resArr[k] === el) {
          return;
        }
      }
      resArr.push(el);
    });
    if (resArr.length !== prevLen) {
      matchedSubGroups += 1;
      prevLen = resArr.length;
    }
  }
  return matchedSubGroups > 1 ? resArr.sort(sorter) : resArr;
};
SelectorGroup.prototype.potentialsLoop = function(root, i, cb) {
  var subGroup = this.subGroups[i];
  var potentials = root.getElementsByTagName(needTagFix ? "*" : subGroup[0].qualifier);
  for (var j = 0;j < potentials.length;j += 1) {
    var el = potentials[j];
    if ((!needCommentFilter || el.nodeType === 1) && _matches(root, el, subGroup)) {
      if (cb(el)) {
        break;
      }
    }
  }
};
function Selector(source) {
  var startIdx = source._reconsumed ? source.last_tok_i : source.i + 1, endIdx = source.sel.indexOf(source.endChar || ",", startIdx);
  if (endIdx === -1) {
    endIdx = source.sel.length;
  }
  var potentialSel = source.sel.slice(startIdx, endIdx).replace(re_trim, "");
  if (selCache.hasOwnProperty(potentialSel)) {
    source._reconsumed = false;
    source.i = endIdx - 1;
    return selCache[potentialSel];
  }
  var doCombinator = false, n;
  this.parts = [];
  this.qualifier = "";
  while (n = source.next()) {
    var isSpace = n === WHITESPACE_TOKEN;
    if (isSpace) {
      n = source.nextAfterSpace();
    }
    if (!n || n === COMMA_TOKEN) {
      source.reconsume();
      break;
    }
    if (this.hasPseudoElem) {
      throw errInvalidSelector;
    }
    if (doCombinator) {
      if (source.prevent_combinator) {
        throw errInvalidSelector;
      }
      switch(n) {
        case COMBINATOR_CHILD:
        ;
        case COMBINATOR_ADJACENT:
        ;
        case COMBINATOR_GENERAL:
          this.parts.push(n);
          break;
        default:
          if (isSpace) {
            source.reconsume();
            this.parts.push(COMBINATOR_DESCENDANT);
          } else {
            throw errInvalidSelector;
          }
        ;
      }
      doCombinator = false;
    } else {
      source.reconsume();
      this.parts.push(new Sequence(source, this));
      doCombinator = true;
    }
  }
  if (!doCombinator) {
    throw errInvalidSelector;
  }
  if (this.autoFail) {
    this.parts = null;
  }
  if (endIdx === source.i) {
    selCache[potentialSel] = this;
  }
}
Selector.prototype.qualifier = "*";
Sequence.prototype.autoFail = false;
Sequence.prototype.hasScope = false;
Sequence.prototype.hasPseudoElem = false;
function Sequence(source, selector) {
  this.sequence = [];
  delete selector.qualifier;
  var n = source.nextAfterSpace();
  if (!n || n === COMMA_TOKEN) {
    throw errInvalidSelector;
  }
  if (n !== UNIVERSAL_TAG_TOKEN) {
    if (n.kind === TAG_TOKEN) {
      selector.qualifier = this.tag = n.value.toUpperCase();
    } else {
      source.reconsume();
    }
  }
  OUTER: while (n = source.next()) {
    switch(n) {
      case COMMA_TOKEN:
      ;
      case WHITESPACE_TOKEN:
      ;
      case COMBINATOR_CHILD:
      ;
      case COMBINATOR_ADJACENT:
      ;
      case COMBINATOR_GENERAL:
        source.reconsume();
        break OUTER;
    }
    if (selector.hasPseudoElem) {
      throw errInvalidSelector;
    }
    if (n === PSEUDO_ELEMENT) {
      selector.hasPseudoElem = true;
      selector.autoFail = true;
      continue;
    }
    switch(n.kind) {
      case PSEUDO_TOKEN:
        switch(n.subKind) {
          case SCOPE:
            if (selector.hasScope) {
              selector.autoFail = true;
            }
            this.hasScope = true;
            continue;
        }
      ;
      case ID_TOKEN:
      ;
      case ATTR_TOKEN:
      ;
      case ATTR_INSENSITIVE_TOKEN:
      ;
      case CLASS_TOKEN:
      ;
      case PSEUDO_FUNCTION_TOKEN:
      ;
      case PSEUDO_ELEMENT:
        this.sequence.push(n);
        break;
      default:
        throw errInvalidSelector;;
    }
  }
  if (this.hasScope) {
    selector.hasScope = true;
  }
}
Sequence.prototype.tag = "";
Sequence.prototype.hasScope = false;
function onOrAfter(a, b) {
  if (a === b || firstElemChild(a) && onOrAfter(firstElemChild(a), b)) {
    return true;
  }
  while (a = nextElemSib(a)) {
    if (onOrAfter(a, b)) {
      return true;
    }
  }
  return false;
}
function sorter(a, b) {
  return a === b ? 0 : a.compareDocumentPosition ? a.compareDocumentPosition(b) & 4 ? -1 : 1 : a.contains(b) ? -1 : b.contains(a) ? 1 : onOrAfter(nextElemSib(a), b) ? -1 : 1;
}
;var needTagFix = function() {
  if (LEGACY) {
    var testElem = document.createElement("div");
    var tempTagName = "div123";
    testElem.innerHTML = "1<" + tempTagName + "></" + tempTagName + ">";
    return getChar(testElem.getElementsByTagName("*")[0].nodeName, 0) === "/";
  } else {
    return false;
  }
}();
var needCommentFilter = LEGACY ? document.createElement("div").appendChild(document.createComment("")).parentNode.getElementsByTagName("*").length !== 0 : false;
function _matches(root, el, subGroup) {
  for (var i = 0;i < subGroup.length;i += 1) {
    if (compare_selector(root, el, subGroup[i])) {
      return true;
    }
  }
  return false;
}
function compare_selector(root, el, selector) {
  for (var j = selector.parts.length - 1, combinator = 0;j > -1;j -= 1) {
    var part = selector.parts[j], haltOnFail = false;
    if (part instanceof Sequence) {
      switch(combinator) {
        case 0:
          haltOnFail = true;
          break;
        case COMBINATOR_CHILD:
          haltOnFail = true;
        case COMBINATOR_DESCENDANT:
          el = parentElement(el);
          break;
        case COMBINATOR_ADJACENT:
          haltOnFail = true;
        case COMBINATOR_GENERAL:
          el = prevElemSib(el);
          break;
        default:
          if (DEBUG_MODE) {
            throw errInternal;
          }
        ;
      }
      if (!el) {
        return false;
      }
      if (compare_sequence(root, el, part)) {
        continue;
      }
      if (haltOnFail) {
        return false;
      }
      j += 1;
    } else {
      combinator = part;
    }
  }
  return true;
}
function compare_sequence(root, el, seq) {
  if (seq.hasScope && el !== root) {
    return false;
  }
  if (seq.tag && nodeName(el) !== seq.tag) {
    return false;
  }
  for (var i = 0, sequence = seq.sequence;i < seq.length;i++) {
    var simple = sequence[i];
    switch(simple.kind) {
      case CLASS_TOKEN:
        if (fieldMatch(el.className, simple.value)) {
          continue;
        }
        return false;
      case ID_TOKEN:
        if (el.id === simple.value) {
          continue;
        }
        return false;
      case PSEUDO_TOKEN:
        if (simple.subKind(el)) {
          continue;
        }
        return false;
      case PSEUDO_FUNCTION_TOKEN:
        switch(simple.subKind) {
          case NOT_TOKEN:
            if (!simple.subSelector["matches"](el)) {
              continue;
            }
            return false;
          case MATCHES_TOKEN:
            if (simple.subSelector["matches"](el)) {
              continue;
            }
            return false;
          case NTH_CHILD_TOKEN:
            if (isNth(el, simple, "", false)) {
              continue;
            }
            return false;
          case NTH_LAST_CHILD_TOKEN:
            if (isNth(el, simple, "", true)) {
              continue;
            }
            return false;
          case NTH_OF_TYPE_TOKEN:
            if (isNth(el, simple, seq.tag, false)) {
              continue;
            }
            return false;
          case NTH_LAST_OF_TYPE_TOKEN:
            if (isNth(el, simple, seq.tag, true)) {
              continue;
            }
            return false;
          case LANG_TOKEN:
            var tempEl = el;
            while (tempEl && !tempEl.lang) {
              tempEl = tempEl.parentNode;
            }
            if (tempEl && dashMatch(tempEl.lang, simple.value)) {
              continue;
            }
            return false;
        }
      ;
      case ATTR_TOKEN:
      ;
      case ATTR_INSENSITIVE_TOKEN:
        var attrVal = getAttr(el, simple.name);
        if (attrVal == null) {
          return false;
        }
        if (simple.kind === ATTR_INSENSITIVE_TOKEN) {
          attrVal = attrVal.toLowerCase();
        }
        switch(simple.subKind) {
          case EQUAL_ATTR_TOKEN:
            if (attrVal === simple.value) {
              continue;
            }
            return false;
          case PREFIX_MATCH_TOKEN:
            if (attrVal.lastIndexOf(simple.value, 0) === 0) {
              continue;
            }
            return false;
          case SUFFIX_MATCH_TOKEN:
            if (attrVal.lastIndexOf(simple.value) + simple.value.length === attrVal.length) {
              continue;
            }
            return false;
          case DASH_MATCH_TOKEN:
            if (dashMatch(attrVal, simple.value)) {
              continue;
            }
            return false;
          case INCLUDE_MATCH_TOKEN:
            if (fieldMatch(attrVal, simple.value)) {
              continue;
            }
            return false;
          case HAS_ATTR_TOKEN:
            continue;
          case SUBSTRING_MATCH_TOKEN:
            if (attrVal.indexOf(simple.value) !== -1) {
              continue;
            }
            return false;
        }
      ;
    }
    if (DEBUG_MODE) {
      throw errInternal;
    }
  }
  return true;
}
function dashMatch(target, pattern) {
  var last = getChar(target, pattern.length);
  return (!last || last === "-") && target.lastIndexOf(pattern, 0) === 0;
}
function fieldMatch(target, pattern) {
  var idx = 0;
  while ((idx = target.indexOf(pattern, idx)) !== -1) {
    if (getSpaceAt(target, idx - 1) && getSpaceAt(target, idx + pattern.length)) {
      return true;
    }
    idx += pattern.length + 1;
  }
  return false;
}
function isNth(el, simple, nn, fromEnd) {
  var nth = simple.a;
  if (!el.parentNode) {
    return false;
  }
  var idx = 1 - simple.b, curr = fromEnd ? lastElemChild(el.parentNode) : firstElemChild(el.parentNode);
  while (curr !== el) {
    if (!nn || nodeName(curr) === nn) {
      idx += 1;
    }
    curr = fromEnd ? prevElemSib(curr) : nextElemSib(curr);
  }
  return idx === 0 || idx % nth === 0 && idx / nth >= 0;
}
var formControls = {"INPUT":1, "TEXTAREA":1, "SELECT":1, "BUTTON":1, "OPTION":1, "OPTGROUP":1};
var hiddenOrButton = {"hidden":1, "image":1, "button":1, "submit":1, "reset":1};
var pseudoClassFns = {"root":function(el) {
  return el.ownerDocument.documentElement === el;
}, "empty":function(el) {
  return !el.firstChild;
}, "optional":function(el) {
  return !pseudoClassFns["required"](el);
}, "required":function(el) {
  return checkBooleanAttr(el, "required") && formControls[nodeName(el)] && !hiddenOrButton[el.type];
}, "checked":function(el) {
  return el.checked && (el.type === "checkbox" || el.type === "radio") || el.selected && nodeName(el) === "OPTION";
}, "indeterminate":function(el) {
  return checkBooleanAttr(el, "indeterminate") && el.type === "checkbox" && nodeName(el) === "INPUT";
}, "out-of-range":function(el) {
  return !pseudoClassFns["in-range"](el);
}, "in-range":function(el) {
  return isNumberInput(el) && ((+el.min !== +el.min || +el.value >= +el.min) && (+el.max !== +el.max || +el.value <= +el.max)) === true;
}, "default-option":function(el) {
  if (el.defaultChecked || el.defaultSelected) {
    return true;
  }
  var sel = "BUTTON, INPUT[type=submit]";
  return el.form && el.form.nodeType === 1 && Query["matches"](el, sel) && Query["one"](el.form, sel) === el;
}, "enabled":function(el) {
  return !pseudoClassFns["disabled"](el);
}, "disabled":function(el) {
  return checkBooleanAttr(el, "disabled") && formControls[nodeName(el)];
}, "target":function(el) {
  return el.id && window.location.hash.slice(1) === el.id;
}, "any-link":function(el) {
  return nodeName(el) === "A" && hasAttr(el, "href");
}, "hover":function(el) {
  if (needHoverHelperSetup) {
    hoverHelperSetup();
  }
  if (el.contains) {
    return el.contains(hoverHelper);
  }
  var helper = hoverHelper;
  do {
    if (el === helper) {
      return true;
    }
  } while (helper && (helper = parentElement(helper)));
  return false;
}, "focus":function(el) {
  return el === el.ownerDocument.activeElement;
}, "first-child":function(el) {
  return !prevElemSib(el);
}, "last-child":function(el) {
  return !nextElemSib(el);
}, "only-child":function(el) {
  return !prevElemSib(el) && !nextElemSib(el);
}, "first-of-type":function(el) {
  var name = nodeName(el);
  while ((el = prevElemSib(el)) && nodeName(el) !== name) {
  }
  return !el;
}, "last-of-type":function(el) {
  var name = nodeName(el);
  while ((el = nextElemSib(el)) && nodeName(el) !== name) {
  }
  return !el;
}, "only-of-type":function(el) {
  return pseudoClassFns["first-of-type"](el) && pseudoClassFns["last-of-type"](el);
}};
var needHoverHelperSetup = true, hoverHelper = null;
function hoverHelperSetup() {
  if (!needHoverHelperSetup) {
    return;
  }
  needHoverHelperSetup = false;
  if (!LEGACY || window.addEventListener) {
    window.addEventListener("mouseover", function(event) {
      hoverHelper = event.target;
    }, true);
  } else {
    if (window.attachEvent) {
      window.attachEvent("onmouseover", function(event) {
        hoverHelper = event.srcElement;
      });
    }
  }
  var body = document.body;
  if (body) {
    var sib = body.nextSibling;
    var par = body.parentNode;
    par.removeChild(body);
    par.insertBefore(body, sib);
  }
}
;function getChar(s, i) {
  return LEGACY ? s.charAt(i) : s[i];
}
function getSpaceAt(s, i) {
  var res = 0;
  for (;;) {
    switch(getChar(s, i + res)) {
      case " ":
      ;
      case "\t":
      ;
      case "\n":
        res += 1;
        continue;
      case "":
      ;
      case undefined:
        return res || -1;
    }
    return res;
  }
}
function nodeName(el) {
  if (LEGACY) {
    var n = el.nodeName.toUpperCase();
    if (needTagFix && getChar(n, 0) === "/") {
      return n.slice(1);
    } else {
      return n;
    }
  } else {
    return el.nodeName;
  }
}
function isNumberInput(el) {
  return nodeName(el) === "INPUT" && (el.type === "number" || el.type === "text" && (hasAttr(el, "min") || hasAttr(el, "max")));
}
function checkBooleanAttr(el, name) {
  return el[name] || hasAttr(el, name);
}
function hasAttr(el, name) {
  if (LEGACY) {
    return !!(!el.attributes[name] && name === "class" ? el.attributes["className"] : el.attributes[name]);
  } else {
    return !!el.attributes[name];
  }
}
var reuse_obj = {};
function getAttr(el, name) {
  if (LEGACY) {
    return ((!el.attributes[name] && name === "class" ? el.attributes["className"] : el.attributes[name]) || reuse_obj).value;
  } else {
    return (el.attributes[name] || reuse_obj).value;
  }
}
function parentElement(el) {
  if (LEGACY) {
    return (el = el.parentNode) && el.nodeType === 1 ? el : null;
  } else {
    return el.parentElement;
  }
}
function prevElemSib(el) {
  if (LEGACY) {
    while ((el = el.previousSibling) && el.nodeType !== 1) {
    }
    return el;
  } else {
    return el.previousElementSibling;
  }
}
function nextElemSib(el) {
  if (LEGACY) {
    while ((el = el.nextSibling) && el.nodeType !== 1) {
    }
    return el;
  } else {
    return el.nextElementSibling;
  }
}
function firstElemChild(el) {
  if (LEGACY) {
    return el.firstChild && el.firstChild.nodeType !== 1 ? nextElemSib(el.firstChild) : el.firstChild;
  } else {
    return el.firstElementChild;
  }
}
function lastElemChild(el) {
  if (LEGACY) {
    return el.lastChild && el.lastChild.nodeType !== 1 ? prevElemSib(el.lastChild) : el.lastChild;
  } else {
    return el.lastElementChild;
  }
}
;})(this);

