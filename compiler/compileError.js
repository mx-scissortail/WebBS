/*
  The only purpose for this class is to enable anything that handles exceptions to use instanceof to easily distinguish between exceptions
    intentionally thrown due to a compilation error, and other exceptions that happen to be caught (e.g. bugs).
*/
export class CompileError {
  constructor (type, data) {
    this.type = type;
    this.data = data;
  }
}
