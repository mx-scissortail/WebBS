import { /* ALL_ASTYPES */ ADD, ADDRESS, ADDRESS_CLOSE, ALLOCATE_PAGES, AND, ARG_LIST, AS, ASSIGN, BAD_TOKEN, BITWISE_AND, BITWISE_OR, BITWISE_SHIFT, BITWISE_XOR, BLOCK, BLOCK_CLOSE, BREAK, CALL, COMMA, COMMENT, CONTINUE, DECLARATION, DEFAULT_MEMORY, DEFAULT_TABLE, DEFINITION, ELSE, END_OF_INPUT, EQ_COMPARISON, EXPORT, EXPORT_TYPE, F32_LITERAL, F64_LITERAL, FN, FN_PTR, FN_SIGNATURE, FROM, I32_LITERAL, I64_LITERAL, IF, IMMUTABLE, IMPORT, INIT_EXPR, LOOP, MEMORY_ACCESS, MISC_INFIX, NEG, OR, ORDER_COMPARISON, PAGES_ALLOCATED, PARAM_LIST, PAREN, PAREN_CLOSE, PASS, PTR, RETURN, ROOT, SCALE_OP, SEMICOLON, STRING, STORAGE_TYPE, SUB, SUFFIX_OP, TYPE_LIST, UNARY_MATH_OP, VALUE_TYPE, VARIABLE, VOID, WS, YIELD /* END_ALL_ASTYPES */ } from "/compiler/syntax.js";
import {lexify} from "../compiler/lexer.js";
import {parse} from "../compiler/parser.js";
import {generateModule} from "../compiler/moduleCodeGen.js";
import {generateErrorMessage} from "./errorMessages.js";

/*
  This class implements the WebBS editor user interface.
  It attaches itself to pre-existing DOM nodes (see index.html), and intercepts/handles user input.
  The main editor DOM node is a contenteditable element. 
*/
export class Editor {
  constructor (text = "") {
    this.text = text.replace(/\r/g, ""); // The current text of the editor element (stripped of rogue \r characters).
    this.tokens = []; // A list of tokens - the value of this.text run through the lexer.
    this.selection = {start: 0, end: 0, backwards: false, isCollapsed: true}; // Useful information about the currently selected text.
    this.editHistory = []; // Edit history (for "undo" functionality).
    this.redoStack = [];  // For "redo" functionality; reset upon change.
    this.module = null; // If we successfully compile a WebAssembly module, we store it here so we can instantiate it when needed.
    this.DOMNodes = { // Some useful DOM nodes.
      buildButton: document.getElementById("build-button"),
      bytecode: document.getElementById("bytecode"),
      editor: document.getElementById("editor"),
      log: document.getElementById("log"),
      output: document.getElementById("output"),
      panel: document.getElementById("panel"),
      parseTree: document.getElementById("parse-tree"),
      runButton: document.getElementById("run-button"),
      runMessage: document.getElementById("run-message"),
      statusMessage: document.getElementById("status-message"),
      statusTitle: document.getElementById("status-title")
    };
    
    this.DOMNodes.editor.addEventListener("keydown", (event) => this.keyDown(event));
    this.DOMNodes.editor.addEventListener("cut", (event) => this.cut(event));
    this.DOMNodes.editor.addEventListener("paste", (event) => this.paste(event));
    this.DOMNodes.editor.addEventListener("input", (event) => document.execCommand("undo")); // Prevent DOM effects from unhandled inputs.
    this.DOMNodes.buildButton.addEventListener("mousedown", () => this.compile());
    this.DOMNodes.runButton.addEventListener("mousedown", () => this.run());
    document.addEventListener("selectionchange", (event) => this.selectionChange(event));
    
    // Register and create event handlers for the tabs on the right-hand panel.
    this.tabs = Object.create(null);
    this.createTab("status", true),
    this.createTab("output", false),
    this.createTab("parse-tree", false),
    this.createTab("bytecode", false),
    this.createTab("about", true),
    this.selectTab("about");
    
    this.initializeModuleDependencyProvider();
    this.edit({start: 0, end: 0, insert: "", postSelection: this.selection});  // This gets the editor DOM in the right state for editing.

    window.WebBSEditor = this;
    console.log(`For advanced instructions, run "WebBSEditor.help()"`);
  }
  
  
  /*
    Inserts a newline, followed by the appropriate amount of indentation based on the scope.
  */
  autoIndentNewLine (start, end) {
    for (var i = start, scopeDiff = 0; i > 0; i--) {
      let char = this.text[i - 1];
      if (char === '\n') {
        break;
      } else if (scopeDiff === 0) {
        if (char === "}") {
          scopeDiff = -1;
        } if (char === "{") {
          scopeDiff = 1;
        }
      }
    }

    let result = initialWhiteSpace.exec(this.text.substring(i, start));
    let indentation = result ? result[0] : "";
    
    if (scopeDiff === 1) {
      initialCloseParen.lastIndex = end;
      let suffix = initialCloseParen.exec(this.text) ? "\n" + indentation : "";
      this.replaceText(start, end, "\n\t" + indentation + suffix, -suffix.length);
    } else {
      this.replaceText(start, end, "\n" + indentation);
    }
  }


  /*
    Attempts to compile the WebBS code in the editor into a WebAssembly module.
  */
  compile () {
    this.DOMNodes.log.innerHTML = ""; // Reset the output log.
    this.disableTab("output");
    this.disableTab("parse-tree");
    let root;
    try {
      root = parse(this.tokens);  // Parse the tokens from the lexer into a WebBS AST.
      this.updateParseTreeTab(root); // Update and re-enable the AST tab.
    } catch (error) {  
      this.showErrorMessage(error);
      return;
    }

    try {
      let module = generateModule(root);  // Generate bytecode from the AST and update the Bytecode tab.
      this.updateByteCodeTab(module);
      
      this.module = new WebAssembly.Module(module.toByteArray()); // Compile a WebAssembly module from the bytecode.
      this.DOMNodes.statusTitle.innerHTML = "Success!";
      this.DOMNodes.statusTitle.className = "success";
      this.DOMNodes.statusMessage.innerHTML = "";
      this.DOMNodes.runMessage.className = "";  // Remove any error messages.
      this.enableTab("output");
      this.DOMNodes.runButton.className = "button"; // Enable the run button.
    } catch (error) {
      this.showErrorMessage(error);
    }
  }

  
  /*
    Registers a tab in this.tabs and adds the appropriate mouse listener.
    The first parameter is a string ID that we use to find the tab and its contents in the DOM.
    The second parameter is a Boolean that determines whether the tab is initially enabled.
  */
  createTab (id, enabled) {
    let tabData = this.tabs[id] = {
      id,
      DOMNode: document.getElementById(id + "-tab"),
      enabled,
      contentDOMNode: document.getElementById(id)
    };

    tabData.DOMNode.addEventListener("mousedown", () => this.selectTab(tabData));
    if (!enabled) {
      tabData.DOMNode.classList.add("disabled");
    }
    return tabData;
  }


  /*
    We manually override the effects of cutting from the document in order to keep the highlighting and internal state consistent.
  */
  cut (event) {
    event.preventDefault();
    event.stopPropagation();
    document.execCommand("copy");
    this.replaceText(this.selection.start, this.selection.end, "");
  }


  /*
    Marks a tab (specified by ID) as disabled, thereby preventing the user from selecting it.
  */
  disableTab (id) {
    let tabData = this.tabs[id];
    tabData.enabled = false;
    tabData.DOMNode.classList.add("disabled");
    if (this.selectedTab === tabData) { // Switch to the (always enabled) status tab if we're disabling the currently active tab.
      this.selectTab(this.tabs["status"]);
    }
  }

  
  /*
    Edits the text, lexifies the result, renders the syntax highlighted tokens and otherwise updates the UI.
  */
  edit ({start, end, insert, postSelection}) {
    // Edit the text and lexify the results.
    this.text = this.text.slice(0, start) + insert + this.text.slice(end);
    this.tokens = lexify(this.text);

    // Re-render the syntax-highlighted result.

    let fragment = new DocumentFragment();
    let selector = new Selector(postSelection); // See the Selector class in the utilities section below.

    for (let token of this.tokens) {
      let node = document.createElement("span");
      node.textContent = token.text;
      node.token = token;
      token.DOMNode = node;
      node.className = token.ASType.category;
      fragment.appendChild(node);
      selector.next(token);
    }

    this.DOMNodes.editor.innerHTML = "";
    this.DOMNodes.editor.appendChild(fragment);
    this.selection = postSelection;
    selector.setSelection();  // Update the actual text selection in the browser.

    this.DOMNodes.runButton.className = "button disabled";  // Disable the run button on edit - the user will need to re-build first.
  }

  
  /*
    Marks a tab (specified by ID) as enabled, thereby allowing the user to select and interact with it.
  */
  enableTab (id) {
    let tabData = this.tabs[id];
    tabData.enabled = true;
    tabData.DOMNode.classList.remove("disabled");
  }


  /*
    Prints some instructions for providing a custom module dependency provider.
  */
  help () {
    console.log(`
    Hello!
    If you want to play around with the imports provided to your WebBS module, or code that uses your module's exports, you need to provide the WebBS editor with a new module dependency provider function.
    The editor is available here as a global variable called "WebBSEditor" and you'll want to set the .moduleInstanceProvider field to a function that takes an instance of the editor and returns an object with two fields:
      .imports : An object that contains the imports to be provided to your module.
      .onInit  : A function that takes the WebAssembly instance, which is run upon instantiation.

    See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/Instance for more information.

    The default module dependency provider looks like this:

    WebBSEditor.moduleDependencyProvider = ${this.moduleDependencyProvider.toSource()};
    `);

    return "Good Luck!";
  }

  
  /*
    Implements smart indentation for selected text.
    Its parameters are the start/end points of a text range,
      and an optional Boolean where "true" indicates that we want to un-indent rather than indent the selected text.
  */
  indentLines (start, end, backwards = false) {
    for (var i = start; i > 0 && this.text[i - 1] !== '\n'; i--);

    let replace = this.text.slice(i, end);
    let insert, offset;

    if (backwards) {
      insert = (replace[0] === "\t" ? replace.slice(1) : replace).replace(allNewLineTabs, "\n");
      offset = (i < start && replace[0] === "\t") ? -1 : 0;
    } else {
      insert = "\t" + replace.replace(allNewLines, "\n\t");
      offset = 1;
    }

    let postStart = start + offset;
    let postEnd = i + insert.length;
    let edit = {
      start: i,
      end,
      insert,
      replace,
      preSelection: this.selection,
      postSelection: {start: postStart, end: postEnd, isCollapsed: postStart === postEnd, backwards: this.selection.backwards}
    };
    this.edit(edit);
    this.editHistory.push(edit);
    this.redoStack = [];
  }


  /*
    This creates a default module dependency provider (which determines what happens when your WebBS module is instantiated).
    The default module dependency provider provides the imports that the editor's example code needs to run.
  */
  initializeModuleDependencyProvider () {
    this.moduleDependencyProvider = (editor) => {
      let memory = new WebAssembly.Memory({initial: 64});
      return {
        imports: {
          WebBS: {
            memory,
            log: (number) => editor.logOutput(number),
            logStr: (index, size) => {
              let str = "";
              let memView = new Uint8Array(memory.buffer);
              for (let i = index; i < index + size; i++) {
                str += String.fromCharCode(memView[i]);
              }
              editor.logOutput(str);
            }
          }
        },

        onInit: (instance) => {}
      };
    };    
  }


  /*
    We intercept keys as they're pressed and decide what to do with them.
    Only navigation keys and cut/copy/paste shortcuts are allowed to pass directly through to the editor.
    Everything else we either handle in some custom way, or ignore.
  */
  keyDown (event) {
    if (navKeys.includes(event.key) || (event.ctrlKey && ignoredCtrlKeys.includes(event.key))) return;

    // Don't let keypresses actually go through to the editor - we manage their effects manually.
    event.preventDefault();
    event.stopPropagation();

    let {start, end, isCollapsed} = this.selection;
    let insert = event.key;
    
    switch (event.key) {
      case "Enter": { // Insert a newline and the appropriate amount of indentation.
        return this.autoIndentNewLine(start, end);
      } break;

      case "Delete": {  // Emulate the normal delete functionality.
        if (this.selection.isCollapsed) {
          if (start === this.text.length) return;
          end += 1;
        }
        insert = "";
      } break;

      case "Backspace": { // Emulate the normal backspace functionality.
        if (this.selection.isCollapsed) {
          if (start === 0) return;
          start -= 1;
        }
        insert = "";
      } break;

      case "Tab": { // Insert a tab, or indent/unindent selected text.
        if (event.shiftKey) {
          return this.indentLines(start, end, true); // The boolean here triggers unindent rather than indent.
        } else if (!isCollapsed) {
          return this.indentLines(start, end);
        }
        insert = "\t";
      } break;

      case "z": { // Trigger our custom undo.
        if (event.ctrlKey) return this.undo();
      } break;

      case "y": { // Trigger our custom redo.
        if (event.ctrlKey) return this.redo();
      } break;
      
      case "{": { // If text is selected, we wrap it with {}, rather than replacing it.
        if (!isCollapsed) return this.wrapText(start, end, "{", "}");
      } break;

      case "}": { // Unindent right brackets one level.
        if (this.text[start - 1] === "\t") {
          start -= 1;
        }
      }

      case "(": { // If text is selected, we wrap it with (), rather than replacing it.
        if (!isCollapsed) return this.wrapText(start, end, "(", ")");
      } break;
      
      default: {  // Ignore anything with a weird key name, but allow typed characters to pass through.
        if (event.key.length > 1) return; 
      } break;
    }

    // If we get here, the start, end and insert variables have all the information we need to edit the text.
    this.replaceText(start, end, insert); 
  }


  /*
    Writes to the Output tab - exposed to WebBS programs in the editor, so they can generate output.
  */
  logOutput (msg) {
    this.DOMNodes.runMessage.className = "hidden";
    let node = document.createElement("div");
    node.innerHTML = msg;
    this.DOMNodes.log.appendChild(node);
  }


  /*
    We manually override the effects of pasting into the document in order to keep the highlighting and internal state consistent.
  */
  paste (event) {
    event.preventDefault();
    event.stopPropagation();
    this.replaceText(this.selection.start, this.selection.end, event.clipboardData.getData("text"));
  }

  
  /*
    This performs the most common kind of text editing operation by:
      1. Constructing an edit specification object from the most common parameters
      2. Calling .edit(), and
      3. Updating the editHistory (and resetting the redo stack)

    It takes two text positions (the start and end of the text to modify),
      a string to insert/replace between those two positions,
      and an optional offset, which determines how much to move the caret
        (where the default 0 value places it at the end of the edit region).
  */
  replaceText (start, end, insertText, offset = 0) {
    let insert = insertText.replace(/\r/g, ""); // Prevent rogue \r characters from showing up in the text and causing havoc.
    let postPos = start + insert.length + offset;
    let edit = {
      start,
      end,
      insert,
      replace: this.text.slice(start, end), // Record the text that's currently in the edit region, so we can undo this change if needed.
      preSelection: this.selection,
      postSelection: {start: postPos, end: postPos, isCollapsed: true, backwards: false}
    };
    this.edit(edit);
    this.editHistory.push(edit);
    this.redoStack = [];
  }


  /*
    Redoes the last undone edit (if possible).
  */
  redo () {
    if (this.redoStack.length === 0) return;

    let edit = reverseInput(this.redoStack.pop());
    this.edit(edit);
    this.editHistory.push(edit);
  }


  /*
    If we have a successfully compiled WebAssembly module, this instantiates it.
  */
  run () {
    if (this.module !== null) {
      let {imports = {}, onInit = () => {}} = this.moduleDependencyProvider(this);
      this.selectTab(this.tabs["output"]);
      this.logOutput("<em>RUNNING...</em>");
      WebAssembly.instantiate(this.module, imports).then((instance) => {
        onInit(instance);
        this.logOutput("<em>...DONE!</em>");
      }).catch((error) => {
        this.showErrorMessage(error);
      });
    }
  }


  /*
    We track the user's selection (which includes the position of the editor caret) with this method.
  */
  selectionChange (event) {
    let {anchorNode, anchorOffset, focusNode, focusOffset, isCollapsed} = document.getSelection();
    let editorNode = this.DOMNodes.editor;

    // If the editor DOM element isn't selected, or the selection crosses outside of it, we bail.
    if (document.activeElement !== editorNode) return;
    if (!editorNode.contains(anchorNode) || !editorNode.contains(focusNode)) return;

    // In Firefox, "select all" presently sets the anchor/focus node to the containing contentEditable.
    if (anchorNode === editorNode) {
      anchorNode = editorNode.firstChild;
      anchorOffset = 0;
      focusNode = editorNode.lastChild;
      focusOffset = 0; // The last child is a fake sentinel node, we don't actually want to select it.
    }

    // Browsers will generally (but not always) report inner text nodes as focus/anchor nodes - we want the surrounding spans.
    if (focusNode.nodeName === "#text") {
      focusNode = focusNode.parentNode;
    }

    if (anchorNode.nodeName === "#text") {
      anchorNode = anchorNode.parentNode;
    }

    // Scroll the cursor into view if necessary.
    if (focusNode.offsetTop < editorNode.scrollTop) {
      focusNode.scrollIntoView({block: "start"});
    } else if (focusNode.offsetTop + 16 > editorNode.scrollTop + editorNode.clientHeight) {
      focusNode.scrollIntoView({block: "end"});
    } else if (focusNode.offsetLeft < editorNode.scrollLeft) {
      focusNode.scrollIntoView({inline: "start"});
    } else if (focusNode.offsetLeft + focusNode.clientWidth> editorNode.scrollLeft + editorNode.clientWidth) {
      focusNode.scrollIntoView({inline: "end"});
    }
    
    let startToken = anchorNode.token;
    let endToken = focusNode.token;
    let start = startToken.pos + anchorOffset;
    let end = endToken.pos + focusOffset;
    let backwards = false;
    if (start > end) {  // If the anchorNode precedes the focusNode, we reverse the selection (we want our ranges to be ordered sensibly).
      [start, end] = [end, start];
      backwards = true;
    }
    
    this.selection = {start, end, isCollapsed, backwards};
  }

  
  /*
    Marks a tab as selected (and thus visible).
  */
  selectTab (tabData) {
    if (tabData.enabled) {
      this.selectedTab = tabData;
      this.DOMNodes.panel.dataset.selected = tabData.id;
    }
  }


  /*
    Generates and displays a relevant message about an error of some sort (generally thrown by the compiler).
  */
 showErrorMessage (error) {
    let displayError = generateErrorMessage(error);

    this.DOMNodes.statusTitle.innerHTML = "Error!";
    this.DOMNodes.statusTitle.className = "error";
    this.DOMNodes.statusMessage.innerHTML = `<em>${displayError.type}</em>\n\n${displayError.message}`;

    // Connect any textual references in the error message to the actual referenced text.
    for (let [index, textReferenced] of displayError.references.entries()) {
      let reference = document.getElementById(`reference-${index}`);
      reference.addEventListener("mouseover", () => this.DOMNodes.editor.classList.add(`show-referent-${index}`));  // This is a CSS hack.
      reference.addEventListener("mouseleave", () => this.DOMNodes.editor.classList.remove(`show-referent-${index}`));
      reference.addEventListener("click", () => textReferenced.DOMNode.scrollIntoView({block: "center"}));
      textReferenced.DOMNode.classList.add("error");
      textReferenced.DOMNode.classList.add(`referent-${index}`);
    }

    this.selectTab(this.tabs["status"]);  // Automatically switch to the status tab to display the error.
  }


  /*
    Pops from the edit history stack (if possible) and returns the editor to the previous state.
  */
  undo () {
    if (this.editHistory.length === 0) return;

    let edit = reverseInput(this.editHistory.pop());
    this.edit(edit);
    this.redoStack.push(edit);
  }

  
  /*
    Updates the Bytecode tab with an annotated view of the bytecode generated by the WebBS code generator.
  */
  updateByteCodeTab (module) {
    let markup = "";
    let prevPath = [];
    let position = 0;
    for (let part of module.parts) {
      let path = part.path.split("|");
      let field = path.pop();
      // Count how many initial segments path and oldPath have in common.
      for (var i = 0, len = Math.min(path.length, prevPath.length); i < len && path[i] === prevPath[i]; i++);
      let newSections = path.slice(i);
      let indentation = path.length - newSections.length;
      for (let newSection of newSections) {
        markup += `<div>${"  ".repeat(indentation++)}<span class="annotation">; ${newSection}</span></div>`;
      }
      let bytes = part.singular ? toHex(part.byte) : part.bytes.map(toHex).join(" ");
      markup += `<div title="offset ${position}">${"  ".repeat(indentation)}<span class="bytes">${bytes}</span> <span class="annotation">; ${field}</span> <span class="value">${part.value}</span></div>`;
      position += part.singular ? 1 : part.bytes.length;
      prevPath = path;
    }
    this.DOMNodes.bytecode.innerHTML = markup;
    this.enableTab("bytecode");
  }

  
  /*
    Updates the AST tab with a visualization of the structure of the AST generated by the WebBS parser.
  */
  updateParseTreeTab (root) {
    let html = root.children.map(createParseTreeView).join("");
    if (html === "") {
      this.disableTab("parse-tree");
    }
    this.DOMNodes.parseTree.innerHTML = html;
    this.enableTab("parse-tree");
  }

  
  /*
    Wraps selected text with a prefix and suffix, while maintaining the selection.
  */
  wrapText (start, end, prefix, suffix) {
    let replace = this.text.slice(start, end);
    let edit = {
      start,
      end,
      insert: prefix + replace + suffix,
      replace,
      preSelection: this.selection,
      postSelection: {
        start: start + prefix.length,
        end: end + prefix.length,
        isCollapsed: start === end,
        backwards: this.selection.backwards
      }
    };
    this.edit(edit);
    this.editHistory.push(edit);
    this.redoStack = [];
  }
}


/*
  Misc. editor utilities.
*/

const allNewLines = /\n/g;
const allNewLineTabs = /\n\t/g;
const initialWhiteSpace = /^\s+/;
const initialCloseParen = / *}/y;
const navKeys = ["Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Insert"];
const ignoredCtrlKeys = ["a", "c", "x", "v"];
const HTMLEscapeReplacements = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;", "/": "&#x2F;"};
const HTMLCharsToEscape = /[&<>"'\/]/g;


/*
  This recursively generates the markup for the AST visualization in the AST tab.
*/
function createParseTreeView  (node) {
  let text = node.token.text.replace(HTMLCharsToEscape, (match) => HTMLEscapeReplacements[match]);
  let nodeInfo = `<div class="node-info ${node.ASType.category}">${text}</div>`;
  let nodeChildren = `<div class="node-children">${node.children.map(createParseTreeView).join("")}</div>`;
  return `<div class="ast-node">${nodeInfo}${nodeChildren}</div>`;
}


/*
  Given an edit specification object, return another that exactly reverses the effects of the specified edit operation.
  This is used by .undo() and .redo() in the Editor class above. 
*/
function reverseInput ({start, end, insert, replace, preSelection, postSelection}) {
  return {
    start,
    end: end - (replace.length - insert.length),
    replace: insert,
    insert: replace,
    preSelection: postSelection,
    postSelection: preSelection
  };
}


/*
  Formats a byte into a 2-digit hexadecimal representation.
*/
function toHex (byte) {
  let hex = byte.toString(16);
  return hex.length === 1 ? "0" + hex : hex;
}


/*
  This is a tiny class used by the .edit() method of the Editor class above to set the text selection after an edit is performed.
  Getting that exactly right requires some somewhat subtle logic that would complicate the .edit() method a lot, so we export that work to
    this stateful container.
*/
class Selector {
  constructor ({start, end}) {
    this.anchor = {
      pos: start,
      DOMNode: null,
      offset: 0
    };

    this.focus = {
      pos: end,
      DOMNode: null,
      offset: 0
    };

    this.targets = [this.anchor, this.focus];
  }

  next (token) {
    let target = this.targets[0];
    if (target !== undefined) {
      if (token.pos + token.length > target.pos) {
        target.DOMNode = token.DOMNode;
        target.offset = target.pos - token.pos;
        this.targets.shift();
        this.next(token);
      }
    }
  }

  setSelection () {
    let {DOMNode: anchorNode, offset: anchorOffset} = this.anchor;
    let {DOMNode: focusNode, offset: focusOffset} = this.focus;

    anchorNode = anchorNode.firstChild || anchorNode;
    focusNode = focusNode.firstChild || focusNode;

    window.getSelection().setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  }
}


/*
  The following table is used to assign a .category property to all ASTypes, which we use for syntax highlighting.
  Mutating the imported ASType objects like this is perhaps a silly thing to do, but it makes syntax highlighting very concise and simple.
*/
const categories = {
  "":           [END_OF_INPUT, ROOT],
  "address":    [ADDRESS, ADDRESS_CLOSE, PTR],
  "bad-token":  [BAD_TOKEN],
  "block":      [BLOCK, BLOCK_CLOSE],
  "default":    [CALL, MEMORY_ACCESS, VARIABLE],
  "fn":         [FN, FN_SIGNATURE, FN_PTR],
  "ignore":     [COMMA, COMMENT, SEMICOLON],
  "keyword":    [ALLOCATE_PAGES, AS, BREAK, CONTINUE, ELSE, EXPORT, FROM, IF, IMPORT, LOOP, PAGES_ALLOCATED, PASS, RETURN, YIELD],
  "literal":    [F32_LITERAL, F64_LITERAL, I32_LITERAL, I64_LITERAL, STRING],
  "operator":   [ADD, AND, ASSIGN, BITWISE_AND, BITWISE_OR, BITWISE_SHIFT, BITWISE_XOR, DECLARATION, DEFINITION, EQ_COMPARISON, INIT_EXPR, MISC_INFIX, NEG, OR, ORDER_COMPARISON, SCALE_OP, SUB, SUFFIX_OP, UNARY_MATH_OP],
  "paren":      [ARG_LIST, PARAM_LIST, PAREN, PAREN_CLOSE, TYPE_LIST],
  "type":       [DEFAULT_MEMORY, DEFAULT_TABLE, IMMUTABLE, STORAGE_TYPE, VALUE_TYPE, VOID],
  "ws":         [WS]
};

for (let [category, ASTypes] of Object.entries(categories)) {
  for (let ASType of ASTypes) {
    ASType.category = category;
  }
}