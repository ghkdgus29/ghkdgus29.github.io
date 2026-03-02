---
layout: post
author: Hyun 
title: Building a PG Vector Client from Scratch 
date:   2025-09-15 21:12:00 +0000
excerpt: "This post introduces a custom PGVector client designed to store and query vector data in an RDB-friendly way—unlike LangChain’s default client, which uses a NoSQL-like schema."
categories:
 - Engineering
 - VectorDB
 - Python
 - AI
lang: en
lang_ref: /Building-a-PG-Vector-Client-from-Scratch-KR/
---


# Building a PG Vector Client from Scratch 

LangChain does provide a [PGVector Client](https://python.langchain.com/docs/integrations/vectorstores/pgvector/), but it does not store data in a form that is easy for DBAs to manage.

```python
vector_store = PGVector(
    embeddings=embeddings,
    collection_name=collection_name,
    connection=connection,
    use_jsonb=True,
)

docs = [
    Document(
        page_content="there are cats in the pond",
        metadata={"id": 1, "location": "pond", "topic": "animals"},
    )
]

vector_store.add_documents(docs, ids=[doc.metadata["id"] for doc in docs])
```
```
Stored Data

langchain_pg_collection
- uuid: uuid-A
- name: collection_name

langchain_pg_embedding
- id: 1 
- collection_id: uuid-A
- embedding: ...
- document: "there are cats in the pond"
- cmetadata: {"id": 1, "location": "pond", "topic": "animals"}
```
> Since the data is stored and used like NoSQL, it is difficult for DBAs to manage.

Therefore, we decided to implement it ourselves.

<br>

# Implementation Goals
- Store data in a form that DBAs can manage, like an RDB.
  - Metadata should be stored as columns.
  - The embedded vector values should also be stored as a separate column.
- Build an extensible structure so that it can be used with any entity.

<br>

# vector entity

## VectorEntityBase
Entities you want to store in PG Vector must inherit from `VectorEntityBase`.
For a child entity to be used as vector DB data, it must define the following three elements: 
1. `content`
- The context that the agent will refer to.

2. `chunk_for_embedding`
- The text to be embedded.
- A subset of the content.
> If the main text is too long, the accuracy of similarity search in the vector DB decreases.
> For this reason, you may want to split the main text into smaller chunks for embedding. <br>
> `chunk_for_embedding` is used in such situations. <br>
> Only the text specified in `chunk_for_embedding` will be embedded. <br>
> `content` itself will be passed to the agent as context.

3. `to_metadata`
- A method that returns metadata.

```python
from abc import abstractmethod
from typing import Any

from model.entity.base import TableBase
from pgvector.sqlalchemy import Vector
from sqlalchemy.orm import Mapped, mapped_column


class VectorEntityBase(TableBase):
    __abstract__ = True

    embedding_value: Mapped[list[float]] = mapped_column(Vector(1024))

    @property
    @abstractmethod
    def content(self) -> str:
        raise NotImplementedError("Subclass must implement content property")

    @property
    @abstractmethod
    def chunk_for_embedding(self) -> str:
        raise NotImplementedError(
            "Subclass must implement chunk_for_embedding property"
        )

    @content.setter
    @abstractmethod
    def content(self, value: str) -> None:
        raise NotImplementedError("Subclass must implement content setter")

    @chunk_for_embedding.setter
    @abstractmethod
    def chunk_for_embedding(self, value: str) -> None:
        raise NotImplementedError("Subclass must implement chunk_for_embedding setter")

    @abstractmethod
    def to_metadata(self, score: float) -> dict[str, Any]:
        raise NotImplementedError("Subclass must implement metadata property")
```

<br>

## Example of Implementing a Vector Entity
For instance, if a developer wants to put `TempBoard` data into the vector DB, they can implement the entity as follows.

```python
from datetime import datetime
from typing import Any

from model.vector_entity.base import VectorEntityBase
from overrides import override
from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    PrimaryKeyConstraint,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Text


class TempBoardEntity(VectorEntityBase):
    __tablename__ = "temp_board"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_sid", "user_sid"),
        {"schema": "ai"},
    )

    tenant_sid = Column(String(100), nullable=False)
    user_sid = Column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_chunk: Mapped[str] = mapped_column(Text, nullable=False)
    write_dtm = Column(DateTime, default=datetime.now)
    update_dtm = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    @property
    @override
    def content(self) -> str:
        return self.content

    @property
    @override
    def chunk_for_embedding(self) -> str:
        return self.content_chunk

    @content.setter
    @override
    def content(self, value: str) -> None:
        self.content = value

    @chunk_for_embedding.setter
    @override
    def chunk_for_embedding(self, value: str) -> None:
        self.content_chunk = value

    @override
    def to_metadata(self, score: float) -> dict[str, Any]:
        return {
            "tenant_sid": self.tenant_sid,
            "user_sid": self.user_sid,
            "content": self.content,
            "write_dtm": self.write_dtm.isoformat(),
            "update_dtm": self.update_dtm.isoformat(),
            "score": score,
        }
```

<br>

# vector store 
## PGVectorStore

As a PGVector client class corresponding to LangChain's VectorStore, two functions have been implemented:
- Embed documents and store them.
- Perform document similarity search based on a query.

```python
from typing import Self, Sequence, Type, TypeVar

from core.persist.transaction import Tx
from core.types.type import Document
from model.vector_entity.base import VectorEntityBase
from langchain_core.embeddings import Embeddings
from sqlalchemy import ColumnElement, desc, select


T = TypeVar("T", bound=VectorEntityBase)


class PGVectorStore:
    def __init__(
        self,
        embedding_model: Embeddings,
    ):
        self._embedding_model = embedding_model

    async def add_documents(self, tx: Tx, documents: Sequence[T]) -> None:
        embeddings = self._embedding_model.embed_documents(
            [doc.chunk_for_embedding for doc in documents]
        )

        for doc, embedding in zip(documents, embeddings):
            doc.embedding_value = embedding

        async for _tx in tx.require():
            session = _tx.get_session()
            session.add_all(documents)

    async def similarity_search_with_score(
        self,
        tx: Tx,
        query: str,
        k: int,
        threshold: float,
        entity_class: Type[T],
        additional_where_clause: list[ColumnElement[bool]] = [],
    ) -> list[Document]:
        query_embedding = self._embedding_model.embed_query(query)
        similarity_column = (
            1 - entity_class.embedding_value.cosine_distance(query_embedding)
        ).label("similarity")
        result = []
        async for _tx in tx.require():
            stmt = (
                select(
                    entity_class,
                    similarity_column,
                )
                .where(similarity_column > threshold)
                .where(*additional_where_clause)
                .order_by(desc(similarity_column))
                .limit(k)
            )
            query_result = (await _tx.get_session().execute(stmt)).all()
            result = [
                Document(
                    content=row._mapping[entity_class.__name__].content,
                    metadata=row._mapping[entity_class.__name__].to_metadata(
                        row.similarity
                    ),
                )
                for row in query_result
            ]
        return result
```

<br>

### Document Storage
Only collections of entities that implement `VectorEntityBase` can be stored.
By enforcing the restriction that only entities can be stored, I intended to give the impression that PG Vector must be used in an RDB-style manner.

<br>

### Document Similarity Search
By accepting the `where` clause as an optional parameter, the implementation allows filtering the data to some extent before performing similarity search.
The return value of similarity search is unified as a `Document` type.

```python
class Document(TypedDict):
    content: str
    metadata: Any
```

Regardless of which entity the search is based on, the documents are always returned in the same type, so the client code can handle them consistently.

Example client code for document search:
```python
    async def similarity_search_by(
        vector_store: PGVectorStore,
        tx: Tx,
        query: str,
        k: int,
        threshold: float,
        tenant_sid: str,
        user_sid: str
    ) -> list[Document]:
        additional_where_clause = [
            TempBoardEntity.tenant_sid == tenant_sid,
            TempBoardEntity.user_sid == user_sid,
        ]
        return await vector_store.similarity_search_with_score(
            tx,
            query,
            k,
            threshold,
            TempBoardEntity,
            additional_where_clause,
        )
```
> Filter data by tenant code and user id, then run a similarity search.

<br>

### Document Deletion
Since PGVector is fundamentally an RDB, deletion logic can be implemented in various ways based on queries.
Therefore, deletion was not implemented in the base class `PGVectorStore`.
Instead, diverse single-record and multi-record deletion logics, driven by queries, should be implemented in child classes that inherit from `PGVectorStore`.

<br>

# References
- [PGVector Offical Documentation](https://github.com/pgvector/pgvector/)
- [LangChain PGVector Client](https://python.langchain.com/docs/integrations/vectorstores/pgvector/)
