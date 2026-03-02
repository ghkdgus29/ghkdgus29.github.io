---
layout: post
author: Hyun 
title: PG Vector 클라이언트 직접 만들기 
date:   2025-09-15 21:12:00 +0000
excerpt: "This post introduces a custom PGVector client designed to store and query vector data in an RDB-friendly way—unlike LangChain’s default client, which uses a NoSQL-like schema."
categories:
 - Engineering
 - VectorDB
 - Python
 - AI
lang: kr
lang_ref: /Building-a-PG-Vector-Client-from-Scratch-EN/
---


# PG Vector 클라이언트 직접 만들기

LangChain에서 [PGVector 클라이언트](https://python.langchain.com/docs/integrations/vectorstores/pgvector/)를 제공하긴 하지만,  DBA들이 관리하기 좋은 형태로 데이터를 저장하지 않는다. 

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
저장된 데이터 

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
> - NoSQL처럼 데이터를 저장하고 사용하기에, DBA가 관리하기 어렵다.

따라서 직접 구현하기로 결정하였다. 

<br>

# 구현 목표
- DBA들이 관리할 수 있는 형태로, RDB처럼 데이터를 저장할 것
  - 메타데이터들이 컬럼으로 저장될 것
  - 임베딩 된 벡터값 역시 또 하나의 컬럼으로 저장될 것
- 어떤 엔티티든 사용할 수 있도록, 확장 가능한 구조로 만들기

<br>

# vector entity 

## `VectorEntityBase`
PG Vector에 저장하고 싶은 엔티티는, `VectorEntityBase`를 상속받아야 한다. 
자식 엔티티는 벡터 DB 데이터로서 사용되기 위해 아래 3가지 요소를 정의해야 한다.
1. `content` 
- agent가 참고할 context에 해당

2. `chunk_for_embedding`
- 임베딩 할 텍스트 
- `content`의 부분집합 
> 본문 텍스트가 너무 긴 경우, 벡터 DB내에서 유사도 검색을 할 때 정확도가 떨어진다. 
> 이러한 이유로, 본문 텍스트보다는 좀 더 작은 단위로 임베딩 할 청크를 나누고 싶을 수 있다. 
> <br> `chunk_for_embedding`은 이런 상황에 사용한다.
> <br> `chunk_for_embedding`으로 지정된 텍스트만 임베딩의 대상이 된다.
> <br> `content`만 agent에게 건네주는 context가 된다. 

3. `to_metadata`
- 메타 데이터 반환 메서드  

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

## vector entity 구현 예시
예를 들어, `TempBoard` 데이터를 벡터 DB에 넣고 싶은 개발자는 아래와 같이 엔티티를 구현할 수 있다.

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
## `PGVectorStore`
LangChain의 `VectorStore`와 대응되는 PGVector 클라이언트 클래스로, 2가지 기능을 구현하였다.
- 문서 임베딩 후 저장
- query를 바탕으로 문서 유사도 검색 

<br>

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

### 문서 저장
`VectorEntityBase`를 구현한 엔티티의 컬렉션만 저장할 수 있도록 하였다.
엔티티만 저장할 수 있다는 제약을 통해, RDB 방식으로 PG Vector를 사용해야 한다는 인상을 주고 싶었다. 

<br>

### 문서 유사도 검색
where절을 optional 파라미터로 받음으로써 어느정도 데이터를 필터링 한 후 유사도 검색을 할 수 있도록 구현하였다. 유사도 검색의 반환값은 `Document` 타입으로 통일되어 있다. 

```python
class Document(TypedDict):
    content: str
    metadata: Any
```
`Document`의 `content`엔 agent에게 넘길 context가 들어있고, `metadata`엔 엔티티에서 구현한 `to_metadata` 반환값이 들어간다.
어떤 엔티티를 바탕으로 조회하던, 같은 타입으로 문서를 반환하도록 하여 클라이언트 코드가 조회한 문서를 일관적으로 사용할 수 있도록 하였다. 

문서를 검색하는 클라이언트 코드는 아래와 같이 작성할 수 있다. 

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
> 회사코드와 유저아이디로 데이터를 필터링 한 후, 유사도 검색

<br>

### 문서 삭제
PGVector는 기본적으로 RDB이기 때문에 삭제 로직은 쿼리를 바탕으로 다양한 방식으로 이뤄질 수 있다. 따라서 베이스 클래스인 `PGVectorStore`에선 삭제를 구현하지 않았다.
쿼리를 바탕으로 한 다양한 단건 삭제, 다건 삭제 로직은 `PGVectorStore`를 상속한 자식 클래스에서 구현해야 한다.

<br>


# 참고자료
- [PGVector 공식문서](https://github.com/pgvector/pgvector/)
- [LangChain PGVector 클라이언트](https://python.langchain.com/docs/integrations/vectorstores/pgvector/)
