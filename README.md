# Cowbird

![Cowbird Logo](https://www.dropbox.com/s/2lc6a5qlyyiq9l0/Cowbird.png?dl=0&raw=1)

> The cowbird has a symbiotic relationship with venerable the Bison.

Cowbird is a scannerless LALR parser generator for JavaScript.  Cowbird enables developers to create parsers for a defined grammar.  It can be used to make integrated development environments, domain specific languages, or entirely new programming languages executed as Javascript.  Cowbird works as a virtual machine which can compile a grammar then parse anything written in that grammar.

Cowbird can operate as either a language recoginizer or as full-blown parser depending on how a grammar is defined.

## Demo

[Molcalc](http://molcalc.herokuapp.com) - molecular formula parser and molar mass calculator. **Warning: Science!**

Let's see what Cowbird is doing behind the scenes.

```javascript
var parser = new Grammar({
  "Substance": [
    /<Elements>/,
    /<Multiplier> <Elements>/
  ],
  "Polymer": [
    /\( <Elements> \)/,
    /<this> <Multiplier>/,
  ],
  "Elements": [
    /<Element>/,
    /<Polymer>/,
    /<this> <Element>/,
    /<this> <Polymer>/,
  ],
  "Element": [
    /<Atom>/,
    /<this> <Multiplier>/,
  ],
  "Atom": [
    /[A-Z][a-z]*/,
  ],
  "Multiplier": [
    /[0-9]+/,
  ]
}, "Substance");
```

Cowbird grammar definitions take the following form.

```javascript
var parser = new Grammar({ grammar }, startToken);
```

Where `grammar` is an object and `startToken` is a string.

To parse our grammar we need only make a call to Cowbird's `parse` function.

```javascript
parser.parse("...");
```

This will run our input through Cowbird's virtual machine using the defined grammar.
