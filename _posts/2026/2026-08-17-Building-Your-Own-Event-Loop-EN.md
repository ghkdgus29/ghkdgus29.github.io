---
layout: post
author: Hyun 
title: Building Your Own Event Loop
date:   2026-08-17 00:00:00 +0900
excerpt: "How Python's async/await and event loops work under the hood, built from scratch"
categories:
 - Engineering
 - Python
 - Concurrency
lang: en
lang_ref: /Building-Your-Own-Event-Loop-KR/
---

# How We Handle Concurrency
There are several ways to handle concurrency. The most basic one is multithreading, which uses threads.

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


But multithreading has a few limitations. First, Python (CPython) has the GIL (Global Interpreter Lock), so even if you spawn multiple threads, only one thread can execute Python bytecode at a time.[^gil] In other words, CPU work isn't actually running in parallel — threads are closer to taking short turns running one after another.

On top of that, every thread switch triggers an OS-level context switch, and the more threads you spawn, the more that overhead adds up.
Finally, each thread carries its own stack memory, so it takes up memory just by existing.

So if a workload is mostly I/O bound, it's more efficient to skip threads altogether and handle concurrency with an asynchronous, event-loop-based approach instead.

<br>

# Building a Mini Event Loop
## An Event Loop Built on yield
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

The Scheduler is built around two queues: a ready queue holding coroutines that can run right now, and a sleeping heap holding coroutines that aren't due to wake up yet, stored as (wake time, sequence, coroutine) tuples.


`run()` is a loop that keeps cycling through these two queues. When the ready queue is empty, it pops the coroutine with the nearest deadline off the sleeping heap, blocks with `time.sleep()` until that time arrives, then moves it into the ready queue. It then pops a coroutine off the ready queue and resumes it with `send(None)`. The coroutine runs until its next await point (`switch` or `sleep`) and hands control back; once it runs to completion, a `StopIteration` is raised and it naturally falls out of the loop.

Because `countdown` and `countup` yield control every time they call `await sched.sleep()`, only one coroutine is ever actually running at any given moment — yet the two functions interleave in a way that makes the countdown and the count-up look like they're progressing at the same time. That's exactly why this looks like concurrency without ever spawning a thread: instead of the OS preemptively switching execution, each coroutine cooperatively hands back control at its own await points.

Here's a step-by-step trace of what's happening internally.

![Yield-based scheduler execution STEP 1/8](/assets/images/posts/260817-33.png)
![Yield-based scheduler execution STEP 2/8](/assets/images/posts/260817-34.png)
![Yield-based scheduler execution STEP 3/8](/assets/images/posts/260817-35.png)
![Yield-based scheduler execution STEP 4/8](/assets/images/posts/260817-36.png)
![Yield-based scheduler execution STEP 5/8](/assets/images/posts/260817-37.png)
![Yield-based scheduler execution STEP 6/8](/assets/images/posts/260817-38.png)
![Yield-based scheduler execution STEP 7/8](/assets/images/posts/260817-39.png)
![Yield-based scheduler execution STEP 8/8](/assets/images/posts/260817-40.png)

<br>

## An Event Loop That Handles I/O
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


To build an event loop that can handle I/O, we first add `_read_waiting` and `_write_waiting` dictionaries to the Scheduler. Each one stores, keyed by file descriptor, the callback to run once that descriptor becomes readable or writable.

Before `recv()`, `send()`, or `accept()` actually touch the socket, they register the current Task (`self.current`) via `read_wait`/`write_wait`, then hand control back with `switch()`.

When the ready queue is empty, `run()` calls `select()`, which blocks until either one of the registered file descriptors becomes readable/writable, or the nearest sleep deadline arrives.

Once the coroutine wakes back up, it performs the actual socket call — `sock.recv()` or `sock.accept()`. Since `select()` has already confirmed the fd is ready, this call won't block.

`Task`, meanwhile, wraps a coroutine into a single "callable scheduling unit." The `run()` loop doesn't need to care whether what it pulled off the ready queue is a coroutine or not — it just calls it, `func()`. Internally, `Task.__call__` calls `coro.send(None)` to run the coroutine up to its next `switch()` point; if the coroutine simply yielded control without blocking on sleep or I/O (meaning `sched.current` still points to itself), it's immediately re-added to the ready queue to continue on the next turn. Once the coroutine finishes, `StopIteration` is raised and the Task quietly disappears without any extra handling.

Here's a step-by-step trace of what's happening internally.

![I/O event loop execution STEP 1/16](/assets/images/posts/260817-41.png)
![I/O event loop execution STEP 2/16](/assets/images/posts/260817-42.png)
![I/O event loop execution STEP 3/16](/assets/images/posts/260817-43.png)
![I/O event loop execution STEP 4/16](/assets/images/posts/260817-44.png)
![I/O event loop execution STEP 5/16](/assets/images/posts/260817-45.png)
![I/O event loop execution STEP 6/16](/assets/images/posts/260817-46.png)
![I/O event loop execution STEP 7/16](/assets/images/posts/260817-47.png)
![I/O event loop execution STEP 8/16](/assets/images/posts/260817-48.png)
![I/O event loop execution STEP 9/16](/assets/images/posts/260817-49.png)
![I/O event loop execution STEP 10/16](/assets/images/posts/260817-50.png)
![I/O event loop execution STEP 11/16](/assets/images/posts/260817-51.png)
![I/O event loop execution STEP 12/16](/assets/images/posts/260817-52.png)
![I/O event loop execution STEP 13/16](/assets/images/posts/260817-53.png)
![I/O event loop execution STEP 14/16](/assets/images/posts/260817-54.png)
![I/O event loop execution STEP 15/16](/assets/images/posts/260817-55.png)
![I/O event loop execution STEP 16/16](/assets/images/posts/260817-56.png)

<br>

## An Event Loop That Handles Cancellation
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

The scheduler we've built so far has no way to stop a Task once it's started. Take a Task like `stalled_read`, which waits for data on a socket — if the other end never sends anything, that Task just sits in `read_wait` forever, never waking up. In practice, we need to be able to give up and cancel a Task after some time has passed. The example where `timeout_after` calls `task.cancel()` two seconds later shows exactly this situation.

To handle this, we introduce a `Future` object. A Future is a container holding the result of an operation that will finish at some point in the future: while unresolved it yields itself, `set_result()` fills it in and marks it done, and `cancel()` marks it done as cancelled without ever supplying a result. Callbacks registered through `add_done_callback()` get pushed onto the scheduler's ready queue via `sched.call_soon()` the instant the Future completes, and run on the next turn.

In this design, Task and Future have a delegation relationship rather than an inheritance one. Methods like `sleep()`, `recv()`, `send()`, and `accept()` no longer do a bare `yield` — each one now creates a fresh Future, wires the actual resume logic (`fut.set_result(None)`) to its completion callback, and hands off control with `await fut`. `Task.__call__` checks whether the result of `coro.send()`/`coro.throw()` is a Future instance; if it is, it stores that Future in `self._fut_waiter` and registers `self._wakeup` as its completion callback. In other words, a Task always holds a reference to exactly one Future: whichever one it's currently waiting on.

That structure is what makes `Task.cancel()` so simple. If the task is already waiting on a Future (`self._fut_waiter is not None`), all it has to do is call `cancel()` on that Future. Once the Future is cancelled, its registered `_wakeup` callback runs; seeing `future.cancelled()` return true, `_wakeup` calls `self(exc=CancelledError())`, throwing a `CancelledError` right at the await point where the coroutine was paused. If the task hasn't started waiting on anything yet (`_fut_waiter` is `None`), it just sets the `_must_cancel` flag, so that the next time the Task runs, a `CancelledError` gets thrown immediately.

In the example, while `stalled_read` waits forever for data that will never arrive via `sched.recv()`, `timeout_after` calls `task.cancel()` after two seconds. That cancellation propagates down into the Future created inside `recv()`, raising a `CancelledError` right at `stalled_read`'s `await sched.recv(...)` line, where it's caught by `except CancelledError` and the task exits cleanly.

Here's a step-by-step trace of what's happening internally.

![Cancellation handling execution STEP 1/8](/assets/images/posts/260817-57.png)
![Cancellation handling execution STEP 2/8](/assets/images/posts/260817-58.png)
![Cancellation handling execution STEP 3/8](/assets/images/posts/260817-59.png)
![Cancellation handling execution STEP 4/8](/assets/images/posts/260817-60.png)
![Cancellation handling execution STEP 5/8](/assets/images/posts/260817-61.png)
![Cancellation handling execution STEP 6/8](/assets/images/posts/260817-62.png)
![Cancellation handling execution STEP 7/8](/assets/images/posts/260817-63.png)
![Cancellation handling execution STEP 8/8](/assets/images/posts/260817-64.png)

<br>

# Wrapping Up the Concepts
## Coroutines vs. Tasks  
A coroutine is the object created when you call a function defined with `async def` — on its own, it's just an "executable unit" that hasn't run anything yet. Creating a coroutine object like `stalled_read(a)` doesn't execute any code by itself; someone has to drive it forward step by step by calling `send()` or `throw()` on it directly.

A Task is a wrapper that packages that coroutine into a form the scheduler can manage. It holds the coroutine, and every time it's invoked (`__call__`), it advances the coroutine one step with `coro.send()`/`coro.throw()`, checks what it's waiting on (a Future), and reschedules accordingly. The coroutine itself only knows *what* to do — it has no idea when it'll run again, or what happens if it gets cancelled. All of that scheduling state — the Future it's waiting on, whether it's been cancelled, whether it's done — is the Task's responsibility.

The same is true in `asyncio`. `asyncio.create_task()` wraps a coroutine in an `asyncio.Task` and registers it as something the event loop can schedule. A coroutine object by itself is just an object that behaves like a generator. Calling `send()` or `throw()` resumes it from wherever it paused, but it carries none of the scheduling state — whether it's in the ready queue, which Future it's waiting on, whether a cancellation has been requested. That's why a coroutine object can never register itself with an event loop or wake itself back up — every single step, something else (a Task) has to call `send(None)` or `throw(exc)` on it. Only once it becomes a Task can it run independently inside the event loop and be cancelled.

<br>

## Future
A Future is "a container that holds the result of an operation that will finish in the future." The `Future` class we built above just tracks whether it's done (`_done`), whether it's been cancelled (`_cancelled`), and what to run once it's done (`_callbacks`) — it never performs any computation on its own. Something outside it always fills in the actual result: `sleep()` calls `set_result()` when its timer expires, `recv()` calls it once the socket becomes readable.

A Task registering itself via `add_done_callback(self._wakeup)` on the Future its coroutine `yield`ed is essentially a reservation: "wake me up once the result is ready." A Future is the connective tissue between a Task and whatever eventually fills it in — a timer, a select() callback, or anything else. From the Task's perspective, it doesn't matter whether it's a sleep or a socket read; both look the same: "wait for one Future to complete."

<br>

## Why CPU-Bound Work Blocks the Event Loop
The event loop we've built is, at bottom, a single `while` loop running on one thread. Because `run()` pulls callbacks off the ready queue one at a time and calls them in order, no other Task can ever interrupt while one callback (or Task) is running.

I/O work fits this design well. `recv()` and `sleep()` hand control back to the scheduler the moment they `await`, so even with hundreds of Tasks waiting on I/O at once, the event loop can keep cycling through the rest of them.

CPU-bound code, on the other hand, runs straight through to the end with no await points along the way. While it's running, there's no way to hand control back to the scheduler, so no matter how many other Tasks are waiting on socket data, the whole loop stalls until that computation finishes. Concurrency in an event loop ultimately comes down to how often each Task voluntarily yields control, and CPU-bound code is a problem precisely because it never has a point where it can yield.

The way around this is to move CPU-bound work outside the event loop entirely. `asyncio`'s `loop.run_in_executor()` hands heavy computation off to a separate thread pool or process pool, and reports the result back to the event loop through a Future once it's ready. It's the exact same kind of Future we used in `recv()` and `sleep()` — just as a callback calls `set_result()` when a socket becomes readable, a background thread finishing its work triggers that same `set_result()` call. So from the event loop's point of view, "waiting for socket data" and "waiting for a heavy computation to finish" look identical — both are just waiting for one Future to complete, and the event loop is free to run other Tasks the whole time. In the end, the problem of CPU-bound work blocking the event loop gets solved simply by not doing that computation inside the event loop at all.

<br>

# References
- [Build Your Own Async](https://www.youtube.com/watch?v=Y4Gt3Xjd7G8)

[^gil]: [Python Glossary - Global Interpreter Lock](https://docs.python.org/3/glossary.html#term-global-interpreter-lock)
