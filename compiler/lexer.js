import { /* ALL_ASTYPES */ ADD, ADDRESS, ADDRESS_CLOSE, ALLOCATE_PAGES, AND, ARG_LIST, AS, ASSIGN, BAD_TOKEN, BITWISE_AND, BITWISE_OR, BITWISE_SHIFT, BITWISE_XOR, BLOCK, BLOCK_CLOSE, BREAK, CALL, COMMA, COMMENT, CONTINUE, DECLARATION, DEFAULT_MEMORY, DEFAULT_TABLE, DEFINITION, ELSE, END_OF_INPUT, EQ_COMPARISON, EXPORT, EXPORT_TYPE, F32_LITERAL, F64_LITERAL, FN, FN_PTR, FN_SIGNATURE, FROM, I32_LITERAL, I64_LITERAL, IF, IMMUTABLE, IMPORT, INIT_EXPR, LOOP, MEMORY_ACCESS, MISC_INFIX, NEG, OR, ORDER_COMPARISON, PAGES_ALLOCATED, PARAM_LIST, PAREN, PAREN_CLOSE, PASS, PTR, RETURN, ROOT, SCALE_OP, SEMICOLON, STRING, STORAGE_TYPE, SUB, SUFFIX_OP, TYPE_LIST, UNARY_MATH_OP, VALUE_TYPE, VARIABLE, VOID, WS, YIELD /* END_ALL_ASTYPES */ } from "./syntax.js";


/* 
  The technique used here is inspired by the lexer generator Moo (https://github.com/no-context/moo).
    The Moo authors claim this is probably the fastest way to build a lexer in Javascript - I'll take their word for it.

  First, we associate each ASType with a regular expression pattern.
  Then all of those patterns are compiled into one big sticky regular expression with a matching group for each ASType
    (see the lexify function below).

  NOTES:
    Keywords are followed by (?!\w) which prevents them from matching the initial segments of variables.
      E.g. You can have a variable called "returnValue" and the initial "return" won't be picked up as a keyword.

    Lexification order is unimportant for most token types, but there are a few exceptions that determine the order of this list.
      1. WS goes first as a (premature) optimization, just because it's almost certainly the most common token type.
      2. There are a few tokens that are prefixes of other tokens (e.g = is a prefix of ==). 
          The longer tokens needs to be caught first, so sets of possible prefixes are separated out up front.
      3. CALL and MEMORY_ACCESS need to go after all keywords (we don't want to mistake things like "if(" for a function call).
      4. VARIABLE needs to go after CALL, MEMORY_ACCESS and all keywords, so those things aren't mistakenly identified as variables.
      5. BAD_TOKEN goes last, to capture any characters we don't recognize as a part of something else.

    The parser overrides certain lexifications when creating the AST (see getASType in /compiler/syntax.js for examples).
*/
const lexerData = [  
  [WS, /\s/],

  [EQ_COMPARISON, /==|!=/],
  [ASSIGN, /=/],

  [COMMENT, /\/\/[^\n]*/],

  [BITWISE_SHIFT, />>>?|<<|rotate_right(?!\w)|rotate_left(?!\w)/],
  [ORDER_COMPARISON, />=?|<=?|\|>=?\||\|<=?\|/],
  [SCALE_OP, /\*|\/|\|\/\||%|\|%\|/],
  [BITWISE_OR, /\|/],

  [STORAGE_TYPE, /(?:i(?:32|64)_[su](?:8|16)|i64_[su]32)(?!\w)/],
  [VALUE_TYPE, /(?:i32|i64|f32|f64)(?!\w)/],

  [F64_LITERAL, /\d+\.\d+x64/],
  [F32_LITERAL, /\d+\.\d+(?:x32)?/],
  [I64_LITERAL, /\d+x64/],
  [I32_LITERAL, /\d+(?:x32)?/],

  [SUFFIX_OP, /\+\+|--/],
  [ADD, /\+/],
  [SUB, /-/],

  [ADDRESS, /\[/],
  [ADDRESS_CLOSE, /\]/],
  [ALLOCATE_PAGES, /allocate_pages(?!\w)/],
  [AND, /and(?!\w)/],
  [AS, /as(?!\w)/],
  [BITWISE_AND, /&/],
  [BITWISE_XOR, /xor(?!\w)/],
  [BLOCK, /{/],
  [BLOCK_CLOSE, /}/],
  [BREAK, /break(?!\w)/],
  [COMMA, /,/],
  [CONTINUE, /continue(?!\w)/],
  [DEFAULT_MEMORY, /default_memory(?!\w)/],
  [DEFAULT_TABLE, /default_table(?!\w)/],
  [DEFINITION, /:/],
  [ELSE, /else(?!\w)/],
  [EXPORT, /export(?!\w)/],
  [FN, /fn(?!\w)/],
  [FN_PTR, /fn_ptr(?!\w)/],
  [FROM, /from(?!\w)/],
  [IF, /if(?!\w)/],
  [IMMUTABLE, /immutable(?!\w)/],
  [IMPORT, /import(?!\w)/],
  [LOOP, /loop(?!\w)/],
  [MISC_INFIX, /\?>|\?<|with_sign_of(?!\w)/],
  [VOID, /void(?!\w)/],
  [OR, /or(?!\w)/],
  [PAGES_ALLOCATED, /pages_allocated(?!\w)/],
  [PAREN, /\(/],
  [PAREN_CLOSE, /\)/],
  [PTR, /ptr(?!\w)/],
  [RETURN, /return(?!\w)/],
  [SEMICOLON, /;/],
  [STRING, /"(?:[^"\\]|\\.)*"/],
  [UNARY_MATH_OP, /(?:abs|ceil|count_ones|floor|leading_zeros|round|sqrt|trailing_zeros|truncate|(?:to|cast)_(?:i32|i64|f32|f64))(?!\w)|!/],
  [YIELD, /yield(?!\w)/],  

  [CALL, /\w+(?=\()/],
  [MEMORY_ACCESS, /\w+(?=\[)/],
  [VARIABLE, /\w+/],
  [BAD_TOKEN, /./]
];

// Create one big sticky regexp from the table above.

const ASTypes = [];
const patterns = [];

for (let [type, regex] of lexerData) {
  ASTypes.push(type);
  patterns.push(`(${regex.source})`);
}

const regexp = new RegExp(patterns.join("|"), "y");


/*
  The main lexer function;
    takes a string as input, returns a list of tokens with associated ASTypes.
*/
export function lexify (text) {
  let textLength = text.length;
  let tokens = [];
  regexp.lastIndex = 0;

  // regexp is sticky, so every time we run regexp.exec, lastIndex will increment to reflect the end of the matched text.
  // Each iteration of this loop will match one token.
  while (regexp.lastIndex < textLength) {
    let result = regexp.exec(text);
    // Iterate through the matching groups of the result - exactly one will be defined,
    //  and we use its index to find the corresponding ASType for the token.
    // Supposedly, executing one big regular expression and then iterating through the matching groups like this is faster than executing a
    //  separate regular expression for each ASType.
    for (var i = 1; i < result.length && result[i] === undefined; i++);
    tokens.push({ASType: ASTypes[i - 1], text: result[0], length: result[0].length, pos: result.index});
  }

  // Finally, we add a sentinel to mark the end of input - this simplifies the parsing algorithm somewhat.
  tokens.push({ASType: END_OF_INPUT, text: '\n', length: 1, pos: textLength});

  return tokens;
}