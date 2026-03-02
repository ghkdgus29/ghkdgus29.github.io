---
layout: post
author: Hyun 
title: Why SSE Errors Are Not Caught by FastAPI's Global Exception Handler
date:   2026-03-02 21:06:00 +0900
excerpt: "Why SSE Errors Are Not Caught by FastAPI's Global Exception Handler"
categories:
 - Engineering
 - FastAPI
 - Python
lang: en
lang_ref: /Why-SSE-Errors-Are-Not-Caught-by-the-Global-Exception-Handler-KR/
---

# Issue
The client is developed to forcibly terminate the SSE connection if it remains open too long, even if the response has not been completed. When the connection is severed on the server side, a `CancelledError` exception occurs at the service layer. I became curious as to why this exception occurs at the service layer and why it is not caught by FastAPI's Global Exception Handler. After debugging the internal logic, I have summarized the reasons and the direction for exception handling.

<br>

# SSE Response Flow

## router handler function is called within the `request_response` function of routing.py.
```python
def request_response(
    func: typing.Callable[[Request], typing.Awaitable[Response] | Response],
) -> ASGIApp:
    """
    Takes a function or coroutine `func(request) -> response`,
    and returns an ASGI application.
    """
    f: typing.Callable[[Request], typing.Awaitable[Response]] = (
        func if is_async_callable(func) else functools.partial(run_in_threadpool, func)  # type:ignore
    )

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        request = Request(scope, receive, send)

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            response = await f(request)                 # <- call  
            await response(scope, receive, send)

        await wrap_app_handling_exceptions(app, request)(scope, receive, send)

    return app
```
> starlette > routing.py <br>
> Starlette is an ASGI (Asynchronous Server Gateway Interface) framework primarily used to build Python-based asynchronous web servers.

<br>

The `request_response` function receives the request and calls the router handler function registered in FastAPI to obtain a `response` return value. When a client request comes in, this function is called first. Here, `f` represents the router handler function written and registered by the developer. After calling `f`, it proceeds to the next step.

<br>

## Router Handler Function Returns `StreamingResponse`
```python
@router.post("/answer")
@inject
async def answer(
    request: AnswerRequestDto,
    service: ManualFaqService = Depends(Provide[Container.manual_faq_service]),
) -> StreamingResponse:
    stream = service.astream(request=request)
    return StreamingResponse(stream, media_type="text/event-stream")
```
> route.py

```python
class ManualFaqService:

    async def astream(
        self,
        request: AnswerRequestDto,
    ):
        # ... 

        async for chunk_msg in self._app.astream(
            state,
            config=config,
            stream_mode="custom",
        ):
            yield ...
```
> service.py

The developer-created router handler function calls `service.astream` to obtain an async generator. The router handler function then creates and returns a `StreamingResponse` object, passing the async generator object as a creation argument.

<br>

## Calling `StreamingResponse.__call__` within the `request_response` function of routing.py
```python
def request_response(
    func: typing.Callable[[Request], typing.Awaitable[Response] | Response],
) -> ASGIApp:
    """
    Takes a function or coroutine `func(request) -> response`,
    and returns an ASGI application.
    """
    f: typing.Callable[[Request], typing.Awaitable[Response]] = (
        func if is_async_callable(func) else functools.partial(run_in_threadpool, func)  # type:ignore
    )

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        request = Request(scope, receive, send)

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            response = await f(request)                 
            await response(scope, receive, send)        # <- call

        await wrap_app_handling_exceptions(app, request)(scope, receive, send)

    return app
```
> starlette > routing.py <br>

The `StreamingResponse` object received from the router handler function is called to initiate the SSE response.

<br>

## Internal behavior of `StreamingResponse.__call__`
```python
class StreamingResponse(Response):
    # ...

    async def listen_for_disconnect(self, receive: Receive) -> None:
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                break
    
    async def stream_response(self, send: Send) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": self.status_code,
                "headers": self.raw_headers,
            }
        )
        async for chunk in self.body_iterator:
            if not isinstance(chunk, (bytes, memoryview)):
                chunk = chunk.encode(self.charset)
            await send({"type": "http.response.body", "body": chunk, "more_body": True})

        await send({"type": "http.response.body", "body": b"", "more_body": False})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        spec_version = tuple(map(int, scope.get("asgi", {}).get("spec_version", "2.0").split(".")))

        # ...

            with collapse_excgroups():                  
                async with anyio.create_task_group() as task_group:

                    async def wrap(func: typing.Callable[[], typing.Awaitable[None]]) -> None:
                        await func()
                        task_group.cancel_scope.cancel()

                    task_group.start_soon(wrap, partial(self.stream_response, send))
                    await wrap(partial(self.listen_for_disconnect, receive))

        if self.background is not None:
            await self.background()
```
> starlette > responses.py <br>
> `partial` is used to fix some of a function's arguments in advance, creating a function object with a simplified signature. It essentially creates a version of the function with certain arguments already filled in.

<br>

`StreamingResponse` assigns two tasks to a `task_group`: `self.stream_response` and `self.listen_for_disconnect`. `self.stream_response` handles chunk streaming, while `self.listen_for_disconnect` is a method that detects client disconnections. These two tasks run almost simultaneously, and if either one finishes first, it calls `task_group.cancel_scope.cancel()` within the `wrap` function to inject a `CancelledError` into the remaining task, thereby halting its progress.

In other words, if the SSE response completes normally, `self.stream_response` finishes and terminates the `self.listen_for_disconnect` task. Conversely, if a client disconnection is detected during the SSE response, the `self.listen_for_disconnect` task exits its infinite loop and completes, which then terminates the `self.stream_response` task responsible for chunk streaming.

<br>

## A Closer Look at `stream_response`
```python
    async def stream_response(self, send: Send) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": self.status_code,
                "headers": self.raw_headers,
            }
        )
        async for chunk in self.body_iterator:
            if not isinstance(chunk, (bytes, memoryview)):
                chunk = chunk.encode(self.charset)
            await send({"type": "http.response.body", "body": chunk, "more_body": True})

        await send({"type": "http.response.body", "body": b"", "more_body": False})
```
> The `stream_response` method of `StreamingResponse`

Several characteristics of chunk streaming can be observed. First, ensuring that the HTTP 200 OK status is dispatched before the chunked response begins. The `self.body_iterator` that is iterated over to provide the chunk responses is the async generator previously obtained by the router handler function calling the service layer. In other words, the async generator is called within the Starlette domain, outside the area managed by FastAPI.

<br>

# How the Server Detects and Handles Client Disconnection During SSE Response

When a client disconnection is detected, the `listen_for_disconnect` task exits its infinite loop and terminates. Subsequently, it calls `task_group.cancel_scope.cancel()`, which injects a `CancelledError` into the `stream_response` task responsible for chunk streaming, thereby halting it. This means that a `CancelledError` occurs within the async generator; therefore, by including code to catch `CancelledError`, you can detect the client disconnection and perform exception handling.

```python
class ManualFaqService:
    # ... 

    async def astream(
        self,
        request: AnswerRequestDto,
    ):
        # ... 

        try:
            async for chunk_msg in self._app.astream(
                state,
                config=config,
                stream_mode="custom",
            ):
                # ... 
        except asyncio.CancelledError as e:
            Logger.error(
                f"request_id: {request.request_id} | SSE connection cancelled\n{str(e)}",
                e,
            )
            # handle error ... 
```
> service.py

<br>

## Awaiting in Task Cancellation Situations

Suppose that if a client's connection is lost, a message queue is published containing the reason for the disconnection. In this case, you must be careful as you cannot use `await` within the `except` block.

```python
class ManualFaqService:
    # ... 

    async def astream(
        self,
        request: AnswerRequestDto,
    ):
        # ... 

        try:
            async for chunk_msg in self._app.astream(
                state,
                config=config,
                stream_mode="custom",
            ):
                # ... 
        except asyncio.CancelledError as e:

            await publisher.send(
                f"request_id: {request.request_id} | SSE connection cancelled\n{str(e)}",
                e,
            )
```
> Exception has occurred: CancelledError | Cancelled by cancel scope 1bf3a926bd0 occurs during asynchronous function calls.

Since the current Task is being cancelled, asynchronous functions (coroutines) cannot be called. Because a coroutine is dependent on a Task, there is no need to create a coroutine or wait for its completion within a Task that is already stopping. Therefore, if you wish to register a coroutine, instead of assigning it within the current Task, you must schedule it by creating a new, independent Task and placing the coroutine into the event loop.

```python
class ManualFaqService:
    # ... 

    async def astream(
        self,
        request: AnswerRequestDto,
    ):
        # ... 

        try:
            async for chunk_msg in self._app.astream(
                state,
                config=config,
                stream_mode="custom",
            ):
                # ... 
        except asyncio.CancelledError as e:

            async def publish_error(e: asyncio.CancelledError):
                await publisher.send(
                    f"request_id: {request.request_id} | SSE connection cancelled\n{str(e)}",
                    e,
                )

            asyncio.run_coroutine_threadsafe(publish_error(e), loop)
```
> Creating a new, independent Task to schedule and execute the `publish_error` coroutine in the existing event loop.
> It works correctly as intended.

<br>

# Why the Global Exception Handler Cannot Catch Exceptions Raised by an Async Generator

The router handler function is considered to have completed successfully without exception the moment it returns the `StreamingResponse` object. The FastAPI exception handler system only catches exceptions that occur during the execution of the handler itself. However, the point at which the exception occurs is outside the FastAPI management domain, specifically when Starlette calls `stream_response` to transmit messages in chunks. As previously explained, the iteration of the async generator happens after exiting the FastAPI stack; therefore, exceptions occurring within the async generator must be handled directly inside the generator rather than by the FastAPI exception handler.

<br>

> Version Info
> - python 3.11.4
> - fastapi 0.115.14
> - uvicorn 0.34.3