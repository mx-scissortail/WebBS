/*
  This file specifies most of the syntax of WebBS.

  I say "most" of the syntax is specified here because some of that work is arguably shared by the lexification rules, the parser algorithm
    itself (in the form of special cases) and perhaps some of the semantic validation rules in /compiler/validation.js.

  The structure of this file:
    1. Declare all of the ASTypes (types of nodes that appear in the abstract syntax tree).
    2. Associate various properties with those ASTypes that determine the overall shape of the grammar (# of operands, scope info, etc.).
    3. Declare more grammatical rules as functions/generate them from tables (parent/child ASType constraints, operator precedence tiers).
    4. Export getASType(), which the parser uses to override the ASType guesses that the lexer makes based on contextual information.

  Regarding the approach to definition taken here:
    We first declare all the ASTypes as empty objects, then procedurally fill in the associated properties, etc.
    At first glance this may appear to be an unusual pattern, but there are good reasons for it.
    Coming from an OOP background, you might be tempted to define the ASTypes individually, together with all their static properties.
      Experience shows that this requires much more code, is less readable overall and becomes a maintenance nightmare in certain situations
        (e.g. when you need to change the ASType data structure format).
    Alternately, more traditional compiler writers tend to specify ASType analogues as something akin to enum values,
      and encode parser rules and properties into tables.
      This can be a step up from the OOP approach in terms of read(-and-maintain)ability, but JS makes specifying such tables a little
        awkward and gives them hidden runtime costs during parsing.

    The procedurally-defined-objects approach used here incurs a negligible startup cost at runtime
      and allows the process of defining (most of) the syntax to follow a logical sequence, so it seems like a good overall strategy.
*/


export const ADD = {};
export const ADDRESS = {};
export const ADDRESS_CLOSE = {};
export const ALLOCATE_PAGES = {};
export const AND = {};
export const ARG_LIST = {};
export const AS = {};
export const ASSIGN = {};
export const BAD_TOKEN = {};
export const BITWISE_AND = {};
export const BITWISE_OR = {};
export const BITWISE_SHIFT = {};
export const BITWISE_XOR = {};
export const BLOCK = {};
export const BLOCK_CLOSE = {};
export const BREAK = {};
export const CALL = {};
export const COMMA = {};
export const COMMENT = {};
export const CONTINUE = {};
export const DECLARATION = {};
export const DEFAULT_MEMORY = {};
export const DEFAULT_TABLE = {};
export const DEFINITION = {};
export const ELSE = {};
export const END_OF_INPUT = {};
export const EQ_COMPARISON = {};
export const EXPORT = {};
export const EXPORT_TYPE = {};
export const F32_LITERAL = {};
export const F64_LITERAL = {};
export const FN = {};
export const FN_PTR = {};
export const FN_SIGNATURE = {};
export const FROM = {};
export const I32_LITERAL = {};
export const I64_LITERAL = {};
export const IF = {};
export const IMMUTABLE = {};
export const IMPORT = {};
export const INIT_EXPR = {};
export const LOOP = {};
export const MEMORY_ACCESS = {};
export const MISC_INFIX = {};
export const NEG = {};
export const OR = {};
export const ORDER_COMPARISON = {};
export const PAGES_ALLOCATED = {};
export const PARAM_LIST = {};
export const PAREN = {};
export const PAREN_CLOSE = {};
export const PASS = {};
export const PTR = {};
export const RETURN = {};
export const ROOT = {};
export const SCALE_OP = {};
export const SEMICOLON = {};
export const STRING = {};
export const STORAGE_TYPE = {};
export const SUB = {};
export const SUFFIX_OP = {};
export const TYPE_LIST = {};
export const UNARY_MATH_OP = {};
export const VALUE_TYPE = {};
export const VARIABLE = {};
export const VOID = {};
export const WS = {};
export const YIELD = {};

// A couple of utility functions

function operands (leftOperands, rightOperands) {
  return {leftOperands, rightOperands, expectedChildCount: leftOperands + rightOperands};
}

function recordProperties (...syntaxRules) {
  for (let [values, types] of syntaxRules) {
    for (let type of types) {
      Object.assign(type, values);
    }
  }
}


/*
  Record default property values for all ASTypes.
*/

recordProperties([
  {
    skip: false,              // Boolean; should the parser ignore this sort of token entirely (true for WS and COMMENT, false otherwise)?

    leftOperands: 0,          // How many operands should the parser expect to the left of this type of node? Either 0 or 1.
    rightOperands: 0,         // How many operands should the parser expect to the right of this type of node?
    expectedChildCount: 0,    // What's the (maximum) number of children to count before marking this node as finished?
                              //    This is Infinity for open expressions, and equal to .leftOperands plus .rightOperands otherwise.
    CTC: () => null,          // Child Type Constraint function - see the CTC section below.
    PTC: () => false,         // Parent Type Constraint function - see the PTC section below.
    
    requiresTerminator: null, // For open expressions, this is the ASType of tokens that close the expression (e.g. PAREN_CLOSE for PAREN).
    ignoresTerminator: null,  // For open expressions, this is an ASType that should be considered a "separator" (e.g. COMMA for ARG_LIST).
    isTerminator: false,      // Boolean; does this token type terminate the current expression (unless exempted by .ignoresTerminator)?

    precedence: -Infinity,    // The precedence to use for operator parsing conflicts. Higher wins.
    rightAssociative: false,  // This sets the associativity rule for operators with equal precedence - see the precedence tiers docs below.

    createsNewScope: false,   // Boolean; does this node mark the beginning of a new scope (in which all its children will be placed)?
    createsName: false,       // Boolean; does this node create a new named entity (e.g. variable definitions and such)?
    isReference: false        // Boolean; does this node reference a named entity (and thus require name resolution)?
  },

  // The following array is automatically populated by a script.
  [ /* ALL_ASTYPES */ ADD, ADDRESS, ADDRESS_CLOSE, ALLOCATE_PAGES, AND, ARG_LIST, AS, ASSIGN, BAD_TOKEN, BITWISE_AND, BITWISE_OR, BITWISE_SHIFT, BITWISE_XOR, BLOCK, BLOCK_CLOSE, BREAK, CALL, COMMA, COMMENT, CONTINUE, DECLARATION, DEFAULT_MEMORY, DEFAULT_TABLE, DEFINITION, ELSE, END_OF_INPUT, EQ_COMPARISON, EXPORT, EXPORT_TYPE, F32_LITERAL, F64_LITERAL, FN, FN_PTR, FN_SIGNATURE, FROM, I32_LITERAL, I64_LITERAL, IF, IMMUTABLE, IMPORT, INIT_EXPR, LOOP, MEMORY_ACCESS, MISC_INFIX, NEG, OR, ORDER_COMPARISON, PAGES_ALLOCATED, PARAM_LIST, PAREN, PAREN_CLOSE, PASS, PTR, RETURN, ROOT, SCALE_OP, SEMICOLON, STRING, STORAGE_TYPE, SUB, SUFFIX_OP, TYPE_LIST, UNARY_MATH_OP, VALUE_TYPE, VARIABLE, VOID, WS, YIELD /* END_ALL_ASTYPES */ ],
]);


/*
  Record operand counts and other basic syntactical properties relating to open expressions/scope & resolution/misc.
*/

recordProperties(

  // Prefix Operators
  
  [operands(0, 1),
    [ALLOCATE_PAGES, CALL, EXPORT, IMMUTABLE, LOOP, MEMORY_ACCESS, NEG, UNARY_MATH_OP, PTR, RETURN, YIELD]],
  [operands(0, 2),
    [DEFAULT_MEMORY, DEFAULT_TABLE, FN_PTR, FN_SIGNATURE, IF]],
  [operands(0, 3),
    [FN, IMPORT]],
  [operands(1, 0),
    [SUFFIX_OP]],
  
  // Infix Operators

  [operands(1, 1),
    [DEFINITION, DECLARATION, SCALE_OP, ADD, AS, MISC_INFIX, SUB, BITWISE_AND, BITWISE_OR, BITWISE_SHIFT, BITWISE_XOR, ORDER_COMPARISON, EQ_COMPARISON, AND, OR, ASSIGN, ELSE, INIT_EXPR]],

  // Open Expressions (various paren types, blocks, etc.) and their terminators
  [{expectedChildCount: Infinity},
    [ADDRESS, ARG_LIST, BLOCK, PARAM_LIST, PAREN, ROOT, TYPE_LIST]],
  [{ignoresTerminator: COMMA},
    [ARG_LIST, PARAM_LIST, TYPE_LIST]],
  [{ignoresTerminator: SEMICOLON},
    [ADDRESS, BLOCK, PAREN, ROOT]],
  [{requiresTerminator: ADDRESS_CLOSE},
    [ADDRESS]],
  [{requiresTerminator: BLOCK_CLOSE},
    [BLOCK]],
  [{requiresTerminator: END_OF_INPUT},
    [ROOT]],
  [{requiresTerminator: PAREN_CLOSE},
    [ARG_LIST, PARAM_LIST, PAREN, TYPE_LIST]],
  [{isTerminator: true},
    [BLOCK_CLOSE, COMMA, END_OF_INPUT, ADDRESS_CLOSE, PAREN_CLOSE, SEMICOLON]],

  // Other Properties

  [{createsName: true},
    [DECLARATION, DEFINITION]],
  [{createsNewScope: true},
    [BLOCK, FN, LOOP, ROOT]],
  [{isReference: true},
    [CALL, MEMORY_ACCESS, VARIABLE]],
  [{rightAssociative: true},
    [ASSIGN, ELSE, INIT_EXPR]],
  [{skip: true},
    [COMMENT, WS]]
);


/*
  Child Type Constaints (CTC)

  The rules above determine how many children a given node type can have, where those children are placed relative to the node, etc.
  Child Type Constraint functions define rules about the acceptable ASTypes of a node's children.
  For instance, IF has two operands to the right, but not just anything can go in those two slots.
    A valid IF must have this shape:
      if (...) {...}
  Consequently, the CTC rule for IF just checks whether the first operand has ASType PAREN and the second one has ASType BLOCK.

  Note that this is still a syntactic constraint, rather than a semantic one.
    The first operand for an IF must also evaluate to a numeric runType in order to work as a condition.
    We don't check that with CTC rules - the CTC for IF doesn't know anything about the runTypes involved.
    That sort of constraint is enforced during the validation stage, after the AST has already been constructed.
    See /compiler/validation.js for more about runTypes and semantic validation.
    
  In general, CTC rules return an object of some sort if a violation is detected, and null otherwise.
*/

/*
  The first type of Child Type Constraint is positional, for ASTypes that take a set number of operands.

  Each argument to CTCByPos is an array of ASTypes that contains the acceptable ASTypes for that operand position.
  E.g. the CTCByPos rule for FN is made up of these parts:
    [PARAM_LIST]        - A list of parameters
    [VALUE_TYPE, VOID]  - The function's return type, which is either a numeric type specifier (i32/i64/f32/f64) or void
    [BLOCK]             - A block that contains the function's body

  CTCByPos creates a rule that checks only the positional constraints given.
  If an operator has 3 operand positions and you give CTCByPos 2 arguments, it will check the first two operand positions against those
    constraints and assume the third can be anything.
*/
function CTCByPos (...positions) {
  return (node) => {
    for (let i = 0; i < positions.length; i++) {
      if (!positions[i].includes(node.children[i].ASType)) {
        return {position: i, child: node.children[i]};
      }
    }
    return null;
  };
}

ASSIGN.CTC          = CTCByPos([DEFINITION, VARIABLE, MEMORY_ACCESS]);  // The right operand of ASSIGN isn't constrained.
AS.CTC              = CTCByPos([EXPORT_TYPE, VARIABLE], [STRING]);
DECLARATION.CTC     = CTCByPos([VARIABLE], [FN_PTR, FN_SIGNATURE, IMMUTABLE, PTR, VALUE_TYPE]);
DEFAULT_MEMORY.CTC  = CTCByPos([I32_LITERAL], [I32_LITERAL, VOID]);
DEFAULT_TABLE.CTC   = CTCByPos([I32_LITERAL], [I32_LITERAL, VOID]);
DEFINITION.CTC      = CTCByPos([VARIABLE], [FN, FN_PTR, IMMUTABLE, PTR, VALUE_TYPE]);
ELSE.CTC            = CTCByPos([IF], [BLOCK, BREAK, CONTINUE, IF, ELSE]);
EXPORT.CTC          = CTCByPos([AS, VARIABLE]);
FN.CTC              = CTCByPos([PARAM_LIST], [VALUE_TYPE, VOID], [BLOCK]);
FN_PTR.CTC          = CTCByPos([TYPE_LIST], [VALUE_TYPE, VOID]);
FN_SIGNATURE.CTC    = CTCByPos([TYPE_LIST], [VALUE_TYPE, VOID]);
IF.CTC              = CTCByPos([PAREN], [BLOCK, BREAK, CONTINUE]);
IMMUTABLE.CTC       = CTCByPos([FN_PTR, PTR, VALUE_TYPE]);
IMPORT.CTC          = CTCByPos([DECLARATION, DEFAULT_MEMORY, DEFAULT_TABLE], [FROM], [STRING]);
INIT_EXPR.CTC       = CTCByPos([DEFINITION], [F32_LITERAL, F64_LITERAL, I32_LITERAL, I64_LITERAL, VARIABLE]);
LOOP.CTC            = CTCByPos([BLOCK, ELSE, IF]);
NEG.CTC             = CTCByPos([F32_LITERAL, F64_LITERAL, I32_LITERAL, I64_LITERAL]);
PTR.CTC             = CTCByPos([STORAGE_TYPE, VALUE_TYPE]);
SUFFIX_OP.CTC       = CTCByPos([VARIABLE]);

/*
  NOTE: The following CALL and MEMORY_ACCESS rules technically hold, but they don't need to be explicitly enforced because the lexer and
    parser conspire to make them impossible to violate in practice.
      See the lexification regex for CALL and the way PAREN becomes ARG_LIST in getASType (defined below) to get an idea of why.

  CALL.CTC            = CTCByPos([ARG_LIST]);
  MEMORY_ACCESS.CTC   = CTCByPos([ADDRESS]);
*/

/*
  Child type constraints for the document root and param/type lists are simpler.
  They're open expressions so we don't distinguish different positions or care about how many children they have, we just make sure that the
    ASType of each child is among a finite list of ASTypes.
*/
function CTCForAll (...acceptableTypes) {
  return (node) => {
    for (let child of node.children) {
      if (!acceptableTypes.includes(child.ASType)) {
        return {child};
      }
    }
    return null;
  };
}

PARAM_LIST.CTC      = CTCForAll(DECLARATION);
ROOT.CTC            = CTCForAll(DEFINITION, DEFAULT_MEMORY, DEFAULT_TABLE, EXPORT, IMPORT, INIT_EXPR);
TYPE_LIST.CTC       = CTCForAll(VALUE_TYPE);

// ADDRESS is a special case, as it has a variable (but bounded) number of children and an ASType constraint only on the second child.
ADDRESS.CTC         = ({children}) => (children.length === 1 || (children.length === 2 && children[1].ASType === I32_LITERAL)) ? null : {};

/*
  Parent Type Constaints (PTC)

  After checking that a node's children are of an appropriate type, we check whether the node itself is being placed appropriately.
  Consider the "fn" keyword, used for defining a function. It should really only appear inside of a definition.
    The CTC rule for DEFINITION says that it will accept FN, but doesn't preclude FN from appearing elsewhere.
    Therefore, we also need a PTC rule for FN that only allows it to be placed as a child of DEFINITION.

  Some PTC rules are positional, in the sense that they only allow nodes with a given ASType to be placed children of a certain type of node
   in a particular operand position.
  Other PTC constraints are position independent, in that they only care about the ASType of the parent, not where among the parent's
    operands/children the node is placed.
*/


/*
  Each argument supplied to PTCByPos is a tuple that defines a possible position in which nodes with the ASType might appear.
    E.g. FOO.PTC = PTCByPos([BAR, 0]) defines a rule where nodes with ASTYpe FOO may only appear as the first child of ASType BAR nodes.

  If supplied with multiple tuples, they're treated as acceptable alternatives.
  If the positional place in the tuple is null, that means "any position".

  So for instance: DEFAULT_MEMORY.PTC = PTCByPos([ROOT, null], [IMPORT, 0]);
    This says that a DEFAULT_MEMORY expression may either appear as:
      1. A child of ROOT (the top level document) in any position, or
      2. The first position of an IMPORT expression

  This returns true if a rule violation is found and false otherwise.
*/
function PTCByPos (...positions) {
  return ({parent}) => {
    for (var [parentType, pos] of positions) {
      // We use parent.children.length as a shorthand for the future position of the node in its parent's children array.
      // This works b/c children check their parent type constraints just before being placed, so the child being checked isn't in the
      //  parent's .children array yet, but it will arrive at the tail of that array it if it passes this check.
      if (parent.ASType === parentType && (pos === null || parent.children.length === pos)) {
        return false;
      }
    }
    return true;
  };
}

ADDRESS.PTC         = PTCByPos([MEMORY_ACCESS, 0]);
AS.PTC              = PTCByPos([EXPORT, 0]);
BREAK.PTC           = PTCByPos([BLOCK, null], [IF, 1], [ELSE, 1]);
CONTINUE.PTC        = PTCByPos([BLOCK, null], [IF, 1], [ELSE, 1]);
DEFAULT_MEMORY.PTC  = PTCByPos([ROOT, null], [IMPORT, 0]);
DEFAULT_TABLE.PTC   = PTCByPos([ROOT, null], [IMPORT, 0]);
EXPORT.PTC          = PTCByPos([ROOT, null]);
FN.PTC              = PTCByPos([DEFINITION, 1]);
FN_PTR.PTC          = PTCByPos([DEFINITION, 1], [DECLARATION, 1]);
FROM.PTC            = PTCByPos([IMPORT, 1]);
IMMUTABLE.PTC       = PTCByPos([DEFINITION, 1]);
IMPORT.PTC          = PTCByPos([ROOT, null]);
PTR.PTC             = PTCByPos([DECLARATION, 1], [DEFINITION, 1], [IMMUTABLE, 0]);
RETURN.PTC          = PTCByPos([BLOCK, null]);
STRING.PTC          = PTCByPos([IMPORT, 2], [AS, 1]);
STORAGE_TYPE.PTC    = PTCByPos([PTR, 0]);
VALUE_TYPE.PTC      = PTCByPos([DECLARATION, 1], [DEFINITION, 1], [FN, 1], [FN_PTR, 1], [FN_SIGNATURE, 1], [IMMUTABLE, 0], [PTR, 0], [TYPE_LIST, null],);
VOID.PTC            = PTCByPos([FN, 1], [FN_PTR, 1], [FN_SIGNATURE, 1], [DEFAULT_MEMORY, 1], [DEFAULT_TABLE, 1]);
YIELD.PTC           = PTCByPos([BLOCK, null]);

/*
  NOTE: The following are more rules that hold but aren't necessary to explicitly enforce,
    because they're either impossible to violate in practice or will necessarily be caught by another rule.
  
  E.g. INIT_EXPR only appears when getASType (see below) overrides an ASSIGN because the parent has type ROOT,
    so we don't need to enforce the implicit constraint that the parent node must have type ROOT.

  ARG_LIST.PTC        = PTCByPos([CALL, 0]);
  DECLARATION.PTC      = PTCByPos([IMPORT, 0]);
  EXPORT_TYPE.PTC     = PTCByPos([AS, 0]);
  FN_SIGNATURE.PTC    = PTCByPos([DECLARATION, 1]);
  INIT_EXPR.PTC       = PTCByPos([ROOT, null]);
  PARAM_LIST.PTC      = PTCByPos([FN, 1]);
  TYPE_LIST.PTC       = PTCByPos([FN_SIGNATURE, 1], [FN_PTR, 1]);
*/


/*
  Operator Precedence Tiers

  This assigns a number to the .precedence field of each operator ASType, based on the order of the tier list below.
  Precedence is used to resolve conflicts when an expression is has an operator on both the left and the right, and both operators could
    claim the expression as an operand.
  E.g. in "a + b * c", either + or * would be happy to accept b as a child, so we need a way of deciding which claim overrides the other.

  The higher an ASType is in this tier list, the higher its precedence.
    "*" is parsed as SCALE_OP, whereas "+" is parsed as ADD.
    SCALE_OP is in the tier above ADD, so in the "a + b * c" example above, the * successfully claims b as its left operand.
  Thus do we preserve the familiar order of operations.

  In cases where two operators with the same precedence could claim a node, we use an associativity rule to determine how to break the tie.
  By default, operators are left associative, so a + b + c is parsed as (a + b) + c rather than a + (b + c).
  There are a few exceptions where operators are marked as right associative instead,
    e.g. for assignment a = b = c, we can only understand this as a = (b = c).

  Currently, if the left operator is left-associative and the right operator is right-associative and they have equal precedence,
    the right operator wins.
  But this seems like an ambiguous parse, so this sort of thing should be avoided by putting right-associative operators in their own tiers.

  See the parse() and shouldReparent() functions in /compiler/parser.js for details on how that algorithm works.  

  Some additional constraints determine the order of this tier list:
    DEFINITION and DECLARATION need to go before IMPORT.
    AS needs to go before EXPORT.
    IF needs to go before ELSE, which needs to go before LOOP.
    Keyword prefix operators that take operands that are dynamically computed expressions should generally go after the math operators.
  
  Most of the rest of the order reflects the familiar operator precedence hierarchy inherited from languages like C.

  Maintainability note:
    Do not refactor this into any form where numbers are manually specified by the programmer, or distributed in different places.
    This form is easy to read (everything is in one place and the shape of the code tells you everything you need to know)
      and easy to modify (inserting a new tier in the middle doesn't require shifting the number assigned to tons of other ASTypes by hand).
*/

[
  [DEFINITION, DECLARATION, AS],
  [CALL, DEFAULT_MEMORY, DEFAULT_TABLE, FN, FN_PTR, FN_SIGNATURE, EXPORT, IF, IMMUTABLE, IMPORT, MEMORY_ACCESS, PTR],
  [ELSE],
  [SUFFIX_OP],
  [LOOP, NEG, UNARY_MATH_OP],
  [SCALE_OP],
  [ADD, SUB],
  [MISC_INFIX],
  [BITWISE_SHIFT],
  [ORDER_COMPARISON],
  [EQ_COMPARISON],
  [BITWISE_AND],
  [BITWISE_XOR],
  [BITWISE_OR],
  [AND],
  [OR],
  [ASSIGN, INIT_EXPR],
  [ALLOCATE_PAGES, RETURN, YIELD]
].forEach((tier, precedence, tiers) => {
  for (let type of tier) {
    type.precedence = tiers.length - precedence;
  }
});


/*
  ASType Override Rules
*/


/*
  This function determines the ASType of the nodes generated by the parser.
  It has two parameters:
    ASType: the lexer's guess at the node's ASType
    parentType: the ASType of the node's (initial) parent

  The following is an important feature of the syntax of WebBS:
    All of the information required to decide the ASType of a node to generate can be determined lexically, by the preceding tokens.
  
  In fact, if we had a modal lexer that was smart enough to use context to distinguish between ambiguous tokens, then it could always
    determine what ASType to associate with a token before it even reached the parser.
  This would complicate the lexer code a lot, and it turns out that our simple non-modal lexer can make fairly accurate guesses about the
    ASType that will eventually end up being assigned to the nodes created from the tokens it emits.
  We usually trust the lexer's guess, but sometimes we let parent nodes reinterpret the ASTypes of their children as they're being created.
  The new ASType is then used when parsing and validating the node and its children.
  
  This applies to prefix operator parents only.
  Since infix operators can adopt a given node and become its parent after the node has already been parsed, adding an infix operator
    that reinterprets the type of its children in a way that affect parsing would require some broader changes to the parser.
  
  There are a couple special cases where a prefix operator reinterprets a potential child node, which is then adopted by an infix operator,
      e.g. export default_table as "foo".
    Normally DEFAULT_TABLE would expect some operands on the right, but we're using it as a name here.
    So when we see an EXPORT followed by DEFAULT_TABLE (or DEFAULT_MEMORY), we re-interpret that as the special EXPORT_TYPE.
    But if we then see AS, it adopts the reinterpreted child.
  Be careful with this sort of thing in general though;
    it could get confusing if a prefix operator reinterprets something into a form that a higher precedence infix operator won't accept.

  Finally, it's worth noting that the WebBS editor wants to re-lexify - but not fully parse - the input on every change.
    It displays the tokens emitted by the lexer (w/ its ASType guesses), rather than the final parse tree.
    So basic syntax highlighting shouldn't depend on reinterpretation, because the editor won't ever see the new ASType.
    This is another potential issue that could be solved with a modal lexer.
*/
export function getASType (ASType, parentType) {
  if (ASType === PAREN) {
    // Parentheses are used for various types of things with different syntactical and semantic constraints, so we disambiguate those.
    if (parentType === FN) {
      // As part of a function definition, a parenthetical is a list of named parameter definitions.
      return PARAM_LIST;
    
    } else if (parentType === CALL) {
      // Following a function call, a parenthetical is a list of function arguments.
      return ARG_LIST;

    } else if (parentType === FN_PTR || parentType === FN_SIGNATURE) {
      // As part of an imported function definition, a parenthetical is a list of parameter types (without names).
      return TYPE_LIST;
    }

  } else if (parentType === IMPORT || parentType === PARAM_LIST) {
    // Imported definitions are slightly different from other definitions (see the next case).
    if (ASType === DEFINITION) {
      return DECLARATION;
    }
  
  } else if (parentType === DECLARATION) {
    // Inside an declaration FN becomes FN_SIGNATURE, which means we don't expect a body.
    if (ASType === FN) {
      return FN_SIGNATURE;
    }
  
  } else if (parentType === EXPORT) {
    // Explained in the large comment above - DEFAULT_MEMORY and DEFAULT_TABLE are used as names in the context of an export.
    if (ASType === DEFAULT_MEMORY || ASType === DEFAULT_TABLE) {
      return EXPORT_TYPE;
    }

  } else if (ASType === ASSIGN && parentType === ROOT) {
    // Finally, assignments in the global scope are initializer expressions, which can't take dynamically computed values on the right.
    return INIT_EXPR;
  }

  // Otherwise, we just go with the lexer's guess.
  return ASType;
}
