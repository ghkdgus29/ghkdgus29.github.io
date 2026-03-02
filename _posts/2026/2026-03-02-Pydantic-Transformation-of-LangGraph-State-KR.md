---
layout: post
author: Hyun 
title: LangGraph State의 Pydantic화
date:   2026-03-02 22:00:00 +0900
excerpt: "LangGraph State의 Pydantic화"
categories:
 - Engineering
 - LangGraph
 - Python
lang: kr
lang_ref: /Pydantic-Transformation-of-LangGraph-State-EN/
---

# LangGraph의 `TypedDict` state 문제점

## state 직렬화 
기존 `TypedDict` state는 그냥 딕셔너리 데이터 타입에 대한 타입 힌트일 뿐이므로, 특정 필드들에 대한 직렬화 방식을 정의하거나 제어하는 기능이 없다. 
따라서 state의 특정 필드에 대한 직렬화 정의가 필요한 경우, 직렬화를 수행하는 인스턴스에 state를 직렬화하는 방식을 정의한 함수를 파라미터로 같이 전달하였다. 

```python
class MyState(TypedDict):
    tenant_sid: Annotated[str, "Tenant SID"]
    history: Annotated[list, "history"]

    # ...
```
> state 예시

`MyState`의 `history` 필드는, `HumanMessage`와 `AIMessage` 객체로 이루어져 `json.dump(state)` 로는 직렬화가 불가능하다고 가정하자. 

<br>

```python
class MyService:
    def __init__(self):
        def state_serializer(state: MyState) -> dict[str, Any]:
            state.pop("history")
            return dict(state)
        
        # ...

        workflow.add_node(MyProcessingNode(state_serializer=state_serializer))
```

<br>

```python
class MyProcessingNode:

    def __init__(self, state_serializer: Callable[[T], dict[str, Any]]):
        self._state_serializer = state_serializer

    async def __call__(self, state: T):
        serialized_state = json.dump(self._state_serializer(state))
        
        # ...
```
> state의 직렬화가 필요한 `MyProcessingNode`는 `state_serializer` 함수를 생성 인자로 받아 내부에서 사용한다. 

<br>

기존 방식은 크게 두 가지 문제점이 있다. <br>
첫째, state 직렬화가 필요한 인스턴스, 함수들에게 `state_serializer` 함수를 빠짐없이 넘겨주어야 하고, 직렬화를 수행하는 인스턴스에선 특정 필드들에 특화된 `state_serializer`를 반드시 호출한 후에 standard serialization을 수행해야 한다는 불편함이 있다. (e.g. `json.dump`) <br> 
둘째, state의 필드들을 제일 잘 아는 전문가는 state이다. 그럼에도 불구하고, state의 특정 필드들에 특화된 `state_serializer`를 구현하는 부분이 state 내부가 아닌 이곳 저곳에 산재해 있다는 문제가 있다. 

<br>

## state내의 필드 접근

```python
class MyState(TypedDict):
    tenant_sid: Annotated[str, "Tenant SID"]
    history: Annotated[list, "history"]

    # ...

TENANT_SID: Literal["tenant_sid"] = "tenant_sid"
HISTORY: Literal["history"] = "history"

# ...
```
> state 예시

앞서 말했듯이, `TypedDict`는 딕셔너리 데이터 타입에 대한 타입 힌트일 뿐이므로, 런타임에는 딕셔너리로 처리된다. 따라서 컴파일러의 타입 힌트를 받을 수 없어 state를 정의한 모듈에 필드를 나타내는 상수를 넣었다.  

```python
from ***.my_state import TENANT_SID, HISTORY,

class MyNode:

    async def __call__(
        self, state: MyState
    ) -> dict[str, Any]:
        tenant_sid = state[TENANT_SID]
        history = state[HISTORY]
        # ...
```
> state를 사용하는 node 예시 

<br>

이처럼 state 모듈에 정의된 상수를 import하여 state의 필드에 접근하였다. 
이는 컴파일러에 의해 강제되는 것이 아무것도 없으므로 아래와 같은 상황이 발생할 수 있다.

```python
class YourState(TypedDict):
    your_tenant_sid: Annotated[str, "Tenant SID"]
    your_history: Annotated[list, "history"]

    # ...

TENANT_SID: Literal["your_tenant_sid"] = "your_tenant_sid"
HISTORY: Literal["your_history"] = "your_history"
```
> 타 개발자가 만든 state 예시

<br>

```python
from ***.your_state import TENANT_SID, HISTORY,

class MyNode:

    async def __call__(
        self, state: MyState
    ) -> dict[str, Any]:
        tenant_sid = state[TENANT_SID]
        history = state[HISTORY]
        # ...
```
> your_state 모듈의 TENANT_SID`를 사용하게 된다면 `KeyError` 발생

<br>

# LangGraph state를 pydantic model로 변경하기
```python
class MyState(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    tenant_sid: str
    history: Annotated[list[HumanMessage | AIMessage], Field(exclude=True)]
    error: Exception | None = None

    # ...

    @field_serializer("error")
    def serialize_error(self, error: Exception | None) -> str | None:
        if error is None:
            return None
        return str(error)
```
> pydantic state 예시 

`BaseModel`을 상속받음으로써, pydantic model state를 생성할 수 있다. 

<br>


`model_config = ConfigDict(arbitrary_types_allowed=True)` <br>
pydantic은 기본적으로 자체적으로 검증이 가능한 타입만 필드로 허용한다. 반면 `MyState`의 `error` 필드와 같은 일반 Python 클래스들 arbitrary type이다.
만약 arbitrary type을 필드로 사용하고 싶다면, `arbitrary_types_allowed=True` 옵션을 주어야 한다.

<br>

`Annotated[list[HumanMessage | AIMessage], Field(exclude=True)]` <br>
`Annotated`를 사용하여 타입힌트와 필드에 대한 메타 데이터를 하나로 합칠 수 있다. pydantic model은 `model_dump` 메서드를 호출하여 일관된 방식으로 직렬화 할 수 있다.
`Field(exclude=True)`를 메타 데이터로 갖는 필드는 `model_dump` 직렬화 시 해당 필드를 제외한다.

<br>

`@field_serializer("error")` <br>
`model_dump` 메서드를 호출하여 직렬화 할 때, 특정 필드의 직렬화 방식을 원하는 방법으로 재정의할 수 있다. 

<br>

## state 직렬화 방식 개선 
state 별로 특화된 직렬화 함수를 이곳 저곳에서 선언하고 해당 함수를 호출할 필요가 없어졌다.
state 설계자는, state 클래스를 설계하고 생성하는 시점에, 어떤 필드가 직렬화 가능하고, 어떤 방식으로 직렬화 되어야 하는지를 정의하면 된다.
직렬화의 책임을 가진 인스턴스를 개발하는 개발자는, state가 어떤 필드를 갖는지, 어떻게 직렬화되어야 하는지 신경쓰지 않고, 단순히 `state.model_dump()`를 호출하여 직렬화한다.

```python
class MyProcessingNode:

    async def __call__(self, state: T):
        serialized_state = state.model_dump() 
        
        # ...
```
> state의 직렬화가 필요한 `MyProcessingNode`는 pydantic state의 `model_dump` 메서드만 호출하면 된다. 

<br>

## state 필드 접근 방식 개선

```python
class MyNode:

    async def __call__(
        self, state: MyState
    ) -> dict[str, Any]:
        tenant_sid = state.tenant_sid
        history = state.history
        # ...
```

state를 사용할 때 코드 에디터의 code completion의 도움을 받아 state 내부 필드에 쉽게 접근할 수 있다. 상수 import가 필요없어짐에 따라, 잘못된 상수 import로 인한 `keyError` 발생 가능성도 제거되었다.   

<br>

## LangGraph pydantic state 규칙 
1. Graph내의 노드들은 pydantic model state에 대해 Runtime validation을 수행하지 않는다.  

즉, Runtime validation은 Graph 내의 노드들에서 매번 발생하는 것이 아니라, Graph에 넣어줄 최초 input state를 만들 때 발생한다. 
따라서, 노드내의 input state나 output 값은 반드시 pydantic model state를 받고, 반환해야 하는 것은 아니다. 

```python
class MyState(BaseModel):
    name: str
    age: int


workflow = StateGraph(MyState)


def node1(state: MyState) -> dict[str, str]:
    return {"name": "John"}


workflow.add_node("node1", node1)

workflow.add_edge(START, "node1")
workflow.add_edge("node1", END)

app = workflow.compile()

result = app.invoke({"named": "Hyun", "age": 20})
```
> pydantic state는 `name`을 필요로 하는데, 최초 state를 만들 때, 해당 필드를 넣지 않은 경우 pydantic model validation 에러 발생  

```
    validated_self = self.__pydantic_validator__.validate_python(data, self_instance=self)
                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
pydantic_core._pydantic_core.ValidationError: 1 validation error for MyState
name
  Field required [type=missing, input_value={'age': 20}, input_type=dict]
    For further information visit https://errors.pydantic.dev/2.11/v/missing
Before task with name 'node1' and path '('__pregel_pull', 'node1')'
```

<br>

```python
workflow = StateGraph(MyState)

def node1(state: dict[str, Any]) -> dict[str, str]:
    return {"named": "John"}


def node2(state: dict[str, Any]) -> dict[str, int]:
    print(type(state))          # <class '__main__.MyState'>
    return {"age": 30}


workflow.add_node("node1", node1)
workflow.add_node("node2", node2)

workflow.add_edge(START, "node1")
workflow.add_edge("node1", "node2")
workflow.add_edge("node2", END)

app = workflow.compile()

result = app.invoke({"name": "Hyun", "age": 20})
```
> 정상 동작 코드 

위의 `node1,` `node2와` 같이 input state와 output값을 딕셔너리 타입으로 받는다해도 런타임에러가 발생하지 않는다.
또한, LangGraph는 그래프 생성 시 넘겨준 `MyState` 스키마를 기준으로 동작하기 때문에, `node2에서` input state 인스턴스의 실제 타입은 `MyState` state이다. 

<br>

2. 각 노드의 반환값은 기존 state를 덮어쓴다.  

더 정확히 말하면, 그래프 생성 시 넘겨준 스키마에 노드의 반환값을 넣고 다음 노드로 전달될 state를 생성한다. 

<br>

```python
class CompiledStateGraph(
    Pregel[StateT, ContextT, InputT, OutputT],
    Generic[StateT, ContextT, InputT, OutputT],
):
    def attach_node(self, key: str, node: StateNodeSpec[Any, ContextT] | None) -> None:
        # ...
        
            else:
                mapper = _pick_mapper(input_channels, input_schema)


def _pick_mapper(
    state_keys: Sequence[str], schema: type[Any]
) -> Callable[[Any], Any] | None:
    if state_keys == ["__root__"]:
        return None
    if isclass(schema) and issubclass(schema, dict):
        return None
    return partial(_coerce_state, schema)


def _coerce_state(schema: type[Any], input: dict[str, Any]) -> dict[str, Any]:
    return schema(**input)
```
> langgraph > graph > state.py

그래프를 컴파일하는 시점에 각 노드들을 연결하면서 `_pick_mapper` 함수를 호출하여, 다음 노드에 건너줄 state를 생성하는 mapper 함수를 `CompiledStateGraph`에 등록한다. 이때, 노드의 output값이 스키마와 다른 경우 `_coerce_state` 함수가 mapper 함수로 등록된다 

<br>

`schema`는 그래프 생성 시 인자로 넘겨준 schema로 pydantic state를 사용하는 경우, pydantic state 클래스를 나타낸다. <br>
위 예시에선, `schema`는 `MyState` 클래스를, `input`은 기존 state값에 노드의 반환값을 merge 한 딕셔너리 데이터를 나타낸다.
이때, `input`의 경우 그래프 스키마에 존재하는 필드들만 가지고 있으므로, 노드의 반환값에 스키마에 존재하지 않는 필드가 있다면 포함되지 않고 그냥 버려진다.
또한, 기존 state와 노드의 반환값이 서로 겹치는 key값을 갖는다면 노드의 반환값이 우선권을 가져 업데이트 된다.

<br>

결과적으로, `schema(**input)`은 새로운 pydantic state 인스턴스를 생성하는 것과 동일하다. pydantic model 인스턴스 생성 규칙에 따라 pydantic schema에 어긋나는 타입으로 값을 할당하는 경우 pydantic validation error를 발생시킨다. 

<br>

```python
class MyState(BaseModel):
    name: str
    age: int


workflow = StateGraph(MyState)


def node1(state: MyState) -> dict[str, str]:
    return {"named": "John"} # named 필드는 그래프 스키마에 존재하지 않으므로 무시


def node2(state: MyState) -> dict[str, int]:
    print(state)  # name='Hyun', age=20
    return {"age": 30}


def node3(state: MyState) -> dict[str, str]:
    print(state)  # name='Hyun', age=30
    return {"name": 123}    # name 필드는 str이므로, 다음 노드에 넘겨줄 state 생성 시 validation error 발생 

def node4(state: MyState) -> dict[str, str]:
    # ...

workflow.add_node("node1", node1)
workflow.add_node("node2", node2)
workflow.add_node("node3", node3)
workflow.add_node("node4", node4)

workflow.add_edge(START, "node1")
workflow.add_edge("node1", "node2")
workflow.add_edge("node2", "node3")
workflow.add_edge("node3", "node4")
workflow.add_edge("node4", END)

app = workflow.compile()

result = app.invoke({"name": "Hyun", "age": 20})
```

<br>

3. 그래프의 반환 값은 pydantic model이 아니다. 

이 말은 곧, 마지막 노드의 반환값 역시 pydantic model을 만들기 위한 mapper 함수에 넘겨지지 않으므로 마지막 노드의 반환값은 그래프 스키마의 타입을 고려하지 않고, validation error도 발생하지 않는다.  

```python
class MyState(BaseModel):
    name: str
    age: int


workflow = StateGraph(MyState)


def node1(state: MyState) -> dict[str, int]:
    return {"name": 123}


workflow.add_node("node1", node1)

workflow.add_edge(START, "node1")
workflow.add_edge("node1", END)

app = workflow.compile()

result = app.invoke(MyState(name="Hyun", age=20))
print(result)  # {'name': 123, 'age': 20}
```
> validation error가 발생하지 않는다.

만약 중간에 위치한 노드가 `{"name" : 123}`을 반환하였다면, 다음 노드에 건내줄 pydantic state를 만드는 과정에서 validation error가 발생했을 것이다. 하지만 마지막 노드에선 이 과정이 없기에 validation error가 발생하지 않는다. 

<br>

# pydantic model state의 필드명 가져오기  

## 목표
그래프내의 state를 업데이트하려면 각 노드의 반환값은 state의 필드명을 key로 가지는 딕셔너리여야 한다. state 필드명을 state 모듈에 상수로 정의하는 것은 앞서 살펴본 문제를 야기할 수 있어 고려하지 않았고, 코드 에디터의 code completion 기능을 이용하여 state 필드명을 구할 수 있도록 하고싶었다.

<br>

## state 메타 클래스 정의 
pydantic은 필드 선언 시, 필드에 대한 정보를 `__pydantic_fields__`에 보관한다. 즉, class attribute로 저장하지 않기 때문에, pydantic model 클래스 Object는 `__dict__`에 아무것도 가지지 않는다. 따라서 `pydantic model 클래스.필드명`으로 표현되는 attribute lookup은 실패하게 된다. <br>
인스턴스의 attribute lookup이 실패하면 클래스 Object의 `__getattr__`을 호출하고, 클래스 Object의 attribute lookup이 실패하면 메타 클래스 Object의 `__getattr__`을 호출한다.

<br>

정리하면, pydantic model 클래스 Object는 class attribute를 가지지 않는다는 특징과 클래스 Object의 attribute lookup이 실패하면 메타 클래스 Object의 `__getattr__`을 호출한다는 특징 두 가지를 사용하여 pydantic model state의 필드명을 가져오는 로직을 구현하였다. 

<br>

```python
class _StateGetAttrMeta(ModelMetaclass):
    def __getattr__(self, item: str) -> str:
        if item in self.__dict__.get("__pydantic_fields__", ()):
            return item
        raise AttributeError(item)

class MyState(BaseModel, metaclass=_StateGetAttrMeta):
    answer: str

    # ...
```
> state 예시 

<br>

```python
class MyNode:

    async def __call__(
        self, state: MyState
    ) -> dict[str, Any]:
        # ... 

        return {state.__class__.answer: result}
```
> 노드 예시

![code completion](/assets/images/posts/260226.png)
> 코드 에디터의 code completion 사용 가능

<br>

state의 클래스 Object를 가져온 후 `answer` 필드에 접근하려 하면, 클래스 Object엔 `answer` 필드가 없으므로 메타 클래스 `_StateGetAttrMeta`의 `__getattr__`을 호출한다. `__getattr__`은 `__pydantic_fields__`에 필드 정보가 있음을 확인하고 필드명을 반환한다.

<br>

> 버전정보
> - python 3.11.4
> - langgraph 1.0.3
> - pydantic 2.11.7

<br>

> 참고문서 
> - https://docs.pydantic.dev/latest/api/config/#pydantic.config.ConfigDict.arbitrary_types_allowed
> - https://docs.langchain.com/oss/python/langgraph/use-graph-api#use-pydantic-models-for-graph-state
> - https://github.com/pydantic/pydantic/discussions/8600