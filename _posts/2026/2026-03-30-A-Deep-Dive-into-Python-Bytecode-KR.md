---
layout: post
author: Hyun 
title: Python Bytecode 파헤치기
date:   2026-03-30 16:57:00 +0900
excerpt: "Python Bytecode 파헤치기"
categories:
 - Engineering
 - Python
 - Bytecode
lang: kr
lang_ref: /A-Deep-Dive-into-Python-Bytecode-EN/
---

# Bytecode Intro

`python -m dis 모듈명`으로 모듈 수준의 bytecode를 볼 수 있다. 

```
  4           LOAD_GLOBAL              1 (len + NULL)
```
> bytecode 예시 

python bytecode는 `line_number | opname | arg | argrepr` 으로 이루어져 있다.

`line_number`는 모듈 파일의 라인 번호를 의미한다.
`opcode`는 사람이 읽을 수 있는 bytecode instruction 이름을 의미한다.
`arguments`는 bytecode instruction에 넘겨주는 인자를 의미하고, `argrepr`은 앞서 넘겨준 `arg`를 사람이 읽을 수 있는 문자열로 표현한 값이다.

<br>

# code object와 attributes
code object는 byte-compiled 된, 여러 정보를 담고 있는 컨테이너이자, 실행 가능한 python code를 의미한다. 
즉, code object는 컴파일 타임에 완성되며, 불변이고 mutable object reference도 갖지 않는다. 

code object는 몇 가지 read-only attributes를 가지는 데 예시 코드를 바탕으로 본문에서 자주 다룰 몇 가지 attributes를 설명하겠다. 

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
code object내의 bytecode가 사용하는 상수들이 담겨있는 tuple이다. 

## co_names
```
foo.__code__.co_names
> ('print',)
```
code object내의 bytecode에서 사용되는 name이 담겨있는 tuple이다. 이 name들은 런타임에 reference lookup에 동적으로 사용된다. 예시에선, 런타임에 builtin function인 `print` function을 찾기 위해 사용된다.

## co_varnames
```
foo.__code__.co_varnames
> ('a', 'b', 'c')
```
code object내의 local 변수명이 담겨있는 tuple이다. 파라미터명도 포함된다.

<br>

# namespace와 LOAD, STORE

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
> `globals()`는 현재 실행 중인 스코프와 상관없이 모듈수준의 namespace를, `locals()`는 현재 실행 중인 스코프의 namespace를 보여준다.

namespace는 name으로 object를 찾을 수 있도록 하는 자료구조로, 일반적으로 dictionary이다. 
namespace는 global 수준과 local 수준으로 나뉜다. global 수준은  global namespace가 호출되는 스코프와 상관없이 해당 코드가 정의된 모듈의 namespace를 가리킨다. 반면, local 수준은 현재 코드가 실행되는 스코프에 따라 다른 namespace를 가진다.

python bytecode에는 `LOAD` 계열 명령어와 `STORE` 계열 bytecode instruction이 있다. `LOAD`와 `STORE`는 namespace와 깊은 연관이 있다.

<br>

## LOAD 계열 instruction
`LOAD` 계열 instruction은 namespace에 존재하는 object를 value stack에 넣는다. (`LOAD_CONST` 제외)

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
> 각 instruction의 동작방식

위 동작방식에서 `locals`, `globals`는 앞서 설명한 namespace를 의미한다.

`LOAD_FAST`의 경우엔 좀 특이한데, function scope에서는 지역변수의 value를 dictionary 형태의 namespace 대신, `fastlocals` value array에 넣는다. `co_varnames[i]`는 변수명(string)을, `fastlocals[i]`는 그 변수의 실제 값(object)을 저장하며, 같은 인덱스 `i`로 대응된다. 정리하면, `co_varnames`는 지역 변수명을 가진 name array이고, `fastlocals`는 실제 값을 가진 value array이다. (CPython 구현체에 한정된 내용)

<br>

## STORE 계열 instruction
`STORE` 계열 instruction은 stack에 존재하는 object를 꺼내 namespace에 할당한다. 

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

위 동작방식에서 `locals`, `globals`는 앞서 설명한 namespace를 의미한다.

`STORE_NAME`은 module scope, class scope, `exec`/`eval`에서 생성되는 bytecode instruction이고, `STORE_GLOBAL`은 `global` 키워드를 명시적으로 사용했을 때만 생성되는 bytecode instruction이다. module scope에서 `locals`와 `globals`는 동일한 namespace를 가리키므로, `locals[name] = value`를 하더라도 모듈 수준 namespace에 값이 할당되는 것은 동일하다.

<br>

# 간단한 function bytecode 분석
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

아무런 동작도 하지 않는 marker로, `context`가 `0`이면 그냥 일반 함수를 의미한다.

```
[]
```
> bytecode 실행 후 value stack

<br>

## LOAD_GLOBAL 1 (len + NULL)
`LOAD_GLOBAL (namei)`

```
stack.append(NULL)
name = co_names[namei >> 1]
stack.append(builtins[name])
```
> bytecode 동작  

`namei`는 name index를 나타낸다. global namespace에는 `len`이 없으므로, builtins namespace에서 `len` function object를 찾는다.


```
[NULL, len function]
```
> bytecode 실행 후 value stack 

<br>

### name을 구할 때, co_names[namei >> 1] 인 이유
파이썬은 호출하려는 function이 인스턴스에 속한 메서드라면, 인스턴스 객체를 참조해야 한다. 따라서, function object의 reference만 넣지 않고 메서드를 가지는 인스턴스 reference도 같이 넣어줘야 하는 경우가 있다. 만약, 호출하려는 function이 메서드가 아니라면 인스턴스 reference 대신 `NULL`을 value stack에 넣는다.

다시말해, 필요에 의해 function reference와 function이 속해있는 인스턴스 reference를 같이 value stack에 넣어야 할 때가 있고, function reference만 value stack에 넣어도 될 때가 있다.

이는 `namei`의 마지막 bit인 flag bit으로 그 경우를 판별할 수 있다. 만약 flag bit이 `1`이면 function reference와 인스턴스 객체 reference (혹은 `NULL`)를 value stack에 모두 넣어줘야 한다.
반대로, flag bit이 `0`이면 function reference만 value stack에 넣는다. flag bit이 `0`인 경우는 함수를 당장 호출하지 않고 참조만 하는 경우이다.

```python
def myfunc():
    a = len  # len을 호출하진 않고 참조만 함
```

```
  3           RESUME                   0

  4           LOAD_GLOBAL              0 (len)
              STORE_FAST               0 (a)
              LOAD_CONST               0 (None)
              RETURN_VALUE
```

`namei`의 flag bit은 오직 위 경우를 식별하기 위한 용도이므로, name을 찾기 위한 인덱스로서는 사용되지 않는다. 따라서 `co_names`에서 name을 찾을 때 `namei` index를 1 bit right shift 하는 것이다.

<br>

## LOAD_FAST_BORROW 0 (alist)
`LOAD_FAST_BORROW (var_num)`

```
value = fastlocals[var_num]
stack.append(value)
```
> bytecode 동작 

code object 생성 시점에, 파라미터 name들이 `co_varnames`의 `0`번 인덱스부터 차례대로 저장된다. 또한 `STORE_FAST`를 하지 않아도 파라미터 값은 함수 호출 시점에 `fastlocals`의 `0`번 인덱스부터 차례대로 저장된다.

`LOAD_FAST` bytecode와의 차이점은 value stack이 변수를 참조하고 있더라도, reference count를 올리지 않는다는 것이다.
`fastlocals[0]`이 이미 `alist` value를 참조하고 있으니 사라지지 않을 것이라고 가정하는 것이다. 이처럼 reference count를 올리지 않고 value stack에 들어있는 `alist` reference를 borrowed reference라 한다.

```
[NULL, len function, alist]
```
> bytecode 실행 후 value stack

<br>

## CALL 1
`CALL (argc)`

```
args = [stack.pop() for i in range(argc)]
function, instance = stack.pop(), stack.pop()
value = function(instance, ...args)
stack.append(value)
```
> bytecode 동작 

`len(alist)`의 반환값을 value stack에 push한다. 

```
[alist 길이]
```
> bytecode 실행 후 value stack

<br>

## RETURN_VALUE
`value_stack[-1]` 값을 caller에게 반환한다.

<br>

# add function bytecode 분석

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
              RETURN_VALU
```

위 bytecode는 function bytecode와 module bytecode, 두 부분으로 나눌 수 있다.

<br>

## function bytecode
```
Disassembly of <code object add at 0x000001670206DC50, file "test.py", line 1>:
  1           RESUME                   0

  2           LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
              BINARY_OP                0 (+)
              RETURN_VALU
```
> add function이 호출될 때 마다 매번 실행되는 bytecode

### LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b)
`LOAD_FAST_BORROW_LOAD_FAST_BORROW (var_nums)`

```
value1 = fastlocals[var_nums >> 4]
value2 = fastlocals[var_nums & 15]
stack.append(value1)
stack.append(value2)
```
> bytecode 동작 

`LOAD_FAST_BORROW`를 두 번 호출하는 대신, 한 번의 bytecode 호출로 줄인 super-instruction이다.
이러한 최적화를 통해 instruction dispatch overhead와 interpreter loop iterations가 감소하여, 결과적으로 실행 속도를 향상시킨다.
`LOAD_FAST_BORROW`와 마찬가지로 value stack에 들어간 reference는 reference count를 올리지 않는 borrowed reference이다.

```
[a, b]
```
> bytecode 실행 후 value stack

<br>

### BINARY_OP 0 (+)
`BINARY_OP (op)`

```
rhs = STACK.pop()
lhs = STACK.pop()
stack.append(lhs op rhs)
```
> bytecode 동작 

스택에 들어있는 피연산자를 가지고 이진 연산을 수행한 결과값을 value stack에 넣는다.

```
[a + b]
```
> bytecode 실행 후 value stack

<br>

## module bytecode
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
> 모듈이 처음 import 될 때 한번만 실행되는 bytecode 

<br>

### LOAD_CONST 0 (<code object add at ...)
`LOAD_CONST (consti)`

```
value = co_consts[consti]
stack.append(value)
```
> bytecode 동작 

code object 역시 compile time에 완성되는 정적인 정보이므로 co_consts에서 관리한다. 모듈의 co_consts[0]은 add function의 code object이다. 

```
[code object add]
```
> bytecode 실행 후 value stack

<br>

### MAKE_FUNCTION 
```
code_obj = stack.pop()
function_obj = make_function(code_obj)
stack.append(function_obj)
```
> bytecode 동작 

function object는 runtime context를 가지는, 정적인 code object를 감싼 run-time에 완성되는 동적인 object이다. 

```
[add function]
```
> bytecode 실행 후 value stack

<br>

### STORE_NAME 0 (add)
`STORE_NAME (namei)`

```
value = stack.pop()
name = co_names[namei]
locals[name] = value
```
> bytecode 동작 

`name`은 `'add'`, `value`는 `add` function을 나타낸다. 모듈의 namespace에 `add` function을 등록한다.

```
[]
```
> bytecode 실행 후 value stack

<br>


### LOAD_NAME 0 (add)
`LOAD_NAME (namei)`

```
name = co_names[namei]       
value = locals[name]          
stack.append(value)            
```
> bytecode 동작 

namespace에 존재하는 add function을 value stack에 넣는다.

```
[add function]
```
> bytecode 실행 후 value stack

<br>

### PUSH_NULL
```
stack.append(NULL)
```
> bytecode 동작 

함수를 호출하기 위해선 function object와 function의 주인인 instance, 이렇게 두 개의 object가 필요하다. 
하지만, 메서드 호출이 아닌 경우엔 function이 인스턴스에 속해있지 않기에, 이 경우 instance 자리를 대신해 `NULL`을 value stack에 넣는다.
인스턴스가 필요없음에도, 아무것도 넣지 않는 대신 `NULL`을 넣는 이유는 균일한 방식으로 함수를 호출하기 위함이다.
현재 예시에서, `add`는 모듈레벨 함수이므로, `self`가 필요없어 `NULL`을 value stack에 넣은 케이스이다.

```
[add function, NULL]
```
> bytecode 실행 후 value stack

<br>

### LOAD_SMALL_INT 3,  LOAD_SMALL_INT 5
```
stack.append(i)  # i는 small int
```
> bytecode 동작 

함수를 호출할 때 넘겨줄 파라미터값을 stack에 넣는 과정


```
[add function, NULL, 3, 5]
```
> bytecode 실행 후 value stack

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
> bytecode 동작 

add(3, 5) 결과값을 result에 할당 

```
[]
```
> bytecode 실행 후 value stack

<br>

### LOAD_CONST 1 (NONE), RETURN_VALUE
모듈 실행 마무리 단계로, `None`을 반환한다.

<br>

# error raise bytecode 분석
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
> divide function이 호출될 때 마다 매번 실행되는 bytecode

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
> bytecode 동작 


```
[b == 0]
```
> bytecode 실행 후 value stack

<br>

## POP_JUMP_IF_FALSE 12 (to L1)
`POP_JUMP_IF_FALSE (delta)`

```
value = stack.pop()
if value == false:
    instruction_counter += delta
```

b == 0이 아니라면, 에러가 발생하지 않은 정상 flow로, instruction counter를 delta만큼 증가시켜 L1 라벨위치로 이동한다. 
L1 위치로 이동하였다면, 정상적인 나눗셈 연산 수행 후 결과를 caller에게 반환한다.

```
[]
```
> bytecode 실행 후 value stack

<br>

## NOT_TAKEN

아무 동작도 하지 않는다. 인터프리터가 BRANCH 분기 이벤트를 기록하기 위해 사용한다.

```
[]
```
> bytecode 실행 후 value stack

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
> bytecode 동작 

ValueError class object를 호출한다는 것은, ValueError instance를 생성함을 의미한다.

```
[ValueError instance]
```
> bytecode 실행 후 value stack

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

`argc`에 따라 3가지 형태로 exception을 raise한다. 예시에서 `argc`는 `1`이므로 value stack 최상단에 위치한 `ValueError` instance를 raise한다.


```
[]
```
> bytecode 실행 후 value stack

<br>

# try, except, finally bytecode 분석 
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
특정 범위에서 에러가 발생했을 경우 참조되는 메타 데이터로, 특정 bytecode 범위에서 난 에러를 어떤 예외 핸들러가 처리할 지를 매핑한 테이블이다. <br> 테이블의 각 엔트리는 `Protected Range -> Exception Handler [stack depth] (last_executed_bytecode_index)`의 구조로 이루어져 있다.

풀어 설명하면, Protected Range 내의 bytecode를 실행하다가 에러가 발생하면 Exception Handler로 이동해야 함을 말한다. 위와 같이 라벨로 범위를 표현하며 L1 to L2는 L1 부분이 Protected Range임을 의미한다. (L2 부분은 포함되지 않는다.)

`stack depth`는 Exception Handler 진입 시점에 value stack에 남아있어야 할 데이터 개수를 의미한다.

`last_executed_bytecode_index`는 에러가 발생한 bytecode index를 의미한다. 이는 에러가 발생한 line을 stack trace에서 보여주기 위함이다.

<br>

## 케이스별 분석 
예시의 divide function은 크게 4가지 케이스가 있다.

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

에러 발생 없이 나눗셈 연산 후 결과를 반환하는 flow이다. <br>
`L1 → L2` 의 흐름으로 bytecode를 실행한다.

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

try 블록 시작 부분으로, 아무런 동작도 하지 않는다.

<br>

#### L1: LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b), BINARY_OP 11 (/)

a / b 나눗셈 연산 수행 결과를 value stack에 넣는다.

```
[ a / b ]
```
> bytecode 실행 후 value stack

<br>

#### L2: LOAD_GLOBAL 1 (print + NULL), LOAD_CONST 0 ('Execution completed.'), CALL 1, 

에러 발생없이 finally 블록에 진입하여 print 함수 호출 후 반환값 None을 value stack에 넣는다.

```
[ a / b, None ]
```
> bytecode 실행 후 value stack

<br>

#### POP_TOP
```
stack.pop()
```
> bytecode 동작  

print 함수의 결과값 None을 value stack에서 제거한다.

```
[ a / b ]
```
> bytecode 실행 후 value stack

<br>

#### RETURN_VALUE
나눗셈 결과값인 value_stack[-1]을 caller에게 반환한다.

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

`try` 블록에서 `b == 0`인 경우, `ZeroDivisionError`가 발생한 상황의 flow이다. <br>
`L1 → L3 → L4 → L5 → L9`의 흐름으로 bytecode를 실행한다. 

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
> L1에서 에러 발생하면 L3로 이동

<br>

#### L1: LOAD_FAST_BORROW_LOAD_FAST_BORROW 1 (a, b), BINARY_OP 11 (/)
BINARY_OP 11 (/) bytecode 실행 시, ZeroDivisionError가 발생한다.
이 경우 ExceptionTable에 따라 Exception Handler인 L3로 이동한다. 

```
[ZeroDivisionError instance]
```
> bytecode 실행 후 value stack

<br>

#### L3: PUSH_EXC_INFO
```
value = stack.pop()
stack.append(current exception in thread state)
stack.append(value)
```
> bytecode 동작  

`except` 블록의 시작부분으로, current exception in thread state를 stack에 넣는 이유는 이전에 발생한 에러 상태를 보존하기 위해서이다. 예시처럼, 현재 스레드에서 아무런 에러가 발생하지 않은 경우엔 `None`을 넣는다.

```
[None, ZeroDivisionError instance]
```
> bytecode 실행 후 value stack

<br>

#### LOAD_GLOBAL 2 (ZeroDivisionError)
```
name = co_names[namei>>1]
value = builtins[name]
stack.append(value)
```
> bytecode 동작  

현재 발생한 에러 인스턴스와 비교를 위해 `ZeroDivisionError` class object를 value stack에 넣는 과정이다. 따라서 object의 호출이 없으므로 `namei`의 low flagbit이 `0`이고, 따라서 `ZeroDivisionError` class object만 value stack에 넣으면 된다.

```
[None, ZeroDivisionError instance, ZeroDivisionError class]
```
> bytecode 실행 후 value stack

<br>

#### CHECK_EXC_MATCH                                       
```
compare_result = isinstnace(stack[-2], stack[-1])
stack.pop()
stack.append(compare_result)
```
> bytecode 동작  

현재 발생한 에러 instance가 ZeroDivisionError class의 instance인지 체크한다.

```
[None, ZeroDivisionError instance, True]
```
> bytecode 실행 후 value stack

<br>

#### POP_JUMP_IF_FALSE 22 (to L7)
```
value = stack.pop()
if value == false:
    instruction_counter += delta
```
> bytecode 동작  

현재 flow에선, `value`가 `True`이므로 jump하지 않는다.

```
[None, ZeroDivisionError instance]
```
> bytecode 실행 후 value stack

<br>

#### STORE_FAST 2 (e)
`STORE_FAST (var_num)`

```
value = stack.pop()
fastlocals[var_num] = value    
```
> bytecode 동작  

로컬 변수 `e`에 ZeroDivisionError instance를 매핑한다. 

```
[None]
```
> bytecode 실행 후 value stack

<br>

#### L4: LOAD_GLOBAL 1 (print + NULL), LOAD_FAST 2 (e), CALL 1, POP_TOP

`print` 함수로 에러를 출력하고, 함수의 반환값을 제거한다.

```
[None]
```
> bytecode 실행 후 value stack

<br>

#### L5: POP_EXCEPT
```
stack.pop()
```
> bytecode 동작  

`except` 블록이 끝나면, `PUSH_EXC_INFO`에서 넣어준 current exception in thread state (이전에 발생한 에러에 대한 정보) 를 제거하여 Exception Handler 진입 전의 상태로 원복한다.

```
[]
```
> bytecode 실행 후 value stack

<br>

#### LOAD_CONST 1 (None), STORE_FAST 2 (e)
```
stack.append(co_consts[consti])

fastlocals[var_num] = stack.pop()
```
> bytecode 동작  

로컬 변수 `e`에 None을 할당함으로써, error instance 참조 관계를 끊고 변수를 정리한다. 

```
[]
```
> bytecode 실행 후 value stack

<br>

#### DELETE_FAST 2 (e)
`DELETE_FAST (var_num)`

```
del fastlocals[var_num] 
```
> bytecode 동작  

namespace에서 `co_varnames[var_num]`의 name을 가진 key를 제거한다. namespace에서 제거되었기 때문에, `except` 블록 바깥에서 로컬 변수 `e`에 접근할 수 없다. <br>
(접근 시 `UnboundLocalError: cannot access local variable 'e' where it is not associated with a value` 발생)

```
[]
```
> bytecode 실행 후 value stack

<br>

#### JUMP_FORWARD 8 (to L9)
`JUMP_FORWARD (delta)`

```
instruction_counter += delta
```
> bytecode 동작  

instruction counter를 증가시켜 L9로 이동한다. 이후에는 앞서 살펴본 finally 블록 bytecode를 실행한다.
 
```
[]
```
> bytecode 실행 후 value stack

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

`ZeroDivisionError`가 발생하여, `except` 블록에 진입했고, 그 안에서 또 에러가 난 경우의 flow이다. <br>
`L1 → L3 → L4 → L6 → L8 -> L10 → L11 -> propagate`의 흐름으로 bytecode를 실행한다.

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
                CALL                     1                <- Error 발생했다 가정
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

`print` function을 호출하였는데, 내부에서 에러가 발생했다고 가정하겠다. 
`print` function은 error instance와 lasti를 반환한다. 

```
[None, print error instance, lasti]
```
> bytecode 실행 후 value stack

<br>

#### L6: LOAD_CONST 1 (None), STORE_FAST 2 (e), DELETE_FAST 2 (e)

로컬 변수 `e`의 참조관계를 정리하고, namespace에서도 제거한다.

```
[None, print error instance, lasti]
```
> bytecode 실행 후 value stack

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
> bytecode 동작  

`oparg`가 `1`이므로 `lasti`랑 error instance를 raise한다. Exception Table에 따라 L8 exception handler로 이동한다.

```
[None]
```
> bytecode 실행 후 value stack

<br>

#### Exception Table L6 to L8 -> L8 [1] lasti

```
reset to stack depth[1]  # value stack에 1개의 데이터만 빼고 전부 pop
stack.append(raised exception instance)
stack.append(lasti)
```
> Exception Table의 value stack 처리 과정 

exception handler로 가기전 value stack을 stack_depth 개수만 남겨놓고 데이터를 전부 제거하고, 현재 발생한 error instance와 lasti를 넣는다.

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
> bytecode 동작  


```
[None, print error instance, lasti, None]
```
> bytecode 실행 후 value stack

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
> bytecode 동작

print error instance를 raise 한다.
exception table에 따라, L10으로 이동한다.

```
[None]
```
> bytecode 실행 후 value stack

<br>

#### Exception Table L8 to L9 -> L10 [0] 

```
reset to stack depth[0]  
stack.append(raised exception instance)
```
> Exception Table의 value stack 처리 과정 

`lasti` 표기가 없으므로, `lasti`는 value stack에 넣지 않는다.

```
[print error instance]
```
> value stack

<br>

#### L10: PUSH_EXC_INFO ~ POP_TOP
finally 블록에 대응되는 bytecode를 실행한다.

```
[None, print error instance]
```
> bytecode 실행 후 value stack

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
> bytecode 동작

exception handler에서 잡지 못한 print error instance를 raise한다. 
exception table에 따라, L11로 이동한다.

```
[None]
```
> bytecode 실행 후 value stack

<br>

#### Exception Table L10 to L11 -> L11 [1] lasti 

```
reset to stack depth[1]  
stack.append(raised exception instance)
stack.append(lasti)
```
> Exception Table의 value stack 처리 과정 


```
[None, print error instance, lasti]
```
> value stack

<br>

#### L11: COPY 3, POP_EXCEPT, RERAISE 1

exception handler가 더이상 남아있지 않은데, print error instance는 여전히 처리되지 않았으므로, caller에게 에러 인스턴스를 전파한다.

<br>

### 4. Non-matching exception flow 

```python
def divide(a, b):
    try:
        return a / b  <- Error occur
    except ZeroDivisionError as e: <- No matched
        print(e)                      
    finally:
        print("Execution completed.")
```


`ZeroDivisionError`가 아닌 다른 에러가 발생하여, `except` 블록에 진입하지 못한 경우의 flow이다. <br>
`L1 → L3 → L7 → L8 -> L10 → L11 -> propagate`

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

현재 발생한 에러가 ZeroDivisionError instance가 아니어서, instruction counter를 증가시켜 L7로 이동한다.

```
[None, unknown error instance]
```
> bytecode 실행 후 value stack

<br>

#### L7: RERAISE 0
error instance를 raise한다. exception table에 따라 L8로 이동한다.

```
[None]
```
> bytecode 실행 후 value stack

<br>

#### Exception Table L6 to L8 -> L8 [1] lasti
```
reset to stack depth[1]  
stack.append(raised exception instance)
stack.append(lasti)
```
> Exception Table의 value stack 처리 과정 


```
[None, unknown error instance, lasti]
```
> value stack

이후부턴 L8로 이동하여 case 3번과 동일한 플로우로 bytecode가 실행된다.

<br>

# 함수 안의 함수, 클로져 bytecode 분석
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
> bytecode 동작 

cell은 inner function과 outer function 모두 접근할 수 있는 작은 컨테이너이다. 
cell은 wrapper 객체이고, 그 안에 실제 객체를 가리키는 참조를 담고 있다. 
위 예시에선, `cell object -> [a object]` 로 표현할 수 있다.  
outer function의 namespace에 cell에 대한 참조를 저장한다.

```
[]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_SMALL_INT 1, STORE_DEREF 1 (a)
`STORE_DEREF (i)`

```
stack.append(1)

value = stack.pop()
cell = fastlocals[i]
cell.set(value)
```
> bytecode 동작 

`STORE_DEREF`는 value stack에서 꺼낸 값을 cell 안에 저장한다.

```
[]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_FAST_BORROW 1 (a), BUILD_TUPLE 1
`BUILD_TUPLE (count)`

```
value = fastlocals[var_num]
stack.append(value)

stack_top_tuple = tuple(stack[-count:])
stack.append(stack_top_tuple)
```
> bytecode 동작 

`BUILD_TUPLE`은 value stack의 상위 `count`개를 하나의 튜플로 만든 후 value stack에 넣는다.

```
[(cell, )]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_CONST 1 (<code object inner ...>), MAKE_FUNCTION

code object를 바탕으로 inner function object를 만들어서 value stack에 넣는다.

```
[(cell, ), inner function]
```
> bytecode 실행 후 value stack 

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
> bytecode 동작 

`flag`에 따라, function의 어떤 attribute를 세팅할 지 결정된다. 예시의 경우, `flag`가 `8`이므로 `inner` function의 `__closure__` attribute에 cell이 포함된 tuple을 할당한다.

```
[inner function]
```
> bytecode 실행 후 value stack 

<br>

### STORE_FAST 0 (inner), LOAD_FAST_BORROW 0 (inner), RETURN_VALUE

inner function을 caller에게 반환한다.

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
> bytecode 동작

inner function의 closure를 local namespace에도 할당한다. 

```
[]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_DEREF 0 (a)
`LOAD_DEREF (i)`

```
cell = fastlocals[i]
value = cell.get()
stack.append(value)
```

local namespace가 가리키는 cell이 갖는 실제 객체를 value stack에 넣는다. cell reference를 넣지 않고, cell reference에 접근하여 cell 안의 객체를 가져오기 때문에 DEREF (dereference) 라는 표현을 쓴다.


```
[a]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_SMALL_INT 1, BINARY_OP 13 (+=)
```
stack.append(1)

rhs = stack.pop()
lhs = stack.pop()
stack.append(lhs op rhs)
```
> bytecode 동작

a에 1을 더한 값을 value stack에 넣는다.

```
[a + 1]
```
> bytecode 실행 후 value stack 

<br>

### STORE_DEREF 0 (a)
```
value = stack.pop()
cell = fastlocals[i]
cell.set(value)
```
> bytecode 동작

cell 안에 a + 1 을 저장한다.

```
[]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_GLOBAL 1 (print + NULL) ~ RETURN_VALUE

cell을 통해 접근 가능한, free variable `a`를 `print` function으로 출력하고 inner function 실행을 종료한다.


<br>

# class와 메서드 호출 bytecode 분석 

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

## module bytecode

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
> bytecode 동작

LOAD_BUILD_CLASS는 class를 생성할 때 필요한 builtins.__build_class__ function을 value stack에 넣는다.


```
[builtins.__build_class__ function, NULL]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_CONST 0 (<code object Person ...>), MAKE_FUNCTION
code object를 바탕으로 Person function을 생성 후 value stack에 넣는다.

```
[builtins.__build_class__ function, NULL, Person function]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_CONST 1 ('Person'), CALL 2
```
class_obj = builtins.__build_class__(Person function, 'Person')
stack.append(class_obj)
```
> bytecode 동작

Person class object를 생성 후 value stack에 넣는다.

```
[Person class]
```
> bytecode 실행 후 value stack 

<br>

### STORE_NAME 0 (Person), LOAD_NAME 0 (Person)
namespace에 Person class object를 할당하고, Person class object를 value stack에 넣는다.

```
[Person class]
```
> bytecode 실행 후 value stack 

<br>

### PUSH_NULL, LOAD_CONST 2 ('hyun'), CALL 1, STORE_NAME 1 (hyun)

Person class object를 호출하여 person instance를 생성 후, 이를 모듈 변수 `hyun`에 할당한다.

```
[]
```
> bytecode 실행 후 value stack 

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
    mtehod = instance.__class__.__dict__[method_name] # unbound function
    stack.append(method)
    stack.append(instance)
else: # attribute load
    attr_name = co_names[namei>>1]
    attr = instance.attr_name
    stack.push(NULL)
    stack.append(attr)
```

namei의 low bit이 1인 경우, method를 load한다. method object는 class object가 생성될 때 만들어진다. value stack에는 instance에 속하지 않는 unbound method를 넣는다. 이후, unbound method를 갖는 instance를 추가로 넣어준다. unbound method는 호출 될 때, self 인자로 value stack에 들어있는 instance를 넣어준다. 

```
[unbound method greet, person instance]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_CONST 3 ('Yoon') ~ RETURN_VALUE
`hyun` instance의 `greet` 메서드를 호출한 후, 모듈을 종료한다.

<br>

## class bytecode
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

### MAKE_CELL 0 (__classdict__)

cell을 만들고, 이를 namespace에 할당한다. 

```
[]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_NAME 0 (__name__) ~ STORE_NAME 3 (__firstlineno__)
class namespace에 special attribute들을 할당한다.

```
[]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_LOCALS
```
stack.append(locals())
```
> bytecode 동작

local namespace를 value stack에 넣는다. 

```
[class namespace dictionary]
```
> bytecode 실행 후 value stack 

<br>

### STORE_DEREF 0 (__classdict__)
cell안에 class namespace dictionary를 저장한다.

```
[]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_CONST 1 (<code object __init__>) ~ STORE_NAME 5 (greet)
init function object, greet function object를 만들고, 이를 class namespace에 할당한다.

```
[]
```
> bytecode 실행 후 value stack 

<br>

### LOAD_CONST 3 (('name',)), STORE_NAME 6 (__static_attributes__)

self.xxx 방식으로 할당된 attribute들은 __static_attributes__ 에 tuple 형태로 attribute name들이 저장된다. Person class object는 __init__에서 `self.name = name`으로 할당되기 때문에 'name'이 tuple내에 들어있다.

```
[]
```
> bytecode 실행 후 value stack 

<br>

## method bytecode

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
> bytecode 동작

instance에 attribute를 할당한다.

<br>

### LOAD_ATTR 2 (name)

```
instance = stack.pop()
if namei & 1 == 1: # method load
    method_name = co_names[namei>>1] 
    mtehod = instance.__class__.__dict__[method_name] # unbound function
    stack.append(method)
    stack.append(instance)
else: # attribute load
    attr_name = co_names[namei>>1]
    attr = instance.attr_name
    stack.push(NULL)
    stack.append(attr)
```
> bytecode 동작

2는 flag bit이 0이므로, method가 아니라 attribute 접근이다. 

<br>

# 버전 정보
- python 3.14.3

<br>

# 출처 
- https://docs.python.org/3.14/library/dis.html
- https://docs.python.org/3/reference/datamodel.html
- https://docs.python.org/3/library/functions.html#locals
- https://docs.python.org/3/library/functions.html#globals
- https://github.com/python/cpython/blob/3.8/Python/ceval.c
- https://github.com/python/cpython/blob/main/InternalDocs/exception_handling.md