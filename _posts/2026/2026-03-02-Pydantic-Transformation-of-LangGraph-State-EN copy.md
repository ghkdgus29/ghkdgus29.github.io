---
layout: post
author: Hyun 
title: Pydantic Transformation of LangGraph State
date:   2026-03-02 22:00:00 +0900
excerpt: "Pydantic Transformation of LangGraph State"
categories:
 - Engineering
 - LangGraph
 - Python
lang: en
lang_ref: /Pydantic-Transformation-of-LangGraph-State-KR/
---

# Problems with `TypedDict` State in LangGraph

## State Serialization

Since the existing `TypedDict` state is merely a type hint for a dictionary data type, it lacks the functionality to define or control serialization methods for specific fields. Therefore, when serialization for a specific field in the state was required, a function defining how to serialize the state had to be passed as a parameter to the instance performing the serialization.

```python
class MyState(TypedDict):
    tenant_sid: Annotated[str, "Tenant SID"]
    history: Annotated[list, "history"]

    # ...
```
> Example of state

Assume that the `history` field of `MyState` consists of `HumanMessage` and `AIMessage` objects, making it impossible to serialize using `json.dump(state)`.

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
> `MyProcessingNode` receives a `state_serializer` function as a constructor argument and uses it internally.

<br>

There are two main problems with the existing approach.
First, the `state_serializer` function must be passed to every instance and function that requires state serialization, and the instance performing the serialization must inconveniently call the field-specific `state_serializer` before performing standard serialization (e.g., `json.dump`).

Second, the state is the expert that knows its own fields best. Nevertheless, there is a problem where the implementation of the `state_serializer` specialized for specific fields of the state is scattered in various places rather than within the state itself.

<br>

## Field Access within State
```python
class MyState(TypedDict):
    tenant_sid: Annotated[str, "Tenant SID"]
    history: Annotated[list, "history"]

    # ...

TENANT_SID: Literal["tenant_sid"] = "tenant_sid"
HISTORY: Literal["history"] = "history"

# ...
```
> Example of state

As previously mentioned, since `TypedDict` is merely a type hint for the dictionary data type, it is treated as a dictionary at runtime. Consequently, because it cannot receive type hints from the compiler, constants representing the fields were placed in the module where the state is defined.

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
> Example of a node using state

<br>

As shown, the state's fields were accessed by importing constants defined in the state module. Since nothing is enforced by the compiler, the following situations may occur:

```python
class YourState(TypedDict):
    your_tenant_sid: Annotated[str, "Tenant SID"]
    your_history: Annotated[list, "history"]

    # ...

TENANT_SID: Literal["your_tenant_sid"] = "your_tenant_sid"
HISTORY: Literal["your_history"] = "your_history"
```
> Example of a state created by another developer

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
> Using `TENANT_SID` from the `your_state` module would result in a `KeyError`.

<br>

# Changing LangGraph state to a Pydantic model

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
> Example of pydantic state

By inheriting from `BaseModel`, a Pydantic model state can be created.

`model_config = ConfigDict(arbitrary_types_allowed=True)` <br> 
By default, Pydantic only allows fields with types it can validate itself. On the other hand, general Python classes like the `error` field in `MyState` are considered arbitrary types. If you want to use an arbitrary type as a field, you must provide the `arbitrary_types_allowed=True` option.

`Annotated[list[HumanMessage | AIMessage], Field(exclude=True)]` <br>
You can combine type hints and field metadata into one using `Annotated`. Pydantic models can be serialized in a consistent manner by calling the `model_dump` method. Fields that have `Field(exclude=True)` as metadata are excluded when performing `model_dump` serialization.

`@field_serializer("error")`  <br>
When serializing by calling the `model_dump` method, you can override the serialization method for a specific field with your desired approach.

<br>

## Improvement in State Serialization

There is no longer a need to declare specialized serialization functions for each state in various places and call them.
The state designer simply defines which fields are serializable and how they should be serialized at the time the state class is designed and created.
A developer creating an instance responsible for serialization does not need to worry about what fields the state has or how they should be serialized; they simply call `state.model_dump()` to serialize.

```python
class MyProcessingNode:

    async def __call__(self, state: T):
        serialized_state = state.model_dump() 
        
        # ...
```
> `MyProcessingNode`, which requires state serialization, only needs to call the `model_dump` method of the Pydantic state.

<br>

## Improvement in State Field Access

```python
class MyNode:

    async def __call__(
        self, state: MyState
    ) -> dict[str, Any]:
        tenant_sid = state.tenant_sid
        history = state.history
        # ...
```

When using the state, you can easily access its internal fields with the help of the code editor's code completion. Since importing constants is no longer necessary, the possibility of a `KeyError` occurring due to incorrect constant imports has also been eliminated.

<br>

## LangGraph Pydantic State Rules

### 1. Nodes within the Graph do not perform runtime validation on the Pydantic model state.

In other words, runtime validation does not occur every time within the nodes of the Graph, but rather when creating the initial input state provided to the Graph. Therefore, the input state or output values within a node do not necessarily have to receive or return a Pydantic model state.

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
> The Pydantic state requires `name`; if this field is missing when creating the initial state, a Pydantic model validation error occurs.

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
> Working code

Even if the input state and output values are received as dictionary types, like in `node1` and `node2` above, no runtime error occurs.
Furthermore, since LangGraph operates based on the `MyState` schema provided during graph creation, the actual type of the input state instance in `node2` is the `MyState` state.

<br>

### 2. The return value of each node overwrites the existing state.

More precisely, the node's return value is mapped onto the graph's schema to build the state for the next node in the graph.

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

When compiling the graph, the `_pick_mapper` function is called as each node is connected to register a mapper function in the `CompiledStateGraph` that generates the state to be passed to the next node. If a node's output value differs from the schema, the `_coerce_state` function is registered as the mapper function.


`schema` refers to the schema passed as an argument during graph creation; when using a Pydantic state, it represents the Pydantic state class.
In the example above, `schema` represents the `MyState` class, and `input` represents dictionary data formed by merging the node's return value into the existing state.
In this case, since `input` only contains fields that exist in the graph schema, any fields in the node's return value that do not exist in the schema are excluded and discarded.
Furthermore, if the existing state and the node's return value have overlapping keys, the node's return value takes priority and updates the state.


Consequently, `schema(**input)` is equivalent to creating a new Pydantic state instance. Following the Pydantic model instance creation rules, a Pydantic validation error is raised if a value is assigned with a type that violates the Pydantic schema.

```python
class MyState(BaseModel):
    name: str
    age: int


workflow = StateGraph(MyState)


def node1(state: MyState) -> dict[str, str]:
    return {"named": "John"} # named field is ignored because 'named' not in graph schema


def node2(state: MyState) -> dict[str, int]:
    print(state)  # name='Hyun', age=20
    return {"age": 30}


def node3(state: MyState) -> dict[str, str]:
    print(state)  # name='Hyun', age=30
    return {"name": 123}    # 'name' must be a str; validation failed during next state generation.

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

### 3. The graph's return value is not a Pydantic model.

This means that the return value of the final node is not passed to the mapper function used to create a Pydantic model. Consequently, the final node's return value does not account for the graph schema's types, and no validation error occurs.

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
> Validation error does not occur.

If an intermediate node had returned `{"name": 123}`, a validation error would have occurred during the process of creating the Pydantic state to be passed to the next node. However, since this process does not take place for the final node, no validation error occurs.

<br>

# Retrieving Field Names of a Pydantic Model State

## Goal

To update the state within a graph, each node's return value must be a dictionary that uses the state's field names as keys. Defining state field names as constants in a state module was not considered because it can cause the issues discussed previously. Instead, I wanted to enable retrieving state field names by utilizing the code editor's code completion feature.

<br>

## Defining a State Metaclass

When fields are declared in Pydantic, the information about those fields is stored in `__pydantic_fields__`. Since they are not stored as class attributes, the Pydantic model class object contains nothing in its `__dict__`. Consequently, an attribute lookup represented by `PydanticModelClass.field_name` will fail.

When an instance's attribute lookup fails, the class object's `__getattr__` is called; if the class object's attribute lookup fails, the metaclass object's `__getattr__` is called.

In summary, I implemented the logic to retrieve the field names of the Pydantic model state by leveraging two characteristics: that the Pydantic model class object does not hold class attributes for its fields, and that a failed attribute lookup on a class object triggers the metaclass object's `__getattr__`.

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
> Example of state 

<br>

```python
class MyNode:

    async def __call__(
        self, state: MyState
    ) -> dict[str, Any]:
        # ... 

        return {state.__class__.answer: result}
```
> Example of node 

![code completion](/assets/images/posts/260226.png)

<br>

When attempting to access the `answer` field after retrieving the state's class object, the metaclass `_StateGetAttrMeta`'s `__getattr__` is invoked because the class object itself does not possess the `answer` field. `__getattr__` then verifies that the field information exists within `__pydantic_fields__` and returns the field name.


<br>

> Version Info
> - python 3.11.4
> - langgraph 1.0.3
> - pydantic 2.11.7

<br>

> References 
> - https://docs.pydantic.dev/latest/api/config/#pydantic.config.ConfigDict.arbitrary_types_allowed
> - https://docs.langchain.com/oss/python/langgraph/use-graph-api#use-pydantic-models-for-graph-state
> - https://github.com/pydantic/pydantic/discussions/8600