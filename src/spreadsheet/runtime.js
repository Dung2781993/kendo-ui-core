// -*- fill-column: 100 -*-

(function(f, define){
    define([ "./references.js" ], f);
})(function(){

    "use strict";

    // WARNING: removing the following jshint declaration and turning
    // == into === to make JSHint happy will break functionality.
    /* jshint eqnull:true, newcap:false, laxbreak:true, shadow:true, validthis:true, -W054 */
    /* global console */

    var calc = {};
    var spreadsheet = kendo.spreadsheet;
    spreadsheet.calc = calc;
    var exports = calc.runtime = {};
    var Class = kendo.Class;

    var Ref = spreadsheet.Ref;
    var NameRef = spreadsheet.NameRef;
    var CellRef = spreadsheet.CellRef;
    var RangeRef = spreadsheet.RangeRef;
    var UnionRef = spreadsheet.UnionRef;
    var NULL = spreadsheet.NULLREF;

    /* -----[ Errors ]----- */

    var CalcError = Class.extend({
        init: function CalcError(code) {
            this.code = code;
        },
        toString: function() {
            return "#" + this.code + "!";
        }
    });

    /* -----[ Context ]----- */

    var Context = Class.extend({
        init: function Context(callback, formula, ss, sheet, row, col) {
            this.callback = callback;
            this.formula = formula;
            this.ss = ss;
            this.sheet = sheet;
            this.row = row;
            this.col = col;
        },

        resolve: function(val) {
            this.formula.value = val;
            this.ss.onFormula(this.sheet, this.row, this.col, val);
            if (this.callback) {
                this.callback(val);
            }
        },

        error: function(val) {
            this.ss.onFormula(this.sheet, this.row, this.col, val);
            if (this.callback) {
                this.callback(val);
            }
            return val;
        },

        resolveCells: function(a, f) {
            var context = this, formulas = [];

            if ((function loop(a){
                for (var i = 0; i < a.length; ++i) {
                    var x = a[i];
                    if (x instanceof Ref) {
                        if (!add(context.ss.getRefCells(x))) {
                            context.error(new CalcError("CIRCULAR"));
                            return true;
                        }
                    }
                    if (Array.isArray(x)) {
                        // make sure we resolve cells in literal matrices
                        if (loop(x)) {
                            return true;
                        }
                    }
                }
            })(a)) {
                // some circular dep was detected, stop here.
                return;
            }

            if (!formulas.length) {
                return f.call(context);
            }

            for (var pending = formulas.length, i = 0; i < formulas.length; ++i) {
                fetch(formulas[i]);
            }
            function fetch(cell) {
                cell.formula.exec(context.ss, cell.sheet, cell.row, cell.col, function(val){
                    if (!--pending) {
                        f.call(context);
                    }
                });
            }
            function add(a) {
                for (var i = 0; i < a.length; ++i) {
                    var cell = a[i];
                    if (cell.formula) {
                        if (cell.formula === context.formula) {
                            return false;
                        }
                        formulas.push(cell);
                    }
                }
                return true;
            }
        },

        cellValues: function(a, f) {
            var ret = [];
            for (var i = 0; i < a.length; ++i) {
                var val = a[i];
                if (val instanceof Ref) {
                    val = this.ss.getData(val);
                    ret = ret.concat(val);
                } else {
                    ret.push(val);
                }
            }
            if (f) {
                return f.apply(this, ret);
            }
            return ret;
        },

        force: function(val) {
            if (val instanceof Ref) {
                return this.ss.getData(val);
            }
            return val;
        },

        forNumbers: function(a, f) {
            if (a instanceof Ref) {
                a = this.cellValues([ a ]);
            }
            else if (a instanceof Matrix) {
                a = a.data;
            }
            if (Array.isArray(a)) {
                for (var i = 0; i < a.length; ++i) {
                    this.forNumbers(a[i], f);
                }
            }
            if (typeof a == "number") {
                f(a);
            }
        },

        func: function(fname, callback, args) {
            fname = fname.toLowerCase();
            if (Object.prototype.hasOwnProperty.call(FUNCS, fname)) {
                return FUNCS[fname].call(this, callback, args);
            }
            this.error(new CalcError("NAME"));
        },

        bool: function(val) {
            if (val instanceof Ref) {
                val = this.ss.getData(val);
            }
            if (typeof val == "string") {
                return val.toLowerCase() == "true";
            }
            if (typeof val == "number") {
                return val !== 0;
            }
            if (typeof val == "boolean") {
                return val;
            }
            return val != null;
        },

        divide: function(callback, left, right) {
            if (right === 0) {
                this.error(new CalcError("DIV/0"));
            } else {
                callback(left / right);
            }
        },

        asMatrix: function(range) {
            if (range instanceof Matrix) {
                return range;
            }
            var self = this;
            if (range instanceof RangeRef) {
                var tl = range.topLeft;
                var cells = self.ss.getRefCells(range);
                var m = new Matrix(self);
                // XXX: infinite range?  tl.row / tl.col will be infinite, thus endless loop later
                // (i.e. in Matrix.each).
                cells.forEach(function(cell){
                    m.set(cell.row - tl.row,
                          cell.col - tl.col,
                          cell.value);
                });
                return m;
            }
            if (Array.isArray(range) && range.length > 0) {
                var m = new Matrix(self), row = 0;
                range.forEach(function(line){
                    var col = 0;
                    var h = 1;
                    line.forEach(function(el){
                        var isRange = el instanceof RangeRef;
                        if (el instanceof Ref && !isRange) {
                            el = self.ss.getData(el);
                        }
                        if (isRange || Array.isArray(el)) {
                            el = self.asMatrix(el);
                        }
                        if (el instanceof Matrix) {
                            el.each(function(el, r, c){
                                m.set(row + r, col + c, el);
                            });
                            h = Math.max(h, el.height);
                            col += el.width;
                        } else {
                            m.set(row, col++, el);
                        }
                    });
                    row += h;
                });
                return m;
            }
        }
    });

    var Matrix = Class.extend({
        init: function Matrix(context) {
            this.context = context;
            this.height = 0;
            this.width = 0;
            this.data = [];
        },
        get: function(row, col) {
            var line = this.data[row];
            var val = line ? line[col] : null;
            return val instanceof Ref ? this.context.ss.getData(val) : val;
        },
        set: function(row, col, data) {
            var line = this.data[row];
            if (line == null) {
                line = this.data[row] = [];
            }
            line[col] = data;
            if (row >= this.height) {
                this.height = row + 1;
            }
            if (col >= this.width) {
                this.width = col + 1;
            }
        },
        each: function(f, includeEmpty) {
            for (var row = 0; row < this.height; ++row) {
                for (var col = 0; col < this.width; ++col) {
                    var val = this.get(row, col);
                    if (includeEmpty || val != null) {
                        val = f.call(this.context, val, row, col);
                        if (val !== undefined) {
                            return val;
                        }
                    }
                }
            }
        },
        map: function(f, includeEmpty) {
            var m = new Matrix(this.context);
            this.each(function(el, row, col){
                // here `this` is actually the context
                m.set(row, col, f.call(this, el, row, col));
            }, includeEmpty);
            return m;
        },
        eachRow: function(f) {
            for (var row = 0; row < this.height; ++row) {
                var val = f.call(this.context, row);
                if (val !== undefined) {
                    return val;
                }
            }
        },
        eachCol: function(f) {
            for (var col = 0; col < this.width; ++col) {
                var val = f.call(this.context, col);
                if (val !== undefined) {
                    return val;
                }
            }
        },
        mapRow: function(f) {
            var m = new Matrix(this.context);
            this.eachRow(function(row){
                m.set(row, 0, f.call(this.context, row));
            });
            return m;
        },
        mapCol: function(f) {
            var m = new Matrix(this.context);
            this.eachCol(function(col){
                m.set(0, col, f.call(this.context, col));
            });
            return m;
        },
        toString: function() {
            return JSON.stringify(this.data);
        },
        transpose: function() {
            var m = new Matrix(this.context);
            this.each(function(el, row, col){
                m.set(col, row, el);
            });
            return m;
        }
    });

    /* -----[ Formula ]----- */

    var Formula = Class.extend({
        init: function Formula(refs, handler, printer){
            this.refs = refs;
            this.handler = handler;
            this.print = printer;
            this.absrefs = null;
        },
        clone: function() {
            return new Formula(this.refs, this.handler, this.print);
        },
        exec: function(ss, sheet, row, col, callback) {
            if ("value" in this) {
                if (callback) {
                    callback(this.value);
                }
            } else {
                if (!this.absrefs) {
                    this.absrefs = this.refs.map(function(ref){
                        return ref.absolute(row, col);
                    }, this);
                }
                var ctx = new Context(callback, this, ss, sheet, row, col);
                ctx.resolveCells(this.absrefs, this.handler);
            }
        },
        reset: function() {
            delete this.value;
        },
        adjust: function(operation, start, delta, formulaRow, formulaCol) {
            this.absrefs = null;
            this.refs = this.refs.map(function(ref){
                if (ref instanceof CellRef) {
                    return deletesCell(ref) ? NULL : fixCell(ref);
                }
                else if (ref instanceof RangeRef) {
                    var del_start = deletesCell(ref.topLeft);
                    var del_end = deletesCell(ref.bottomRight);
                    if (del_start && del_end) {
                        return NULL;
                    }
                    if (del_start) {
                        // this case is rather tricky to handle with relative references.  what we
                        // want here is that the range top-left stays in place, even if the cell
                        // itself is being deleted.  So, we (1) convert it to absolute cell based on
                        // formula position, then make it relative to the location where the formula
                        // will end up after the deletion.
                        return new RangeRef(
                            ref.topLeft
                                .absolute(formulaRow, formulaCol)
                                .relative(
                                    operation == "row" ? fixNumber(formulaRow) : formulaRow,
                                    operation == "col" ? fixNumber(formulaCol) : formulaCol,
                                    ref.topLeft.rel
                                ),
                            fixCell(ref.bottomRight)
                        ).setSheet(ref.sheet, ref.hasSheet());
                    }
                    return new RangeRef(
                        fixCell(ref.topLeft),
                        fixCell(ref.bottomRight)
                    ).setSheet(ref.sheet, ref.hasSheet());
                }
                else if (!(ref instanceof NameRef)) {
                    throw new Error("Unknown reference in adjust");
                }
            });
            function deletesCell(ref) {
                if (delta >= 0) {
                    return false;
                }
                ref = ref.absolute(formulaRow, formulaCol);
                if (operation == "row") {
                    return ref.row >= start && ref.row < start - delta;
                } else {
                    return ref.col >= start && ref.col < start - delta;
                }
            }
            function fixCell(ref) {
                return new CellRef(
                    operation == "row" ? fixNumber(ref.row, ref.rel & 2, formulaRow) : ref.row,
                    operation == "col" ? fixNumber(ref.col, ref.rel & 1, formulaCol) : ref.col,
                    ref.rel
                ).setSheet(ref.sheet, ref.hasSheet());
            }
            function fixNumber(num, relative, base) {
                if (relative) {
                    var abs = base + num;
                    if (abs < start && start <= base) {
                        return num - delta;
                    } else if (base < start && start <= abs) {
                        return num + delta;
                    } else {
                        return num;
                    }
                } else {
                    if (num >= start) {
                        return num + delta;
                    } else {
                        return num;
                    }
                }
            }
        }
    });

    // spreadsheet functions --------

    function arrayHandler1(func) {
        return function doit(val) {
            var m = this.asMatrix(val);
            return m ? m.map(doit) : this.cellValues([ val ], func);
        };
    }

    function arrayHandler2(func) {
        return function doit(left, right) {
            var mleft = this.asMatrix(left);
            var mright = this.asMatrix(right);
            if (mleft && mright) {
                return mleft.map(function(el, row, col){
                    return doit.call(this, el, mright.get(row, col));
                });
            }
            else if (mleft) {
                return mleft.map(function(el){
                    return doit.call(this, el, right);
                });
            }
            else if (mright) {
                return mright.map(function(el){
                    return doit.call(this, left, el);
                });
            }
            else {
                return this.cellValues([ left, right ], func);
            }
        };
    }

    function binaryNumeric(func) {
        var handler = arrayHandler2(function(left, right){
            left = +left;
            right = +right;
            if (isNaN(left) || isNaN(right)) {
                return new CalcError("VALUE");
            }
            else {
                return func(left, right);
            }
        });
        return function(callback, args) {
            callback(handler.call(this, args[0], args[1]));
        };
    }

    function binaryCompare(func) {
        var handler = arrayHandler2(function(left, right){
            if (typeof left == "string" && typeof right != "string") {
                right = right == null ? "" : right + "";
            }
            if (typeof left != "string" && typeof right == "string") {
                left = left == null ? "" : left + "";
            }
            if (typeof left == "number" && right == null) {
                right = 0;
            }
            if (typeof right == "number" && left == null) {
                left = 0;
            }
            if (typeof left == "string" && typeof right == "string") {
                // string comparison is case insensitive
                left = left.toLowerCase();
                right = right.toLowerCase();
            }
            if (typeof right == typeof left) {
                return func.call(this, left, right);
            } else {
                return new CalcError("VALUE");
            }
        });
        return function(callback, args) {
            callback(handler.call(this, args[0], args[1]));
        };
    }

    function unaryNumeric(func) {
        var handler = arrayHandler1(function(exp){
            exp = +exp;
            if (isNaN(exp)) {
                return new CalcError("VALUE");
            } else {
                return func.call(this, exp);
            }
        });
        return function(callback, args) {
            callback(handler.call(this, args[0]));
        };
    }

    var FUNCS = {

        /* -----[ binary ops ]----- */

        // arithmetic
        "binary+": binaryNumeric(function(left, right){
            return left + right;
        }),
        "binary-": binaryNumeric(function(left, right){
            return left - right;
        }),
        "binary*": binaryNumeric(function(left, right){
            return left * right;
        }),
        "binary/": binaryNumeric(function(left, right){
            if (right === 0) {
                return new CalcError("DIV/0");
            }
            return left / right;
        }),
        "binary^": binaryNumeric(function(left, right){
            return Math.pow(left, right);
        }),

        // text concat
        "binary&": (function(){
            var handler = arrayHandler2(function(left, right){
                if (left == null) { left = ""; }
                if (right == null) { right = ""; }
                return "" + left + right;
            });
            return function(callback, args) {
                callback(handler.call(this, args[0], args[1]));
            };
        })(),

        // boolean
        "binary=": (function(){
            var handler = arrayHandler2(function(left, right){
                return left === right;
            });
            return function(callback, args) {
                callback(handler.call(this, args[0], args[1]));
            };
        })(),
        "binary<>": (function(){
            var handler = arrayHandler2(function(left, right){
                return left !== right;
            });
            return function(callback, args) {
                callback(handler.call(this, args[0], args[1]));
            };
        })(),
        "binary<": binaryCompare(function(left, right){
            return left < right;
        }),
        "binary<=": binaryCompare(function(left, right){
            return left <= right;
        }),
        "binary>": binaryCompare(function(left, right){
            return left > right;
        }),
        "binary>=": binaryCompare(function(left, right){
            return left >= right;
        }),

        // range
        "binary:": function(callback, args) {
            var left = args[0], right = args[1];
            if (left instanceof CellRef && right instanceof CellRef) {
                callback(new RangeRef(left, right).setSheet(left.sheet || this.formula.sheet, left.hasSheet()));
            } else {
                this.error(new CalcError("REF"));
            }
        },
        // union
        "binary,": function(callback, args) {
            var left = args[0], right = args[1];
            if (left instanceof Ref && right instanceof Ref) {
                callback(new UnionRef([ left, right ]));
            } else {
                this.error(new CalcError("REF"));
            }
        },
        // intersect
        "binary ": function(callback, args) {
            var left = args[0], right = args[1];
            if (left instanceof Ref && right instanceof Ref) {
                var x = left.intersect(right);
                if (x === NULL) {
                    this.error(new CalcError("NULL"));
                } else {
                    callback(x);
                }
            } else {
                this.error(new CalcError("REF"));
            }
        },

        /* -----[ unary ops ]----- */

        "unary+": unaryNumeric(function(exp) {
            return exp;
        }),
        "unary-": unaryNumeric(function(exp) {
            return -exp;
        }),
        "unary%": unaryNumeric(function(exp) {
            return exp/100;
        }),

        /* -----[ conditional ]----- */

        "if": function(callback, args) {
            var self = this;
            var co = args[0], th = args[1], el = args[2];
            var comatrix = self.asMatrix(co);
            if (comatrix) {
                // XXX: calling both branches in this case, since we'll typically need values from
                // both.  We could optimize and call them only when first needed, but oh well.
                th(function(th){
                    el(function(el){
                        var thmatrix = self.asMatrix(th);
                        var elmatrix = self.asMatrix(el);
                        callback(comatrix.map(function(val, row, col){
                            if (self.bool(val)) {
                                return thmatrix ? thmatrix.get(row, col) : th;
                            } else {
                                return elmatrix ? elmatrix.get(row, col) : el;
                            }
                        }));
                    });
                });
            } else {
                if (self.bool(co)) {
                    th(callback);
                } else {
                    el(callback);
                }
            }
        },

        "not": (function(){
            var handler = arrayHandler1(function(x){
                return !this.bool(x);
            });
            return function(callback, args) {
                callback(handler.call(this, args[0]));
            };
        })(),

        /* -----[ error catching ]----- */

        "-catch": function(callback, args){
            var fname = args[0].toLowerCase();
            var prevCallback = this.callback;
            this.callback = function(ret) {
                this.callback = prevCallback;
                var val = this.cellValues([ ret ])[0];
                switch (fname) {
                  case "isblank":
                    if (ret instanceof CellRef) {
                        return callback(val == null || val === "");
                    }
                    return callback(false);
                  case "iserror":
                    return callback(val instanceof CalcError);
                  case "iserr":
                    return callback(val instanceof CalcError && val.code != "N/A");
                  case "islogical":
                    return callback(typeof val == "boolean");
                  case "isna":
                    return callback(val instanceof CalcError && val.code == "N/A");
                  case "isnontext":
                    return callback(typeof val != "string" || val === "");
                  case "isref":
                    // apparently should return true only for cell and range
                    return callback(ret instanceof CellRef || ret instanceof RangeRef);
                  case "istext":
                    return callback(typeof val == "string" && val !== "");
                  case "isnumber":
                    return callback(typeof val == "number");
                }
                this.error("CATCH");
            };
            args[1]();
        }

    };

    function compileArgumentChecks(args, postlude) {
        var resolve = "var toResolve = [], i = 0; ";
        var name, out, forced, main = "var xargs = [], i = 0, m, err = 'VALUE'; ", haveForced = false;
        main += args.map(comp).join("");
        main += "if (i < args.length) return this.error(new CalcError('N/A')); ";

        if (haveForced) {
            out = resolve
                + "this.resolveCells(toResolve, function(){ "
                + main + postlude
                + "}); ";
        } else {
            out = main + postlude;
        }

        return out;

        function comp(x) {
            name = x[0];
            var code = "{ ";
            if (Array.isArray(name)) {
                resolve += "while (i < args.length) { ";
                code += "while (i < args.length) { ";
                code += x.map(comp).join("");
                code += "} ";
                resolve += "} ";
            } else if (name == "+") {
                resolve += "while (i < args.length) { ";
                code += "do { ";
                code += x.slice(1).map(comp).join("");
                code += "} while (i < args.length); ";
                resolve += "} ";
            } else {
                var type = x[1];
                code += "var $" + name + " = args[i++]; if ($"+name+" instanceof CalcError) return this.error($"+name+"); "
                    + typeCheck(type) + "xargs.push($"+name+"); ";
            }
            code += "} ";
            return code;
        }

        function force() {
            if (forced) {
                return "$"+name+"";
            }
            haveForced = true;
            forced = true;
            resolve += "toResolve.push(args[i++]); ";
            return "($"+name+" = this.force($"+name+"))";
        }

        function typeCheck(type) {
            forced = false;
            var ret = "if (!(" + cond(type) + ")) return this.error(new CalcError(err)); ";
            if (!forced) {
                resolve += "i++; ";
            }
            return ret;
        }

        function cond(type) {
            if (Array.isArray(type)) {
                if (type[0] == "or") {
                    return "(" + type.slice(1).map(cond).join(") || (") + ")";
                }
                if (type[0] == "and") {
                    return "(" + type.slice(1).map(cond).join(") && (") + ")";
                }
                if (type[0] == "values") {
                    return "(" + type.slice(1).map(function(val){
                        return force() + " === " + val;
                    }).join(") || (") + ")";
                }
                if (type[0] == "null") {
                    return "(" + cond("null") + " ? ($"+name+" = " + type[1] + ", true) : false)";
                }
                if (type[0] == "between") {
                    return "(" + force() + " >= " + type[1] + " && " + "$"+name+" <= " + type[2] + ")";
                }
                if (type[0] == "assert") {
                    return "(" + type[1] + ")";
                }
                throw new Error("Unknown array type condition: " + type[0]);
            }
            if (type == "number") {
                return "(typeof " + force() + " == 'number' || typeof $"+name+" == 'boolean')";
            }
            if (type == "divisor") {
                return "((typeof " + force() + " == 'number' || typeof $"+name+" == 'boolean') && "
                    + "($"+name+" === 0 ? ((err = 'DIV/0'), false) : true))";
            }
            if (type == "number+") {
                return "((typeof " + force() + " == 'number' || typeof $"+name+" == 'boolean') && $"+name+" >= 0)";
            }
            if (type == "number++") {
                return "((typeof " + force() + " == 'number' || typeof $"+name+" == 'boolean') && $"+name+" > 0)";
            }
            if (type == "string") {
                return "(typeof " + force() + " == 'string')";
            }
            if (type == "boolean") {
                return "(typeof " + force() + " == 'boolean')";
            }
            if (type == "matrix") {
                force();
                return "((m = this.asMatrix($"+name+")) ? ($"+name+" = m) : false)";
            }
            if (type == "ref") {
                return "($"+name+" instanceof kendo.spreadsheet.Ref)";
            }
            if (type == "area") {
                return "($"+name+" instanceof kendo.spreadsheet.CellRef || $"+name+" instanceof kendo.spreadsheet.RangeRef)";
            }
            if (type == "cell") {
                return "($"+name+" instanceof kendo.spreadsheet.CellRef)";
            }
            if (type == "null") {
                return "(" + force() + " == null)";
            }
            if (type == "any") {
                return "(" + force() + ", i <= args.length)";
            }
            if (type == "any*") {
                return "(i <= args.length)";
            }
            throw new Error("Can't check for type: " + type);
        }
    }

    function defineFunction(name, func) {
        name = name.toLowerCase();
        FUNCS[name] = func;
        return {
            args: function(args, log) {
                var code = compileArgumentChecks(
                    args,
                    ("var v = handler.apply(this, xargs); " +
                     "if (v instanceof CalcError) this.error(v); else callback(v); ")
                );
                defun(name, code, log);
                return this;
            },
            argsAsync: function(args, log) {
                var code = compileArgumentChecks(
                    args,
                    ("xargs.unshift(callback); " +
                     "handler.apply(this, xargs); ")
                );
                defun(name, code, log);
                return this;
            }
        };
        function defun(name, code, log) {
            code = [
                "return function " + fname(name) + "(callback, args) { ",
                "'use strict'; ", code, "};"
            ].join("");
            var f = new Function("handler", "CalcError", code);
            FUNCS[name] = f(func, CalcError);

            // XXX: debug
            if (log) {
                console.log(FUNCS[name].toString());
            }
        }
        function fname(name) {
            return name.replace(/[^a-z0-9_]/g, function(s){
                return "$" + s.charCodeAt(0) + "$";
            });
        }
    }

    /* -----[ date calculations ]----- */

    var DAYS_IN_MONTH = [ 31, 28, 31,
                          30, 31, 30,
                          31, 31, 30,
                          31, 30, 31 ];

    function isLeapYear(yr) {
        // if (yr == 1900) {
        //     return true;        // Excel's Leap Year Bug™
        // }
        if (yr % 4) {
            return false;
        }
        if (yr % 100) {
            return true;
        }
        if (yr % 400) {
            return false;
        }
        return true;
    }

    function daysInYear(yr) {
        return isLeapYear(yr) ? 366 : 365;
    }

    function daysInMonth(yr, mo) {
        return (isLeapYear(yr) && mo == 1) ? 29 : DAYS_IN_MONTH[mo];
    }

    function unpackDate(serial) {
        // This uses the Google Spreadsheet approach: treat 1899-12-31
        // as day 1, allowing to avoid implementing the "Leap Year
        // Bug" yet still be Excel compatible for dates starting
        // 1900-03-01.
        return _unpackDate(serial - 1);
    }

    function packDate(date, month, year) {
        return _packDate(date, month, year) + 1;
    }

    var MS_IN_MIN = 60 * 1000;
    var MS_IN_HOUR = 60 * MS_IN_MIN;
    var MS_IN_DAY = 24 * MS_IN_HOUR;

    function unpackTime(serial) {
        var frac = serial - (serial|0);
        if (frac < 0) {
            frac++;
        }
        var ms = Math.round(MS_IN_DAY * frac);
        var hours = Math.floor(ms / MS_IN_HOUR);
        ms -= hours * MS_IN_HOUR;
        var minutes = Math.floor(ms / MS_IN_MIN);
        ms -= minutes * MS_IN_MIN;
        var seconds = Math.floor(ms / 1000);
        ms -= seconds * 1000;
        return {
            hours: hours,
            minutes: minutes,
            seconds: seconds,
            milliseconds: ms
        };
    }

    function serialToDate(serial) {
        var d = unpackDate(serial), t = unpackTime(serial);
        return new Date(d.year, d.month, d.date,
                        t.hours, t.minutes, t.seconds, t.milliseconds);
    }

    // Unpack date by assuming serial is number of days since
    // 1900-01-01 (that being day 1).  Negative numbers are allowed
    // and go backwards in time.
    function _unpackDate(serial) {
        serial |= 0;            // discard time part
        var month, tmp;
        var backwards = serial <= 0;
        var year = 1900;
        var day = serial % 7;   // 1900-01-01 was a Monday
        if (backwards) {
            serial = -serial;
            year--;
            day = (day + 7) % 7;
        }

        while (serial >= (tmp = daysInYear(year))) {
            serial -= tmp;
            year += backwards ? -1 : 1;
        }

        if (backwards) {
            month = 11;
            while (serial >= (tmp = daysInMonth(year, month))) {
                serial -= tmp;
                month--;
            }
            serial = tmp - serial;
        } else {
            month = 0;
            while (serial > (tmp = daysInMonth(year, month))) {
                serial -= tmp;
                month++;
            }
        }

        return {
            year: year, month: month, date: serial, day: day
        };
    }

    function _packDate(year, month, date) {
        var serial = 0;
        if (year >= 1900) {
            for (var i = 1900; i < year; ++i) {
                serial += daysInYear(i);
            }
        } else {
            for (var i = 1899; i >= year; --i) {
                serial -= daysInYear(i);
            }
        }
        for (var i = 0; i < month; ++i) {
            serial += daysInMonth(year, i);
        }
        serial += date;
        return serial;
    }

    function packTime(hours, minutes, seconds, ms) {
        return (hours + minutes/60 + seconds/3600 + ms/3600000) / 24;
    }

    function dateToSerial(date) {
        var time = packTime(date.getHours(),
                            date.getMinutes(),
                            date.getSeconds(),
                            date.getMilliseconds());
        date = packDate(date.getFullYear(),
                        date.getMonth(),
                        date.getDate());
        if (date < 0) {
            return date - 1 + time;
        } else {
            return date + time;
        }
    }

    /* -----[ exports ]----- */

    exports.CalcError = CalcError;
    exports.Formula = Formula;
    exports.arrayHandler1 = arrayHandler1;
    exports.arrayHandler2 = arrayHandler2;
    exports.Matrix = Matrix;

    exports.packDate = packDate;
    exports.unpackDate = unpackDate;
    exports.packTime = packTime;
    exports.unpackTime = unpackTime;
    exports.serialToDate = serialToDate;
    exports.dateToSerial = dateToSerial;

    exports.defineFunction = defineFunction;

}, typeof define == 'function' && define.amd ? define : function(_, f){ f(); });
