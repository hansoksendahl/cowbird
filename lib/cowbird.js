// # Cowbird.js
//
// This document serves as the design specification and usage manual for the
// Cowbird parser generator for Javascript (ECMA-262).  Cowbird is capable of
// generating parsers which use either the LR(0) or LALR(1) parsing algorithm to
// recognize defined a defined grammar.
//
// _MIT User License 2012_


var Grammar = (function() {

  // ## Debugging functions

  // This hash stores error codes used in the parser generator.
  var errors = {};

  // Each error code for the software is associated with an error template.
  // These templates are passed through the function `constructError` to form a
  // corresponding error function.  Arguments passed to the function returned by
  // `constructError` will replace any instances of variables (specified by
  // `$$[0-9]+` which occur in the generating template.
  errors[0x00] = 'Invalid constructor arguments.';
  errors[0x10] = 'The non-terminal "$$0" is not defined in the grammar.';
  errors[0xA1] = 'Choked while attempting to parse: $$0';
  errors[0xF0] = '$$0, have you considered a career in $$1?'

  // The `constructError` function returns an error reporting function created
  // from one of the error templates above.
  function constructError(s) {
    s = s.replace(/\"/g, '\\"');
    s = s.replace(/\n/g, '\\n');
    s = s.replace(/\$\$([0-9]+)/g, '"+arguments[$1]+"');
    s = 'return "'+s+'";';
    return new Function(s);
  }

  // Error objects are arrays for our purposes.  If the first item in the error
  // array is a hexadecimal index then we use it to look up the template for the
  // error being fired.
  function displayError(e) {
    if (e.length && errors[e[0]] !== void(0)) {
      e = constructError(errors[e[0]]).call({}, e.slice(1));
    }
    throw(e);
  }

  // ## General functions

  // The purpose of `clone` is to create a copy of an object which does not
  // occupy the same sector in memory.  Changing a value in the returned object
  // `b` will not effect values in object `a`.
  function clone(a) {
    var
      b = (a.length) ? [] : {},
      k;
    for (k in a) {
      if (typeof(a[k]) === "object") { b[k] = clone(a[k]); }
      else { b[k] = a[k]; }
    }
    return b;
  }

  // The `valuesAt` function takes a list of integer indices `a` and returns an
  // array containing the elements in `b` corresponding to the indices in `a`.
  function valuesAt(a, b) {
    var
      n = [],
      i, s;
    for (i = 0; i < a.length; i += 1) {
      s = a[i];
      if (b[s] !== undefined) { n.push(b[s]); }
    }
    return n;
  }

  // ## Grammar constructor

  function Grammar(grammar, sT, debug) {
    try {
      // If we have valid input then proceed to the construct phase.
      if (
        typeof grammar === 'object' &&
        typeof sT      === 'string'
      ) {
        this.sT                  = sT;
        this.aST                 = sT+"`";
        this.tokens              = [];
        this.productions         = [];
        this.actions             = {};
        this.table               = [];

        if (debug) { this.debug = true; }

        // Augment the grammar and construct usage metrics
        this.__construct(grammar);
      }
      // Invalid input, throw an error.
      else { throw(0x00); }
    }
    catch(e) { displayError(e); }
  }

  Grammar.prototype = {

    // Constructs an augmented grammar which we can perform data analysis on
    // later.
    '__construct': function(grammar) {
      var
        self                 = this,
        scannedTokens        = [],
        metrics              = [],
        augmentedGrammar     = [],
        configSets           = [],
        condensedProductions = [],
        condensedConfigSets  = [];

      // Save the tokens used in the grammar and metrics related to their usage.
      function saveToken(value, terminal) {
        var i = scannedTokens.indexOf(value);

        if (i === -1) {
          scannedTokens.push(value);
          metrics.push({'value': value, 'terminal': terminal, 'count': 1});
        }
        else {
          metrics[i].count += 1;
        }
      }

      // Splits the regular expression that makes up a production's
      // right-hand-side and scans through each lexical symbol saving it to the
      // list of possible tokens.
      function buildRHS(lhs, regRHS) {
        var
          tagScan   = /^<([^>]+)>$/,
          tokenList = regRHS.toString().slice(1, -1).split(/\s+/),
          rhs       = [],
          i, tagMatch, token, index;

        // Iterate through each token in the RHS of this production
        for (i = 0; i < tokenList.length; i += 1) {
          token    = tokenList[i];
          tagMatch = tagScan.exec(token);

          // This token is a terminal symbol
          if (!tagMatch) {
            saveToken(token, true);
          }
          // This token is a non-terminal symbol
          else {
            // Replace any token named "this" with the left-hand-side of the
            // production.  Then check to see if this token has already been
            // scanned.
            token = (tagMatch[1] === 'this') ? lhs : tagMatch[1];
            index = scannedTokens.indexOf(token);

            saveToken(token, false);
            if (index === -1) { buildProductions(token); }
          }

          rhs.push(token);
        }

        return rhs;
      }

      // Construct the alternate right-hand-side productions for this
      // left-hand-side.
      function buildAlternates(lhs, args) {
        var
          funScan     = /^function/,
          productions = [],
          i, regRHS, funMatch, production;

        for (i = 0; i < args.length; i += 1) {
          regRHS   = args[i];
          funMatch = funScan.exec(args[i + 1]);

          production = {'rhs': buildRHS(lhs, regRHS)};

          if (funMatch) {
            production.action = args[i + 1];
            i += 1;
          }

          productions.push(production);
        }

        return productions;
      }

      // Construct productions for the augmented grammar.
      function buildProductions(lhs) {
        if (grammar[lhs] !== void(0)) {
          augmentedGrammar[lhs] = buildAlternates(lhs, grammar[lhs]);
        }
        else {
          throw([0x10, lhs]);
        }
      }

      // Creates a stringified version of a production
      function condense(lhs, rhs, index) {
        var c = clone(rhs);
        // Splice the token read character in if specified
        if (index > 0) { c.splice(0, 0, '.'); }
        return lhs+'->'+rhs.join(',');
      }

      // A closure is the set of all productions that can be recursively defined
      // from their leftmost token.
      function closure(configSet) {
        var
          condensed = [],
          i, config, lhs, rhsList,
          j, rhs, rule, ruleString;

        for (i = 0; i < configSet.length; i += 1) {
          config = configSet[i];
          lhs    = config.rhs[config.index];
          rhsList = augmentedGrammar[lhs];

          if (rhsList) {
            for (j = 0; j < rhsList.length; j += 1) {
              rhs        = rhsList[j];
              rule       = {'lhs': lhs, 'rhs': rhs, 'index': 0};
              ruleString = condense(lhs, rhs, 0);

              if (condensed.indexOf(ruleString) === -1) {
                condensed.push(ruleString);
                configSet.push(rule);
              }
            }
          }
        }
        return configSet;
      }

      // Determine the successor cofiguration set based off of this
      // configuration set and the next terminal symbol.
      function successor(configSet, symbol) {
        var
          set = [],
          i, config;
        
        for (i = 0; i < configSet.length; i++) {
          config = clone(configSet[i]);

          if (config.rhs[config.index] === symbol) {
            if (config.rhs.length > config.index) {
              config.index++;
              set.push(config);
            }
          }
        }
        return (set.length > 0) ? closure(set) : [];
      }


      // Augment the grammar.
      grammar[this.aST] = [new RegExp('<'+this.sT+'>')];

      // Save the start token of our augmented grammar
      saveToken(this.aST, false);

      // Build the grammar's productions recursively
      buildProductions(this.aST);

      // Sort the tokens by their usage metrics
      metrics.sort(function(a, b) {
        return b.count - a.count;
      });

      // Optimize the order of tokens and productions based on the collected 
      // metrics data.
      (function () {
        var
          map             = {},
          nonTerminals    = [],
          remappedGrammar = {},
          i, metric, symbol,
          lhs, lhsIndex,
          j, rhs, rhsIndices;

        // Create an object mapping token values to their new indexes.
        for (i = 0; i < metrics.length; i += 1) {
          metric      = metrics[i];
          symbol      = metric.value;
          map[symbol] = i;

          if (metric.terminal) {
            symbol = new RegExp('^(' + symbol +')');
          }
          else {
            nonTerminals.push(symbol);
          }

          self.tokens[i] = symbol;
        }

        // Iterate through the non-terminals remapping each of the associated
        // productions to indices from the token list
        for (i = 0; i < nonTerminals.length; i += 1) {
          lhs                       = nonTerminals[i];
          lhsIndex                  = self.tokens.indexOf(lhs);
          remappedGrammar[lhsIndex] = [];

          for (j = 0; j < augmentedGrammar[lhs].length; j += 1) {
            rhs        = augmentedGrammar[lhs][j];
            rhsIndices = valuesAt(rhs.rhs, map);

            remappedGrammar[lhsIndex][j] = rhsIndices;
            condensedProductions.push(condense(lhsIndex, rhsIndices));

            // Save information regarding this production
            self.productions.push([lhsIndex, rhs.rhs.length]);

            // Add action
            if (rhs.action) {
              self.actions[self.productions.length - 1] = rhs.action;
            }
          }
        }

        // Save our remapped grammar
        augmentedGrammar = remappedGrammar;
      }());

      // Generate an initial configuration set
      configSets.push([]);
      configSets[0].push([]);
      configSets[0][0] = {
        lhs: this.tokens.indexOf(this.aST),
        rhs: [this.tokens.indexOf(this.sT)],
        index: 0
      };
      closure(configSets[0]);

      // Generate all subsequent configuration sets from the initial
      // configuration set.
      (function() {
        var
          i, configSet,
          j, config,
          h, next, nextString, nextIndex;
        
        // Iterate through each of the configuration sets.
        for (i = 0; i < configSets.length; i += 1) {
          configSet = configSets[i];

          // Iterate through each configuration in this configuration set.
          for (j = 0; j < configSet.length; j += 1) {
            config = configSet[j];

            // Iterate through each token in this configuration.
            for (h = 0; h < config.rhs.length; h += 1) {
              // Find the successor for this configuration set
              next       = successor(configSet, config.rhs[h]);
              nextString = JSON.stringify(next);
              nextIndex  = condensedConfigSets.indexOf(nextString);

              // Save the configuration set if it's not empty.
              if (nextIndex === -1 && next.length > 0) {
                configSets.push(next);
                condensedConfigSets.push(nextString);
              }
            }
          }
        }
      }());

      // If we are in debug mode save the cofiguration sets to the class scope.
      if (this.debug) { this.configSets = configSets; }

      // Construct an LR(0) parse table
      (function() {
        var
          i, row, configSet,
          j, token, table, action,
          config, configStr, productionIndex,
          nextSet;
        
        for (i = 0; i < configSets.length; i += 1) {
          row       = [];
          token     = void(0);
          action    = void(0);
          configSet = configSets[i];
          
          for (j = 0; j < configSet.length; j+= 1) {
            config    = configSet[j];
            
            // End of production, Reduce or Accept
            if (config.index === config.rhs.length) {
              table = 0;
              token = '$';

              // Reduce
              if (self.tokens[config.lhs] !== self.aST) {
                configStr       = condense(config.lhs, config.rhs);
                productionIndex = condensedProductions.indexOf(configStr);
                action          = (productionIndex * -1) - 1;
              }
              // Accept
              else {
                action = 0;
              }
            }
            // Shift or Goto
            else {
              token   = config.rhs[config.index];
              nextSet = successor(configSets[i], token);
              action  = condensedConfigSets.indexOf(JSON.stringify(nextSet)) + 1;
              
              // Goto on non-terminal symbol
              if (typeof self.tokens[token] === 'string') {
                table = 1;
              }
              // Shift on terminal symbol
              else {
                table = 0;
              }
            }

            // Initialize the table for this row
            row[table] = row[table] || {};

            // Assign an action to this table/token
            if (row[table][token] === void(0)) {
              row[table][token] = action;
            }
          }

          self.table.push(row);
        }
      }());
    },

    // The parse function takes an input stream and an optional scope.
    'parse': function(stream, scope) {
      var
        self        = this,
        index       = 0,
        state       = 0,
        stack       = [state],
        values      = [],
        currentState, row, action, token, tokenIndex,
        productionIndex, rule, goTo, args;

      function findLongest() {
        var
          key, successor, search, reduction,
          match, longest, whitespace;
        
        // Iterate through the possible terminal symbols in this state
        for (key in action) {
          // Attempt a match on a given token
          successor = action[key];
          search    = self.tokens[key];

          // Shift action: consume symbols / whitespace
          if (successor > 0) {
            match  = search.exec(stream.substr(index));

            if (match && (!longest || match[1].length > longest.value.length)) {
              longest = { value: match[1], successor: successor };
            }
          }
          else if (successor < 0) {
            reduction = successor;
          }
          else if (successor === 0 && stream.length === index) {
            reduction = 0;
          }
        }

        // If a non-terminal symbol has been scanned then increment the index.
        if(longest !== undefined) {
          index += longest.value.length;

          whitespace = /^( +)/.exec(stream.substr(index));
          if (whitespace) { index += whitespace[1].length; }

          return [longest.successor, longest.value];
        }
        // If we encountered a reduction then return the reduction
        else if (reduction !== undefined) {
          return [reduction];
        }
      }

      function getCurrentState() {
        return stack[stack.length - 1];
      }

      try {
        // Iterate through the input stream until a successful parse is completed.
        while (true) {
          currentState = getCurrentState();
          row          = this.table[currentState];
          action       = row[0];

          token      = findLongest();
          tokenIndex = (token) ? token[0] : void(0);

          if (token && token[1] !== undefined) { values.push(token[1]); }

          // Push a state onto the stack
          if (tokenIndex > 0) {
            stack.push(tokenIndex);
          }
          // Reduce
          else if (tokenIndex < 0) {
            productionIndex = (tokenIndex + 1) * -1;
            rule            = this.productions[productionIndex];

            // Remove n items from the stack where n is the length of the
            // production's right-hand-side
            stack.splice(stack.length - rule[1], rule[1]);

            goTo = this.table[getCurrentState()];

            if(goTo[1] && goTo[1][rule[0]]) {
              stack.push(goTo[1][rule[0]]);
            }

            if(this.actions[productionIndex]) {
              args = values.splice(values.length - rule[1], rule[1]);
              values.push(this.actions[productionIndex].apply(scope, args));
            }
          }
          // Accept
          else if (tokenIndex === 0) {
            return values;
          }
          // Throw the "choked attempting to parse: ____" error.
          else if (tokenIndex === undefined) {
            throw([0xA1, '"'+stream.substr(index, 40)]+'"');
          }
        }
      }
      catch (e) {
        displayError(e);
      }
    }
  };

  return Grammar;
}());

var exports = exports || void(0);
// If we are in a CommonJS environment export the Grammar class.
if(exports) { exports.Grammar = Grammar; }
