---
layout: post
author: Hyun 
title: 왜 SSE 에러는 FastAPI Global Exception Handler에서 잡히지 않을까
date:   2026-03-02 21:06:00 +0900
excerpt: "왜 SSE 에러는 FastAPI Global Exception Handler에서 잡히지 않을까"
categories:
 - Engineering
 - FastAPI
 - Python
lang: kr
lang_ref: /Why-SSE-Errors-Are-Not-Caught-by-the-Global-Exception-Handler-EN/
---

# 문제 상황
클라이언트는 서버와의 SSE 커넥션이 너무 오래 유지되면, 응답이 완료되지 않았더라도 커넥션을 강제로 끊도록 개발되어 있다. 
서버 측에서 SSE 커넥션이 끊어졌을 경우, 서비스 레이어에서 `CancelledError` 예외가 발생하게 된다. 
해당 예외가 왜 서비스 레이어에서 발생하는지, FastAPI의 Global Exception Handler에서는 왜 잡히지 않는 건지에 대한 궁금증이 생겨, 내부 로직을 디버깅하여 나름대로의 이유와 예외 처리 방향을 정리하였다.

<br>

# SSE 응답 flow

## routing.py의 `request_response` 함수에서 라우터 핸들러 함수 호출
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
> Starlette은 ASGI(Asynchronous Server Gateway Interface) 프레임워크로, 파이썬 기반의 비동기 웹 서버를 구축하는 데 주로 사용된다. 

`request_response` 함수는, request를 받고 FastAPI에 등록된 라우터 핸들러 함수를 호출하여 `response` 반환값을 얻는다. 
클라이언트 request가 들어오면 가장 먼저 해당 함수를 호출한다.
여기서 `f`가 바로 개발자가 작성하고 등록한 라우터 핸들러 함수이다. `f`를 호출한 후에 아래 단계로 넘어간다.

<br>

## 라우터 핸들러 함수가 `StreamingResponse` 반환 
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

개발자가 만든 라우터 핸들러 함수는 `service.astream`을 호출하여 async generator를 얻는다. 라우터 핸들러 함수는 async generator 객체를 생성 인자로 넣어 `StreamingResponse` 객체를 생성한 후 반환한다. 

<br>

## routing.py의 `request_response` 함수에서 `StreamingResponse.__call__` 호출
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

라우터 핸들러 함수로부터 받은 `StreamingResponse` 객체를 호출하여, SSE 응답을 시작한다. 

<br>


## `StreamingResponse.__call__` 내부 동작
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
> partial은 함수의 인자 일부를 미리 고정하여, 더 단순화된 시그니처를 가진 함수 객체를 생성하는 데 사용한다. 일종의 인자가 미리 채워진 버전의 함수를 만드는 것이다. 

<br>

`StreamingResponse`는 task_group에 `self.stream_response`와 `self.listen_for_disconnect` 두 Task를 할당한다. `self.stream_response`는 chunk streaming을, `self.listen_for_disconnect`는 클라이언트의 연결 끊김을 감지하는 메서드이다. 두 Task는 거의 동시에 실행되며 둘 중 하나의 Task가 먼저 끝나게 되면 `wrap` function의 `task_group.cancel_scope.cancel()`을 호출하여 나머지 Task에 `CancelledError`를 주입함으로써, 작업 진행을 중지한다. <br>
즉, SSE 응답을 정상적으로 완료하는 경우 `self.stream_response` 가 완료되어 클라이언트 연결 끊김을 감지하는 `self.listen_for_disconnect` Task를 종료시킨다. 
반대로, SSE 응답 도중 클라이언트의 연결 끊김을 감지하면 `self.listen_for_disconnect` Task는 무한 루프를 탈출 후 작업을 완료하여, chunk streaming을 진행하는 `self.stream_response` Task를 종료시킨다. <br>


<br>

## stream_response 더 살펴보기 
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
> `StreamingResponse`의 `stream_response` 메서드

chunk streaming의 몇 가지 특징을 살펴볼 수 있다. 우선, http 200 OK 응답 헤더를 먼저 보내고 chunk streaming을 시작함을 확인할 수 있다. <br>
chunk 응답을 내려주기 위해 순회하는 `self.body_iterator`는 앞서 라우터 핸들러 함수가 서비스 레이어를 호출하여 얻어낸 async generator이다. 즉, async generator는 FastAPI가 관리하는 영역을 벗어나 Starlette의 영역에서 호출된다. 

<br>

# SSE 응답 도중, 클라이언트의 연결이 끊어진 경우, 서버가 이를 감지하고 처리하는 방법 
클라이언트의 연결이 끊어짐을 감지하면, `listen_for_disconnect` Task가 무한 루프를 탈출하고, 작업을 종료한다. 이후 `task_group.cancel_scope.cancel()`을 호출, chunk streaming 중인 `stream_response` Task에 `CancelledError`를 주입함으로써 해당 Task를 중지시킨다. 이는 다시 말해, async generator 내에서 `CancelledError`가 발생함을 의미하기에 `CancelledError`를 잡는 코드를 넣음으로써 클라이언트 연결이 끊김을 감지하고, 예외 처리를 할 수 있다. 

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

## Task cancel 상황에서 await 
만약 클라이언트의 연결이 끊어진 경우, 그 이유를 담은 메세지 큐를 발행한다고 가정하자. 
이때 except block에서 await를 사용할 수 없음을 주의해야 한다. 

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
> 비동기 함수 호출 시, Exception has occurred: CancelledError | Cancelled by cancel scope 1bf3a926bd0 발생

현재 Task가 취소 중이기 때문에, 비동기 함수(coroutine)를 호출할 수 없다. coroutine은 Task에 종속적이기에, 중지되는 Task에서 coroutine을 생성할 필요도, 완료를 기다릴 필요도 없기 때문이다. 따라서 coroutine을 등록하고 싶다면 현재 Task에서 할당하는 대신, 이벤트 루프에 coroutine을 넣은 독립적인 새 Task를 생성하여 스케줄링해야 한다. 

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
> 기존 이벤트 루프에 `publish_error` coroutine을 실행할 독립적인 새 Task를 생성하여 스케줄링 <br>
> 의도대로 정상 동작한다.

<br>

# async generator가 raise한 예외를 global exception handler에서 못잡는 이유 
라우터 핸들러 함수는 `StreamingResponse` 객체를 반환한 시점에, 예외없이 성공적으로 끝났다고 할 수 있다. FastAPI exception handler 시스템은 핸들러 실행 중 발생한 예외만 잡는다. 하지만 예외가 발생하는 시점은 FastAPI 관리 영역을 벗어나, Starlette이 `stream_response`를 호출하여 chunk 단위로 메시지를 전송하는 시점이다. 앞서 설명했듯이, async generator를 순회하는 시점은 FastAPI 스택을 벗어난 시점이고, 그렇기에 async generator에서 발생한 예외는 FastAPI exception handler가 아닌 async generator 내부에서 직접 처리해야 한다.

<br>

> 버전정보
> - python 3.11.4
> - fastapi 0.115.14
> - uvicorn 0.34.3