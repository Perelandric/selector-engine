#selector-engine

##Overview

`selector-engine` is a JavaScript based DOM selector engine. It provides methods for selecting elements from a DOM and inquiring if an element matches a selector by using standard Selectors API selectors. These methods may serve as alternatives or polyfills to their standard counterparts.

| selector-engine | standard | behavior |
| --- | --- | --- |
| `Query.one` | `querySelector`| Return the first element matching the provided selector from the given root. |
| `Query.all` | `querySelectorAll` | Return all elements matching the provided selector from the given root. |
| `Query.matches` | `matches` | Return `true` if the given element matches the selector, otherwise `false`. |

In each `selector-engine` method, the first argument is the root from which the query is performed and the second argument is the selector string. If only one argument is passed, it is assumed to be the selector string, and the `document` will be used as the root.

##Usage

To use this project, simply include one of the two files in your project. Use the *"legacy"* version if support for old browsers like IE6 is needed.

| [selector-engine.min.js](lib/selector-engine.min.js) | [selector-engine-legacy.min.js](/lib/selector-engine-legacy.min.js) |
| --- | --- |
| 3.45kb gzipped | 3.67kb gzipped |
| Takes advantage of more modern features, providing better performance. | Ensures compatibility at a *minor* performance cost. |
| Supports: - Chrome 4 - Firefox 3.5 - IE 9 - Opera 9.8 - Safari 4 | Supports: - Chrome 1 - Firefox 2 - IE 6 - Opera 9.8 - Safari 1 |


##Examples
```JavaScript
// Select the first .comments div.
var div = Query.one(document, "div.comments")

// Check if the comments section is empty
if (!Query.matches(div, ":empty")) {

  // Select all highlighted spans in new and updated comments.
  Query.all(div, "p.comment:matches(.new, .updated) > span.highlighted").forEach(function(s) {
    console.log(s.textContent)
  })
}
```


##Current CSS4 support
*(feature support table coming soon)*


##FAQ
###Is `selector-engine` ready for production use?
Not yet, but almost. `selector-engine` is not yet at its 1.0 release, so it should be considered unstable but real-world testing is mostly what is needed at this point.

###Will you be adding more selector support?
That's the goal. Generally if one or two major browsers implement a feature described in the Working Draft or Editor's Draft of the Selectors API, it'll be given consideration.

###Why support legacy browsers like IE6?
There are some rare cases where legacy support at that level is genuinely needed. Adding support for them is fairly simple, so the decision was easy.

###What specific legacy accommodations are provided?
- String character access uses `.charAt()` instead of direct indexes.
- Custom tags are selectable.
- Element traversal uses techniques like `.nextSibling` in a loop instead of `.nextElementSibling`.
- Checking attributes, like `"class"`, has compatibility patches.

###What issues are you unable to fix?
- In legacy version of IE, properties on elements automatically become available as attributes. Because of this, if you use attribute selectors to fetch elements by a custom attribute that also appears as a custom property, you may get false positives. For example, in IE6, doing `element.foo = "bar"` will cause a `[foo="bar"]` selector to match that element, because `foo` will appear as an attribute on the element. This is not the case in modern browsers.

###Will you provide support for custom selectors?
No, for the following reasons:
- Adhering to standards makes code more portable and future proof. Code written for non-standard features can only be used where that library will be accepted as a dependency, which isn't always the case.
- For the same reason that developers often avoid extending host prototypes with custom methods, we avoid it with selectors. If custom selectors are added, they can conflict with future implementations of new standards. They can also conflict with additions by other libraries that use this library.
- The standard selectors provide quite a lot of functionality, and like regular expressions, they're useful and powerful but don't need to be the solution to every problem.

###How can I contribute?
Please review the [contributing guide](CONTRIBUTING.md) for information on contributing to this project.
