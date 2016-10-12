

/**
 * @param {!string} s
 * @param {!number} i
 * @return {string}
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
function getSpaceAt(s, i) {
  var res = 0

  for (;;) {
    switch(getChar(s, i+res)) {
    case ' ': case '\t': case '\n':
      res += 1
      continue

    case "": case undefined:
      return res || -1
    }
    return res
  }
}


 /**
 * @param {!Element} el
 * @return {string}
 */
function nodeName(el) {
  return LEGACY ? el.nodeName.toUpperCase() : el.nodeName
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
function prevElemSib(el) {
  if (LEGACY) {
    while ((el = el.previousSibling) && el.nodeType !== 1) {
    }
    return el
  } else {
    return el.previousElementSibling
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function nextElemSib(el) {
  if (LEGACY) {
    while ((el = el.nextSibling) && el.nodeType !== 1) {
    }
    return el
  } else {
    return el.nextElementSibling
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function firstElemChild(el) {
  if (LEGACY) {
    return el.firstChild && el.firstChild.nodeType !== 1 ?
            nextElemSib(el.firstChild) :
            el.firstChild
  } else {
    return el.firstElementChild
  }
}


/**
 * @param {!Element} el
 * @return {Element}
 */
function lastElemChild(el) {
  if (LEGACY) {
    return el.lastChild && el.lastChild.nodeType !== 1 ?
            prevElemSib(el.lastChild) :
            el.lastChild
  } else {
    return el.lastElementChild
  }
}
