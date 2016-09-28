;(function(global) {var DEBUG_MODE = false;
var Query = global["Query"] = {};
Query["one"] = function(elem, selector) {
  return (new SelectorGroup(selector)).selectFirstFrom(elem);
};
Query["all"] = function(elem, selector) {
  return (new SelectorGroup(selector)).selectFrom(elem);
};
Query["matches"] = function(elem, selector) {
  return (new SelectorGroup(selector)).matches(elem);
};
var e_proto = (global.HTMLElement || global.Element || {}).prototype;
if (e_proto && !e_proto.matches) {
  e_proto.matches = e_proto.matchesSelector || e_proto.webkitMatchesSelector || e_proto.mozMatchesSelector || e_proto.msMatchesSelector || e_proto.oMatchesSelector || function(sel) {
    return Query["matches"](this, sel);
  };
}
;var errInvalidSelector = new Error("Invalid selector");
var errInternal = new Error("Internal error");
var NO_TOKEN = 0;
var UNIVERSAL_TAG_TOKEN = 1;
var PSEUDO_FUNCTION_TOKEN = 2;
var WHITESPACE_TOKEN = 3;
var COMBINATOR = 4;
var CHILD_COMB = 5;
var DESCENDANT_COMB = 6;
var ADJACENT_SIB_COMB = 7;
var GENERAL_SIB_COMB = 8;
var NO_COMB = 9;
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
var COMBINATOR_DESCENDANT_REUSE = new Token(COMBINATOR);
var COMBINATOR_CHILD_REUSE = new Token(COMBINATOR);
var COMBINATOR_ADJACENT_REUSE = new Token(COMBINATOR);
var COMBINATOR_GENERAL_REUSE = new Token(COMBINATOR);
var COMBINATOR_NONE_REUSE = new Token(COMBINATOR);
var UNIVERSAL_TAG_REUSE = new Token(UNIVERSAL_TAG_TOKEN);
var COMMA_TOKEN_REUSE = new Token(",", ",");
var WHITESPACE_TOKEN_REUSE = new Token(WHITESPACE_TOKEN, " ");
var re_consumeName = /^-?(?:[_a-zA-Z\u0080-\uFFFF]|\\[^\n]?|--\d?)(?:[-\w\u0080-\uFFFF]|\\[^\n]?)*/;
var re_Attr = new RegExp("^\\s*(" + re_consumeName.source.slice(1) + ")" + "\\s*(?:" + "([$^*~|]?=)" + "\\s*(?:((?:'(?:[^'\\n]|\\\\\\n)*')|(?:\"(?:[^\"\\n]|\\\\\\n)*\"))|" + "(" + re_consumeName.source.slice(1) + "))" + ")?\\s*]");
var re_makeNth = /^(?:([-+]?\d+)|([-+]?\d*)?n\s*(?:([-+])\s*(\d+))?|(even)|(odd))\s*\)/i;
COMBINATOR_DESCENDANT_REUSE.subKind = DESCENDANT_COMB;
COMBINATOR_CHILD_REUSE.subKind = CHILD_COMB;
COMBINATOR_ADJACENT_REUSE.subKind = ADJACENT_SIB_COMB;
COMBINATOR_GENERAL_REUSE.subKind = GENERAL_SIB_COMB;
COMBINATOR_NONE_REUSE.subKind = NO_COMB;
function Token(kind, value) {
  this.kind = kind;
  this.value = value;
}
Token.prototype.kind = NO_TOKEN;
Token.prototype.subKind = NO_TOKEN;
Token.prototype.name = "";
Token.prototype.value = "";
Token.prototype.a = 0;
Token.prototype.b = 0;
function Lexer(source, endChar, prevent_not) {
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
  var r = this.sel.charAt(this.i += 1), temp = "", parts;
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
    case " ":
    ;
    case "\t":
    ;
    case "\n":
      for (;;) {
        switch(this.sel.charAt(this.i + 1)) {
          case " ":
          ;
          case "\t":
          ;
          case "\n":
            this.i += 1;
            continue;
        }
        break;
      }
      this.curr = WHITESPACE_TOKEN_REUSE;
      break;
    case ",":
      this.curr = COMMA_TOKEN_REUSE;
      break;
    case ">":
      this.curr = COMBINATOR_CHILD_REUSE;
      break;
    case "+":
      this.curr = COMBINATOR_ADJACENT_REUSE;
      break;
    case "~":
      this.curr = COMBINATOR_GENERAL_REUSE;
      break;
    case ":":
      var verifyPseudoElem = false, name = "";
      if (this.sel.charAt(this.i + 1) === ":") {
        this.i += 1;
        verifyPseudoElem = true;
      }
      name = (re_consumeName.exec(this.sel.slice(this.i + 1)) || arrEmptyString)[0].toLowerCase();
      this.i += name.length;
      if (verifyPseudoElem) {
        switch(name) {
          case "first-line":
          ;
          case "first-letter":
          ;
          case "before":
          ;
          case "after":
            this.curr = new Token(PSEUDO_TOKEN, name);
            this.curr.subKind = pseudoClassFns["no-tok"];
            break;
          default:
            throw errInvalidSelector;;
        }
      } else {
        if (this.sel.charAt(this.i + 1) === "(") {
          this.i += 1;
          this.curr = this.getPseudoFunction(name);
        } else {
          this.curr = new Token(PSEUDO_TOKEN, name);
          this.curr.subKind = pseudoClassFns[name];
          if (!this.curr.subKind) {
            throw errInvalidSelector;
          }
        }
      }
      break;
    case "[":
      parts = re_Attr.exec(this.sel.slice(this.i + 1));
      if (!parts) {
        throw errInvalidSelector;
      }
      this.i += parts[0].length;
      this.curr = new Token(ATTR_TOKEN);
      this.curr.name = parts[1];
      if (parts[2]) {
        this.curr.subKind = parts[2];
        this.curr.value = parts[3] ? parts[3].slice(1, -1) : parts[4];
      } else {
        this.curr.subKind = HAS_ATTR_TOKEN;
      }
      break;
    case "*":
      this.curr = UNIVERSAL_TAG_REUSE;
      break;
    default:
      var tok = r === "#" ? ID_TOKEN : r === "." ? CLASS_TOKEN : TAG_TOKEN;
      if (tok === TAG_TOKEN) {
        this.i -= 1;
      }
      if (temp = re_consumeName.exec(this.sel.slice(this.i + 1))) {
        this.i += temp[0].length;
        this.curr = new Token(tok, temp[0]);
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
      block = new Lexer(this, ")", true);
      n.subSelector = [new Selector(block, false)];
      if (n.subSelector[0].parts.length !== 2 || n.subSelector[0].parts[0].subKind === NOT_TOKEN) {
        throw errInvalidSelector;
      }
      n.subKind = NOT_TOKEN;
      break;
    case "lang":
      block = new Lexer(this, ")");
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
  while ((n = this.next()) && n.kind === WHITESPACE_TOKEN) {
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
          n.a = parseInt(aStr, 10);
        }
        if (bStr) {
          n.b = parseInt(bStr, 10);
        }
        if (DEBUG_MODE && (isNaN(n.a) || isNaN(n.b))) {
          throw errInternal;
        }
      }
    }
  }
  return n;
};
var re_trim = /(?:^\s+|\s+$)/g, cache = {}, selCache = {};
function SelectorGroup(strTok) {
  var isLexer = strTok instanceof Lexer;
  if (!isLexer && cache.hasOwnProperty(strTok)) {
    return cache[strTok];
  }
  var subGroups = {};
  var source = new Lexer(strTok);
  var first = true, hasUniversal = false, n;
  while (n = source.nextAfterSpace()) {
    var isComma = n.kind === ",";
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
    var selObject = new Selector(source, true);
    hasUniversal = hasUniversal || selObject.qualifier === "*";
    if (!subGroups.hasOwnProperty(selObject.qualifier)) {
      subGroups[selObject.qualifier] = [];
    }
    subGroups[selObject.qualifier].push(selObject);
  }
  this._doSubGroups(subGroups, hasUniversal);
  if (!isLexer) {
    cache[strTok] = this;
  }
}
SelectorGroup.prototype._doSubGroups = function(subGroups, hasUniversal) {
  this.subGroups = [];
  for (var key in subGroups) {
    if (!subGroups.hasOwnProperty(key)) {
      continue;
    }
    if (hasUniversal) {
      if (this.subGroups[0]) {
        this.subGroups[0].push.apply(this.subGroups[0], subGroups[key]);
      } else {
        this.subGroups[0] = subGroups[key];
      }
    } else {
      this.subGroups.push(subGroups[key]);
    }
  }
  if (hasUniversal) {
    for (var i = 0, sg = this.subGroups[0];i < sg.length;i = i + 1) {
      sg[i].qualifier = "*";
    }
  }
};
SelectorGroup.prototype.matches = function(el) {
  for (var i = 0;i < this.subGroups.length;i += 1) {
    if (_matches(el, this.subGroups[i])) {
      return true;
    }
  }
  return false;
};
SelectorGroup.prototype.selectFirstFrom = function(root) {
  var sgLen = this.subGroups.length;
  var res = null;
  for (var i = 0;i < sgLen;i += 1) {
    this.potentialsLoop(i, null, function(el) {
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
    this.potentialsLoop(i, resArr, function(el) {
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
  return matchedSubGroups ? resArr.sort(sorter) : resArr;
};
SelectorGroup.prototype.potentialsLoop = function(i, resArr, cb) {
  var subGroup = this.subGroups[i];
  var potentials = root.getElementsByTagName(needTagFix ? "*" : subGroup[0].qualifier);
  for (var j = 0;j < potentials.length;j += 1) {
    var el = potentials[j];
    if ((!needCommentFilter || el.nodeType === 1) && _matches(el, subGroup)) {
      if (cb(el)) {
        break;
      }
    }
  }
};
function Selector(source, guarantee_tag) {
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
  this.source = source;
  this.parts = [];
  this.qualifier = "";
  while (n = source.next()) {
    var isSpace = n.kind === WHITESPACE_TOKEN;
    if (isSpace) {
      n = source.nextAfterSpace();
    }
    if (!n || n.kind === ",") {
      source.reconsume();
      break;
    } else {
      if (doCombinator) {
        switch(n) {
          case COMBINATOR_CHILD_REUSE:
          ;
          case COMBINATOR_ADJACENT_REUSE:
          ;
          case COMBINATOR_GENERAL_REUSE:
            this.parts.push(n);
            break;
          default:
            if (isSpace) {
              source.reconsume();
              this.parts.push(COMBINATOR_DESCENDANT_REUSE);
            } else {
              throw errInvalidSelector;
            }
          ;
        }
        doCombinator = false;
      } else {
        source.reconsume();
        this.makeSimpleSequence(guarantee_tag);
        doCombinator = true;
      }
    }
  }
  if (doCombinator === false) {
    throw errInvalidSelector;
  }
  this.parts.push(COMBINATOR_NONE_REUSE);
  this.source = null;
  if (endIdx === source.i) {
    selCache[potentialSel] = this;
  }
}
var temp_sequence = [];
Selector.prototype.makeSimpleSequence = function(guarantee_tag) {
  temp_sequence.length = 0;
  this.qualifier = "";
  var n = this.source.nextAfterSpace();
  if (!n || n.kind === ",") {
    throw errInvalidSelector;
  }
  switch(n.kind) {
    case TAG_TOKEN:
      n.value = n.value.toUpperCase();
    case UNIVERSAL_TAG_TOKEN:
      this.qualifier = n.value || "*";
      temp_sequence.push(n);
      break;
    default:
      this.source.reconsume();
      this.qualifier = "*";
      if (guarantee_tag) {
        temp_sequence.push(UNIVERSAL_TAG_REUSE);
      }
    ;
  }
  OUTER: while (n = this.source.next()) {
    switch(n.kind) {
      case ",":
      ;
      case WHITESPACE_TOKEN:
      ;
      case COMBINATOR:
        this.source.reconsume();
        break OUTER;
      case ID_TOKEN:
      ;
      case ATTR_TOKEN:
      ;
      case CLASS_TOKEN:
      ;
      case PSEUDO_FUNCTION_TOKEN:
      ;
      case PSEUDO_TOKEN:
        temp_sequence.push(n);
        break;
      default:
        throw errInvalidSelector;;
    }
  }
  for (var i = temp_sequence.length - 1;i > -1;i -= 1) {
    this.parts.push(temp_sequence[i]);
  }
  temp_sequence.length = 0;
};
function onOrAfter(a, b) {
  if (a === b || a.firstChild && onOrAfter(a.firstChild, b)) {
    return true;
  }
  while (a = a.nextSibling) {
    if (a.nodeType === 1 && onOrAfter(a, b)) {
      return true;
    }
  }
  return false;
}
function sorter(a, b) {
  return a === b ? 0 : a.compareDocumentPosition ? a.compareDocumentPosition(b) & 4 ? -1 : 1 : a.contains(b) ? -1 : b.contains(a) ? 1 : onOrAfter(a.nextSibling, b) ? -1 : 1;
}
;var testElem = document.createElement("div");
var randTagName = "x" + ("00000000" + ~~(Math.random() * 1E9)).slice(-9);
testElem.innerHTML = "1<" + randTagName + "></" + randTagName + ">";
var needTagFix = testElem.getElementsByTagName("*")[0].nodeName.charAt(0) === "/";
testElem.innerHTML = "";
var needCommentFilter = testElem.appendChild(document.createComment("")).parentNode.getElementsByTagName("*").length !== 0;
var re_twoSpaceOnceSpaceOrEmpty = /^\s\s?$|^$/;
testElem = null;
function _matches(origEl, subGroup) {
  SUBGROUP_LOOP: for (var i = 0;i < subGroup.length;i += 1) {
    var selector = subGroup[i], el = origEl, haltOnFail = false, lastCombinatorIdx = -1;
    for (var j = selector.parts.length - 1;j > -1;j -= 1) {
      var part = selector.parts[j];
      if (part.kind === COMBINATOR) {
        haltOnFail = false;
        switch(part.subKind) {
          case NO_COMB:
            haltOnFail = true;
            break;
          case CHILD_COMB:
            haltOnFail = true;
          case DESCENDANT_COMB:
            el = el.parentNode;
            break;
          case ADJACENT_SIB_COMB:
            haltOnFail = true;
          case GENERAL_SIB_COMB:
            while ((el = el.previousSibling) && el.nodeType !== 1) {
            }
            break;
          default:
            if (DEBUG_MODE) {
              throw errInternal;
            }
          ;
        }
        if (!el || el.nodeType !== 1) {
          return false;
        }
        el = (el);
        lastCombinatorIdx = j + 1;
        continue;
      }
      var temp = "", thisSeqQualName = "";
      switch(part.kind) {
        case UNIVERSAL_TAG_TOKEN:
          thisSeqQualName = "";
          continue;
        case TAG_TOKEN:
          temp = el.nodeName.toUpperCase();
          thisSeqQualName = part.value;
          if (needTagFix && temp.charAt(0) === "/") {
            temp = temp.slice(1);
          }
          if (temp === thisSeqQualName) {
            continue;
          }
          break;
        case CLASS_TOKEN:
          if (fieldMatch(el.className, part.value)) {
            continue;
          }
          break;
        case ID_TOKEN:
          if (el.id === part.value) {
            continue;
          }
          break;
        case NO_TOKEN:
          break;
        case PSEUDO_TOKEN:
          if (part.subKind(el)) {
            continue;
          }
          break;
        case PSEUDO_FUNCTION_TOKEN:
          switch(part.subKind) {
            case NOT_TOKEN:
              if (!_matches(el, part.subSelector)) {
                continue;
              }
              break;
            case NTH_CHILD_TOKEN:
              if (isNth(el, part, "", false)) {
                continue;
              }
              break;
            case NTH_LAST_CHILD_TOKEN:
              if (isNth(el, part, "", true)) {
                continue;
              }
              break;
            case NTH_OF_TYPE_TOKEN:
              if (isNth(el, part, thisSeqQualName, false)) {
                continue;
              }
              break;
            case NTH_LAST_OF_TYPE_TOKEN:
              if (isNth(el, part, thisSeqQualName, true)) {
                continue;
              }
              break;
            case LANG_TOKEN:
              var tempEl = el;
              while (tempEl && !tempEl.lang) {
                tempEl = tempEl.parentNode;
              }
              if (tempEl && dashMatch(tempEl.lang, part.value)) {
                continue;
              }
              break;
            default:
              if (DEBUG_MODE) {
                throw errInternal;
              }
            ;
          }
          break;
        case ATTR_TOKEN:
          var attrVal = el.getAttribute(part.name);
          if (attrVal == null) {
            return false;
          }
          switch(part.subKind) {
            case EQUAL_ATTR_TOKEN:
              if (attrVal === part.value) {
                continue;
              }
              break;
            case PREFIX_MATCH_TOKEN:
              if (attrVal.lastIndexOf(part.value, 0) === 0) {
                continue;
              }
              break;
            case SUFFIX_MATCH_TOKEN:
              if (attrVal.lastIndexOf(part.value) + part.value.length === attrVal.length) {
                continue;
              }
              break;
            case DASH_MATCH_TOKEN:
              if (dashMatch(attrVal, part.value)) {
                continue;
              }
              break;
            case INCLUDE_MATCH_TOKEN:
              if (fieldMatch(attrVal, part.value)) {
                continue;
              }
              break;
            case HAS_ATTR_TOKEN:
              continue;
            case SUBSTRING_MATCH_TOKEN:
              if (attrVal.indexOf(part.value) !== -1) {
                continue;
              }
              break;
            default:
              if (DEBUG_MODE) {
                throw errInternal;
              }
            ;
          }
          break;
        default:
          if (DEBUG_MODE) {
            throw errInternal;
          }
        ;
      }
      if (haltOnFail) {
        continue SUBGROUP_LOOP;
      }
      j = lastCombinatorIdx;
    }
    return true;
  }
  return false;
}
function dashMatch(target, pattern) {
  var last = target.charAt(pattern.length);
  return (!last || last === "-") && target.lastIndexOf(pattern, 0) === 0;
}
function fieldMatch(target, pattern) {
  var idx = -1;
  while ((idx = target.indexOf(pattern, idx + 1)) !== -1) {
    if (re_twoSpaceOnceSpaceOrEmpty.test(target.charAt(idx - 1) + target.charAt(idx + pattern.length))) {
      return true;
    }
  }
  return false;
}
function isNth(el, simple, nn, fromEnd) {
  var nth = simple.a;
  var offset = simple.b;
  var cap = nth <= 0 ? offset : Infinity;
  if (!el.parentNode || nth <= 0 && offset <= 0) {
    return false;
  }
  var idx = 1, curr = fromEnd ? el.parentNode.lastChild : el.parentNode.firstChild;
  if (!curr) {
    return false;
  }
  nn = nn.toUpperCase();
  while (curr !== el && idx <= cap) {
    if (curr.nodeType === 1 && (!nn || curr.nodeName.toUpperCase() === nn)) {
      idx += 1;
    }
    curr = fromEnd ? curr.previousSibling : curr.nextSibling;
  }
  if (idx % nth !== offset) {
    return false;
  }
  return nth >= 0 && idx >= offset;
}
var formControls = {"INPUT":1, "TEXTAREA":1, "SELECT":1, "BUTTON":1, "OPTION":1, "OPTGROUP":1};
var hiddenOrButton = {"hidden":1, "image":1, "button":1, "submit":1, "reset":1};
function isNumberInput(el) {
  return el.nodeName.toUpperCase() === "INPUT" && (el.type === "number" || el.type === "text" && ("min" in el || "max" in el));
}
var pseudoClassFns = {"root":function(el) {
  return el.ownerDocument.documentElement === el;
}, "empty":function(el) {
  return !el.firstChild;
}, "optional":function(el) {
  return formControls[el.nodeName.toUpperCase()] && !hiddenOrButton[el.type] && !pseudoClassFns["required"](el);
}, "required":function(el) {
  return formControls[el.nodeName.toUpperCase()] && !hiddenOrButton[el.type] && (typeof el.required === "string" || typeof el.required === "boolean" && el.required);
}, "checked":function(el) {
  return el.checked && (el.type === "checkbox" || el.type === "radio") || el.selected && el.nodeName === "OPTION";
}, "indeterminate":function(el) {
  return !!el.indeterminate && el.type === "checkbox" && el.nodeName.toUpperCase() === "INPUT";
}, "out-of-range":function(el) {
  return isNumberInput(el) && ((+el.min !== +el.min || +el.value >= +el.min) && (+el.max !== +el.max || +el.value <= +el.max)) === false;
}, "in-range":function(el) {
  return isNumberInput(el) && ((+el.min !== +el.min || +el.value >= +el.min) && (+el.max !== +el.max || +el.value <= +el.max)) === true;
}, "default-option":function(el) {
  if (el.defaultChecked || el.defaultSelected) {
    return true;
  }
  var sel = "BUTTON, INPUT[type=submit]";
  return el.form && el.form.nodeType === 1 && Query["matches"](el, sel) && Query["one"](el.form, sel) === el;
}, "enabled":function(el) {
  return !el.disabled && formControls[el.nodeName.toUpperCase()];
}, "disabled":function(el) {
  return el.disabled && formControls[el.nodeName.toUpperCase()];
}, "target":function(el) {
  return el.id && window.location.hash.slice(1) === el.id;
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
  } while (helper && (helper = helper.parentNode));
  return false;
}, "focus":function(el) {
  return el === el.ownerDocument.activeElement;
}, "first-child":function(el) {
  while ((el = el.previousSibling) && el.nodeType !== 1) {
  }
  return !el;
}, "last-child":function(el) {
  while ((el = el.nextSibling) && el.nodeType !== 1) {
  }
  return !el;
}, "only-child":function(el) {
  return pseudoClassFns["first-child"](el) && pseudoClassFns["last-child"](el);
}, "first-of-type":function(el) {
  var name = el.nodeName.toUpperCase();
  while ((el = el.previousSibling) && (el.nodeType !== 1 || el.nodeName.toUpperCase() !== name)) {
  }
  return !el;
}, "last-of-type":function(el) {
  var name = el.nodeName.toUpperCase();
  while ((el = el.nextSibling) && (el.nodeType !== 1 || el.nodeName.toUpperCase() !== name)) {
  }
  return !el;
}, "only-of-type":function(el) {
  return pseudoClassFns["first-of-type"](el) && pseudoClassFns["last-of-type"](el);
}, "no-tok":function() {
  return false;
}};
var needHoverHelperSetup = true, hoverHelper = null;
function hoverHelperSetup() {
  if (!needHoverHelperSetup) {
    return;
  }
  needHoverHelperSetup = false;
  if (window.addEventListener) {
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
;})(this);

