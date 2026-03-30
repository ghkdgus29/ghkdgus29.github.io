---
layout: post
author: Hyun 
title: A Deep Dive into Python Bytecode
date:   2026-03-30 16:57:00 +0900
excerpt: "A Deep Dive into Python Bytecode"
categories:
 - Engineering
 - Python
 - Bytecode
lang: en
lang_ref: /A-Deep-Dive-into-Python-Bytecode-KR/
---

# Bytecode Intro

You can view module-level bytecode with `python -m dis <module_name>`.

```
  4           LOAD_GLOBAL              1 (len + NULL)
```
> Example bytecode

Python bytecode consists of: `line_number | opname | arg | argrepr`.

`line_number` refers to the line number in the module file.
`opcode` is the human-readable name of a bytecode instruction.
`arguments` are the operands passed to a bytecode instruction, and `argrepr` is a human-readable string representation of the given `arg`.

<br>

# code object and attributes
A code object is a container holding various information in byte-compiled form, and represents executable Python code.
In other words, a code object is finalized at compile time — it is immutable and holds no references to mutable objects.

A code object has several read-only attributes. Using the example code below, we'll cover a few attributes that appear frequently throughout this document.

```python
def foo(a, b):
    print("hi")
    c = a + b
    print(c)
```

<br>

## co_consts
```
foo.__code__.co_consts
> ('hi', None)
```
A tuple containing the constants used by the bytecode inside the code object.

## co_names
```
foo.__code__.co_names
> ('print',)
```
A tuple containing the names used by the bytecode inside the code object. These names are dynamically used for reference lookup at runtime. In this example, it is used to look up the built-in function `print` at runtime.

## co_varnames
```
foo.__code__.co_varnames
> ('a', 'b', 'c')
```
A tuple containing the local variable names inside the code object. Parameter names are also included.

<br>

# namespace and LOAD, STORE

```python
x = "module"  # module namespace
print(globals())  # {'__name__': '__main__', 'x': 'module', ...}
print(locals())  # {'__name__': '__main__', 'x': 'module', ...}
print(globals() == locals())  # True


class MyClass:
    x = "class"  # class namespace

    def method(self):
        print(globals())  # {'__name__': '__main__', 'x': 'module', 'MyClass': <class '__main__.MyClass'>, 'a': <__main__.MyClass object at 0x0000029D21DE8590>, ...}
        print(locals())  # {'self': <__main__.MyClass object at 0x0000029D21DE8590>}

        x = "local"  # local namespace

        print(globals())  # {'__name__': '__main__', 'x': 'module', 'MyClass': <class '__main__.MyClass'>, 'a': <__main__.MyClass object at 0x0000029D21DE8590>, ...}
        print(locals())  # {'self': <__main__.MyClass object at 0x0000029D21DE8590>, 'x': 'local'}


a = MyClass()
a.method()
```
> `globals()` always returns the module-level namespace regardless of the currently executing scope, while `locals()` returns the namespace of the currently executing scope.

A namespace is a data structure that allows objects to be looked up by name — typically a dictionary.
Namespaces are divided into two levels: global and local. The global level refers to the namespace of the module where the code is defined, regardless of the scope from which the global namespace is accessed. The local level, on the other hand, varies depending on the scope in which the code is currently executing.

Python bytecode includes a family of `LOAD` instructions and a family of `STORE` instructions. Both are closely tied to namespaces.

<br>

## LOAD instructions
`LOAD` instructions push an object from a namespace onto the value stack. (except `LOAD_CONST`)

```
LOAD_FAST (var_num):
  value = fastlocals[var_num]          # direct array index → value (no lookup needed)
  stack.append(value)

LOAD_NAME (namei):
  name = co_names[namei]       
  value = locals[name]          # try locals first
       ?? globals[name]         # fallback to globals
       ?? builtins[name]        # fallback to builtins
  stack.append(value)            

LOAD_GLOBAL (namei):
  name = co_names[namei]       
  value = globals[name]          # try globals
       ?? builtins[name]         # fallback to builtins
  stack.append(value)            
```
> Behavior of each instruction

In the behavior described above, `locals` and `globals` refer to the namespaces explained earlier.

`LOAD_FAST` is somewhat special: within a function scope, the values of local variables are stored not in a dictionary-based namespace, but in a `fastlocals` value array. `co_varnames[i]` holds the variable name (a string), while `fastlocals[i]` holds the actual value (an object) of that variable — both indexed by the same `i`. In summary, `co_varnames` is a name array holding local variable names, and `fastlocals` is a value array holding their actual values. (This is specific to the CPython implementation.)

<br>

## STORE instructions
`STORE` instructions pop an object from the stack and assign it to a namespace.

```
STORE_FAST (var_num):
  value = stack.pop()
  fastlocals[var_num] = value    # direct array write, no lookup

STORE_NAME (namei):
  value = stack.pop()
  name  = co_names[namei]        
  locals[name] = value         

STORE_GLOBAL (namei):
  value = stack.pop()
  name  = co_names[namei]        
  globals[name] = value        
```

In the behavior described above, `locals` and `globals` refer to the namespaces explained earlier.

`STORE_NAME` is a bytecode instruction emitted in module scope, class scope, and `exec`/`eval` contexts. `STORE_GLOBAL` is only emitted when the `global` keyword is explicitly used. Since `locals` and `globals` refer to the same namespace at module scope, `locals[name] = value` still assigns the value to the module-level namespace.

<br>

# A Simple Function Bytecode Analysis
```python
def myfunc(alist):
    return len(alist)
```
```
  3           RESUME                   0

  4           LOAD_GLOBAL              1 (len + NULL)
              LOAD_FAST_BORROW         0 (alist)
              CALL                     1
              RETURN_VALUE
```

<br>

## RESUME 0
`RESUME (context)`

A no-op marker instruction. When `context` is `0`, it indicates a regular function.

```
[]
```
> value stack after execution

<br>

## LOAD_GLOBAL 1 (len + NULL)
`LOAD_GLOBAL (namei)`

```
stack.append(NULL)
name = co_names[namei >> 1]
stack.append(builtins[name])
```
> instruction behavior

`namei` represents a name index. Since `len` is not in the global namespace, it is looked up in the builtins namespace, and the `len` function object is pushed onto the stack.

```
[NULL, len function]
```
> value stack after execution

<br>

### Why `co_names[namei >> 1]` is used to retrieve the name

If the function being called is a method belonging to an instance, a reference to that instance is also required. Therefore, in some cases, both the function object reference and the reference to the instance that owns the method must be pushed onto the value stack together. If the function is not a method, `NULL` is pushed in place of the instance reference.

In other words, there are cases where both the function reference and the owning instance reference must be pushed onto the value stack together, and cases where only the function reference needs to be pushed.

This is determined by the least significant bit of `namei`, which serves as a flag bit. If the flag bit is `1`, both the function reference and the instance reference (or `NULL`) must be pushed onto the value stack. If the flag bit is `0`, only the function reference is pushed. A flag bit of `0` indicates that the function is being referenced but not immediately called.

```python
def myfunc():
    a = len  # referencing len without calling it
```

```
  3           RESUME                   0

  4           LOAD_GLOBAL              0 (len)
              STORE_FAST               0 (a)
              LOAD_CONST               0 (None)
              RETURN_VALUE
```

Since the flag bit of `namei` is used solely to distinguish between these two cases, it is not part of the index used to look up the name. Therefore, `namei` is right-shifted by 1 bit before indexing into `co_names`.

<br>

## LOAD_FAST_BORROW 0 (alist)
`LOAD_FAST_BORROW (var_num)`

```
value = fastlocals[var_num]
stack.append(value)
```
> instruction behavior

At the time the code object is created, parameter names are stored in `co_varnames` starting from index `0` in order. Likewise, at the time of a function call, parameter values are stored in `fastlocals` starting from index `0` in order — without requiring an explicit `STORE_FAST`.

The difference from `LOAD_FAST` is that it does not increment the reference count, even though the value stack holds a reference to the variable. It assumes that `fastlocals[0]` already references the `alist` value and that it will not be freed. A reference held on the value stack without incrementing the reference count is called a borrowed reference.

```
[NULL, len function, alist]
```
> value stack after execution

<br>

## CALL 1
`CALL (argc)`

```
args = [stack.pop() for i in range(argc)]
function, instance = stack.pop(), stack.pop()
value = function(instance, ...args)
stack.append(value)
```
> instruction behavior

Pushes the return value of `len(alist)` onto the value stack.

```
[length of alist]
```
> value stack after execution

<br>

## RETURN_VALUE
Returns the value at `value_stack[-1]` to the caller.

<br>

# Bytecode Analysis of the `add` Function

```python
def add(a, b):
    return a+b

result = add(3, 5)
```
```
  0           RESUME                   0

  1           LOAD_CONST               0 (<code object add at 0x000001670206DC50, file "test.py", line 1>)
              MAKE_FUNCTION
              STORE_NAME               0 (add)

  4           LOAD_NAME                0 (add)
              PUSH_NULL
              LOAD_SMALL_INT           3
              LOAD_SMALL_INT           5
              CALL                     2
              STORE_NAME               1 (result)
              LOAD_CONST               1 (None)
              RETURN_VALUE

Disassembly of <code object add at 0x000001670206DC50, file "test.py", line 1>:
  1           RESUME                   0

  2           LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
              BINARY_OP                0 (+)
              RETURN_VALUE
```

The bytecode above can be split into two parts: the function bytecode and the module bytecode.

<br>

## Function bytecode
```
Disassembly of <code object add at 0x000001670206DC50, file "test.py", line 1>:
  1           RESUME                   0

  2           LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
              BINARY_OP                0 (+)
              RETURN_VALUE
```
> Bytecode executed every time the `add` function is called

### LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
`LOAD_FAST_BORROW_LOAD_FAST_BORROW (var_nums)`

```
value1 = fastlocals[var_nums >> 4]
value2 = fastlocals[var_nums & 15]
stack.append(value1)
stack.append(value2)
```
> instruction behavior

This is a super-instruction that combines two `LOAD_FAST_BORROW` calls into a single bytecode dispatch. This optimization reduces instruction dispatch overhead and interpreter loop iterations, resulting in improved execution speed. As with `LOAD_FAST_BORROW`, references pushed onto the value stack are borrowed references — the reference count is not incremented.

```
[a, b]
```
> value stack after execution

<br>

### BINARY_OP 0 (+)
`BINARY_OP (op)`

```
rhs = STACK.pop()
lhs = STACK.pop()
stack.append(lhs op rhs)
```
> instruction behavior

Pops both operands from the stack, performs the binary operation, and pushes the result onto the value stack.

```
[a + b]
```
> value stack after execution

<br>

## Module bytecode
```
  0           RESUME                   0

  1           LOAD_CONST               0 (<code object add at 0x000001670206DC50, file "test.py", line 1>)
              MAKE_FUNCTION
              STORE_NAME               0 (add)

  4           LOAD_NAME                0 (add)
              PUSH_NULL
              LOAD_SMALL_INT           3
              LOAD_SMALL_INT           5
              CALL                     2
              STORE_NAME               1 (result)
              LOAD_CONST               1 (None)
              RETURN_VALUE
```
> Bytecode executed only once when the module is first imported

<br>

### LOAD_CONST 0 (\<code object add at ...)
`LOAD_CONST (consti)`

```
value = co_consts[consti]
stack.append(value)
```
> instruction behavior

Since a code object is static information finalized at compile time, it is managed in `co_consts`. The module's `co_consts[0]` is the code object for the `add` function.

```
[code object add]
```
> value stack after execution

<br>

### MAKE_FUNCTION
```
code_obj = stack.pop()
function_obj = make_function(code_obj)
stack.append(function_obj)
```
> instruction behavior

A function object is a dynamic, runtime object that wraps a static code object and carries runtime context.

```
[add function]
```
> value stack after execution

<br>

### STORE_NAME 0 (add)
`STORE_NAME (namei)`

```
value = stack.pop()
name = co_names[namei]
locals[name] = value
```
> instruction behavior

`name` is `'add'` and `value` is the `add` function object. This registers the `add` function in the module's namespace.

```
[]
```
> value stack after execution

<br>

### LOAD_NAME 0 (add)
`LOAD_NAME (namei)`

```
name = co_names[namei]       
value = locals[name]          
stack.append(value)            
```
> instruction behavior

Pushes the `add` function from the namespace onto the value stack.

```
[add function]
```
> value stack after execution

<br>

### PUSH_NULL
```
stack.append(NULL)
```
> instruction behavior

Calling a function requires two objects on the stack: the function object and the instance that owns it. However, for non-method calls, the function does not belong to any instance, so `NULL` is pushed in place of the instance. Even though no instance is needed, `NULL` is pushed rather than nothing in order to maintain a uniform calling convention. In this example, `add` is a module-level function that requires no `self`, so `NULL` is pushed.

```
[add function, NULL]
```
> value stack after execution

<br>

### LOAD_SMALL_INT 3, LOAD_SMALL_INT 5
```
stack.append(i)  # i is a small int
```
> instruction behavior

Pushes the argument values onto the stack in preparation for the function call.

```
[add function, NULL, 3, 5]
```
> value stack after execution

<br>

### CALL 2, STORE_NAME 1 (result)
```
args = [stack.pop() for i in range(argc)]
function, instance = stack.pop(), stack.pop()
value = function(instance, ...args)
stack.append(value)

value = stack.pop()
name  = co_names[namei]        
locals[name] = value      
```
> instruction behavior

Assigns the return value of `add(3, 5)` to `result`.

```
[]
```
> value stack after execution

<br>

### LOAD_CONST 1 (None), RETURN_VALUE
As the final step of module execution, returns `None`.

<br>

# Bytecode Analysis of `error raise`

```python
def divide(a, b):
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b
```

```
Disassembly of <code object divide at 0x109bd1ce0, file "test.py", line 1>:
  1           RESUME                   0

  2           LOAD_FAST_BORROW         1 (b)
              LOAD_SMALL_INT           0
              COMPARE_OP              88 (bool(==))
              POP_JUMP_IF_FALSE       12 (to L1)
              NOT_TAKEN

  3           LOAD_GLOBAL              1 (ValueError + NULL)
              LOAD_CONST               1 ('Cannot divide by zero')
              CALL                     1
              RAISE_VARARGS            1

  4   L1:     LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
              BINARY_OP               11 (/)
              RETURN_VALUE
```
> Bytecode executed every time the `divide` function is called

<br>

## LOAD_FAST_BORROW 1 (b), LOAD_SMALL_INT 0, COMPARE_OP 88 (bool(==))
```
value = fastlocals[var_num]
stack.append(value)

stack.append(0)

rhs = stack.pop()
lhs = stack.pop()
stack.append(lhs op rhs)
```
> instruction behavior

```
[b == 0]
```
> value stack after execution

<br>

## POP_JUMP_IF_FALSE 12 (to L1)
`POP_JUMP_IF_FALSE (delta)`

```
value = stack.pop()
if value == false:
    instruction_counter += delta
```

If `b == 0` is false, execution follows the normal path — the instruction counter is advanced by `delta`, jumping to label `L1`. From there, the normal division is performed and the result is returned to the caller.

```
[]
```
> value stack after execution

<br>

## NOT_TAKEN

A no-op instruction. Used by the interpreter to record branch prediction events.

```
[]
```
> value stack after execution

<br>

## LOAD_GLOBAL 1 (ValueError + NULL), LOAD_CONST 1 ('Cannot divide by zero'), CALL 1

```
stack.append(NULL)
name = co_names[namei >> 1]
stack.append(builtins[name])

value = co_consts[consti]
stack.append(value)

args = [stack.pop() for i in range(argc)]
function, instance = stack.pop(), stack.pop()
value = function(instance, ...args)
stack.append(value)
```
> instruction behavior

Calling the `ValueError` class object means constructing a `ValueError` instance.

```
[ValueError instance]
```
> value stack after execution

<br>

## RAISE_VARARGS 1
`RAISE_VARARGS (argc)`

```
if argc == 0:
    raise
elif argc == 1:
    raise stack[-1]
elif argc == 2:
    raise stack[-2] from stack[-1]
```

Raises an exception in one of three forms depending on `argc`. In this example, `argc` is `1`, so the `ValueError` instance at the top of the value stack is raised.

```
[]
```
> value stack after execution

<br>

# Bytecode Analysis of `try`, `except`, and `finally`

```python
def divide(a, b):
    try:
        return a / b
    except ZeroDivisionError as e:
        print(e)
    finally:
        print("Execution completed.")
```

```
Disassembly of <code object divide at 0x00000226196B6A30, file "test.py", line 1>:
   1            RESUME                   0

   2            NOP

   3    L1:     LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
                BINARY_OP               11 (/)

   7    L2:     LOAD_GLOBAL              1 (print + NULL)
                LOAD_CONST               0 ('Execution completed.')
                CALL                     1
                POP_TOP
                RETURN_VALUE

  --    L3:     PUSH_EXC_INFO

   4            LOAD_GLOBAL              2 (ZeroDivisionError)
                CHECK_EXC_MATCH
                POP_JUMP_IF_FALSE       22 (to L7)
                NOT_TAKEN
                STORE_FAST               2 (e)

   5    L4:     LOAD_GLOBAL              1 (print + NULL)
                LOAD_FAST                2 (e)
                CALL                     1
                POP_TOP
        L5:     POP_EXCEPT
                LOAD_CONST               1 (None)
                STORE_FAST               2 (e)
                DELETE_FAST              2 (e)
                JUMP_FORWARD             8 (to L9)

  --    L6:     LOAD_CONST               1 (None)
                STORE_FAST               2 (e)
                DELETE_FAST              2 (e)
                RERAISE                  1

   4    L7:     RERAISE                  0

  --    L8:     COPY                     3
                POP_EXCEPT
                RERAISE                  1

   5    L9:     NOP

   7            LOAD_GLOBAL              1 (print + NULL)
                LOAD_CONST               0 ('Execution completed.')
                CALL                     1
                POP_TOP
                LOAD_CONST               1 (None)
                RETURN_VALUE

  --   L10:     PUSH_EXC_INFO

   7            LOAD_GLOBAL              1 (print + NULL)
                LOAD_CONST               0 ('Execution completed.')
                CALL                     1
                POP_TOP
                RERAISE                  0

  --   L11:     COPY                     3
                POP_EXCEPT
                RERAISE                  1

ExceptionTable:
  L1 to L2 -> L3 [0]
  L3 to L4 -> L8 [1] lasti
  L4 to L5 -> L6 [1] lasti
  L5 to L6 -> L10 [0]
  L6 to L8 -> L8 [1] lasti
  L8 to L9 -> L10 [0]
  L10 to L11 -> L11 [1] lasti
```

<br>

## Exception Table
A piece of metadata referenced when an error occurs within a specific range. It maps a range of bytecode to the exception handler responsible for handling any error that arises within that range. Each entry in the table follows the structure: `Protected Range -> Exception Handler [stack depth] (last_executed_bytecode_index)`.

To elaborate: if an error occurs while executing bytecode within the Protected Range, execution jumps to the Exception Handler. Ranges are expressed using labels, where "L1 to L2" means L1 is the Protected Range (L2 is not included).

`stack depth` is the number of items that must remain on the value stack at the point of entering the Exception Handler.

`last_executed_bytecode_index` is the index of the bytecode instruction where the error occurred. This is used to display the faulting line in the stack trace.

<br>

## Case-by-Case Analysis
The `divide` function covers four main cases.

<br>

### 1. Normal flow

```python
def divide(a, b):
    try:
        return a / b
    # except ZeroDivisionError as e:
    #     print(e)
    finally:
        print("Execution completed.")
```

The normal flow performs the division without raising an error and returns the result. Bytecode executes in the order `L1 → L2`.

```
   2            NOP

   3    L1:     LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
                BINARY_OP               11 (/)

   7    L2:     LOAD_GLOBAL              1 (print + NULL)
                LOAD_CONST               0 ('Execution completed.')
                CALL                     1
                POP_TOP
                RETURN_VALUE
```

<br>

#### NOP

Marks the start of the `try` block. Does nothing.

<br>

#### L1: LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b), BINARY_OP 11 (/)

Performs the division `a / b` and pushes the result onto the value stack.

```
[ a / b ]
```
> value stack after execution

<br>

#### L2: LOAD_GLOBAL 1 (print + NULL), LOAD_CONST 0 ('Execution completed.'), CALL 1

Enters the `finally` block without an error, calls `print`, and pushes its return value `None` onto the value stack.

```
[ a / b, None ]
```
> value stack after execution

<br>

#### POP_TOP
```
stack.pop()
```
> instruction behavior

Removes the return value `None` of the `print` call from the value stack.

```
[ a / b ]
```
> value stack after execution

<br>

#### RETURN_VALUE
Returns `value_stack[-1]`, the result of the division, to the caller.

<br>

### 2. ZeroDivisionError flow (success in except)

```python
def divide(a, b):
    try:
        return a / b
    except ZeroDivisionError as e:
        print(e)
    finally:
        print("Execution completed.")
```

This is the flow where `b == 0` causes a `ZeroDivisionError` in the `try` block. Bytecode executes in the order `L1 → L3 → L4 → L5 → L9`.

```
   3    L1:     LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
                BINARY_OP               11 (/)   <- ZeroDivisionError Raise!


    // ...

  --    L3:     PUSH_EXC_INFO

   4            LOAD_GLOBAL              2 (ZeroDivisionError)
                CHECK_EXC_MATCH
                POP_JUMP_IF_FALSE       22 (to L7)
                NOT_TAKEN
                STORE_FAST               2 (e)

   5    L4:     LOAD_GLOBAL              1 (print + NULL)
                LOAD_FAST                2 (e)
                CALL                     1
                POP_TOP
        L5:     POP_EXCEPT
                LOAD_CONST               1 (None)
                STORE_FAST               2 (e)
                DELETE_FAST              2 (e)
                JUMP_FORWARD             8 (to L9)

    // ...

   5    L9:     NOP

   7            LOAD_GLOBAL              1 (print + NULL)
                LOAD_CONST               0 ('Execution completed.')
                CALL                     1
                POP_TOP
                LOAD_CONST               1 (None)
                RETURN_VALUE

ExceptionTable:
  L1 to L2 -> L3 [0]
```
> If an error occurs at L1, jump to L3

<br>

#### L1: LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b), BINARY_OP 11 (/)
A `ZeroDivisionError` is raised when `BINARY_OP 11 (/)` executes. Per the Exception Table, execution jumps to the Exception Handler at L3.

```
[ZeroDivisionError instance]
```
> value stack after execution

<br>

#### L3: PUSH_EXC_INFO
```
value = stack.pop()
stack.append(current exception in thread state)
stack.append(value)
```
> instruction behavior

Marks the entry point of the `except` block. The current exception in thread state is pushed onto the stack to preserve any previously active error state. If no prior error occurred in the current thread, as in this example, `None` is pushed instead.

```
[None, ZeroDivisionError instance]
```
> value stack after execution

<br>

#### LOAD_GLOBAL 2 (ZeroDivisionError)
```
name = co_names[namei>>1]
value = builtins[name]
stack.append(value)
```
> instruction behavior

Pushes the `ZeroDivisionError` class object onto the value stack for comparison against the active exception instance. Since the class is only being referenced, not called, the low flag bit of `namei` is `0`, so only the class object is pushed.

```
[None, ZeroDivisionError instance, ZeroDivisionError class]
```
> value stack after execution

<br>

#### CHECK_EXC_MATCH
```
compare_result = isinstance(stack[-2], stack[-1])
stack.pop()
stack.append(compare_result)
```
> instruction behavior

Checks whether the active exception instance is an instance of the `ZeroDivisionError` class.

```
[None, ZeroDivisionError instance, True]
```
> value stack after execution

<br>

#### POP_JUMP_IF_FALSE 22 (to L7)
```
value = stack.pop()
if value == false:
    instruction_counter += delta
```
> instruction behavior

In this flow, `value` is `True`, so no jump occurs.

```
[None, ZeroDivisionError instance]
```
> value stack after execution

<br>

#### STORE_FAST 2 (e)
`STORE_FAST (var_num)`

```
value = stack.pop()
fastlocals[var_num] = value    
```
> instruction behavior

Maps the local variable `e` to the `ZeroDivisionError` instance.

```
[None]
```
> value stack after execution

<br>

#### L4: LOAD_GLOBAL 1 (print + NULL), LOAD_FAST 2 (e), CALL 1, POP_TOP

Prints the error via `print`, then removes the function's return value from the stack.

```
[None]
```
> value stack after execution

<br>

#### L5: POP_EXCEPT
```
stack.pop()
```
> instruction behavior

At the end of the `except` block, removes the current exception in thread state that was pushed by `PUSH_EXC_INFO`, restoring the state to what it was before entering the Exception Handler.

```
[]
```
> value stack after execution

<br>

#### LOAD_CONST 1 (None), STORE_FAST 2 (e)
```
stack.append(co_consts[consti])

fastlocals[var_num] = stack.pop()
```
> instruction behavior

Assigns `None` to the local variable `e`, severing the reference to the error instance and cleaning up the variable.

```
[]
```
> value stack after execution

<br>

#### DELETE_FAST 2 (e)
`DELETE_FAST (var_num)`

```
del fastlocals[var_num] 
```
> instruction behavior

Removes the entry keyed by `co_varnames[var_num]` from the namespace. Once removed, the local variable `e` is inaccessible outside the `except` block. (Accessing it raises `UnboundLocalError: cannot access local variable 'e' where it is not associated with a value`.)

```
[]
```
> value stack after execution

<br>

#### JUMP_FORWARD 8 (to L9)
`JUMP_FORWARD (delta)`

```
instruction_counter += delta
```
> instruction behavior

Advances the instruction counter to jump to L9, after which the `finally` block bytecode described earlier is executed.

```
[]
```
> value stack after execution

<br>

### 3. ZeroDivisionError flow (error INSIDE except)

```python
def divide(a, b):
    try:
        return a / b 
    except ZeroDivisionError as e:
        print(e)                      <- Error Raise again!
    finally:
        print("Execution completed.")
```

This is the flow where a `ZeroDivisionError` is raised, execution enters the `except` block, and another error occurs inside it. Bytecode executes in the order `L1 → L3 → L4 → L6 → L8 -> L10 → L11 -> propagate`.

```
   3    L1:     LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
                BINARY_OP               11 (/)

  // ...

  --    L3:     PUSH_EXC_INFO

   4            LOAD_GLOBAL              2 (ZeroDivisionError)
                CHECK_EXC_MATCH
                POP_JUMP_IF_FALSE       22 (to L7)
                NOT_TAKEN
                STORE_FAST               2 (e)

   5    L4:     LOAD_GLOBAL              1 (print + NULL)  
                LOAD_FAST                2 (e)
                CALL                     1                <- Error occurs here
                POP_TOP
  // ...

  --    L6:     LOAD_CONST               1 (None)
                STORE_FAST               2 (e)
                DELETE_FAST              2 (e)
                RERAISE                  1
  // ...

  --    L8:     COPY                     3
                POP_EXCEPT
                RERAISE                  1
  // ...

  --   L10:     PUSH_EXC_INFO

   7            LOAD_GLOBAL              1 (print + NULL)
                LOAD_CONST               0 ('Execution completed.')
                CALL                     1
                POP_TOP
                RERAISE                  0

  --   L11:     COPY                     3
                POP_EXCEPT
                RERAISE                  1

ExceptionTable:
  L1 to L2 -> L3 [0]
  L4 to L5 -> L6 [1] lasti
  L5 to L6 -> L10 [0]
  L6 to L8 -> L8 [1] lasti
  L8 to L9 -> L10 [0]
  L10 to L11 -> L11 [1] lasti
```

<br>

#### L4: LOAD_GLOBAL 1 (print + NULL), LOAD_FAST 2 (e), CALL 1

Assume that an error occurs inside the `print` call. The `print` function returns the error instance and `lasti`.

```
[None, print error instance, lasti]
```
> value stack after execution

<br>

#### L6: LOAD_CONST 1 (None), STORE_FAST 2 (e), DELETE_FAST 2 (e)

Clears the reference held by local variable `e` and removes it from the namespace.

```
[None, print error instance, lasti]
```
> value stack after execution

<br>

#### RERAISE 1
`RERAISE (oparg)`

```
if oparg == 0:
  error = stack.pop()
  raise error
else:
  lasti = stack.pop()
  error = stack.pop()
  raise (error, lasti)
```
> instruction behavior

Since `oparg` is `1`, both `lasti` and the error instance are re-raised. Per the Exception Table, execution jumps to the exception handler at L8.

```
[None]
```
> value stack after execution

<br>

#### Exception Table L6 to L8 -> L8 [1] lasti

```
reset to stack depth[1]  # pop everything except 1 item from the value stack
stack.append(raised exception instance)
stack.append(lasti)
```
> Value stack processing by the Exception Table

Before jumping to the exception handler, all items beyond `stack_depth` are popped from the value stack, then the current error instance and `lasti` are pushed.

```
[None, print error instance, lasti]
```
> value stack

<br>

#### L8: COPY 3
`COPY (i)`

```
stack.append(stack[-i])
```
> instruction behavior

```
[None, print error instance, lasti, None]
```
> value stack after execution

<br>

#### POP_EXCEPT, RERAISE 1
```
stack.pop()

if oparg == 0:
  error = stack.pop()
  raise error
else:
  lasti = stack.pop()
  error = stack.pop()
  raise (error, lasti)
```
> instruction behavior

Re-raises the print error instance. Per the Exception Table, execution jumps to L10.

```
[None]
```
> value stack after execution

<br>

#### Exception Table L8 to L9 -> L10 [0]

```
reset to stack depth[0]  
stack.append(raised exception instance)
```
> Value stack processing by the Exception Table

Since `lasti` is not marked, it is not pushed onto the value stack.

```
[print error instance]
```
> value stack

<br>

#### L10: PUSH_EXC_INFO ~ POP_TOP
Executes the bytecode corresponding to the `finally` block.

```
[None, print error instance]
```
> value stack after execution

<br>

#### RERAISE 0

```
if oparg == 0:
  error = stack.pop()
  raise error
else:
  lasti = stack.pop()
  error = stack.pop()
  raise (error, lasti)
```
> instruction behavior

Re-raises the print error instance, which was not caught by any exception handler. Per the Exception Table, execution jumps to L11.

```
[None]
```
> value stack after execution

<br>

#### Exception Table L10 to L11 -> L11 [1] lasti

```
reset to stack depth[1]  
stack.append(raised exception instance)
stack.append(lasti)
```
> Value stack processing by the Exception Table

```
[None, print error instance, lasti]
```
> value stack

<br>

#### L11: COPY 3, POP_EXCEPT, RERAISE 1

Since no exception handler remains but the print error instance is still unhandled, the error is propagated to the caller.

<br>

### 4. Non-matching exception flow

```python
def divide(a, b):
    try:
        return a / b  <- Error occurs
    except ZeroDivisionError as e: <- No Match
        print(e)                      
    finally:
        print("Execution completed.")
```

This is the flow where an error other than `ZeroDivisionError` is raised, so execution never enters the `except` block. Bytecode executes in the order `L1 → L3 → L7 → L8 -> L10 → L11 -> propagate`.

```
   3    L1:     LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
                BINARY_OP               11 (/)

    // ...

  --    L3:     PUSH_EXC_INFO

   4            LOAD_GLOBAL              2 (ZeroDivisionError)
                CHECK_EXC_MATCH
                POP_JUMP_IF_FALSE       22 (to L7)
                NOT_TAKEN
                STORE_FAST               2 (e)

    // ...

   4    L7:     RERAISE                  0

  --    L8:     COPY                     3
                POP_EXCEPT
                RERAISE                  1

    // ...

  --   L10:     PUSH_EXC_INFO

   7            LOAD_GLOBAL              1 (print + NULL)
                LOAD_CONST               0 ('Execution completed.')
                CALL                     1
                POP_TOP
                RERAISE                  0

  --   L11:     COPY                     3
                POP_EXCEPT
                RERAISE                  1

ExceptionTable:
  L1 to L2 -> L3 [0]
  L3 to L4 -> L8 [1] lasti
  L6 to L8 -> L8 [1] lasti
  L8 to L9 -> L10 [0]
  L10 to L11 -> L11 [1] lasti
```

<br>

#### L3: PUSH_EXC_INFO ~ POP_JUMP_IF_FALSE 22 (to L7)

Since the raised error is not an instance of `ZeroDivisionError`, the instruction counter is advanced and execution jumps to L7.

```
[None, unknown error instance]
```
> value stack after execution

<br>

#### L7: RERAISE 0
Re-raises the error instance. Per the Exception Table, execution jumps to L8.

```
[None]
```
> value stack after execution

<br>

#### Exception Table L6 to L8 -> L8 [1] lasti
```
reset to stack depth[1]  
stack.append(raised exception instance)
stack.append(lasti)
```
> Value stack processing by the Exception Table

```
[None, unknown error instance, lasti]
```
> value stack

From here, execution moves to L8 and follows the same flow as case 3.

<br>

# Bytecode Analysis of Nested Functions and Closures

```python
def outer():
    a = 1

    def inner():
        nonlocal a
        a += 1
        print(a)

    return inner
```

```
Disassembly of <code object outer at 0x101125c50, file "main.py", line 1>:
  --           MAKE_CELL                1 (a)

   1           RESUME                   0

   2           LOAD_SMALL_INT           1
               STORE_DEREF              1 (a)

   4           LOAD_FAST_BORROW         1 (a)
               BUILD_TUPLE              1
               LOAD_CONST               1 (<code object inner at 0x101196a30, file "main.py", line 4>)
               MAKE_FUNCTION
               SET_FUNCTION_ATTRIBUTE   8 (closure)
               STORE_FAST               0 (inner)

   9           LOAD_FAST_BORROW         0 (inner)
               RETURN_VALUE

Disassembly of <code object inner at 0x101196a30, file "main.py", line 4>:
  --           COPY_FREE_VARS           1

   4           RESUME                   0

   6           LOAD_DEREF               0 (a)
               LOAD_SMALL_INT           1
               BINARY_OP               13 (+=)
               STORE_DEREF              0 (a)

   7           LOAD_GLOBAL              1 (print + NULL)
               LOAD_DEREF               0 (a)
               CALL                     1
               POP_TOP
               LOAD_CONST               1 (None)
               RETURN_VALUE
```

<br>

## outer function bytecode
```
Disassembly of <code object outer at 0x101125c50, file "main.py", line 1>:
  --           MAKE_CELL                1 (a)

   1           RESUME                   0

   2           LOAD_SMALL_INT           1
               STORE_DEREF              1 (a)

   4           LOAD_FAST_BORROW         1 (a)
               BUILD_TUPLE              1
               LOAD_CONST               1 (<code object inner at 0x101196a30, file "main.py", line 4>)
               MAKE_FUNCTION
               SET_FUNCTION_ATTRIBUTE   8 (closure)
               STORE_FAST               0 (inner)

   9           LOAD_FAST_BORROW         0 (inner)
               RETURN_VALUE
```

<br>

### MAKE_CELL 1 (a)
`MAKE_CELL (i)`

```
cell = create a new cell in heap 
fastlocals[i] = cell
```
> instruction behavior

A cell is a small container accessible by both the inner and outer functions. It is a wrapper object that holds a reference to the actual object inside it. In this example, it can be expressed as `cell object -> [a object]`. A reference to the cell is stored in the outer function's namespace.

```
[]
```
> value stack after execution

<br>

### LOAD_SMALL_INT 1, STORE_DEREF 1 (a)
`STORE_DEREF (i)`

```
stack.append(1)

value = stack.pop()
cell = fastlocals[i]
cell.set(value)
```
> instruction behavior

`STORE_DEREF` pops a value from the value stack and stores it inside the cell.

```
[]
```
> value stack after execution

<br>

### LOAD_FAST_BORROW 1 (a), BUILD_TUPLE 1
`BUILD_TUPLE (count)`

```
value = fastlocals[var_num]
stack.append(value)

stack_top_tuple = tuple(stack[-count:])
stack.append(stack_top_tuple)
```
> instruction behavior

`BUILD_TUPLE` takes the top `count` items from the value stack, packs them into a tuple, and pushes it onto the value stack.

```
[(cell, )]
```
> value stack after execution

<br>

### LOAD_CONST 1 (\<code object inner ...>), MAKE_FUNCTION

Creates an `inner` function object from the code object and pushes it onto the value stack.

```
[(cell, ), inner function]
```
> value stack after execution

<br>

### SET_FUNCTION_ATTRIBUTE 8 (closure)
`SET_FUNCTION_ATTRIBUTE (flag)`

```
if flag == 8:   # set closure attribute
    function = stack.pop()
    attribute = stack.pop()
    function.__closure__ = attribute
    stack.append(function)
```
> instruction behavior

The `flag` determines which attribute of the function to set. Since `flag` is `8` in this example, the tuple containing the cell is assigned to the `__closure__` attribute of the `inner` function.

```
[inner function]
```
> value stack after execution

<br>

### STORE_FAST 0 (inner), LOAD_FAST_BORROW 0 (inner), RETURN_VALUE

Returns the `inner` function to the caller.

<br>

## inner function bytecode

```
Disassembly of <code object inner at 0x101196a30, file "main.py", line 4>:
  --           COPY_FREE_VARS           1

   4           RESUME                   0

   6           LOAD_DEREF               0 (a)
               LOAD_SMALL_INT           1
               BINARY_OP               13 (+=)
               STORE_DEREF              0 (a)

   7           LOAD_GLOBAL              1 (print + NULL)
               LOAD_DEREF               0 (a)
               CALL                     1
               POP_TOP
               LOAD_CONST               1 (None)
               RETURN_VALUE
```

<br>

### COPY_FREE_VARS 1
`COPY_FREE_VARS (n)`

```
fastlocals[n] = __closure__[n]
```
> instruction behavior

Copies the `inner` function's closure into the local namespace as well.

```
[]
```
> value stack after execution

<br>

### LOAD_DEREF 0 (a)
`LOAD_DEREF (i)`

```
cell = fastlocals[i]
value = cell.get()
stack.append(value)
```

Pushes the actual object held inside the cell — referenced by the local namespace — onto the value stack. The term DEREF (dereference) is used because it does not push the cell reference itself, but instead follows the cell reference to retrieve the object within it.

```
[a]
```
> value stack after execution

<br>

### LOAD_SMALL_INT 1, BINARY_OP 13 (+=)
```
stack.append(1)

rhs = stack.pop()
lhs = stack.pop()
stack.append(lhs op rhs)
```
> instruction behavior

Adds `1` to `a` and pushes the result onto the value stack.

```
[a + 1]
```
> value stack after execution

<br>

### STORE_DEREF 0 (a)
```
value = stack.pop()
cell = fastlocals[i]
cell.set(value)
```
> instruction behavior

Stores `a + 1` inside the cell.

```
[]
```
> value stack after execution

<br>

### LOAD_GLOBAL 1 (print + NULL) ~ RETURN_VALUE

Prints the free variable `a` — accessible via the cell — using the `print` function, then terminates execution of the `inner` function.

<br>

# Bytecode Analysis of Classes and Method Calls
```python
class Person:
    def __init__(self, name):
        self.name = name

    def greet(self, friend):
        print(f"hello, my name is {self.name}. Nice to meet you {friend}")


hyun = Person("hyun")
hyun.greet("Yoon")
```

```
  0           RESUME                   0

  1           LOAD_BUILD_CLASS
              PUSH_NULL
              LOAD_CONST               0 (<code object Person at 0x10511ba30, file "main.py", line 1>)
              MAKE_FUNCTION
              LOAD_CONST               1 ('Person')
              CALL                     2
              STORE_NAME               0 (Person)

  9           LOAD_NAME                0 (Person)
              PUSH_NULL
              LOAD_CONST               2 ('hyun')
              CALL                     1
              STORE_NAME               1 (hyun)

 10           LOAD_NAME                1 (hyun)
              LOAD_ATTR                5 (greet + NULL|self)
              LOAD_CONST               3 ('Yoon')
              CALL                     1
              POP_TOP
              LOAD_CONST               4 (None)
              RETURN_VALUE

Disassembly of <code object Person at 0x10511ba30, file "main.py", line 1>:
  --           MAKE_CELL                0 (__classdict__)

   1           RESUME                   0
               LOAD_NAME                0 (__name__)
               STORE_NAME               1 (__module__)
               LOAD_CONST               0 ('Person')
               STORE_NAME               2 (__qualname__)
               LOAD_SMALL_INT           1
               STORE_NAME               3 (__firstlineno__)
               LOAD_LOCALS
               STORE_DEREF              0 (__classdict__)

   2           LOAD_CONST               1 (<code object __init__ at 0x1050a9c50, file "main.py", line 2>)
               MAKE_FUNCTION
               STORE_NAME               4 (__init__)

   5           LOAD_CONST               2 (<code object greet at 0x10511dce0, file "main.py", line 5>)
               MAKE_FUNCTION
               STORE_NAME               5 (greet)
               LOAD_CONST               3 (('name',))
               STORE_NAME               6 (__static_attributes__)
               LOAD_FAST_BORROW         0 (__classdict__)
               STORE_NAME               7 (__classdictcell__)
               LOAD_CONST               4 (None)
               RETURN_VALUE

Disassembly of <code object __init__ at 0x1050a9c50, file "main.py", line 2>:
  2           RESUME                   0

  3           LOAD_FAST_BORROW_LOAD_FAST_BORROW 16 (name, self)
              STORE_ATTR               0 (name)
              LOAD_CONST               0 (None)
              RETURN_VALUE

Disassembly of <code object greet at 0x10511dce0, file "main.py", line 5>:
  5           RESUME                   0

  6           LOAD_GLOBAL              1 (print + NULL)
              LOAD_CONST               0 ('hello, my name is ')
              LOAD_FAST_BORROW         0 (self)
              LOAD_ATTR                2 (name)
              FORMAT_SIMPLE
              LOAD_CONST               1 ('. Nice to meet you ')
              LOAD_FAST_BORROW         1 (friend)
              FORMAT_SIMPLE
              BUILD_STRING             4
              CALL                     1
              POP_TOP
              LOAD_CONST               2 (None)
              RETURN_VALUE
```

<br>

## Module bytecode

```
  0           RESUME                   0

  1           LOAD_BUILD_CLASS
              PUSH_NULL
              LOAD_CONST               0 (<code object Person at 0x10511ba30, file "main.py", line 1>)
              MAKE_FUNCTION
              LOAD_CONST               1 ('Person')
              CALL                     2
              STORE_NAME               0 (Person)

  9           LOAD_NAME                0 (Person)
              PUSH_NULL
              LOAD_CONST               2 ('hyun')
              CALL                     1
              STORE_NAME               1 (hyun)

 10           LOAD_NAME                1 (hyun)
              LOAD_ATTR                5 (greet + NULL|self)
              LOAD_CONST               3 ('Yoon')
              CALL                     1
              POP_TOP
              LOAD_CONST               4 (None)
              RETURN_VALUE
```

<br>

### LOAD_BUILD_CLASS, PUSH_NULL
```
stack.append(builtins.__build_class__ function)
stack.append(null)
```
> instruction behavior

`LOAD_BUILD_CLASS` pushes the `builtins.__build_class__` function — required for class creation — onto the value stack.

```
[builtins.__build_class__ function, NULL]
```
> value stack after execution

<br>

### LOAD_CONST 0 (\<code object Person ...>), MAKE_FUNCTION
Creates a `Person` function from the code object and pushes it onto the value stack.

```
[builtins.__build_class__ function, NULL, Person function]
```
> value stack after execution

<br>

### LOAD_CONST 1 ('Person'), CALL 2
```
class_obj = builtins.__build_class__(Person function, 'Person')
stack.append(class_obj)
```
> instruction behavior

Creates the `Person` class object and pushes it onto the value stack.

```
[Person class]
```
> value stack after execution

<br>

### STORE_NAME 0 (Person), LOAD_NAME 0 (Person)
Assigns the `Person` class object to the namespace, then pushes it back onto the value stack.

```
[Person class]
```
> value stack after execution

<br>

### PUSH_NULL, LOAD_CONST 2 ('hyun'), CALL 1, STORE_NAME 1 (hyun)

Calls the `Person` class object to create a person instance, then assigns it to the module variable `hyun`.

```
[]
```
> value stack after execution

<br>

### LOAD_NAME 1 (hyun), LOAD_ATTR 5 (greet + NULL|self)
`LOAD_ATTR (namei)`

```
name = co_names[namei]       
value = locals[name]          
stack.append(value)            

instance = stack.pop()
if namei & 1 == 1: # method load
    method_name = co_names[namei>>1] 
    method = instance.__class__.__dict__[method_name] # unbound function
    stack.append(method)
    stack.append(instance)
else: # attribute load
    attr_name = co_names[namei>>1]
    attr = instance.attr_name
    stack.push(NULL)
    stack.append(attr)
```

When the low bit of `namei` is `1`, a method is loaded. Method objects are created when the class object is created. The unbound method — one not  bound to any instance — is pushed onto the value stack, followed by the instance that owns it. When the unbound method is called, the instance on the value stack is passed in as the `self` argument.

```
[unbound method greet, person instance]
```
> value stack after execution

<br>

### LOAD_CONST 3 ('Yoon') ~ RETURN_VALUE
Calls the `greet` method on the `hyun` instance, then terminates the module.

<br>

## Class bytecode
```
Disassembly of <code object Person at 0x10511ba30, file "main.py", line 1>:
  --           MAKE_CELL                0 (__classdict__)

   1           RESUME                   0
               LOAD_NAME                0 (__name__)
               STORE_NAME               1 (__module__)
               LOAD_CONST               0 ('Person')
               STORE_NAME               2 (__qualname__)
               LOAD_SMALL_INT           1
               STORE_NAME               3 (__firstlineno__)
               LOAD_LOCALS
               STORE_DEREF              0 (__classdict__)

   2           LOAD_CONST               1 (<code object __init__ at 0x1050a9c50, file "main.py", line 2>)
               MAKE_FUNCTION
               STORE_NAME               4 (__init__)

   5           LOAD_CONST               2 (<code object greet at 0x10511dce0, file "main.py", line 5>)
               MAKE_FUNCTION
               STORE_NAME               5 (greet)
               LOAD_CONST               3 (('name',))
               STORE_NAME               6 (__static_attributes__)
               LOAD_FAST_BORROW         0 (__classdict__)
               STORE_NAME               7 (__classdictcell__)
               LOAD_CONST               4 (None)
               RETURN_VALUE
```

<br>

### MAKE_CELL 0 (`__classdict__`)

Creates a cell and stores a reference to it in the namespace.

```
[]
```
> value stack after execution

<br>

### LOAD_NAME 0 (`__name__`) ~ STORE_NAME 3 (`__firstlineno__`)
Assigns special attributes to the class namespace.

```
[]
```
> value stack after execution

<br>

### LOAD_LOCALS
```
stack.append(locals())
```
> instruction behavior

Pushes the local namespace onto the value stack.

```
[class namespace dictionary]
```
> value stack after execution

<br>

### STORE_DEREF 0 (`__classdict__`)
Stores the class namespace dictionary inside the cell.

```
[]
```
> value stack after execution

<br>

### LOAD_CONST 1 (\<code object `__init__`>) ~ STORE_NAME 5 (greet)
Creates the `__init__` and `greet` function objects and assigns them to the class namespace.

```
[]
```
> value stack after execution

<br>

### LOAD_CONST 3 (('name',)), STORE_NAME 6 (`__static_attributes__`)

Attributes assigned via `self.xxx` are stored as a tuple of attribute names in `__static_attributes__`. Since the `Person` class assigns `self.name = name` in `__init__`, `'name'` is included in the tuple.

```
[]
```
> value stack after execution

<br>

## Method bytecode

```
Disassembly of <code object __init__ at 0x1050a9c50, file "main.py", line 2>:
  2           RESUME                   0

  3           LOAD_FAST_BORROW_LOAD_FAST_BORROW 16 (name, self)
              STORE_ATTR               0 (name)
              LOAD_CONST               0 (None)
              RETURN_VALUE

Disassembly of <code object greet at 0x10511dce0, file "main.py", line 5>:
  5           RESUME                   0

  6           LOAD_GLOBAL              1 (print + NULL)
              LOAD_CONST               0 ('hello, my name is ')
              LOAD_FAST_BORROW         0 (self)
              LOAD_ATTR                2 (name)
              FORMAT_SIMPLE
              LOAD_CONST               1 ('. Nice to meet you ')
              LOAD_FAST_BORROW         1 (friend)
              FORMAT_SIMPLE
              BUILD_STRING             4
              CALL                     1
              POP_TOP
              LOAD_CONST               2 (None)
              RETURN_VALUE
```

### STORE_ATTR 0 (name)
`STORE_ATTR (namei)`

```
name = co_names[namei]
instance = stack.pop()
value = stack.pop()
instance.name = value
```
> instruction behavior

Assigns an attribute to the instance.

<br>

### LOAD_ATTR 2 (name)

```
instance = stack.pop()
if namei & 1 == 1: # method load
    method_name = co_names[namei>>1] 
    method = instance.__class__.__dict__[method_name] # unbound function
    stack.append(method)
    stack.append(instance)
else: # attribute load
    attr_name = co_names[namei>>1]
    attr = instance.attr_name
    stack.push(NULL)
    stack.append(attr)
```
> instruction behavior

Since `2` has its flag bit set to `0`, this is an attribute access, not a method load.

<br>

# Version
- Python 3.14.3

<br>

# References
- https://docs.python.org/3.14/library/dis.html
- https://docs.python.org/3/reference/datamodel.html
- https://docs.python.org/3/library/functions.html#locals
- https://docs.python.org/3/library/functions.html#globals
- https://github.com/python/cpython/blob/3.8/Python/ceval.c
- https://github.com/python/cpython/blob/main/InternalDocs/exception_handling.md