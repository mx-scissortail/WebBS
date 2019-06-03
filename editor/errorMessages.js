/*
  This file exports generateErrorMessage(), which creates a human-readable representation of errors thrown by the compiler.
  
  This is factored out from the compiler code, because the form of error messages is a presentational issue.
    The compiler throws CompileError objects, which contain just enough information to generate a more useful message here.
    These functions format errors using HTML markup for the editor to display, which the compiler shouldn't need to know anything about.

  The functions in this file make heavy use of tagged template literals to create a kind of template language for generating error messages
    that are annotated with references into the code.
  (See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#Tagged_templates if you're not familiar with
    tagged templates.)
  
  The utility functions that define the tagged template literal format used here are at the bottom of the file.

  TODO: Using string names for error message types is a bad idea (typos cause problems, etc.) - this should be refactored.
*/
import { /* ALL_ASTYPES */ ADD, ADDRESS, ADDRESS_CLOSE, ALLOCATE_PAGES, AND, ARG_LIST, AS, ASSIGN, BAD_TOKEN, BITWISE_AND, BITWISE_OR, BITWISE_SHIFT, BITWISE_XOR, BLOCK, BLOCK_CLOSE, BREAK, CALL, COMMA, COMMENT, CONTINUE, DECLARATION, DEFAULT_MEMORY, DEFAULT_TABLE, DEFINITION, ELSE, END_OF_INPUT, EQ_COMPARISON, EXPORT, EXPORT_TYPE, F32_LITERAL, F64_LITERAL, FN, FN_PTR, FN_SIGNATURE, FROM, I32_LITERAL, I64_LITERAL, IF, IMMUTABLE, IMPORT, INIT_EXPR, LOOP, MEMORY_ACCESS, MISC_INFIX, NEG, OR, ORDER_COMPARISON, PAGES_ALLOCATED, PARAM_LIST, PAREN, PAREN_CLOSE, PASS, PTR, RETURN, ROOT, SCALE_OP, SEMICOLON, STRING, STORAGE_TYPE, SUB, SUFFIX_OP, TYPE_LIST, UNARY_MATH_OP, VALUE_TYPE, VARIABLE, VOID, WS, YIELD /* END_ALL_ASTYPES */ } from "/compiler/syntax.js";
import {CompileError} from "../compiler/compileError.js";
import {lexify} from "../compiler/lexer.js";


/*
  This returns a formatted error message that the WebBS editor can display, given pretty much any kind of error.
  Mostly, we just translate CompileErrors into a human-readable format,
    but it also handles WebAssembly compile/runtime errors, and whatever else we happen to catch.
*/
export function generateErrorMessage (error) {
  if (error instanceof CompileError) {
    let {type, data} = error;
    let formattedError = {type, message: "", references: []};
    let msg = (strings, ...objects) => buildErrorFromTemplate(formattedError, strings, objects);
    // These may not end up being defined, but it's convenient to try to pull them out here, so we can avoid lots of indirection below.
    let node = data.node;
    let token = node && node.token;    
    
    switch (type) {
      case "32-bit Address Required": {
        return msg`Addresses must have type ${R("i32")}, but this${ref(token)} expression appears to have type ${R(node.runType)}.`;
      }

      case "Assignment Type Mismatch": {
        return msg`Assignment type mismatch!\n\nThe variable ${codeRef(data.left.token)} has type ${R(data.runType)}, whereas the expression at ${ref(data.right.token)} has type ${R(data.right.runType)}.`;      
      }

      case "Assignment To Immutable": {
        return msg`Can't assign to ${code(node.children[0].token)} at ${ref(token)} because ${code(node.children[0].token)} is immutable.`;
      }
      
      case "Bad Condition": {
        return msg`The value of ${codeRef(token)} is used as the condition of an ${R("if")} but its type can't be interpreted as a Boolean (all ${R("if")} conditions must have a numeric type).`;
      }
      
      case "Bad Import Source": {
        return msg`Import sources need to have the form ${R("\"MODULE/FIELD\"")}. I don't know what to make of ${codeRef(token)}.`;
      }

      case "Bad Initializer": {
        return msg`In the WebAssembly MVP, global variables can only be initialized with numeric literals or references to immutable imported variables.\n\n${codeRef(token)} is not an immutable imported variable.`;
      }

      case "Bad Placement for Function Definition": {
        return msg`Can't define a function here${ref(token)} - try moving the definition to the global scope.`;
      }

      case "Bad Reference: Not a Function": {
        return msg`Expected a function, got ${codeRef(token)} which is a ${typeDescriptor(node)}.`;
      }

      case "Bad Reference: Not a Pointer": {
        return msg`Expected a pointer, got ${codeRef(token)} which is a ${typeDescriptor(node)}.`;
      }

      case "Bad Reference: Not a Variable": {
        return msg`Expected a variable with a value type (i.e. ${R("i32")}/${R("i64")}/${R("f32")}/${R("f64")}); got ${codeRef(token)} which is a ${typeDescriptor(node)}.`;
      }

      case "Duplicate Default Memory Definition": {
        return msg`The default memory store is defined twice: see ${ref(data.first.token)} and ${ref(data.second.token)}.`;
      }

      case "Duplicate Default Table Definition": {
        return msg`The default function table is defined twice: see ${ref(data.first.token)} and ${ref(data.second.token)}.`;
      }

      case "Duplicate Definition": {
        return msg`${code(data.first.token)} is defined twice: see ${ref(data.first.token)} and ${ref(data.second.token)}.`;
      }

      case "Explicit Return Type Mismatch": {
        return msg`The function ${codeRef(data.definition.token)} has return type ${R(data.definition.returnType)}, but the expression returned at ${ref(token)} has type ${R(data.runType)}.`
      }

      case "Function Signature Mismatch": {
        return msg`Wrong argument type for call to ${code(token)} at ${ref(data.arg.token)}: expected a value of type ${R(data.expectedType)}; got ${R(data.arg.runType)}.`;
      }

      case "Implicit Return Type Mismatch": {
        return msg`The function ${codeRef(token)} fails to return a value of type ${R(node.meta.returnType)}.`;
      }

      case "Inconsistent Type": {
        return msg`The type of the value produced by this ${R("if")}/${R("else")} expression is inconsistent.\n\nThe ${codeRef(data.ifNode.token)} body has type ${R(data.ifType)}, whereas the ${codeRef(data.elseNode.token)} body has type ${R(data.elseType)}.`;
      }

      case "Inconsistent Type For Boolean": {
        return msg`The type of the value produced by this ${codeRef(token)} expression is inconsistent.\n\nThe left expression has type ${R(data.leftType)}, whereas the right expression has type ${R(data.rightType)}.`;
      }

      case "Inconsistent Type For Loop": {
        return msg`The type of the value produced by this ${codeRef(token)} is inconsistent.\n\nSee here${ref(data.first.token)} and here${ref(data.second.token)}, which yield values of type ${ref(data.first.runType)} and ${ref(data.second.runType)} respectively.`;
      }

      case "Infinite Loop": {
        return msg`This ${codeRef(token)} contains no ${R("break")}, ${R("yield")} or ${R("return")} statements, and will therefore never terminate.`;
      }

      case "Integer Literal Out of Range": {
        if (data.bits === 32) {
          return msg`The integer literal ${codeRef(token)} is out of the range that can be encoded as an ${R("i32")}.`;
        } else {
          return msg`The integer literal ${codeRef(token)} is out of the range that can be safely encoded by this compiler.\n\nDue to JavaScript limitations, only integers in the range ${Number.MIN_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER} can be encoded at this time.`;
        }
      }

      case "Integer Out of Range in Code Generation": {
        return msg`Something you've done has caused the compiler to try to emit a numeric index that exceeds the 32-bit limit. I can't imagine how this error would ever actually be triggered, so thank you for reading the source code.`;
      }

      case "Misplaced Break/Yield/Continue": {
        return msg`This ${codeRef(token)} appears outside of a ${R("loop")}.`;
      }

      case "Misplaced Terminator or Unfinished Expression": {
        if (node.ASType.expectedChildCount === Infinity) {
          if (node.ASType === ROOT) {
            return msg`What's this ${codeRef(data.token)} doing here?`;
          } else {
            return msg`What's this ${codeRef(data.token)} doing here? Maybe you forgot to close this ${codeRef(token)}?`;
          }
        } else {
          // TODO: We should probably print the expected format here.
          return msg`It looks like ${ref(token)} expression ended prematurely here ${ref(data.token)}.`;
        }
      }

      case "Mutable Export": {
        return msg`Can't export ${codeRef(token)}; all exported globals must be immutable in the WebAssembly MVP.`;
      }

      case "Mysterious Symbol": {
        return msg`I don't know what this${ref(data.token)} is, and I don't like it.`;
      }

      case "No Memory Defined For Pointer": {
        return msg`Can't define a ${codeRef(token)} because no default memory store is defined.`;
      }

      case "No Table Defined For Function Pointer": {
        return msg`Can't define a ${codeRef(token)} because no default table is defined.`;
      }

      case "Non-Existent Export": {
        return msg`You tried to export something here${ref(token)} (either a table or memory store) that was never defined.`;
      }

      case "Non-Numeric Type For Boolean": {
        return msg`${codeRef(token)} expressions must operate on numeric values (so they can be interpreted as Booleans), but the sub-expressions here appear to have type ${R(data.runType)}.`;
      }

      case "Undefined Operator": {
        return diagnoseOperatorError(msg, node); 
      }

      case "Unintelligible Size": {
        return msg`The initial size specified here${ref(data.initialSize.token)} is larger than the maximum size specified here${ref(data.maxSize.token)}.\nUse ${R("void")} if you don't want to set a maximum size.`;
      }

      case "Unintelligible Syntax (Child Type Constraint Violation)": {
        return diagnoseCTCError(msg, data);
      }

      case "Unintelligible Syntax (Parent Type Constraint Violation)": {
        return diagnosePTCError(msg, data);
      }

      case "Unfinished Expression": {
        // TODO: Write a better message here?
        return msg`Expected a complete expression to the left of ${codeRef(data.token)}. Something appears to be missing.`;
      }

      case "Unreachable Code": {
        // TODO: Write a better message here?
        return msg`Execution is guaranteed to never return to the code that seems to depend on this${ref(token)} expression.`;
      }

      case "Unresolvable Reference": {
        return msg`Can't find a definition for ${codeRef(token)}.`;
      }

      case "Wrong Number Of Arguments": {
        // TODO: This should probably list the expected arguments.
        return msg`Wrong number of arguments for call to ${codeRef(token)}: expected ${node.meta.paramTypes.length}, got ${data.args.length}.`;
      }
    } // The huge switch statement ends here.

  } else if (error instanceof WebAssembly.RuntimeError) {
    return {
      type: "WebAssembly Runtime Error",
      message: `Your program threw a WebAssembly runtime error with the following message:\n\n  "${error.message}"\n\nThis is most likely a bug in the program.`,
      references: []
    };
  } else if (error instanceof WebAssembly.CompileError) {
    return {
      type: "WebAssembly Compile Error",
      message: `Your program threw a WebAssembly compile error with the following message:\n\n  "${error.message}"\n\nThis is most likely due to a bug in the WebBS compiler.`,
      references: []
    };
  } else if (error instanceof WebAssembly.LinkError) {
    return {
      type: "WebAssembly Link Error",
      message: `Your program threw a WebAssembly link error with the following message:\n\n  "${error.message}"\n\nThis most likely means that you've referenced an import that wasn't provided. Run "WebBSEditor.help()" in the browser console for more information about providing imports for your WebBS module.`,
      references: []
    };
  } else {
    return {
      type: "Unknown Error",
      message: `An unexpected error has occurred. This is problably a bug in WebBS.`,
      references: []
    };
  }
}


/*
  This generates an error message for operator misusages.
*/
function diagnoseOperatorError (msg, node) {
  if (node.ASType.expectedChildCount === 2) {
    let leftType = node.children[0].runType;
    let rightType = node.children[1].runType;
    if (leftType !== rightType) {
      return msg`Mismatched types for operator ${codeRef(node.token)}: the left operand has type ${R(leftType)}, whereas the right operand has type ${R(rightType)}.`;
    }
  }

  msg`The operator ${codeRef(node.token)} is only defined for the following types: \n  `;

  let acceptableTypes = operatorRunTypeConstraints[node.token.text];  
  
  for (let runType of acceptableTypes) {
    msg`${R(runType)} `;
  }

  for (let child of node.children) {
    if (!acceptableTypes.includes(child.runType)) {
      return msg`\n...but this${ref(child.token)} expression appears to have type ${R(child.runType)}.`;
    }
  }
}


/*
  This generates a custom error message for CTC violations, depending on the parent node, child node and position.
*/
function diagnoseCTCError (msg, {node, child, position}) {
  let token = node.token;

  switch (node.ASType) {
    case ADDRESS: {
      if (node.children.length === 0) {
        return msg`Missing address for pointer here${ref(token)}.`;
      } else {
        return msg`Unintelligible pointer address starting here${ref(token)}. The format is ${R("[ADDRESS]")} or ${R("[ADDRESS; OFFSET]")}, where ${R("OFFSET")} is an optional 32-bit integer literal.`;
      }
    }

    case ASSIGN: {
      return msg`The left-hand side of an assignment can only be a variable (including pointers and function pointers), a variable definition or a memory location.`;
    }

    case AS: {
      if (position === 0) {
        return msg`The ${codeRef(token)} keyword can only follow an identifier that names a variable, function, default table or memory store.`;
      } else {
        return msg`The ${codeRef(token)} keyword can only be followed by a string (to determine the name of an export).`;
      }
    }

    case DECLARATION:
    case DEFINITION: {
      if (position === 0) {
        return msg`The ${R(":")} symbol is used to define a named entity, so I expected an identifier here${ref(child.token)}.`;
      } else {
        return msg`The ${R(":")} symbol is used to define a named entity, so I expected a type (${R("i32")}, ${R("fn")}, etc.) or the ${R("immutable")} modifier here${ref(child.token)}.`;
      }
    }


    case DEFAULT_MEMORY: {
      if (position === 0) {
        return msg`Expected a 32-bit integer literal here${ref(child.token)}, to specify a minimum size for the default memory store.`;
      } else {
        return msg`Expected a 32-bit integer literal or ${R("void")} here${ref(child.token)}, to specify a maximum size for the default memory store.`;
      }
    }

    case DEFAULT_TABLE: {
      if (position === 0) {
        return msg`Expected a 32-bit integer literal here${ref(child.token)}, to specify a minimum size for the default table.`;
      } else {
        return msg`Expected a 32-bit integer literal or ${R("void")} here${ref(child.token)}, to specify a maximum size for the default table.`;
      }
    }

    case ELSE: {
      if (position === 0) {
        return msg`I can't find the ${R("if")} that this ${codeRef(token)} is supposed to be attached to.`;
      } else {
        return msg`This ${R("else")} needs either a block, another ${R("if")} or a ${R("break")}/${R("continue")} statement for a body here${ref(child.token)}.`;
      }
    }

    case EXPORT: {
      return msg`Expected an identifier here${ref(child.token)}, following the ${R("export")} keyword.`;
    }

    case FN: {
      if (position === 0) { 
        return msg`Expected a list of function parameters here${ref(child.token)}.`;
      } else if (position === 1) {
        return msg`Expected a function return type here${ref(child.token)}.`;
      } else {
        return msg`Expected a block here${ref(child.token)} to serve as the body for the preceding function definition.`;
      }
    }

    case FN_SIGNATURE: 
    case FN_PTR: {
      if (position === 0) { 
        return msg`Expected a list of function parameters types here${ref(child.token)}.`;
      } else {
        return msg`Expected a function return type here${ref(child.token)}.`;
      }
    }

    case IF: {
      if (position === 0) {
        return msg`Expected a conditional expression (try putting parentheses around the expression that starts here${ref(child.token)}).`;
      } else {
        return msg`Expected a block here${ref(child.token)} to serve as the body for the preceding ${R("if")}.`;
      }
    }

    case IMMUTABLE: {
      return msg`Expected a value type (e.g. ${R("i32")}, ${R("ptr")}) here${ref(child.token)}.`;
    }

    case IMPORT: {
      if (position === 0) {
        return msg`Expected a named entity definition here${ref(child.token)}.`;
      } else if (position === 1) {
        return msg`Expected the ${R("from")} keyword here${ref(child.token)}.`;
      } else {
        return msg`Expected an import path string (e.g. ${R('"WebBS/log"')}) here${ref(child.token)}.`;
      }
    }

    case INIT_EXPR: {
      if (position === 0) {
        return msg`Expected a variable definition to the left of this${ref(token)} global initializer expression.`;
      } else {
        return msg`Global variables can only be initialized using numeric literals or imported globals, not whatever this${ref(token)} is.`;
      }
    }

    case LOOP: {
      return msg`The preceding loop needs a block or an ${R("if")}/${R("else")} here${ref(child.token)}.`;
    }

    case NEG: {
      return msg`Expected a numeric literal here${ref(child.token)} (negating other expressions has yet to be implemented).`;
    }

    case PARAM_LIST: {
      msg`Only named parameter definitions may appear in function parameter lists`;
      if (child.ASType === VARIABLE) {
        return msg`. Did you forget the type for this${ref(child.token)} parameter?`;
      } else if (child.ASType === VALUE_TYPE) {
        return msg`. Did you forget the name for this${ref(child.token)} parameter?`;
      } else {
        return msg`, not whatever this${ref(child.token)} is.`;
      }
    }

    case ROOT: {
      return msg`Only definitions and ${R("import")}/${R("export")} statements may appear in the global scope, not whatever this${ref(child.token)} is.`;
    }
    
    case TYPE_LIST: {
      msg`Only parameter types may appear in function parameter lists`;
      if (child.ASType === DEF_VAR) {
        return msg`. Remove the name from this${ref(child.token)} definition.`;
      } else {
        return msg`, not whatever this${ref(child.token)} is.`;
      }
    }

    case PTR: {
      return msg`Expected a storage type (e.g. ${R("f32")}, ${R("i64_u32")}) here${ref(child.token)}.`;
    }

    
    case SUFFIX_OP: {
      return msg`Expected a numeric variable name immediately before ${codeRef(token)}.`;
    }
  }
}


/*
  This generates a custom error message for PTC violations, determined by the child and parent node ASTypes.
*/
function diagnosePTCError (msg, {node: {ASType, token, parent}}) {
  switch (ASType) {
    case ADDRESS: {
      return msg`This${ref(token)} should be probably be attached to some sort of pointer.`;
    }

    case AS: {
      return msg`Unexpected ${codeRef(token)} outside of an ${R("export")} statement.`;
    }

    case BREAK:
    case CONTINUE:
    case FROM:
    case RETURN:
    case YIELD: {
      return msg`I'm not sure what to make of this ${codeRef(token)}.`;
    }

    case DEFAULT_MEMORY:
    case DEFAULT_TABLE:
    case EXPORT: {
      return msg`This${ref(token)} sort of definition is only allowed at the top level global scope.`;
    }

    case FN:
    case FN_PTR: {
      return msg`This ${codeRef(token)} should probably appear on the right hand side of a definition (e.g. ${R(`foo: ${token.text} () void`)} ...).`;
    }

    case IMMUTABLE: {
      return msg`The format for immutable variable definitions looks like this:\n\n  ${R("name: immutable i32")}`;
    }

    case IMPORT: {
      return msg`Import statements like this${ref(token)} are only allowed at the top level global scope.`;
    }

    case PTR: {
      return msg`This ${codeRef(token)} should probably appear on the right hand side of a definition (e.g. ${R("foo: ptr i32")}).`;
    }

    case STRING: {
      if (parent.ASType === IMPORT) {
        return msg`Unexpected string ${codeRef(token)}. Did you forget part of the ${R("import")} statement (e.g. ${R("from")})?`;
      } else {
        return msg`Unexpected string ${codeRef(token)}. Strings are only allowed inside of ${R("import")} and ${R("export")} statements.`;
      }
    }

    case STORAGE_TYPE: {
      return msg`Storage types like this${ref(token)} are only allowed in pointer definitions.`;
    }

    case VALUE_TYPE: {
      return msg`This ${codeRef(token)} should probably be attached to some sort of definition.`;
    }

    case VOID: {
      return msg`Unexpected ${codeRef(token)}. ${R("void")} can only appear as a function return type or maximum size limit for a table or memory store.`;
    }
  
    default: {
      return `Unexpected expression: ${codeRef(token)}`;
    }
  }
}


/*
  Utilities
*/


/*
  This constructs an error message from the parts provided by the tagged template literal.
  If any of those parts are functions, they're called with the error message object.
  Otherwise, they're assumed to be strings and interpolated into the error message.
*/
function buildErrorFromTemplate (error, strings, objects) {
  for (let i = 0; i < objects.length; i++) {
    error.message += strings[i];
    let object = objects[i];
    if (typeof object === "function") {
      object(error);
    } else {
      error.message += object;
    }
  }

  error.message += strings[strings.length - 1]; // There's always one more string in the strings array than object in the objects array.
  return error;
}


/*
  This records a reference into the code and inserts the referenced token into the error message.
*/
function codeRef (token) {
  return (error) => {
    let index = error.references.length;
    error.message += `<span id="reference-${index}" class="code ref"><span class="${token.ASType.category}">${token.text}</span><span class="tag">[${index + 1}]</span></span>`;
    error.references.push(token);
  };
}


/*
  This records a reference into the code.
*/
function ref (token) {
  return (error) => {
    let index = error.references.length;
    error.message += `<span id="reference-${index}" class="code ref"><span class="tag">[${index + 1}]</span></span>`;
    error.references.push(token);
  };
}


/*
  This returns the formatted markup for a single token.
*/
function code (token) {
  return `<span class="code ${token.ASType.category}">${token.text}</span>`;
}


/*
  This returns a formatted description of a given type.
*/
function typeDescriptor (node) {
  let ASType = node.meta.ASType;
  if (ASType === FN || ASType === FN_SIGNATURE) {
    return "function";
  } else if (ASType === PTR) {
    return "pointer";
  } else if (ASType === FN_PTR) {
    return "function pointer";
  } else {
    return `variable (<span class="code type">${node.meta.runType}</span>)`;
  }
}


/*
  This lexifies a string and returns the formatted markup for the resulting tokens.
*/
function R (string) {
  return lexify(string).slice(0, -1).map(code).join("");  // Remove the END_OF_INPUT token, which will insert a newline.
}


// This is a table that lists runTypes that WebBS operators can operate on.
//  operatorRunTypeConstraints() uses this to provide a helpful list of what the given operator will and won't accept.
const operatorRunTypeConstraints = {
  "-":              ["i32", "i64", "f32", "f64"],
  "!":              ["i32", "i64"],
  "!=":             ["i32", "i64", "f32", "f64"],
  "?<":             ["f32", "f64"],
  "?>":             ["f32", "f64"],
  "*":              ["i32", "i64", "f32", "f64"],
  "/":              ["i32", "i64", "f32", "f64"],
  "&":              ["i32", "i64"],
  "%":              ["i32", "i64"],
  "+":              ["i32", "i64", "f32", "f64"],
  "<":              ["i32", "i64", "f32", "f64"],
  "<<":             ["i32", "i64"],
  "<=":             ["i32", "i64", "f32", "f64"],
  "==":             ["i32", "i64", "f32", "f64"],
  ">":              ["i32", "i64", "f32", "f64"],
  ">=":             ["i32", "i64", "f32", "f64"],
  ">>":             ["i32", "i64"],
  ">>>":            ["i32", "i64"],
  "|":              ["i32", "i64"],
  "|/|":            ["i32", "i64"],
  "|%|":            ["i32", "i64"],
  "|<=|":           ["i32", "i64"],
  "|<|":            ["i32", "i64"],
  "|>=|":           ["i32", "i64"],
  "|>|":            ["i32", "i64"],
  "abs":            ["f32", "f64"],
  "allocate_pages": ["i32"],
  "cast_f32":       ["i32"],
  "cast_f64":       ["i64"],
  "cast_i32":       ["f32"],
  "cast_i64":       ["f64"],
  "ceil":           ["f32", "f64"],
  "count_ones":     ["i32", "i64"],
  "floor":          ["f32", "f64"],
  "leading_zeros":  ["i32", "i64"],
  "rotate_left":    ["i32", "i64"],
  "rotate_right":   ["i32", "i64"],
  "round":          ["f32", "f64"],
  "sqrt":           ["f32", "f64"],
  "to_f32":         ["i32", "i64", "f64"],
  "to_f64":         ["i32", "i64", "f64"],
  "to_i32":         ["i64", "f32", "f64"],
  "to_i64":         ["i32", "f32", "f64"],
  "trailing_zeros": ["i32", "i64"],
  "truncate":       ["f32", "f64"],
  "with_sign_of":   ["f32", "f64"],
  "xor":            ["i32", "i64"]
};
