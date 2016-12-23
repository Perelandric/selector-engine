

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
  let res = 0

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
  for (let i = 0, len = coll.length; i < len; i+=1) {
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
    const n = el.nodeName.toUpperCase()

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
    while ((sib = sib.previousSibling) && sib.nodeType !== Node.ELEMENT_NODE){}

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
    while ((sib = sib.nextSibling) && sib.nodeType !== Node.ELEMENT_NODE){}

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
