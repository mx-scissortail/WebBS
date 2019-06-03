import {getASType, /* ALL_ASTYPES */ ADD, ADDRESS, ADDRESS_CLOSE, ALLOCATE_PAGES, AND, ARG_LIST, AS, ASSIGN, BAD_TOKEN, BITWISE_AND, BITWISE_OR, BITWISE_SHIFT, BITWISE_XOR, BLOCK, BLOCK_CLOSE, BREAK, CALL, COMMA, COMMENT, CONTINUE, DECLARATION, DEFAULT_MEMORY, DEFAULT_TABLE, DEFINITION, ELSE, END_OF_INPUT, EQ_COMPARISON, EXPORT, EXPORT_TYPE, F32_LITERAL, F64_LITERAL, FN, FN_PTR, FN_SIGNATURE, FROM, I32_LITERAL, I64_LITERAL, IF, IMMUTABLE, IMPORT, INIT_EXPR, LOOP, MEMORY_ACCESS, MISC_INFIX, NEG, OR, ORDER_COMPARISON, PAGES_ALLOCATED, PARAM_LIST, PAREN, PAREN_CLOSE, PASS, PTR, RETURN, ROOT, SCALE_OP, SEMICOLON, STRING, STORAGE_TYPE, SUB, SUFFIX_OP, TYPE_LIST, UNARY_MATH_OP, VALUE_TYPE, VARIABLE, VOID, WS, YIELD /* END_ALL_ASTYPES */} from "/compiler/syntax.js";
import {validate} from "./validation.js";
import {CompileError} from "./compileError.js";


/*
  This is the main parser function.
  This takes a list of tokens produced by the lexer and returns a WebBS abstract syntax tree (AST), suitable for code generation.
  The parsing technique used here is based on Pratt parsing/Precedence Climbing algorithms.
    This page has a number of links that are good resources for learning more about the relevant techniques:
      https://www.oilshell.org/blog/2017/03/31.html
      
  The three main things to pay attention to while reading this function are:
    1. The difference between node and token:
      node is the current AST node we're working with.
        We want to give it an appropriate number of children, validate it and place it with an appropriate parent.
      token is the upcoming token to the right of whatever we've processed so far.
        We want to turn it into a new AST node or determine how it otherwise affects the AST.
        Each loop iteration may or may not consume a token (note the places where index-- happens).
    2. The asymmetry between node.parent and parent.children:
      nodeA.parent === nodeB does not imply nodeB.children.includes(nodeA) until place(nodeA) is called.
      We make an initial guess as to a node's parent and store it in node.parent, but we may change that guess in a moment,
        depending on what tokens we see coming in from the right.
      Once a node is pushed into its parent's .children array, its placement is finalized.
    3. The concept of a "complete" node.
      Generally, a node is marked with .complete = true when an appropriate number of children (as determined by 
        node.ASType.expectedChildCount) have been placed on it, or in the case of open expressions with an unbound child count
        (e.g. parentheses, blocks, etc.), when a specific terminator token is encountered.
      .complete = true signals that we should attempt to validate this node's further syntactic constraints
      (see .CTC() and .PTC() in /compiler/syntax.js) and then place it as a child of another node.
      When we mark a node as complete it will be placed in the next loop iteration (but not necessarily as the child of its current parent).    
*/
export function parse (tokens) {
  let root = createASTNode(null, null, ROOT); // This ROOT node is the complete WebBS document and its children go in the global scope.
  
  // We're going to step through the tokens from the lexer one at a time,
  //  but beware of the clauses below that step the loop counter backwards once - not every iteration of this loop consumes a new token.
  for (let index = 0, node = root; index < tokens.length; index++) {
    let token = tokens[index];

    if (token.ASType.skip) continue;  // Ignore white space and comments.
    if (token.ASType === BAD_TOKEN) {
      throw new CompileError("Mysterious Symbol", {token});
    }
  
    if (node.complete) {
      // If the node we've been working on has all the children it expects, it's done so we place it among the children of another node.
      // We look at the token to the right of the node to determine where the complete node is placed.
      // By default, we expect to give it to the current node.parent.
      // But if the token to the right takes a left operand, it may want to adopt the node out from under the current parent instead.
      //  e.g. if we were about to place the b in a + b but noticed that the next token is *, the * steals b away from +.
      if (shouldReparent(node.parent.ASType, token.ASType)) {
        // If the upcoming token would claim the complete node as its child, we use that token to create a new AST node, then re-parent.
        //  Note that getASType() may override token.ASType when determining the final ASType for the node we create here.
        node.parent = createASTNode(token, node.parent, getASType(token.ASType, node.parent.ASType));
      } else {
        // If we don't have a use for the token yet, we want to re-examine it the next loop iteration, so we decrement the loop counter.
        index--;
      }
  
      // Place the node among the children of node.parent.
      node = place(node); // place() returns node.parent, so we effectively ascend one step up the syntax tree.
      if (node.children.length === node.ASType.expectedChildCount) {  // Mark the parent node as done if placing that child completed it.
        node.complete = true;
      }
  
    } else if (token.ASType.isTerminator) { // The current node can/must accept more children but we've encountered a terminator token.
      if (node.ASType.requiresTerminator === token.ASType) {
        // If this is the appropriate terminator for an open expression, consume the token, close the node and move on.
        node.complete = true;

      } else if (node.ASType === RETURN) {  // RETURN is a special case - it expects a child on the left, but it's fine without one.
        node.complete = true;
        index--;  // Decrement the loop counter and examine the un-consumed terminator token again in the next iteration.
      
      } else if (node.ASType.ignoresTerminator !== token.ASType) {
        throw new CompileError("Misplaced Terminator or Unfinished Expression", {node, token});
      }
      // If we get here, the current node ignores terminator tokens of this type, so we consume the token and move on.
  
    // In the remaining cases, the current node can/must accept more children on the right.
    } else if (token.ASType.leftOperands !== 0) { // Uh oh, the upcoming token's ASType seems to expect operands on the left...
      
      if (token.ASType === SUB) { // SUB is a special case, because the lexer can't tell it from unary negation (e.g. a - b vs. (-b))...
        node = createASTNode(token, node, NEG); //  ...so we optimistically re-interpret it as the unary NEG operator.
      } else {  // Otherwise, something is missing between these two operators.
        throw new CompileError("Unfinished Expression", {token});
      }
    
    } else {
      // Finally we come to the case where we can assume the upcoming token represents a child that the current node will try to accept.
      // We consume the token to create a new node, set the current node as the default parent for it, and set it as the current node.
      //  Note that a different parent may end up adopting the node we create here,
      //    and that nodes that take no children will already be marked as complete upon creation,
      //    and finally, that getASType() may override token.ASType when determining the final ASType for the node we create here.
      node = createASTNode(token, node, getASType(token.ASType, node.ASType));
    }
  }

  // The document root never gets placed on a parent (for obvious reasons), but we still need to check its child type constraints.
  let CTCViolation = ROOT.CTC(root);
  if (CTCViolation !== null) {
    throw new CompileError("Unintelligible Syntax (Child Type Constraint Violation)", {node: root, ...CTCViolation});
  }

  // The final shape of the AST is set in stone at this point, but we still need to do some processing before parsing is complete.
  resolve(root.scope);  // Resolve all references.
  validate(root, false);  // Do semantic validation and fill in metadata used during code generation.

  return root;
}


/*
  This creates a new ASTNode object.
    Parameters:
      token - the associated token
      parent - the parent ASTNode
      ASType - optional, overrides the default ASType associated with the token
*/
function createASTNode (token, parent, ASType) {
  let scope = parent && parent.scope;  // This will be null for the ROOT node, which is okay (createScope handles that separately).
  
  if (ASType.createsNewScope) {
    scope = createScope(scope, ASType);
  }

  return {
    alwaysEscapes: false,
    ASType,
    children: [],
    complete: ASType.expectedChildCount === 0,  // Automatically mark nodes with no children as complete.
    dropValue: false,
    meta: null,
    parent,
    runType: "void",
    scope,
    token
  };
}


/*
  This creates a new scope object, for tracking defined identifiers and other relevant information.
    If called with a null argument, this creates a blank scope object, suitable for use as the global scope.
    If called with a parent scope object, this copies the relevant information from the parent scope to the newly created scope.
*/
function createScope (parent) {
  if (parent === null) {  // We're creating the global scope.
    return   {
      names: Object.create(null), // A map from names to nameable entities (variables, functions, pointers, etc.).
      functionSignatureIndexMap: Object.create(null), // Used to memoize function signature definitions (see functionSignatureIndex()).
      functionSignatures: [], // A list of known function signatures, (see functionSignatureIndex()).
      defaultMemory: [],  // Limited to one entry, created as an array so copy-by-reference works for sub-scopes below.
      defaultTable: [], // Limited to one entry, created as an array so copy-by-reference works for sub-scopes below.
      definitions: [],
      imports: {function: [], global: []},
      isGlobal: true, // Is this the global scope? Yes.
      functions: [],
      variables: [],
      exports: [],
      references: [], // A running list of all the references that need to be resolved.
      children: [], // A list of sub-scopes.
      returnPoints: []
    };

  } else {
    // Most fields from the parent scope are only created once and copied (by reference) into the sub-scope we're creating here,
    //  but we create new, empty lists for things that are block scoped - this helps us do name resolution in the right order.
    let scope = {
      ...parent,
      children: [],
      definitions: [],
      isGlobal: false,
      references: []
    };

    if (parent.isGlobal) {
      scope.variables = [];
    }

    parent.children.push(scope);
    return scope;
  }
}


const storageTypeSplitter = /(.(..))_?(.)?(..?)?/;  // This is a tiny utility regular expression used by define() below.


/*
  This records a variable/function/function pointer/pointer definition, so that it may be referred to by an identifier.
*/
function define (node) {
  let [{token}, spec] = node.children;
  let mutable = node.parent.ASType !== IMPORT;  // All imported variables are immutable by default in the WebAssembly MVP.
  
  if (spec.ASType === IMMUTABLE) {
    mutable = false;
    spec = spec.children[0];
  }

  let {ASType, scope} = spec;

  // Most named definitions can technically appear pretty much anywhere, but function defintions are limited to the global scope.
  if (ASType === FN && node.parent.ASType !== ROOT) {
    throw new CompileError("Bad Placement for Function Definition", {node});
  } 

  let definition = {
    ASType,
    exportName: null,
    isGlobal: scope.isGlobal,
    importSource: null,
    index: 0, // The actual positions in index space are set during code generation.
    initializer: null,
    kind: "global", // Overridden below, generally used for exporting.
    mutable,
    name: token.text,
    runType: spec.token.text, // Overridden below.
    scope,
    token
  };

  let isFnPtr = ASType === FN_PTR;

  if (ASType === FN || ASType === FN_SIGNATURE || isFnPtr) {
    let [{children: paramList}, {token: {text: returnType}}, body = null] = spec.children;
    let paramTypes = paramList.map(ASType === FN ? (param) => param.meta.runType : (param) => param.token.text);
    let signatureIndex = functionSignatureIndex(scope, paramTypes, returnType);

    definition = {
      ...definition,
      body,
      kind: isFnPtr ? "global" : "function",  // Function pointers have a function signature, but otherwise act like i32 globals.
      mutable: isFnPtr && mutable,  // Functions can't be mutable, but function pointers can.
      paramTypes,
      returnType,
      runType: isFnPtr ? "i32" : "void",
      signatureIndex
    };

  } else if (ASType === PTR) {
    let storageType = spec.children[0].token.text;
    let [ignore, returnType, bits, storageSigned, storageBits] = storageTypeSplitter.exec(storageType);
    let extendedType = storageBits !== undefined;
    definition = {
      ...definition,
      extendedType,
      storageSigned,
      storageBits,
      runType: "i32", // Pointers all have runType i32, because the actual value of the pointer is a memory address.
      returnType, // .returnType is the type of the data that the pointer points to.
      storageSize: Number.parseInt(extendedType ? storageBits : bits) / 8,
      storageType
    };
  }

  node.meta = definition;
  spec.meta = definition;
  node.parent.scope.definitions.push(definition);

  if (node.parent.ASType === IMPORT) {
    scope.imports[definition.kind].push(definition);
  } else if (definition.kind === "function") {
    scope.functions.push(definition);
  } else {
    scope.variables.push(definition);
  }
}


/*
  This records the default memory store definition in the global scope object.
*/
function defineMemory (node) {
  let [initialSize, maxSize] = node.children;

  if (node.scope.defaultMemory.length !== 0) {
    throw new CompileError("Duplicate Default Memory Definition", {first: node.scope.defaultMemory[0], second: node});
  }

  // Many of these fields will be updated later.
  let definition = {
    ASType: DEFAULT_MEMORY,
    token: node.token,
    kind: "memory",
    importSource: null,
    initialSize,
    maxSize,
    index: 0,
    exportName: null
  };

  node.scope.defaultMemory.push(definition);
  node.meta = definition;
}


/*
  This records the default table defintion in the global scope object.
*/
function defineTable (node) {
  let [initialSize, maxSize] = node.children;

  if (node.scope.defaultTable.length !== 0) {
    throw new CompileError("Duplicate Default Table Definition", {first: node.scope.defaultTable[0], second: node});
  }

  // Many of these fields will be updated later.
  let definition = {
    ASType: DEFAULT_TABLE,
    token: node.token,
    kind: "table",
    importSource: null,
    initialSize,
    maxSize,
    index: 0,
    exportName: null
  };

  node.scope.defaultTable.push(definition);
  node.meta = definition;
}


/*
  This finalizes the placement of an ASTNode in the AST (by adding it to its parent's .children array).
  Along the way, it enforces child and parent ASType placement constraints, and records definitions and variable/function references.
*/
function place (node) {
  let {ASType, parent} = node;

  // Check child and parent ASType constraints before placement.
  let CTCViolation = ASType.CTC(node);
  if (CTCViolation !== null) {
    throw new CompileError("Unintelligible Syntax (Child Type Constraint Violation)", {node, ...CTCViolation});
  } else if (ASType.PTC(node)) {
    throw new CompileError("Unintelligible Syntax (Parent Type Constraint Violation)", {node});
  }

  // If the node is some kind of definition, now is a good time to record that in the scope.
  if (ASType === DEFINITION || ASType === DECLARATION) {
    define(node);
  } else if (ASType === DEFAULT_MEMORY) {
    defineMemory(node);
  } else if (ASType === DEFAULT_TABLE) {
    defineTable(node);
  } else if (ASType.isReference && !parent.ASType.createsName) {  // If it's a reference to another definition, note that for resolution.
    node.scope.references.push(node);
  }

  parent.children.push(node);
  return parent;
}


/*
  This does name resolution, noting unresolvable references and duplicate definitions along the way.
*/
function resolve (scope) {
  for (let definition of scope.definitions) {
    if (scope.names[definition.name] === undefined) {
      scope.names[definition.name] = definition;
    } else {
      throw new CompileError("Duplicate Definition", {first: scope.names[definition.name], second: definition});
    }
  }

  // Attach the definitional meta information of the referent to each reference and enforce semantic rules.
  for (let reference of scope.references) {
    reference.meta = scope.names[reference.token.text];
    if (reference.meta === undefined) {
      throw new CompileError("Unresolvable Reference", {node: reference});
    }
    enforceReferenceSemantics(reference);
  }

  for (let child of scope.children) {
    child.names = {...scope.names};
    resolve(child);
  }
}


/*
  This resolves operator precedence conflicts.
  See the operator precedence table in /compiler/syntax.js for more information.
  This returns true iff the ASTypes imply that the node on the right has priority over the left node, when resolving placement.
*/
function shouldReparent (leftType, rightType) {
  // We know the node with the left type can try to take the current node as a child (it would be complete by now, otherwise).
  // If the right type doesn't take any operands on the left, it can't claim the current node as a child, so we don't reparent.
  if (rightType.leftOperands === 0) {
    return false;

  // If we get here both the left and right types could potentially claim the current node as a child, so we test their precedence
  //  (factoring in associativity) to determine which gets to make the claim.
  } else if (rightType.rightAssociative) {
    return rightType.precedence >= leftType.precedence;
  } else {
    return rightType.precedence > leftType.precedence;
  }
}


/*
  This function makes sure identifiers reference the right type of entity, based on the way they're being used,
    e.g. you can't write foo[1] if foo isn't a pointer.
*/
function enforceReferenceSemantics (reference) {
  let refType = reference.meta.ASType;

  if (reference.parent.ASType === EXPORT || reference.parent.ASType === AS) return; // We can export any type.
    
  if (reference.ASType === VARIABLE && (refType === FN || refType === FN_SIGNATURE)) {
    throw new CompileError("Bad Reference: Not a Variable", {node: reference});
  } else if (reference.ASType === CALL && refType !== FN && refType !== FN_SIGNATURE && refType !== FN_PTR) {
    throw new CompileError("Bad Reference: Not a Function", {node: reference});
  } else if (reference.ASType === MEMORY_ACCESS && refType !== PTR) {
    throw new CompileError("Bad Reference: Not a Pointer", {node: reference});
  }
}


/*
  WebAssembly modules have a list of function signatures, referred to by numeric index.
  This function takes the components of a function signature (its parameters and return type) finds or creates an entry in that list,
    and returns the relevant index.
*/
function functionSignatureIndex (scope, paramTypes, returnType) {
  let signature = [returnType, ...paramTypes];
  let signatureKey = signature.join(",");
  let index = scope.functionSignatureIndexMap[signatureKey];
  if (index === undefined) {
    index = scope.functionSignatureIndexMap[signatureKey] = scope.functionSignatures.length;
    scope.functionSignatures.push(signature);
  }
  return index;
}


// The following lines are sometimes useful for debugging purposes.
// Since the ASTypes are normal objects, it can be hard to tell which is which in a debugger.
// Uncomment these lines to assign a label to each ASType in /compiler/syntax.js corresponding to its export name.

// import * as ASTypes from "/compiler/syntax.js";
// for (let [key, value] of Object.entries(ASTypes)) {
//  value._name = key;
// }