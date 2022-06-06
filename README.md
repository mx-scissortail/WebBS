# WebBS

__WebBS__ (short for "(Web)Assembly (B)etter (S)yntax") is a simple byte-twiddling language that compiles to WebAssembly bytecode.

It features:
* Simple, structured syntax with block scope
* Infixed math expressions with operator precedence
* Typed pointers and function pointers
* Immutable local variables
* Minor type coersion / syntax sugar
* Not much else

__WebBS__ isn't intended to be particularly useful on its own - it's a toy language. Rather, it's intended to be an educational tool for learning about WebAssembly and compiler design.

The __WebBS__ code contains an extremely simple compiler, written in pure Javascript, which runs entirely on the front end. The __WebBS__ compiler has zero external dependencies and no build or bundling steps, and the whole thing (including this GUI) is a few hundred lines of well-commented code. It has a very simple architecture and it translates __WebBS__ code into WebAssembly bytecode in pretty much the most straightforward possible way, with (almost) no optimization or code restructuring. It's written to be very easy to understand and modify, so programmers (especially Javascript programmers) who are interested in learning more about how compilers work can dig right in by reading the source.

The editor GUI allows the user to write and run simple __WebBS__ programs, and view the compiler's output either as an abstract syntax tree or as annotated(!) WebAssembly bytecode, so interested programmers can get a sense of how __WebBS__ expressions are parsed and translated into the stack-machine-like WebAssembly bytecode without even reading the source.

If you want to write your own lightweight DSL that runs on the front end, __WebBS__ wouldn't be a terrible place to start (and in fact, it was initially created as the first steps toward exactly that).

To get a sense of the syntax of the language, check out some [example code](http://mx-scissortail.github.io/WebBS/index.html#splash) in the editor.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

## Acknowledgements

* Credit to [LÆMEUR](http://laemeur.sdf.org/fonts/) for the More Perfect DOS VGA font used in the editor.

* A series of posts on the [Oil Shell blog](https://www.oilshell.org/blog/2017/03/31.html) about Pratt Parsing/Precedence Climbing were very helpful while writing the __WebBS__ parser.
