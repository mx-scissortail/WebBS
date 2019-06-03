/*
  This file contains the generate function, which is used for generating the WebAssembly bytecode for function bodies.

  It's useful to separate the function code generation code out into it its own file, as it tends to change more often than the module code
    generation stuff in /compiler/moduleCodeGen.js or the basic bytecode emitting tools in /compiler/byteCode.js.
  Those are mostly determined by the structure of the WebAssembly bytecode module format, whereas the function body code generation is
    determined by the structure and features of the WebBS language.
*/
import { /* ALL_ASTYPES */ ADD, ADDRESS, ADDRESS_CLOSE, ALLOCATE_PAGES, AND, ARG_LIST, AS, ASSIGN, BAD_TOKEN, BITWISE_AND, BITWISE_OR, BITWISE_SHIFT, BITWISE_XOR, BLOCK, BLOCK_CLOSE, BREAK, CALL, COMMA, COMMENT, CONTINUE, DECLARATION, DEFAULT_MEMORY, DEFAULT_TABLE, DEFINITION, ELSE, END_OF_INPUT, EQ_COMPARISON, EXPORT, EXPORT_TYPE, F32_LITERAL, F64_LITERAL, FN, FN_PTR, FN_SIGNATURE, FROM, I32_LITERAL, I64_LITERAL, IF, IMMUTABLE, IMPORT, INIT_EXPR, LOOP, MEMORY_ACCESS, MISC_INFIX, NEG, OR, ORDER_COMPARISON, PAGES_ALLOCATED, PARAM_LIST, PAREN, PAREN_CLOSE, PASS, PTR, RETURN, ROOT, SCALE_OP, SEMICOLON, STRING, STORAGE_TYPE, SUB, SUFFIX_OP, TYPE_LIST, UNARY_MATH_OP, VALUE_TYPE, VARIABLE, VOID, WS, YIELD /* END_ALL_ASTYPES */ } from "./syntax.js";


/*
  This takes a ByteCodeContainer and a WebBS AST node, emits executable bytecode and returns the ByteCodeContainer.
*/
export function generate (bytecode, node, depth) {
  let {ASType, children, parent, runType, dropValue} = node; // Extract commonly used AST node properties for convenience.
  
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
    case ORDER_COMPARISON:
    case UNARY_MATH_OP: {
      bytecode
        .generateEach(children, depth)
        .op(node.meta.operator);
    } break;


    case ALLOCATE_PAGES: {
      bytecode
        .generate(children[0], depth)
        .op("grow_memory").varuint(0, "reserved");
    } break;


    case AND: {
      let [left, right] = children;

      // Note that we can't use WebAssembly's "select" operator here because it doesn't short-circuit.
      bytecode.generate(left, depth);
      if (runType === "i32" || runType === "i64") {
        bytecode.op(`${runType}.eqz`);
      } else {  // There's no eqz for floats, for some reason, so we have to manually create one.
        bytecode
          .op(`${runType}.const`).literal(runType, 0, "value")
          .op(`${runType}.eq`);
      }
      bytecode
        .op("if").byte(runType, "block_type")
          .op(`${runType}.const`).literal(runType, 0, "value")
        .op("else")
          .generate(right, depth + 1)
        .op("end");
    } break;


    case ASSIGN: {
      let [left, right] = children;
      
      if (left.ASType !== MEMORY_ACCESS) {
        bytecode
          .generate(right, depth)
          .setVariable(left.meta.index, left.meta.isGlobal, !dropValue);

      } else {  // left.ASType === MEMORY_ACCESS
        let {index, isGlobal, storageSize, returnType, extendedType, storageBits} = left.meta;
        let [address, offsetProvided] = left.children[0].children;
        let offset = offsetProvided === undefined ? 0 : offsetProvided.meta.value;

        for (var alignment = Math.log2(storageSize); offset % (2**alignment) !== 0; alignment--); // Calculate the alignment.
        
        bytecode
          .generate(address, depth)
          .getVariable(index, isGlobal)
          .op("i32.add")
          .op("i32.const").varuint(storageSize, "value")
          .op("i32.mul")
          .generate(right, depth);

        let storageOp = `${returnType}.store${extendedType ? storageBits : ""}`;
        if (dropValue) { // We don't need to put a value on the stack, so we just store and move on.
          bytecode.op(storageOp).varuint(alignment, "flags").varuint(offset, "offset");
        } else {  // We're expected to keep the value we just calculated on the stack.
          bytecode
            .op("tee_local").varuint(node.meta.tempVariable.index, "local_index")
            .op(storageOp).varuint(alignment, "flags").varuint(offset, "offset")
            .op("get_local").varuint(node.meta.tempVariable.index, "local_index");
        }
      }

      dropValue = false;
    } break;


    case BLOCK:
    case PAREN: {
      let parentType = parent.ASType;
      if (children.length === 1) {  // As a minor optimization, we unwrap any single expression wrapped in a block/paren.
        bytecode.generate(children[0], depth);
      } else if (parentType === ELSE || parentType === IF || parentType === FN || parentType === LOOP) {
        // Some control structures already define implicit blocks, so we unwrap any unnecessary blocks as immediate children.
        bytecode.generateEach(children, depth);
      } else {
        bytecode
          .op("block").byte(runType, "block_type")
            .generateEach(children, depth + 1)
          .op("end");
      }
    } break;


    case BREAK:
    case YIELD: {
      bytecode
        .generateEach(children, depth)  // This is a no-op for BREAK, which won't have any children.
        .op("br").varuint(depth - node.meta.jumpTarget.meta.depth, "relative_depth");
      dropValue = false;  // Don't generate an unreachable drop instruction, no matter what the validation stage says.
    } break;


    case CALL: {
      bytecode.generateEach(children[0].children, depth);
      if (node.meta.ASType === FN_PTR) {
        bytecode
          .getVariable(node.meta.index, node.meta.isGlobal)
          .op("call_indirect").varuint(node.meta.signatureIndex, "type_index").varuint(0, "reserved");
      } else {
        bytecode.op("call").varuint(node.meta.index, "function_index");
      }
    } break;

    
    case CONTINUE: {
      // Subtracting 1 from the jumpTarget depth hits the inner loop instead of the outer block, so the loop iterates rather than breaks.
      bytecode.op("br").varuint(depth - node.meta.jumpTarget.meta.depth - 1, "relative_depth");
    } break;


    case DEFINITION:
    case VARIABLE: {
      if (dropValue) return bytecode; // If we're not going to use a variable, why bother putting it on the stack?
      bytecode.getVariable(node.meta.index, node.meta.isGlobal);
    } break;

    
    case ELSE: {
      let [{children: [condition, passBody]}, failBody] = children;

      bytecode.generate(condition, depth);  // During validation, we established that this returns some kind of numeric type...
      if (condition.runType !== "i32") {  // If it's not an i32 (required by "if"), we implicitly cast it to one by comparing it to 0.
        bytecode
          .op(`${condition.runType}.const`).literal(condition.runType, 0, "value")
          .op(`${condition.runType}.ne`);
      }
      bytecode
        .op("if").byte(runType, "block_type")
          .generate(passBody, depth + 1)
        .op("else")
          .generate(failBody, depth + 1)
        .op("end");
    } break;


    case F32_LITERAL:
    case F64_LITERAL:
    case I32_LITERAL:
    case I64_LITERAL: {
      runType = node.meta.runType;
      bytecode.op(`${runType}.const`).literal(runType, node.meta.value, "value");
    } break;


    case IF: {
      let [condition, body] = children;

      bytecode.generate(condition, depth); // During validation, we established that this returns some kind of numeric type...
      if (condition.runType !== "i32") {  // If it's not an i32 (required by "if"), we implicitly cast it to one by comparing it to 0.
        bytecode
          .op(`${condition.runType}.const`).literal(condition.runType, 0, "value")
          .op(`${condition.runType}.ne`);
      }
      bytecode
        .op("if").byte("void", "block_type")  // All bare IFs have runType void.
          .generate(body, depth + 1)
        .op("end");
    } break;


    case LOOP: {
      // Loops have a container block and a loop block.
      // To continue the loop, branch to the loop's relative depth. To break out of the loop, branch to the container's depth.
      node.meta.depth = depth + 1;  // This is the container depth.
      bytecode
        .op("block").byte(node.runType, "block_type")
          .op("loop").byte(node.runType, "block_type")
            .generate(children[0], depth + 2)
            .op("br").varuint(0, "relative_depth")  // Branch to loop depth to continue if we get here.
          .op("end")
        .op("end");
    } break;


    case MEMORY_ACCESS: {
      let {index, isGlobal, storageSize, runType, extendedType, storageSigned, storageBits} = node.meta;
      let [address, offsetProvided] = children[0].children;
      let offset = offsetProvided === undefined ? 0 : offsetProvided.meta.value;
      
      for (var alignment = Math.log2(storageSize); offset % (2**alignment) !== 0; alignment--); // Calculate the alignment.
      
      let loadOp = `${runType}.load`;
      if (extendedType) {
        loadOp += `${storageBits}_${storageSigned}`;
      }

      bytecode
        .generate(address, depth)
        .getVariable(index, isGlobal)
        .op("i32.add")
        .op("i32.const").varuint(storageSize, "value")
        .op("i32.mul")
        .op(loadOp).varuint(alignment, "flags").varuint(offset, "offset");
    } break;


    case NEG: {
      // TODO: Enable NEG for non-literal expressions.
      bytecode.op(`${runType}.const`).literal(runType, -children[0].meta.value, "value");
    } break;


    case OR: {
      let [left, right] = children;

      // Since we can't duplicate values off the stack in WebAssembly, we have to temporarily store the left-hand value somewhere.
      // We use a temporary local variable defined in the validation stage.
      bytecode
        .generate(left, depth)
        .op("tee_local").varuint(node.meta.tempVariable.index, "local_index")
        .op("if").byte(runType, "block_type")
          .op("get_local").varuint(node.meta.tempVariable.index, "local_index")
        .op("else")
          .generate(right, depth + 1)
        .op("end");
    } break;


    case PAGES_ALLOCATED: {
      bytecode.op("current_memory").varuint(0, "reserved");
    } break;

    
    case PASS: {
      bytecode.op("nop");
    } break;


    case RETURN: {
      if (children.length === 1) {  // RETURN nodes may or may not have a single child that needs to be put on the stack.
        bytecode.generate(children[0], depth);
      }
      bytecode.op("return");
      dropValue = false;  // Don't generate an unreachable drop instruction, no matter what the validation stage says.
    } break;
    

    case SUFFIX_OP: {
      let child = children[0];
      let index = child.meta.index;
      let isGlobal = child.meta.isGlobal;

      if (!dropValue) {
        bytecode.getVariable(index, isGlobal);
      }

      bytecode
        .getVariable(index, isGlobal)
        .op(`${child.runType}.const`).literal(child.runType, 1, "value")
        .op(`${child.runType}.${node.token.text === "++" ? "add" : "sub"}`)
        .setVariable(index, isGlobal, false);
    
      dropValue = false;
    } break;

  } // The huge switch ends here.

  // If we've marked this node as pushing a value on to the stack when one isn't expected, we need to drop that value.
  if (dropValue) {
    bytecode.op("drop");
  }

  return bytecode;
}
