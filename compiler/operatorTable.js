/*
  This is a big table that maps WebBS operators to WebAssembly operators,
    first by the token used to write the operator, then by the operand runtypes.

  This is used to disambiguate WebBS operators that can specify different WebAssembly operators,
    and identify situations where no relevant WebAssembly operator exists for the given values. 

  This only includes WebBS operators that map pretty much directly to WebAssembly operators.
  Some things not included in this table:
    =                 Assignment
    ++/--             Postincrement/postdecrement
    and/or            Short circuiting Booleans
    pages_allocated   0-ary current memory allocated query
*/
export const operatorTable = {
  "==": {
    "i32,i32": {returnType: "i32", operator: "i32.eq"},
    "i64,i64": {returnType: "i32", operator: "i64.eq"},
    "f32,f32": {returnType: "i32", operator: "f32.eq"},
    "f64,f64": {returnType: "i32", operator: "f64.eq"}
  },
  
  "!=": {
    "i32,i32": {returnType: "i32", operator: "i32.ne"},
    "i64,i64": {returnType: "i32", operator: "i64.ne"},
    "f32,f32": {returnType: "i32", operator: "f32.ne"},
    "f64,f64": {returnType: "i32", operator: "f64.ne"}
  },
  
  "<": {
    "i32,i32": {returnType: "i32", operator: "i32.lt_s"},
    "i64,i64": {returnType: "i32", operator: "i64.lt_s"},
    "f32,f32": {returnType: "i32", operator: "f32.lt"},
    "f64,f64": {returnType: "i32", operator: "f64.lt"}
  },

  "|<|": {  // Unsigned <
    "i32,i32": {returnType: "i32", operator: "i32.lt_u"},
    "i64,i64": {returnType: "i64", operator: "i64.lt_u"},
  },
    
  ">": {
    "i32,i32": {returnType: "i32", operator: "i32.gt_s"},
    "i64,i64": {returnType: "i32", operator: "i64.gt_s"},
    "f32,f32": {returnType: "i32", operator: "f32.gt"},
    "f64,f64": {returnType: "i32", operator: "f64.gt"}
  },

  "|>|": {  // Unsigned >
    "i32,i32": {returnType: "i32", operator: "i32.gt_u"},
    "i64,i64": {returnType: "i64", operator: "i64.gt_u"},
  },
  
  "<=": {
    "i32,i32": {returnType: "i32", operator: "i32.le_s"},
    "i64,i64": {returnType: "i32", operator: "i64.le_s"},
    "f32,f32": {returnType: "i32", operator: "f32.le"},
    "f64,f64": {returnType: "i32", operator: "f64.le"}
  },

  "|<=|": { // Unsigned <=
    "i32,i32": {returnType: "i32", operator: "i32.le_u"},
    "i64,i64": {returnType: "i64", operator: "i64.le_u"},
  },
  
  ">=": {
    "i32,i32": {returnType: "i32", operator: "i32.ge_s"},
    "i64,i64": {returnType: "i32", operator: "i64.ge_s"},
    "f32,f32": {returnType: "i32", operator: "f32.ge"},
    "f64,f64": {returnType: "i32", operator: "f64.ge"}
  },

  "|>=|": { // Unsigned >=
    "i32,i32": {returnType: "i32", operator: "i32.ge_u"},
    "i64,i64": {returnType: "i64", operator: "i64.ge_u"},
  },
  
  "+": {
    "i32,i32": {returnType: "i32", operator: "i32.add"},
    "i64,i64": {returnType: "i64", operator: "i64.add"},
    "f32,f32": {returnType: "f32", operator: "f32.add"},
    "f64,f64": {returnType: "f64", operator: "f64.add"}
  },
  
  "-": {
    "i32,i32": {returnType: "i32", operator: "i32.sub"},
    "i64,i64": {returnType: "i64", operator: "i64.sub"},
    "f32,f32": {returnType: "f32", operator: "f32.sub"},
    "f64,f64": {returnType: "f64", operator: "f64.sub"}
  },
  
  "*": {
    "i32,i32": {returnType: "i32", operator: "i32.mul"},
    "i64,i64": {returnType: "i64", operator: "i64.mul"},
    "f32,f32": {returnType: "f32", operator: "f32.mul"},
    "f64,f64": {returnType: "f64", operator: "f64.mul"}
  },
  
  "/": {
    "i32,i32": {returnType: "i32", operator: "i32.div_s"},
    "i64,i64": {returnType: "i64", operator: "i64.div_s"},
    "f32,f32": {returnType: "f32", operator: "f32.div"},
    "f64,f64": {returnType: "f64", operator: "f64.div"}
  },

  "|/|": {  // Unsigned Division
    "i32,i32": {returnType: "i32", operator: "i32.div_u"},
    "i64,i64": {returnType: "i64", operator: "i64.div_u"},
  },

  "&": {
    "i32,i32": {returnType: "i32", operator: "i32.and"},
    "i64,i64": {returnType: "i64", operator: "i64.and"},
  },
  
  "|": {
    "i32,i32": {returnType: "i32", operator: "i32.or"},
    "i64,i64": {returnType: "i64", operator: "i64.or"},
  },

  "xor": {
    "i32,i32": {returnType: "i32", operator: "i32.xor"},
    "i64,i64": {returnType: "i64", operator: "i64.xor"},
  },

  "with_sign_of": {
    "f32,f32": {returnType: "f32", operator: "f32.copysign"},
    "f64,f64": {returnType: "f64", operator: "f64.copysign"}
  },

  "%": {  // Signed Remainder
    "i32,i32": {returnType: "i32", operator: "i32.rem_s"},
    "i64,i64": {returnType: "i64", operator: "i64.rem_s"},
  },

  "|%|": {  // Unsigned Remainder
    "i32,i32": {returnType: "i32", operator: "i32.rem_u"},
    "i64,i64": {returnType: "i64", operator: "i64.rem_u"}
  },

  "<<": {
    "i32,i32": {returnType: "i32", operator: "i32.shl"},
    "i64,i64": {returnType: "i64", operator: "i64.shl"},
  },

  ">>": {
    "i32,i32": {returnType: "i32", operator: "i32.shr_s"},
    "i64,i64": {returnType: "i64", operator: "i64.shr_s"},
  },

  ">>>": {
    "i32,i32": {returnType: "i32", operator: "i32.shr_u"},
    "i64,i64": {returnType: "i64", operator: "i64.shr_u"}
  },

  "rotate_left": {
    "i32,i32": {returnType: "i32", operator: "i32.rotl"},
    "i64,i64": {returnType: "i64", operator: "i64.rotl"},
  },

  "rotate_right": {
    "i32,i32": {returnType: "i32", operator: "i32.rotr"},
    "i64,i64": {returnType: "i64", operator: "i64.rotr"},
  },

  "?<": { // Select Minimum
    "f32,f32": {returnType: "f32", operator: "f32.min"},
    "f64,f64": {returnType: "f64", operator: "f64.min"},
  },

  "?>": { // Select Maximum
    "f32,f32": {returnType: "f32", operator: "f32.max"},
    "f64,f64": {returnType: "f64", operator: "f64.max"},
  },

  "cast_i32": { // Reinterpret an f32 as an i32 bitwise
    "f32": {returnType: "i32", operator: "i32.reinterpret/f32"}
  },
  
  "cast_i64": { // Reinterpret an f64 as an i64 bitwise
    "f64": {returnType: "i64", operator: "i64.reinterpret/f64"}
  },
  
  "cast_f32": { // Reinterpret an i32 as an f32 bitwise
    "i32": {returnType: "f32", operator: "f32.reinterpret/i32"},
  },
  
  "cast_f64": { // Reinterpret an i64 as an f64 bitwise
    "i64": {returnType: "f64", operator: "f64.reinterpret/i64"},
  },
  
  "to_i32": {
    "i64": {returnType: "i32", operator: "i32.wrap/i64"},
    "f32": {returnType: "i32", operator: "i32.trunc_s/f32"},
    "f64": {returnType: "i32", operator: "i32.trunc_s/i64"}
  },
  
  "to_i64": {
    "i32": {returnType: "i64", operator: "i64.extend_s/i64"},
    "f32": {returnType: "i64", operator: "i64.trunc_s/f32"},
    "f64": {returnType: "i64", operator: "i64.trunc_s/i64"}
  },
  
  "to_f32": {
    "i32": {returnType: "f32", operator: "f32.convert_s/i32"},
    "i64": {returnType: "f32", operator: "f32.convert_s/i64"},
    "f64": {returnType: "f32", operator: "f32.demote/f64"}
  },
  
  "to_f64": {
    "i32": {returnType: "f64", operator: "f64.convert_s/i32"},
    "i64": {returnType: "f64", operator: "f64.convert_s/i64"},
    "f64": {returnType: "f64", operator: "f64.promote/f32"}
  },

  "abs": {
    "f32": {returnType: "f32", operator: "f32.abs"},
    "f64": {returnType: "f64", operator: "f64.abs"}
  },

  "ceil": {
    "f32": {returnType: "f32", operator: "f32.ceil"},
    "f64": {returnType: "f64", operator: "f64.ceil"}
  },

  "count_ones": {
    "i32": {returnType: "i32", operator: "i32.popcnt"},
    "i64": {returnType: "i64", operator: "i64.popcnt"},
  },

  "floor": {
    "f32": {returnType: "f32", operator: "f32.floor"},
    "f64": {returnType: "f64", operator: "f64.floor"}
  },

  "leading_zeros": {
    "i32": {returnType: "i32", operator: "f32.clz"},
    "i64": {returnType: "i64", operator: "f64.clz"},
  },

  "round": {
    "f32": {returnType: "f32", operator: "f32.nearest"},
    "f64": {returnType: "f64", operator: "f64.nearest"}
  },

  "sqrt": {
    "f32": {returnType: "f32", operator: "f32.sqrt"},
    "f64": {returnType: "f64", operator: "f64.sqrt"}
  },

  "trailing_zeros": {
    "i32": {returnType: "i32", operator: "i32.ctz"},
    "i64": {returnType: "i64", operator: "i64.ctz"},
  },

  "truncate": {
    "f32": {returnType: "f32", operator: "f32.trunc"},
    "f64": {returnType: "f64", operator: "f64.trunc"}
  },

  "!": {
    "i32": {returnType: "i32", operator: "i32.eqz"},
    "i64": {returnType: "i32", operator: "i64.eqz"}
  },

  "allocate_pages": {
    "i32": {returnType: "i32", operator: "grow_memory"}
  }
};
