/*
  This file exports the validate() function, which performs semantic validation on WebBS AST nodes.

  Semantic validation ensures that the WebBS code can be compiled down to WebAssembly bytecode as written. The validation stage also records
    any additional semantic information needed for code generation, usually in the .meta object associated with AST nodes.

  A note about runTypes:

  The syntactic validation performed by the first stage of parsing (implemented in /compiler/parser.js with rules defined in
    /compiler/syntax.js) mostly depends on ASTypes (the syntactical types of nodes in the parse tree, e.g. FN, ASSIGN, etc.).
  The semantic validation done here also depends on runtime types (or runTypes, as they're referred to in the code below).

  Runtime types are baked in to WebAssembly. The semantics for WebAssembly depend on a kind of typed stack that instructions may push/pop
    values on to and off of, and all stack values have a numeric type (i32, i64, f32 or f64).

  WebBS expressions are associated with runTypes - think of an expression's runType as its stack "return type".
  The runType associated with a WebBS expression is roughly the type of value that it pushes on to the stack upon being executed (if any).
  So the possible runTypes include "i32", "i64", "f32", "f64" and "void".
  The "void" runType means that the expression has no effect on the stack, or only consumes stack values, but doesn't push anything on top.

  We also use runTypes to represent things that don't immediately affect the stack but have numeric semantics that line up with the stack
    value types (e.g. 32-bit integer immediates are identified with an "i32" type, even though they don't touch the stack).

  In terms of stack effects, runTypes in WebBS are almost invariant. Control flow branches introduce one minor complication.
  For instance, if/else expressions can return a value, but they can also contain code that returns a value from the current function, and
    those two values don't have the same type. So there's a sense in which such expressions can have heterogenous stack effects, depending
    on the control flow path that execution takes out of them.
  But we only assign one runType to each expression - in heterogenous control flow cases, the runType of an expression is the stack value
    produced in the case where execution continues forward normally (not the stack value produced on a branch out of a block/function).
*/

import { /* ALL_ASTYPES */ ADD, ADDRESS, ADDRESS_CLOSE, ALLOCATE_PAGES, AND, ARG_LIST, AS, ASSIGN, BAD_TOKEN, BITWISE_AND, BITWISE_OR, BITWISE_SHIFT, BITWISE_XOR, BLOCK, BLOCK_CLOSE, BREAK, CALL, COMMA, COMMENT, CONTINUE, DECLARATION, DEFAULT_MEMORY, DEFAULT_TABLE, DEFINITION, ELSE, END_OF_INPUT, EQ_COMPARISON, EXPORT, EXPORT_TYPE, F32_LITERAL, F64_LITERAL, FN, FN_PTR, FN_SIGNATURE, FROM, I32_LITERAL, I64_LITERAL, IF, IMMUTABLE, IMPORT, INIT_EXPR, LOOP, MEMORY_ACCESS, MISC_INFIX, NEG, OR, ORDER_COMPARISON, PAGES_ALLOCATED, PARAM_LIST, PAREN, PAREN_CLOSE, PASS, PTR, RETURN, ROOT, SCALE_OP, SEMICOLON, STRING, STORAGE_TYPE, SUB, SUFFIX_OP, TYPE_LIST, UNARY_MATH_OP, VALUE_TYPE, VARIABLE, VOID, WS, YIELD /* END_ALL_ASTYPES */ } from "/WebBS/compiler/syntax.js";
import {CompileError} from "/WebBS/compiler/compileError.js";
import {operatorTable} from "/WebBS/compiler/operatorTable.js";

/*
  This function implements the semantic validation stage.
  It recursively descends through the parse tree, looking for semantic errors and recording meta information used during code generation.

  The parameters are:
    node
      A parse tree node to validate
    valueRequired
      A Boolean that indicates whether any value produced by treating this node as an executable expression is used by the program;
        This mainly helps us track which operations to use during code generation (e.g. set_local versus tee_local)
          and when it's necessary to drop values from the stack.

  It returns the runType of the node (treated as an expression), for convenience.
*/
export function validate (node, valueRequired) {
  let {ASType, token, children, scope, parent, runType} = node;

  switch (ASType) {
    
    case ADD:
    case SUB:
    case SCALE_OP:
    case BITWISE_AND:
    case BITWISE_OR:
    case BITWISE_SHIFT:
    case BITWISE_XOR:
    case MISC_INFIX:
    case EQ_COMPARISON:
    case ORDER_COMPARISON: {
      let [left, right] = children;
      let leftType = validate(left, true);
      let rightType = validate(right, true);
      let opInfo = operatorTable[token.text][`${leftType},${rightType}`];

      if (left.alwaysEscapes) {
        throw new CompileError("Unreachable Code", {node: left, unreachable: node});
      } else if (right.alwaysEscapes) {
        throw new CompileError("Unreachable Code", {node: right, unreachable: node});
      } else if (opInfo === undefined) {
        throw new CompileError("Undefined Operator", {node});
      }
    
      node.meta = opInfo;
      runType = opInfo.returnType;
    } break;
    

    case ALLOCATE_PAGES:
    case UNARY_MATH_OP: {
      let child = children[0];
      let opInfo = operatorTable[token.text][validate(child, true)];

      if (child.alwaysEscapes) {
        throw new CompileError("Unreachable Code", {node: child, unreachable: node});
      } else if (opInfo === undefined) {
        throw new CompileError("Undefined Operator", {node});
      }
    
      node.meta = opInfo;
      runType = opInfo.returnType;
    } break;

    
    case AND: {
      let [left, right] = children;
      runType = validate(left, true);

      if (left.alwaysEscapes) {
        throw new CompileError("Unreachable Code", {node: left, unreachable: node});
      } else if (validate(right, true) !== runType) {
        throw new CompileError("Inconsistent Type For Boolean", {node, leftType: runType, rightType: right.runType});
      } else if (runType === "void") {
        throw new CompileError("Non-Numeric Type For Boolean", {node, runType});
      }
    } break;


    case ASSIGN: {
      let [left, right] = children;
      let leftType = left.meta.runType;

      if (left.ASType === MEMORY_ACCESS) {
        validate(left, valueRequired);
        leftType = left.meta.returnType;  // We need .returnType instead of .runType here, because left is a pointer.
        if (valueRequired) {
          // Efficiently teeing the value from a memory store requires an anonymous variable - see /compiler/functionCodeGen.js.
          node.meta = {tempVariable: anonymousLocalVariable(node, leftType)};
        }
      } else if (left.ASType !== DEFINITION && !left.meta.mutable) {
        // Initial assignment to an immutable is OK, so DEFINITION passes the check above, but we bounce other references out.
        throw new CompileError("Assignment To Immutable", {node});
      }

      validate(right, true);
      if (right.alwaysEscapes) {
        throw new CompileError("Unreachable Code", {node: right, unreachable: node});
      } if (right.runType !== leftType) {
        throw new CompileError("Assignment Type Mismatch", {left: left.ASType === DEFINITION ? left.children[0] : left, right, runType: leftType});
      }
      
      runType = leftType;
    } break;
    

    case BLOCK:
    case PAREN: {
      if (children.length > 0) {
        let lastIndex = children.length - 1;
        for (let i = 0; i < lastIndex; i++) { // Every child but the last is validated here.
          let child = children[i];
          validate(child, false);
          if (child.alwaysEscapes) {
            throw new CompileError("Unreachable Code", {child, unreachable: children[i + 1]});
          } else if (child.runType !== "void") {
            child.dropValue = true;
          }
        }

        // Validate the last child and store runType and other information.
        let lastChild = children[lastIndex];
        let lastChildType = validate(lastChild, valueRequired);
        node.alwaysEscapes = lastChild.alwaysEscapes;
        if (valueRequired) {
          runType = lastChildType;
        } else if (lastChildType !== "void") {
          lastChild.dropValue = true;
        }
      }
    } break;


    case BREAK:
    case YIELD: {
      let loop = findAncestorOfType(node, LOOP);
      if (loop === null) { // Make sure we're inside of a loop.
        throw new CompileError("Misplaced Break/Yield/Continue", {node});
      }
      
      loop.meta.yieldPoints.push(node);
      node.meta = {jumpTarget: loop}; // Technically, we jump to a block containing the loop, but code generation will take care of that.
      node.alwaysEscapes = true;
      
      if (children.length === 1) {  // YIELD will have a child, BREAK won't.
        let child = children[0];
        runType = validate(child, true);
        if (child.alwaysEscapes) {
          throw new CompileError("Unreachable Code", {node: child, unreachable: node});
        }
      }
    } break;


    case CALL: {
      let fn = node.meta;
      let args = children[0].children;

      if (args.length !== fn.paramTypes.length) {
        throw new CompileError("Wrong Number of Arguments", {node, args});
      }

      // Here we validate argument runTypes against the function signature.
      for (let i = 0; i < args.length; i++) {
        let paramType = fn.paramTypes[i];
        let arg = args[i];
        validate(arg, true);
        if (arg.alwaysEscapes) {
          // On the off chance one of the arguments is a block expression that always returns, we need to catch it.
          throw new CompileError("Unreachable Code", {node: arg, unreachable: node});
        } else if (arg.runType !== paramType) {
          throw new CompileError("Function Signature Mismatch", {node, arg, expectedType: paramType});
        }        
      }

      runType = fn.returnType;
    } break;
    
    
    case CONTINUE: {
      let loop = findAncestorOfType(node, LOOP);
      if (loop === null) { // Make sure we're inside of a loop.
        throw new CompileError("Misplaced Break/Yield/Continue", {node});
      }
      node.meta = {jumpTarget: loop};
      node.alwaysEscapes = true;
    } break;


    case DEFAULT_MEMORY:
    case DEFAULT_TABLE: {
      let {initialSize, maxSize} = node.meta;

      validate(initialSize, true);
      
      if (maxSize.ASType !== VOID) {
        validate(maxSize, true);
        if (maxSize.meta.value < initialSize.meta.value) {
          throw new CompileError("Unintelligible Size", {initialSize, maxSize});
        }
      }
    } break;


    case DEFINITION: {
      let spec = children[1];
      validate(spec, false);
      runType = node.meta.runType;
    } break;


    case ELSE: {
      let [{children: [condition, ifBody]}, elseBody] = children;
      
      validate(condition, true);
      if (condition.alwaysEscapes) {
        throw new CompileError("Unreachable Code", {node: condition, unreachable: node});
      } else if (condition.runType === "void") {
        // We can coerce any numeric runType into something that works as a condition for the "if", but otherwise we're in trouble.
        throw new CompileError("Bad Condition", {node: condition});
      }

      runType = validate(ifBody, valueRequired);
      let elseType = validate(elseBody, valueRequired);

      // We have to decide on a runType for the entire if/else expression, and note whether it always bounces out of the current block.
      // If both the if and else blocks branches non-locally, so does the entire expression (and it gets the branch-y runType).
      // If only one of those blocks branches non-locally, if/else expression gets the runType of whichever doesn't.
      // If neither of the if/else blocks branch non-locally, we have to check to make sure they both have the same runType.
      if (ifBody.alwaysEscapes) {
        if (elseBody.alwaysEscapes) {
          node.alwaysEscapes = true;
        } else {
          runType = elseType;
        }
      } else if (runType !== elseType) {
        throw new CompileError("Inconsistent Type", {ifNode: children[0], elseNode: node, ifType: runType, elseType});
      }
    } break;


    case EXPORT: {
      // We populate the global scope's list of exports here.
      // This is done during validation because we had to wait for name resolution to be complete before doing it.
      let child = children[0];
      let name;
      let definition;

      if (child.ASType === AS) {  // If we're re-naming the export with AS, we need to descend into that to get the reference/name.
        name = child.children[1].token.text.slice(1, -1); // Remove quotes around the name.
        child = child.children[0];
        if (child.ASType === EXPORT_TYPE) {
          definition = child.token.text === "default_table" ? scope.defaultTable[0] : scope.defaultMemory[0];
          if (definition === null) {
            throw new CompileError("Non-Existent Export", {node: child});
          }
        } else {
          definition = child.meta;
        }
      } else {  // Otherwise, we already have the reference and we can just take the name from that.
        name = child.token.text;
        definition = child.meta;
      }
      
      if (definition.mutable) {
        throw new CompileError("Mutable Export", {node}); // Exporting mutable globals is not allowed in the WebAssembly MVP.
      }

      definition.exportName = name;
      scope.exports.push(definition);
    } break;


    case F32_LITERAL: {
      runType = "f32";
      // TODO: What happens if we get an "x32" and we try to encode a number that can only be represented as a 64 bit float?
      //  The encoder uses DataView.setFloat32 under the covers - investigate how that works.
      node.meta = {value: parseFloat(token.text.replace("x32", "")), runType};
    } break;


    case F64_LITERAL: {
      runType = "f64";
      node.meta = {value: parseFloat(token.text.slice(0, -3)), runType};
    } break;


    case FN: {
      // The only thing we need to check here is whether the body actually returns something of the declared return type.
      let returnType = validate(node.meta.body, node.meta.returnType !== "void");
      if (returnType !== node.meta.returnType && !node.meta.body.alwaysEscapes) {
        throw new CompileError("Implicit Return Type Mismatch", {node});
      }
    } break;


    case FN_PTR: {
      if (scope.defaultTable.length !== 1) {
        throw new CompileError("No Table Defined For Function Pointer", {node});
      }
    } break;


    case I32_LITERAL: {
      // Extract the actual value of the literal here, and throw an error if it's outside of the 32-bit range.
      let value = parseInt(token.text.replace("x32", ""), 10);  // Remove any unnecessary "x32" suffixes.
      
      // The literals here always yield a positive value.
      // But in-place they may be negated (i.e. if the parent node is a negative symbol),
      //  in which case, we use the lower bound for a signed 32-bit integer
      // Otherwise, we just check if they're below the unsigned 32-bit limite.
      let negative = parent.ASType === NEG;
      if (value > (negative ? 2147483648 : 4294967295)) {
        throw new CompileError("Integer Literal Out of Range", {node, bits: 32});
      }

      runType = "i32";
      node.meta = {value, runType};
    } break;


    case I64_LITERAL: {
      let value = parseInt(token.text.slice(0, -3), 10);  // Remove the "x64" suffix.
      let negative = parent.ASType === NEG;
       
      // Javascript represents all numbers using 64-bit floats.
      // Long story short, this means that only integers that can fit in the 53 bit coefficient of a 64-bit float can be safely represented.
      // We could get around this limitation by writing our own numeric literal parser/encoder, or allowing other representations...
      //  ...but we don't.

      if (!Number.isSafeInteger(negative ? -value : value)) {
        throw new CompileError("Integer Literal Out of Range", {node, bits: 64});
      }

      runType = "i64";
      node.meta = {value, runType};
    } break;


    case IF: {
      // We only get here if this is a bare "if" (not part of an if/else) which can only have type "void", so we don't assign a runType,
      //  and the body is required to not produce a value.
      let [condition, body] = children;

      validate(condition, true);
      if (condition.alwaysEscapes) {
        throw new CompileError("Unreachable Code", {node: condition, unreachable: node});
      } else if (condition.runType === "void") {
        // We can coerce any numeric runType into something that works as a condition for the "if", but otherwise we're in trouble.
        throw new CompileError("Bad Condition", {node: condition});
      }

      validate(body, false);  // The body will take care of dropping values from the stack.
    } break;


    case IMPORT: {
      let [spec, ignoreFrom, importSource] = children;
      let sources = importSourceSplitter.exec(importSource.token.text);
      if (sources === null) {
        throw new CompileError("Bad Import Source", {node: importSource});
      }
      sources.shift(); // Remove the first item - we're interested in the two sub-matches.
      spec.meta.importSource = sources;

      // We have to check the ranges of integers used in memory/table declarations.
      if (spec.ASType === DEFAULT_TABLE || spec.ASType === DEFAULT_MEMORY) {
        validate(children[0], true);
      }
    } break;


    case INIT_EXPR: {
      let [left, right] = children;
      left.meta.initializer = right;

      if (validate(right, true) !== left.meta.runType) {
        throw new CompileError("Assignment Type Mismatch", {left, right, runType: left.meta.runType});
      } else if (right.ASType === VARIABLE && (right.meta.imported || right.meta.mutable)) {
        // Initializers for global variables can only refer to literals or imported immutable globals.
        throw new CompileError("Bad Initializer", {node: right});
      }
    } break;

    
    case LOOP: {
      let yieldPoints = [];
      let returnPoints = [];
      node.meta = {yieldPoints, returnPoints, depth: 0};

      validate(children[0], false); // valueRequired is false here, because loops only return a value through explicit yields.

      if (yieldPoints.length === 0) {
        // This loop doesn't yield (or break), so if it doesn't return either, it has no exit condtion.
        if (returnPoints.length === 0) {
          throw new CompileError("Infinite Loop", {node});
        }
        // If we get here, there's a theoretical exit condition (in the form of a return), so the loop always returns from the function
        //  (unless it continues forever).
        node.alwaysEscapes = true;
        runType = returnPoints[0].runType; // This is the returnType of the function.
      } else {
        // If there's a yield point, the loop might yield a value (or void).
        //  That determines its runType and we also need to make sure the yielded type is consistent.
        runType = yieldPoints[0].runType;
        for (let i = 1; i < yieldPoints.length; i++) {
          if (yieldPoints[i].runType !== runType) {
            throw new CompileError("Inconsistent Type For Loop", {first: yieldPoints[0], second: yieldPoints[i]});
          }
        }
      }
    } break;


    case MEMORY_ACCESS: {
      let [address, offsetProvided] = children[0].children;
      runType = node.meta.returnType;

      validate(address, true);
      if (address.alwaysEscapes) {
        throw new CompileError("Unreachable Code", {node: address, unreachable: node});
      } else if (address.runType !== "i32") {
        throw new CompileError("32-bit Address Required", {node: address});
      }

      if (offsetProvided !== undefined) {
        validate(offsetProvided, true);  // Trigger integer literal parsing.
      }
    } break;


    case NEG: {
      runType = validate(children[0], true);
    } break;


    case OR: {
      let [left, right] = children;
      runType = validate(left, true);

      if (left.alwaysEscapes) {
        throw new CompileError("Unreachable Code", {node: left, unreachable: node});
      } if (validate(right, true) !== runType) {
        throw new CompileError("Inconsistent Type For Boolean", {node, leftType, rightType});
      } else if (runType === "void") {
        throw new CompileError("Non-Numeric Type For Boolean", {node, runType});
      }

      // Code generation requires that we add an anonymous local variable here.
      node.meta = {tempVariable: anonymousLocalVariable(node, runType)};
    } break;


    case PAGES_ALLOCATED: {
      runType = "i32";
    } break;


    case PTR: {
      if (scope.defaultMemory.length !== 1) {
        throw new CompileError("No Memory Defined For Pointer", {node});
      }
    } break;


    case RETURN: {
      if (children.length === 1) {  // Return values are optional.
        let child = children[0];
        runType = validate(child, true);
        if (child.alwaysEscapes) {
          throw new CompileError("Unreachable Code", {node: child, unreachable: node});
        }
      }
      
      // Ascend to the containing function, and note any loops escaped along the way.
      for (var ancestor = node.parent; ancestor.ASType !== FN; ancestor = ancestor.parent) {
        if (ancestor.ASType === LOOP) {
          ancestor.meta.returnPoints.push(node);
        }
      }

      if (ancestor.meta.returnType !== runType) {
        throw new CompileError("Explicit Return Type Mismatch", {node, definition: ancestor.meta, runType});
      }

      node.alwaysEscapes = true;
    } break;
    

    case ROOT: {
      for (let child of children) {
        validate(child, false);
      }
    } break;


    case SUFFIX_OP: {
      runType = validate(children[0], true);
    } break;


    case VARIABLE: {
      runType = node.meta.runType;
    } break;

  } // End of huge switch statement
  
  node.runType = runType;
  return runType;
}


/*
  Utility Functions & Constants
*/


const importSourceSplitter = /^"((?:[^"\\/]|\\.)*)\/((?:[^"\\/]|\\.)*)"$/;  // This is used by the IMPORT case above.


/*
  This adds an anonymous local variable to a function scope, for when temporary storage is required during code generation.
*/
function anonymousLocalVariable (node, runType) {
  let fnScope = findAncestorOfType(node, FN).scope;
  let name = `tmp-${runType}`;  // "-" is not an allowed character in WebBS variable names, so this isn't a regular local variable.
  let definition = fnScope.names[name];  
  if (definition === undefined) {
    definition = fnScope.names[name] = {
      ASType: VARIABLE,
      exportName: null,
      isGlobal: false,
      importSource: null,
      index: 0, // The actual positions in index space are set during code generation.
      initializer: null,
      kind: "global", // Ignore this, it's only used for exports.
      mutable: true,
      name,
      runType,
      scope: fnScope,
      token: node.token // Welp, hopefully we don't need to reference this variable by token.
    };

    // We need to add this to the function's list of local variables, so it gets included during code generation.
    fnScope.variables.push(definition);
    // But we don't have to add it to fnScope.definitions, since that's only used during name resolution (which has already happened).
  }
  return definition;
}


/*
  This walks up the AST starting with a given node, looking for an ancestor with a given ASType.
*/
function findAncestorOfType (initialNode, ASType) {
  for (let node = initialNode.parent; node !== null; node = node.parent) {
    if (node.ASType === ASType) {
      return node;
    }
  }

  return null;
}
