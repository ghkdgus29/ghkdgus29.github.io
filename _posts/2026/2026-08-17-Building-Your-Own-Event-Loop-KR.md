---
layout: post
author: Hyun 
title: 미니 이벤트 루프 scratch
date:   2026-08-17 00:00:00 +0900
excerpt: "Python 동시성 처리 방식과 미니 이벤트 루프 구현"
categories:
 - Engineering
 - Python
 - Concurrency
lang: kr
lang_ref: /Building-Your-Own-Event-Loop-EN/
---

# 동시성 처리 방식
동시성을 처리하는 방법에는 여러 가지가 있다. 그 중 가장 기본적인 방법은 스레드를 사용하는 멀티 스레딩이다.

```python
import time


def countdown(n):
    while n > 0:
        print("Down", n)
        time.sleep(1)
        n -= 1


def countup(stop):
    x = 0
    while x < stop:
        print("Up", x)
        time.sleep(1)
        x += 1


import threading

threading.Thread(target=countdown, args=(5,)).start()
threading.Thread(target=countup, args=(5,)).start()
```


하지만 멀티 스레딩에는 몇 가지 한계가 있다. 먼저 Python(CPython)에는 GIL(Global Interpreter Lock)이 있어서, 스레드를 여러 개 만들어도 한 번에 하나의 스레드만 Python 바이트코드를 실행할 수 있다.[^gil] 즉 CPU 연산 자체가 진짜 병렬로 실행되는 것이 아니라, 스레드끼리 짧은 시간 단위로 번갈아가며 실행되는 것에 가깝다.

또한 스레드를 전환할 때마다 운영체제 수준의 context switching이 발생하며, 스레드 개수가 늘어날수록 context switching의 오버헤드도 함께 커진다.
마지막으로 스레드는 각자 자신만의 스택 메모리를 가지기 때문에 메모리를 차지한다. 

따라서 I/O bound job이 많다면, 굳이 스레드를 사용하지 않고 이벤트 루프를 이용한 비동기 방식으로 동시성을 처리하는 것이 더 효율적이다.

<br>

# 미니 이벤트 루프 구현하기
## yield를 이용한 이벤트루프
```python
import heapq
import time
from collections import deque


class Awaitable:
    def __await__(self):
        yield


def switch():
    return Awaitable()


class Scheduler:
    def __init__(self):
        self.ready = deque()
        self.sleeping = []
        self.current = None  # Currently executing generator
        self.sequence = 0

    async def sleep(self, delay):
        deadline = time.time() + delay
        self.sequence += 1
        heapq.heappush(self.sleeping, (deadline, self.sequence, self.current))
        self.current = None  # "Disappear"
        await switch()  # Switch tasks

    def new_task(self, coro):
        self.ready.append(coro)

    def run(self):
        while self.ready or self.sleeping:
            if not self.ready:
                deadline, _, coro = heapq.heappop(self.sleeping)
                delta = deadline - time.time()
                if delta > 0:
                    time.sleep(delta)
                self.ready.append(coro)

            self.current = self.ready.popleft()
            try:
                self.current.send(None)  # Send to a coroutine
                if self.current:
                    self.ready.append(self.current)
            except StopIteration:
                pass


sched = Scheduler()  

# ---- Example code

async def countdown(n):
    while n > 0:
        print("Down", n)
        await sched.sleep(4)
        n -= 1


async def countup(stop):
    x = 0
    while x < stop:
        print("Up", x)
        await sched.sleep(1)
        x += 1


sched.new_task(countdown(5))
sched.new_task(countup(20))
sched.run()
```

Scheduler는 크게 두 개의 큐를 가진다. 지금 바로 실행 가능한 코루틴을 담아두는 ready 큐와, 아직 깨어날 시간이 되지 않은 코루틴을 (깨어날 시각, 시퀸스, 코루틴) 튜플로 저장해두는 sleeping 힙이다.


`run()`은 이 두 큐를 계속 순회하는 루프다. ready 큐가 비어 있으면 sleeping 힙에서 가장 먼저 깨어나야 할 코루틴을 꺼내 그 시각까지 `time.sleep()`으로 기다린 뒤 ready 큐로 옮긴다. 그다음 ready 큐에서 코루틴을 하나 꺼내 `send(None)`으로 실행을 재개시킨다. 코루틴은 다음 await 지점(`switch` 또는 `sleep`)까지 실행되다 다시 제어권을 돌려주고, 끝까지 실행되면 `StopIteration`이 발생해 루프에서 자연스럽게 빠진다.

`countdown`과 `countup`은 `await sched.sleep()`을 호출할 때마다 실행을 양보하기 때문에, 실제로는 한 순간에 하나의 코루틴만 실행되고 있음에도 두 함수가 번갈아 실행되면서 마치 카운트다운과 카운트업이 동시에 진행되는 것처럼 보인다. 스레드를 하나도 만들지 않았는데 동시성처럼 보이는 이유가 바로 이것이다. OS가 강제로 실행을 전환하는 preemptive 방식이 아니라, 코루틴 스스로가 await 지점에서 제어권을 넘겨주는 cooperative 방식으로 동시성을 흉내 낸 것이다.

아래는 내부 동작을 그림으로 표현하였다.

![yield 기반 스케줄러 실행 STEP 1/8](/assets/images/posts/260817.png)
![yield 기반 스케줄러 실행 STEP 2/8](/assets/images/posts/260817-2.png)
![yield 기반 스케줄러 실행 STEP 3/8](/assets/images/posts/260817-3.png)
![yield 기반 스케줄러 실행 STEP 4/8](/assets/images/posts/260817-4.png)
![yield 기반 스케줄러 실행 STEP 5/8](/assets/images/posts/260817-5.png)
![yield 기반 스케줄러 실행 STEP 6/8](/assets/images/posts/260817-6.png)
![yield 기반 스케줄러 실행 STEP 7/8](/assets/images/posts/260817-7.png)
![yield 기반 스케줄러 실행 STEP 8/8](/assets/images/posts/260817-8.png)

<br>

## i/o를 처리하는 이벤트루프
```python
import heapq
import time
from collections import deque
from select import select


class Scheduler:
    def __init__(self):
        self.ready = deque()  # Functions ready to execute
        self.sleeping = []  # Sleeping functions
        self.sequence = 0
        self._read_waiting = {}
        self._write_waiting = {}

    def call_soon(self, func):
        self.ready.append(func)

    def call_later(self, delay, func):
        self.sequence += 1
        deadline = time.time() + delay  # Expiration time
        heapq.heappush(self.sleeping, (deadline, self.sequence, func))

    def read_wait(self, fileno, func):
        # Trigger func() when fileno is readable
        self._read_waiting[fileno] = func

    def write_wait(self, fileno, func):
        # Trigger func() when fileno is writeable
        self._write_waiting[fileno] = func

    def run(self):
        while self.ready or self.sleeping or self._read_waiting or self._write_waiting:
            if not self.ready:
                # Only block in select() when there's nothing else to run;
                # timeout caps the wait so the nearest sleeping task still wakes on time
                if self.sleeping:
                    deadline, _, func = self.sleeping[0]
                    timeout = deadline - time.time()
                    timeout = max(timeout, 0)
                else:
                    timeout = None  # Wait forever

                # Wait for I/O (and sleep)
                can_read, can_write, _ = select(
                    self._read_waiting, self._write_waiting, [], timeout
                )

                for fd in can_read:
                    self.ready.append(self._read_waiting.pop(fd))
                for fd in can_write:
                    self.ready.append(self._write_waiting.pop(fd))

                # Check for sleeping tasks
                now = time.time()
                while self.sleeping:
                    if now > self.sleeping[0][0]:
                        self.ready.append(heapq.heappop(self.sleeping)[2])
                    else:
                        break

            while self.ready:
                func = self.ready.popleft()
                func()

    def new_task(self, coro):
        self.ready.append(Task(coro))  # Wrapped coroutine

    async def sleep(self, delay):
        self.call_later(delay, self.current)
        self.current = None  
        await switch()  # Switch to a new task

    async def recv(self, sock, maxbytes):
        self.read_wait(sock, self.current)
        self.current = None  # blocked on I/O, not requeued until socket is readable
        await switch()
        return sock.recv(maxbytes)

    async def send(self, sock, data):
        self.write_wait(sock, self.current)
        self.current = None  # blocked on I/O, not requeued until socket is writeable
        await switch()
        return sock.send(data)

    async def accept(self, sock):
        self.read_wait(sock, self.current)
        self.current = None  # blocked on I/O, not requeued until a connection arrives
        await switch()
        return sock.accept()


class Task:
    def __init__(self, coro):
        self.coro = coro  # "Wrapped coroutine"

    # Make it look like a callback
    def __call__(self):
        try:
            sched.current = self
            self.coro.send(None)  # run until the next `await switch()`
            if sched.current: 
                # still set to self => coroutine yielded without blocking on I/O/sleep,
                # so just reschedule it to run again next turn
                sched.ready.append(self)
        except StopIteration:
            pass


class Awaitable:
    def __await__(self):
        yield  # bare yield: hands control back to Task.__call__ without a value


def switch():
    return Awaitable()


sched = Scheduler()  

# ----------------

from socket import *


async def tcp_server(addr):
    sock = socket(AF_INET, SOCK_STREAM)
    sock.bind(addr)
    sock.listen(1)
    while True:
        client, addr = await sched.accept(sock)
        print("Connection from", addr)
        sched.new_task(echo_handler(client))


async def echo_handler(sock):
    while True:
        data = await sched.recv(sock, 10000)
        if not data:
            break
        await sched.send(sock, b"Got:" + data)
    print("Connection closed")
    sock.close()


sched.new_task(tcp_server(("", 30000)))
sched.run()
```


I/O 작업을 처리하는 이벤트 루프를 구현하기 위해선 먼저 Scheduler에 `_read_waiting`, `_write_waiting` 딕셔너리를 추가한다. 각각 이 파일 디스크립터가 읽기 또는 쓰기가 가능해지면 실행할 콜백을 파일 디스크립터를 key로 하여 저장한다. 

`recv()`, `send()`, `accept()` 같은 메서드는 실제로 소켓을 읽거나 쓰기 전에 먼저 `read_wait`/`write_wait`으로 현재 Task(`self.current`)를 등록해두고 `switch()`로 제어권을 넘긴다.

`run()` 루프는 ready 큐가 비었을 때 `select()`를 호출해서, 등록된 fd 중 하나라도 읽기 또는 쓰기가 가능해지거나 가장 가까운 sleep wakeup 시각이 될 때까지 블로킹한다.

이렇게 다시 깨어난 코루틴이 재개되면, `sock.recv()`나 `sock.accept()` 같은 실제 소켓 호출을 수행한다. `select()`가 이미 해당 fd가 준비됐음을 확인해줬기 때문에 이 호출은 블로킹되지 않는다.

한편 `Task`는 코루틴을 감싸서 "호출 가능한 하나의 스케줄링 단위"로 만드는 역할을 한다. `run()` 루프는 ready 큐에서 꺼낸 대상이 코루틴인지 아닌지 신경 쓸 필요 없이 그냥 `func()`처럼 호출하기만 하면 된다. `Task.__call__`은 내부적으로 `coro.send(None)`을 호출해 코루틴을 다음 `switch()` 지점까지 실행시키고, 코루틴이 sleep이나 I/O 대기 없이 그냥 제어권만 양보했다면(즉 `sched.current`가 여전히 자기 자신을 가리키고 있다면) 곧바로 ready 큐에 다시 등록해 다음 턴에 이어 실행되게 한다. 코루틴이 끝까지 실행되면 `StopIteration`이 발생하고, Task는 별다른 처리 없이 조용히 사라진다.

아래는 내부 동작을 그림으로 표현하였다.

![I/O 이벤트 루프 실행 STEP 1/16](/assets/images/posts/260817-9.png)
![I/O 이벤트 루프 실행 STEP 2/16](/assets/images/posts/260817-10.png)
![I/O 이벤트 루프 실행 STEP 3/16](/assets/images/posts/260817-11.png)
![I/O 이벤트 루프 실행 STEP 4/16](/assets/images/posts/260817-12.png)
![I/O 이벤트 루프 실행 STEP 5/16](/assets/images/posts/260817-13.png)
![I/O 이벤트 루프 실행 STEP 6/16](/assets/images/posts/260817-14.png)
![I/O 이벤트 루프 실행 STEP 7/16](/assets/images/posts/260817-15.png)
![I/O 이벤트 루프 실행 STEP 8/16](/assets/images/posts/260817-16.png)
![I/O 이벤트 루프 실행 STEP 9/16](/assets/images/posts/260817-17.png)
![I/O 이벤트 루프 실행 STEP 10/16](/assets/images/posts/260817-18.png)
![I/O 이벤트 루프 실행 STEP 11/16](/assets/images/posts/260817-19.png)
![I/O 이벤트 루프 실행 STEP 12/16](/assets/images/posts/260817-20.png)
![I/O 이벤트 루프 실행 STEP 13/16](/assets/images/posts/260817-21.png)
![I/O 이벤트 루프 실행 STEP 14/16](/assets/images/posts/260817-22.png)
![I/O 이벤트 루프 실행 STEP 15/16](/assets/images/posts/260817-23.png)
![I/O 이벤트 루프 실행 STEP 16/16](/assets/images/posts/260817-24.png)

<br>

## cancel을 처리하는 이벤트루프
```python
import heapq
import socket
import time
from collections import deque
from select import select


class CancelledError(Exception):
    pass


class Future:
    """A box for a value that becomes available later."""

    def __init__(self):
        self._done = False
        self._cancelled = False
        self._result = None
        self._callbacks = []

    def done(self):
        return self._done

    def cancelled(self):
        return self._cancelled

    def set_result(self, result):
        if self._done:
            return  # already resolved (e.g. cancelled first) -- ignore, like
            # asyncio's _set_result_unless_cancelled
        self._result = result
        self._done = True
        self._run_callbacks()

    def cancel(self):
        if self._done:
            return False
        self._cancelled = True
        self._done = True
        self._run_callbacks()
        return True

    def add_done_callback(self, cb):
        if self._done:
            sched.call_soon(lambda: cb(self))
        else:
            self._callbacks.append(cb)

    def _run_callbacks(self):
        callbacks, self._callbacks = self._callbacks, []
        for cb in callbacks:
            sched.call_soon(lambda cb=cb: cb(self))

    def result(self):
        if self._cancelled:
            raise CancelledError()
        return self._result

    def __await__(self):
        if not self._done:
            yield self  # hand the Future itself back to Task.__call__
        return self.result()


class Scheduler:
    def __init__(self):
        self.ready = deque()  # Functions ready to execute
        self.sleeping = []  # (deadline, seq, callback)
        self.sequence = 0
        self._read_waiting = {}  # fileno -> callback
        self._write_waiting = {}  # fileno -> callback

    def call_soon(self, func):
        self.ready.append(func)

    def call_later(self, delay, func):
        self.sequence += 1
        deadline = time.time() + delay
        heapq.heappush(self.sleeping, (deadline, self.sequence, func))

    def read_wait(self, fileno, func):
        self._read_waiting[fileno] = func

    def write_wait(self, fileno, func):
        self._write_waiting[fileno] = func

    def run(self):
        while self.ready or self.sleeping or self._read_waiting or self._write_waiting:
            if not self.ready:
                if self.sleeping:
                    deadline, _, _ = self.sleeping[0]
                    timeout = max(deadline - time.time(), 0)
                else:
                    timeout = None  # wait forever

                can_read, can_write, _ = select(
                    self._read_waiting, self._write_waiting, [], timeout
                )

                for fd in can_read:
                    self._read_waiting.pop(fd)()
                for fd in can_write:
                    self._write_waiting.pop(fd)()

                now = time.time()
                while self.sleeping:
                    if now > self.sleeping[0][0]:
                        heapq.heappop(self.sleeping)[2]()
                    else:
                        break

            while self.ready:
                func = self.ready.popleft()
                func()

    def new_task(self, coro):
        task = Task(coro)
        self.ready.append(task)
        return task  # handle for cancel()

    async def sleep(self, delay):
        fut = Future()
        self.call_later(delay, lambda: fut.set_result(None))
        await fut

    async def recv(self, sock, maxbytes):
        fut = Future()
        self.read_wait(sock, lambda: fut.set_result(None))
        # if cancelled before the socket ever became readable, drop the
        # stale registration so select() stops watching it
        fut.add_done_callback(lambda f: self._read_waiting.pop(sock, None))
        await fut
        return sock.recv(maxbytes)

    async def send(self, sock, data):
        fut = Future()
        self.write_wait(sock, lambda: fut.set_result(None))
        fut.add_done_callback(lambda f: self._write_waiting.pop(sock, None))
        await fut
        return sock.send(data)

    async def accept(self, sock):
        fut = Future()
        self.read_wait(sock, lambda: fut.set_result(None))
        fut.add_done_callback(lambda f: self._read_waiting.pop(sock, None))
        await fut
        return sock.accept()


class Task:
    def __init__(self, coro):
        self.coro = coro
        self.done = False
        self._fut_waiter = None  # the one Future this task is blocked on
        self._must_cancel = False

    def __call__(self, exc=None):
        self._fut_waiter = None
        try:
            if self._must_cancel and exc is None:
                exc = CancelledError()
                self._must_cancel = False
            if exc is not None:
                result = self.coro.throw(exc)
            else:
                result = self.coro.send(None)
        except StopIteration, CancelledError:
            self.done = True
            return

        if isinstance(result, Future):
            self._fut_waiter = result
            result.add_done_callback(self._wakeup)
        else:
            # bare yield (shouldn't really happen anymore, everything awaits
            # a Future now) -- just run again next turn
            sched.ready.append(self)

    def _wakeup(self, future):
        if future.cancelled():
            self(exc=CancelledError())
        else:
            self()

    def cancel(self):
        if self.done:
            return False  # already finished, nothing to cancel
        if self._fut_waiter is not None:
            # <-- the whole point: one line, no waiting_kind dispatch
            return self._fut_waiter.cancel()  # blocked on a Future: cancel that
        self._must_cancel = True  # not waiting on anything yet: flag for next __call__
        if self not in sched.ready:
            sched.ready.append(self)
        return True


sched = Scheduler()


async def stalled_read(sock):
    print("[reader] waiting for data that will never arrive")
    try:
        await sched.recv(sock, 1024)
        print("[reader] got data (unexpected)")
    except CancelledError:
        print("[reader] cancelled, giving up on the read")


async def timeout_after(task, seconds):
    await sched.sleep(seconds)
    print(f"[timeout] {seconds}s elapsed, cancelling read")
    task.cancel()


_keepalive = []  # prevents `b` below from being GC'd (and closed) while unused


async def demo_cancel_io():
    a, b = socket.socketpair()  
    _keepalive.append(b)
    reader = sched.new_task(stalled_read(a))
    sched.new_task(timeout_after(reader, seconds=2))


async def main():
    await demo_cancel_io()


if __name__ == "__main__":
    sched.new_task(main())
    sched.run()

```

지금까지 만든 스케줄러는 한 번 시작된 Task를 중간에 멈출 방법이 없다. 예를 들어 `stalled_read`처럼 소켓에서 데이터가 오길 기다리는 Task가 있는데 상대방이 끝내 데이터를 보내지 않는다면, 이 Task는 영원히 깨어나지 못한 채 `read_wait`에 남아 있게 된다. 실제로는 이런 상황에서 일정 시간이 지나면 대기를 포기하고 Task를 취소할 수 있어야 한다. `timeout_after`가 2초 뒤 `task.cancel()`을 호출하는 예제가 바로 이 상황을 보여준다.

이를 위해 Future라는 객체를 도입했다. Future는 미래에 완료될 연산 결과를 담는 컨테이너 객체로, 아직 값이 준비되지 않았으면 대기 상태로 자기 자신을 yield하고, `set_result()`가 호출되면 값이 채워지며 완료 상태가 되며, `cancel()`을 호출하면 값이 채워지지 않은 채로 취소 상태가 된다. `add_done_callback()`으로 등록해둔 콜백들은 Future가 완료되는 순간 `sched.call_soon()`을 통해 스케줄러의 ready 큐에 등록되어 다음 턴에 실행된다. 

이 구조에서 Task와 Future는 위임 관계이다. `sleep()`, `recv()`, `send()`, `accept()` 같은 메서드들은 이제 bare `yield` 대신 매번 새로운 Future를 만들고, 그 완료 콜백에 실제 재개 로직(`fut.set_result(None)`)을 연결해둔 뒤 `await fut`으로 제어권을 넘긴다. `Task.__call__`은 `coro.send()`/`coro.throw()`의 결과가 Future 인스턴스이면 그 Future를 `self._fut_waiter`에 저장해두고 `self._wakeup`을 완료 콜백으로 등록한다. 즉 Task는 항상 "지금 내가 기다리고 있는 단 하나의 Future"에 대한 참조를 갖는다.

`Task.cancel()`이 하는 일은 이 구조 덕분에 단순해진다. 이미 어떤 Future를 기다리고 있는 상태라면(`self._fut_waiter is not None`) 그 Future의 `cancel()`을 그대로 호출하면 된다. Future가 취소되면 등록해둔 `_wakeup` 콜백이 실행되고, `_wakeup`은 `future.cancelled()`가 참임을 보고 `self(exc=CancelledError())`를 호출해 코루틴이 멈춰 있던 바로 그 await 지점에 `CancelledError`를 `throw()`한다. 아직 아무 Future도 기다리기 전이라면(`_fut_waiter`가 `None`) `_must_cancel` 플래그만 세워두고, Task가 다음번에 실행될 때 그 자리에서 바로 `CancelledError`가 던져지도록 한다.

예제에서는 `stalled_read`가 `sched.recv()`로 영원히 오지 않을 데이터를 기다리는 동안 `timeout_after`가 2초 뒤 `task.cancel()`을 호출한다. 이 취소는 `recv()` 내부에서 만든 Future까지 전파되어 `stalled_read`의 `await sched.recv(...)` 지점에서 `CancelledError`가 발생하고, `except CancelledError`로 잡혀 깔끔하게 종료된다.

아래는 내부 동작을 그림으로 표현하였다.

![cancel 처리 실행 STEP 1/8](/assets/images/posts/260817-25.png)
![cancel 처리 실행 STEP 2/8](/assets/images/posts/260817-26.png)
![cancel 처리 실행 STEP 3/8](/assets/images/posts/260817-27.png)
![cancel 처리 실행 STEP 4/8](/assets/images/posts/260817-28.png)
![cancel 처리 실행 STEP 5/8](/assets/images/posts/260817-29.png)
![cancel 처리 실행 STEP 6/8](/assets/images/posts/260817-30.png)
![cancel 처리 실행 STEP 7/8](/assets/images/posts/260817-31.png)
![cancel 처리 실행 STEP 8/8](/assets/images/posts/260817-32.png)

<br>

# 이벤트루프 개념 정리
## 코루틴과 Task  
코루틴은 `async def`로 정의된 함수를 호출했을 때 만들어지는 객체로, 그 자체로는 아직 아무것도 실행되지 않은 "실행 가능한 단위"에 불과하다. `stalled_read(a)`처럼 코루틴 객체를 만드는 것만으로는 코드가 동작하지 않고, 누군가 `send()`나 `throw()`로 직접 구동해줘야 한 스텝씩 실행된다.

Task는 이 코루틴을 스케줄러가 관리할 수 있는 형태로 감싼 wrapper다. 코루틴을 들고 있다가 자신이 호출될 때마다(`__call__`) `coro.send()`/`coro.throw()`로 한 스텝 진행시키고, 코루틴이 무엇을 기다리는지(Future)를 확인해 다시 스케줄링한다. 코루틴 자체는 "무엇을 할지"만 알고 있을 뿐, 언제 다시 실행될지 취소되면 어떻게 되는지는 전혀 모른다. 대기 중인 Future나 취소 여부, 완료 여부 같은 스케줄링 상태를 관리하는 책임은 전부 Task 쪽에 있다.

`asyncio`에서도 마찬가지다. `asyncio.create_task()`는 코루틴을 `asyncio.Task`로 감싸 이벤트 루프의 스케줄링 대상으로 등록하는 함수다. 코루틴 객체 자체는 제너레이터와 같은 방식으로 동작하는 객체일 뿐이다. `send()`나 `throw()`를 호출하면 멈춰있던 지점부터 다시 실행되긴 하지만, 지금 ready 큐에 들어있는지, 어떤 Future를 기다리고 있는지, 취소 요청이 들어왔는지 같은 스케줄링 상태는 전혀 갖고 있지 않다. 그래서 코루틴 객체 혼자서는 이벤트 루프에 등록될 수도, 스스로 다시 깨어날 수도 없다. 매번 Task가 `send(None)`이나 `throw(exc)`를 호출해줘야 한 스텝씩 진행된다. 즉, Task가 되어야 비로소 이벤트 루프 안에서 독립적으로 실행되고 취소도 가능해진다.

<br>

## Future
Future는 "미래에 완료될 연산 작업의 결과를 담아두는 컨테이너"이다. 위에서 구현한 `Future` 클래스는 값이 채워졌는지(`_done`), 취소됐는지(`_cancelled`), 값이 채워지면 무엇을 실행할지(`_callbacks`)를 들고 있을 뿐 그 자체로는 아무 계산도 하지 않는다. 실제 결과를 채워 넣는 주체는 항상 외부에 있다. `sleep()`에서는 타이머가 만료됐을 때, `recv()`에서는 소켓이 읽기 가능해졌을 때 각각 `set_result()`를 호출해 값을 채워 넣는다.

Task가 코루틴이 `yield`한 Future를 받아 `add_done_callback(self._wakeup)`으로 자기 자신을 등록해두는 것이 바로 "결과가 준비되면 나를 깨워달라"는 예약이다. Future는 Task와, 그 Future를 채우는 콜백 사이를 이어주는 연결 고리인 셈이다. Task 입장에서는 그게 sleep이든 소켓 읽기든 신경 쓸 필요 없이 "Future 하나가 완료될 때까지 기다린다"는 동일한 인터페이스로 다룰 수 있다는 게 핵심이다.

<br>

## CPU bound 작업이 이벤트 루프를 왜 블록하는지 설명
지금까지 만든 이벤트 루프는 결국 하나의 스레드에서 도는 `while` 루프 하나다. `run()`이 ready 큐에서 콜백을 하나씩 꺼내 순서대로 호출하는 구조이기 때문에, 어떤 콜백(또는 Task)이 실행되는 동안에는 다른 Task가 절대 끼어들 수 없다.

I/O 작업은 이 구조와 잘 맞는다. `recv()`나 `sleep()`은 `await`하는 즉시 제어권을 스케줄러에 돌려주기에, 수백 개의 Task가 동시에 I/O를 기다리고 있어도 이벤트 루프는 계속 다른 Task를 돌릴 수 있다.

반면 CPU bound 작업 코드는 await 지점 없이 한 번에 끝까지 실행된다. 이 코드가 실행되는 동안에는 제어권을 스케줄러에 돌려줄 방법이 없으므로, 다른 Task들이 아무리 소켓 데이터를 기다리고 있어도 그 계산이 끝날 때까지 루프 전체가 멈춘다. 이벤트 루프의 동시성은 결국 "각 Task가 스스로 얼마나 자주 제어권을 양보하는가"에 달려 있는데, CPU bound 코드는 양보할 지점이 없기 때문에 문제가 된다. 


이 문제를 피하는 방법은 CPU bound 작업을 이벤트 루프 바깥으로 빼내는 것이다. `asyncio`의 `loop.run_in_executor()`는 무거운 연산을 별도의 스레드 풀이나 프로세스 풀로 넘기고, 결과가 준비되면 Future를 통해 이벤트 루프에 알려주는 방식으로 동작한다. 이를 통해 이벤트 루프는 블록되지 않고, CPU bound 작업을 I/O bound 작업과 동일하게 처리한다.  
<br>

# 출처
- [Build Your Own Async](https://www.youtube.com/watch?v=Y4Gt3Xjd7G8)

[^gil]: [Python Glossary - Global Interpreter Lock](https://docs.python.org/3/glossary.html#term-global-interpreter-lock)
