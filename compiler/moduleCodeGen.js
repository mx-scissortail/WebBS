import {ByteCodeContainer} from "/WebBS/compiler/byteCode.js";


/*
  This is the entry point for code generation.
  It takes the root node of a WebBS AST (as returned by the parse function).
  It returns a ByteCodeContainer with the (annotated) source of a WebAssembly module.
  In order to compile that into an actual WebAssembly module, you'll need to call .toByteArray() on the result (see /compiler/byteCode.js).
  
  Code generation should basically never intentially throw a CompileError;
    the only defined exception is thrown if you do something silly like define more local variables than can fit in the 32-bit index space.
*/
export function generateModule (root) {
  let module =
    new ByteCodeContainer("module")
      .WASMModuleHeader();

  orderGlobals(root.scope);

  // The order of these sections is determined by the WebAssembly module format.
  generateTypeSection(root.scope, module);
  generateImportSection(root.scope, module);
  generateFunctionSection(root.scope, module);
  generateTableSection(root.scope, module);
  generateMemorySection(root.scope, module);
  generateGlobalSection(root.scope, module);
  generateExportSection(root.scope, module);
  generateStartSection(root.scope, module);
  generateCodeSection(root.scope, module);

  return module;
}


/*
  The type section is a list of function signature types that functions (including imported functions) reference in their definitions.
*/
function generateTypeSection (source, module) {
  let section = module.section("type section");
  let count = source.functionSignatures.length;

  if (count > 0) {
    section
      .byte("section.type", "id")
      .reserveSize("payload_len")
      .varuint(count, "count");

    
    for (let [index, [returnType, ...paramTypes]] of source.functionSignatures.entries()) {
      let signature =
        section.section(`type ${index}`)
          .byte("func", "form")
          .varuint(paramTypes.length, "param_count");

      for (let param of paramTypes) {
        signature.byte(param, "param_types");
      }

      if (returnType === "void") {
        signature.varuint(0, "return_count");
      } else {
        signature
          .varuint(1, "return_count")
          .byte(returnType, "return_type");
      }

      signature.finishSection();
    }
  }
  
  section.finishSection();
}


/*
  The import section is a list of all imported globals, functions, tables & memory stores.

  Note that these entries occupy positions in their respective index spaces.
    E.g. if you import two functions, they'll occupy the 0 and 1 positions of the function index space,
      and the first function defined inside the module will be at position 2.
*/
function generateImportSection (source, module) {
  let section = module.section("import section");
  let count = source.imports.function.length + source.imports.global.length;
  let table = source.defaultTable[0];
  if (table !== undefined && table.importSource !== null) {
    count++;
  }
  let memory = source.defaultMemory[0];
  if (memory !== undefined && memory.importSource !== null) {
    count++;
  }

  if (count > 0) {
    section
      .byte("section.import", "id")
      .reserveSize("payload_len")
      .varuint(count, "count");

    for (let definition of source.imports.function) {
      section
        .section(`fn ${definition.index} (${definition.name})`)
          .importDefinition(definition)
          .varuint(definition.signatureIndex, "index")
          .finishSection();
    }
  
    for (let definition of source.imports.global) {
      section
        .section(`global ${definition.index} (${definition.name})`)
          .importDefinition(definition)
          .byte(definition.runType, "content_type")
          .byte("global.immutable", "mutability") // In the WebAssembly MVP, all imported globals must be immutable.
          .finishSection();
    }
  
    if (table !== undefined && table.importSource !== null) {
      section
        .section("default_table")
          .importDefinition(table)
          .byte("anyfunc", "element_type")  // In the WebAssembly MVP, "anyfunc" is the only defined element type for a table.
          .resizableLimits(table)
          .finishSection();
    }
  
    if (memory !== undefined && memory.importSource !== null) {
      section
        .section("default_memory")
          .importDefinition(memory)
          .resizableLimits(memory)
          .finishSection();
    }
  }  

  section.finishSection();
}


/*
  The function section just contains a list that maps non-imported functions to function signatures (via indices into the type section).
    It does not contain any executable code - see the code section below for that.
*/
function generateFunctionSection (source, module) {
  let section = module.section("function section");
  let count = source.functions.length;

  if (count > 0) {
    section
      .byte("section.function", "id")
      .reserveSize("payload_len")
      .varuint(count, "count");

    for (let definition of source.functions) {
      section.varuint(definition.signatureIndex, `fn ${definition.index} (${definition.name})|type_index`);
    }
  }

  section.finishSection();
}


/*
  The table section defines a non-imported default table, if necessary.
*/
function generateTableSection (source, module) {
  let section = module.section("table section");
  let table = source.defaultTable[0];

  if (table !== undefined && table.importSource === null) {  // If the default table is imported, it's already been defined.
    section
      .byte("section.table", "id")
      .reserveSize("payload_len")
      .varuint(1, "count")
      .byte("anyfunc", "elem_type")
      .resizableLimits(table);
  }

  section.finishSection();
}


/*
  The memory section defines a non-imported default memory store, if necessary.
*/
function generateMemorySection (source, module) {
  let section = module.section("memory section");
  let memory = source.defaultMemory[0];

  if (memory !== undefined && memory.importSource === null) {  // If the default memory store is imported, it's already been defined.
    section
      .byte("section.memory", "id")
      .reserveSize("payload_len")
      .varuint(1, "count")
      .resizableLimits(memory);
  }

  section.finishSection();
}


/*
  The global section is a list of all non-imported global variables, along with basic expressions used to initialize them.
*/
function generateGlobalSection (source, module) {
  let section = module.section("global section");
  let count = source.variables.length;

  if (count > 0) {
    section
      .byte("section.global", "id")
      .reserveSize("payload_len")
      .varuint(count, "count");

    for (let {name, runType, mutable, initializer} of source.variables) {
      section
        .section(`${name}`)
          .byte(runType, "content_type")
          .byte(mutable ? "global.mutable" : "global.immutable", "mutability")
          .section("init_expr")
            .generate(initializer, 0)
            .op("end")
            .finishSection()
          .finishSection();
    }
  } 

  section.finishSection();
}


/*
  The export section is a list of exported functions, globals, tables and memory stores.
  Each export assigned a name and then specified via an external kind and an reference into the respective index space.
*/
function generateExportSection (source, module) {
  let section = module.section("export section");
  let count = source.exports.length;
  
  if (count > 0) {
    section
      .byte("section.export", "id")
      .reserveSize("payload_len")
      .varuint(count, "count");

    for (let {exportName, kind, index} of source.exports) {
      section
        .section(`${exportName}`)
          .string(exportName, "field")
          .byte(`external_kind.${kind}`, "kind",)
          .varuint(index, "index")
          .finishSection();
    }
  }
  
  section.finishSection();
}


/*
  The start section (optionally) specifies a function to execute when the module is instantiated.
  We look for a function named "main" that takes no parameters and has no return value.
*/
function generateStartSection (source, module) {
  let section = module.section("start section");
  let startFn = source.names["main"];

  if (startFn !== undefined && startFn.kind === "function" && startFn.paramTypes.length === 0 && startFn.returnType === "void") {
    section
      .byte("section.start", "id")
      .reserveSize("payload_len")
      .varuint(startFn.index, "index");
  }

  section.finishSection();
}


/*
  The code section contains the actual executable code for all the non-imported functions.
  Each function defintion is a list of local variable types, followed by the actual function body code.
*/
function generateCodeSection (source, module) {
  let count = source.functions.length;
  let section = module.section("code section");

  if (count > 0) {
    section
      .byte("section.code", "id")
      .reserveSize("payload_len")
      .varuint(count, "count");

    for (let definition of source.functions) {
      let locals = definition.scope.variables; // Includes function parameters.
      let fnByteCode = 
        section
          .section(`fn ${definition.index} (${definition.name})`)
            .reserveSize("body_size")
            .varuint(locals.length - definition.paramTypes.length, "local_count");

      // Indices for local variables aren't actually recorded until this point.
      // The format for recording local variables (including function parameters) technically allows us to specify more than one variable at
      //  a time - there's a "count" field preceding the type field. If we wanted to save some bytes, we could condense sequences of
      //  similarly typed locals, or re-order everything but the parameters to take advantage of this.
      for (let i = 0; i < locals.length; i++) {
        let local = locals[i];
        local.index = i;
        if (i >= definition.paramTypes.length) {
          fnByteCode
            .varuint(1, `locals|${local.name}|count`)
            .byte(local.runType, `locals|${local.name}|type`);
        }
      }

      fnByteCode
        .section("code")
          .generate(definition.body, 0) // See /compiler/functionCodeGen.js for the function body code generation.
          .op("end")
          .finishSection()
        .finishSection();
    }
  }

  section.finishSection();
}


/*
  Functions and global variables need to be assigned numbers within an index space, with imports preceding other definitions.
*/
function orderGlobals ({imports: {function: fnImports, global: varImports}, variables, functions}) {
  for (let i = 0; i < fnImports.length; i++) {
    fnImports[i].index = i;
  }
  for (let i = 0; i < functions.length; i++) {
    functions[i].index = i + fnImports.length;
  }
  for (let i = 0; i < varImports.length; i++) {
    varImports[i].index = i;
  }
  for (let i = 0; i < variables.length; i++) {
    variables[i].index = i + varImports.length;
  }
}