---
layout: post
author: Hyun 
title: Ragas의 RAG 평가 지표 분석
date:   2026-09-20 00:00:00 +0900
excerpt: "Ragas 메트릭을 소스코드 레벨로 분석한다"
categories:
 - Research
 - RAG
 - Evaluation
lang: kr
lang_ref: /Understanding-RAG-Evaluation-Metrics-with-Ragas-EN/
---

# 들어가며
RAG 파이프라인을 만드는 것 자체보다 중요한 건 평가다. 파이프라인이 일단 동작하게 만드는 것 자체는 어렵지 않다. 하지만 리랭커를 넣을지, 청킹 전략을 바꿀지, 프롬프트를 손볼지 같은 결정은 전부 "지금보다 나아졌는가"를 판단할 수 있어야 결정할 수 있다. 그 기준이 되는 게 baseline이고, baseline이 있어야 비로소 개선과 튜닝이 가능해진다.

문제는 이걸 감으로 판단하기 어렵다는 점이다. 검색이 문제인지, 생성이 문제인지, 애초에 관련 문서가 없는 건지는 답변 하나만 보고는 구분이 안 된다. [Ragas](https://github.com/explodinggradients/ragas)는 파이프라인의 어느 단계가 문제인지 쉽게 테스트할 수 있도록 도와주는 평가 프레임워크다.

이 글에서는 Ragas가 제공하는 7개 지표(Context Precision, Precision@K, Context Recall, Faithfulness, Response Relevancy, Factual Correctness, Noise Sensitivity)를 각각 예시와 소스코드 레벨로 뜯어보고, 각 지표가 갖는 의미에 대해 정리한다.

<br>

# Context Precision (Average Precision)
- 가져온 청크의 순위를 얼마나 잘 매겼는지에 대한 평가 지표. IR에서 쓰는 Precision@K와는 다르다.
- 공식: `Σ(Precision@k × relevance_k) / (전체 relevant 항목 수)`

<br>

## 예시
질문: "교통비 영수증은 언제 첨부해야 해?"

reference: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다."

검색된 청크:
- 청크1 (1번째, irrelevant): "연차는 매년 15일 발생한다."
- 청크2 (2번째, relevant): "교통비가 10만원을 초과하면 영수증을 첨부해야 한다."

계산:
```
k=1, precision@1 = 0/1 = 0, relevance_1 = 0
k=2, precision@2 = 1/2 = 0.5, relevance_2 = 1

AP = ((0 * 0) + (0.5 * 1)) / 1 = 0.5
```

relevant 문서를 1개 확보한 건 맞지만, 2등으로 밀렸다는 이유만으로 점수가 0.5로 깎인다. 같은 문서가 1등이었다면 `precision@1=1.0`이 그대로 분자가 돼서 AP=1.0이 나왔을 것이다. 또한, 첫 번째로 가져온 문서가 relevant하다면, 뒤에 아무리 irrelevant한 문서를 여러 개 가져왔다 해도 점수는 1.0으로 만점이다.

<br>

## Ragas 코드 분석
```python
metric = ContextPrecision(llm=get_judge_llm())
```
> `ContextPrecision` 생성

<br>

```python
class ContextPrecisionWithReference(BaseMetric):
    # ...

    def __init__(
        self,
        llm: "InstructorBaseRagasLLM",
        name: str = "context_precision_with_reference",
        **kwargs,
    ):
        """
        Initialize ContextPrecisionWithReference metric with required components.

        Args:
            llm: Modern instructor-based LLM for context evaluation
            name: The metric name
        """
        # Set attributes explicitly before calling super()
        self.llm = llm
        self.prompt = ContextPrecisionPrompt()  # Initialize prompt class once

        # Call super() for validation (without passing llm in kwargs)
        super().__init__(name=name, **kwargs)
```
> `ContextPrecision` 부모 클래스

<br>

```python
class ContextPrecisionPrompt(BasePrompt[ContextPrecisionInput, ContextPrecisionOutput]):
    """Context precision evaluation prompt with structured input/output."""

    input_model = ContextPrecisionInput
    output_model = ContextPrecisionOutput

    instruction = 'Given question, answer and context verify if the context was useful in arriving at the given answer. Give verdict as "1" if useful and "0" if not with json output.'

    examples = [
        (
            ContextPrecisionInput(
                question="What can you tell me about Albert Einstein?",
                context="Albert Einstein (14 March 1879 – 18 April 1955) was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. Best known for developing the theory of relativity, he also made important contributions to quantum mechanics, and was thus a central figure in the revolutionary reshaping of the scientific understanding of nature that modern physics accomplished in the first decades of the twentieth century. His mass–energy equivalence formula E = mc2, which arises from relativity theory, has been called 'the world's most famous equation'. He received the 1921 Nobel Prize in Physics 'for his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect', a pivotal step in the development of quantum theory. His work is also known for its influence on the philosophy of science. In a 1999 poll of 130 leading physicists worldwide by the British journal Physics World, Einstein was ranked the greatest physicist of all time. His intellectual achievements and originality have made Einstein synonymous with genius.",
                answer="Albert Einstein, born on 14 March 1879, was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. He received the 1921 Nobel Prize in Physics for his services to theoretical physics.",
            ),
            ContextPrecisionOutput(
                reason="The provided context was indeed useful in arriving at the given answer. The context includes key information about Albert Einstein's life and contributions, which are reflected in the answer.",
                verdict=1,
            ),
        ),
        (
            ContextPrecisionInput(
                question="who won 2020 icc world cup?",
                context="The 2022 ICC Men's T20 World Cup, held from October 16 to November 13, 2022, in Australia, was the eighth edition of the tournament. Originally scheduled for 2020, it was postponed due to the COVID-19 pandemic. England emerged victorious, defeating Pakistan by five wickets in the final to clinch their second ICC Men's T20 World Cup title.",
                answer="England",
            ),
            ContextPrecisionOutput(
                reason="the context was useful in clarifying the situation regarding the 2020 ICC World Cup and indicating that England was the winner of the tournament that was intended to be held in 2020 but actually took place in 2022.",
                verdict=1,
            ),
        ),
        (
            ContextPrecisionInput(
                question="What is the tallest mountain in the world?",
                context="The Andes is the longest continental mountain range in the world, located in South America. It stretches across seven countries and features many of the highest peaks in the Western Hemisphere. The range is known for its diverse ecosystems, including the high-altitude Andean Plateau and the Amazon rainforest.",
                answer="Mount Everest.",
            ),
            ContextPrecisionOutput(
                reason="the provided context discusses the Andes mountain range, which, while impressive, does not include Mount Everest or directly relate to the question about the world's tallest mountain.",
                verdict=0,
            ),
        ),
    ]
```
> Few-Shot prompt 생성

<br>

```python
result = await metric.ascore(
    user_input=QUESTION, reference=REFERENCE, retrieved_contexts=retrieved_contexts
)
```
> metric 측정

<br>

```python
class ContextPrecisionWithReference(BaseMetric):
    # ... 

    async def ascore(
        self, user_input: str, reference: str, retrieved_contexts: List[str]
    ) -> MetricResult:
        # ... 

        # Evaluate each retrieved context
        verdicts = []
        for context in retrieved_contexts:
            # Create input data and generate prompt
            input_data = ContextPrecisionInput(
                question=user_input, context=context, answer=reference
            )
            prompt_string = self.prompt.to_string(input_data)
            result = await self.llm.agenerate(prompt_string, ContextPrecisionOutput)
            verdicts.append(result.verdict)

        # Calculate average precision
        score = self._calculate_average_precision(verdicts)
        return MetricResult(value=float(score))
```
> 개별 retrieved_contexts가 reference를 만드는 데 필요했는지를 검증 후, AP 계산

<br>

## 진단
| Context Precision (AP) | 해석 |
|---|---|
| 낮음 | retrieval 로직을 점검<br>- Reranking을 추가하거나, similarity score 계산 자체에 문제가 없는지 확인 |

<br>

# Precision@K
- 가져온 K개 문서 중 실제로 관련 있는 문서의 비율.
- `TP / (TP + FP) = (가져온 K개 문서 중 relevant 문서 개수) / K`

<br>

## 예시
질문: "교통비 영수증은 언제 첨부해야 해?"

reference: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다."

검색된 청크:
- 청크1 (1번째, irrelevant): "연차는 매년 15일 발생한다."
- 청크2 (2번째, relevant): "교통비가 10만원을 초과하면 영수증을 첨부해야 한다."

계산:
```
Precision@2 = 1 / (1 + 1) = 0.5
```

Context Precision과 달리 순서는 전혀 고려하지 않는다. 청크1이 1등이든 2등이든 결과는 같다.

<br>

## 코드 구현
Ragas가 기본 제공하지 않아서 직접 구현해야 한다. `ContextPrecisionPrompt`로 얻은 verdict를 순서 없이 평균만 내면 된다.

```python
async def get_verdicts(llm, retrieved_contexts: list[str]) -> list[int]:
    prompt = ContextPrecisionPrompt()
    verdicts = []
    for context in retrieved_contexts:
        input_data = ContextPrecisionInput(question=QUESTION, context=context, answer=REFERENCE)
        prompt_string = prompt.to_string(input_data)
        result: ContextPrecisionOutput = await llm.agenerate(prompt_string, ContextPrecisionOutput)
        verdicts.append(result.verdict)
    return verdicts


def precision_at_k(verdicts: list[int]) -> float:
    return sum(verdicts) / len(verdicts)

verdicts = await get_verdicts(llm, retrieved_contexts)
result = precision_at_k(verdicts)
```

<br>

## 진단
| Context Precision (AP) | Precision@K | 해석 |
|---|---|---|
| 높음 | 낮음 | 정답 문서는 상위에 있지만 top-K 나머지 자리가 irrelevant한 청크로 채워지고 있음<br>- top-k를 줄이거나 reranker 컷오프를 조정 |
| 낮음 | 낮음 | retriever 자체의 문제<br>- 임베딩이나 인덱스를 점검 |

<br>

# Context Recall
- 원래 Recall은 `TP / (TP + FN) = (가져온 문서 중 relevant 문서 수) / (전체 relevant 문서 수)`다.
- 그런데 전체 문서를 대상으로 reference별 relevant 문서를 일일이 애노테이션하는 건 현실적으로 어렵다.
- 그래서 Ragas는 reference를 claim 단위로 쪼갠 뒤, 그 statement 하나하나가 검색된 문서로부터 유추 가능한지를 비율로 계산한다. 즉 "정답을 만드는 데 필요한 근거를 retriever가 놓치지 않았는가"를 측정하는 지표다.
- `검색된 문서가 뒷받침해주는 reference claim 수 / reference claim 수`

<br>

## 예시
질문: "교통비 영수증은 언제 첨부해야 해?"

reference: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다. 숙박비는 항상 영수증이 필요하다."
- R1: 교통비 10만원 초과 시 첨부
- R2: 숙박비 항상 필요

검색된 청크:
- 청크1: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다."
- 청크2: "회의실은 캘린더에서 예약한다."

계산:
```
R1 → 청크1이 뒷받침 → attributed = 1
R2 → 어느 청크에도 없음 → attributed = 0

recall = (1 + 0) / 2 = 0.5
```

reference를 2개 문장으로 쪼갰는데 검색된 청크가 그중 1개(R1)만 뒷받침하니 recall은 0.5다. 여기서도 순서는 상관없다.

<br>

## Ragas 코드 분석
```python
metric = ContextRecall(llm=get_judge_llm())
```
> `ContextRecall` 생성

<br>

```python
class ContextRecall(BaseMetric):
    # ... 

    def __init__(
        self,
        llm: "InstructorBaseRagasLLM",
        name: str = "context_recall",
        **kwargs,
    ):
        """
        Initialize ContextRecall metric with required components.

        Args:
            llm: Modern instructor-based LLM for statement classification
            name: The metric name (default: "context_recall")
            **kwargs: Additional arguments passed to BaseMetric
        """
        # Set attributes explicitly before calling super()
        self.llm = llm
        self.prompt = ContextRecallPrompt()  # Initialize prompt class once

        # Call super() for validation
        super().__init__(name=name, **kwargs)
```

<br>

```python
class ContextRecallPrompt(BasePrompt[ContextRecallInput, ContextRecallOutput]):
    """Context recall evaluation prompt with structured input/output."""

    input_model = ContextRecallInput
    output_model = ContextRecallOutput

    instruction = """Given a context and an answer, analyze each statement in the answer and classify if the statement can be attributed to the given context or not.
Use only binary classification: 1 if the statement can be attributed to the context, 0 if it cannot.
Provide detailed reasoning for each classification."""

    examples = [
        (
            ContextRecallInput(
                question="What can you tell me about Albert Einstein?",
                context="Albert Einstein (14 March 1879 - 18 April 1955) was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. Best known for developing the theory of relativity, he also made important contributions to quantum mechanics, and was thus a central figure in the revolutionary reshaping of the scientific understanding of nature that modern physics accomplished in the first decades of the twentieth century. His mass-energy equivalence formula E = mc2, which arises from relativity theory, has been called 'the world's most famous equation'. He received the 1921 Nobel Prize in Physics 'for his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect', a pivotal step in the development of quantum theory. His work is also known for its influence on the philosophy of science. In a 1999 poll of 130 leading physicists worldwide by the British journal Physics World, Einstein was ranked the greatest physicist of all time. His intellectual achievements and originality have made Einstein synonymous with genius.",
                answer="Albert Einstein, born on 14 March 1879, was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time. He received the 1921 Nobel Prize in Physics for his services to theoretical physics. He published 4 papers in 1905. Einstein moved to Switzerland in 1895.",
            ),
            ContextRecallOutput(
                classifications=[
                    ContextRecallClassification(
                        statement="Albert Einstein, born on 14 March 1879, was a German-born theoretical physicist, widely held to be one of the greatest and most influential scientists of all time.",
                        reason="The date of birth of Einstein is mentioned clearly in the context.",
                        attributed=1,
                    ),
                    ContextRecallClassification(
                        statement="He received the 1921 Nobel Prize in Physics for his services to theoretical physics.",
                        reason="The exact sentence is present in the given context.",
                        attributed=1,
                    ),
                    ContextRecallClassification(
                        statement="He published 4 papers in 1905.",
                        reason="There is no mention about papers he wrote in the given context.",
                        attributed=0,
                    ),
                    ContextRecallClassification(
                        statement="Einstein moved to Switzerland in 1895.",
                        reason="There is no supporting evidence for this in the given context.",
                        attributed=0,
                    ),
                ]
            ),
        ),
        (
            ContextRecallInput(
                question="who won 2020 icc world cup?",
                context="The 2022 ICC Men's T20 World Cup, held from October 16 to November 13, 2022, in Australia, was the eighth edition of the tournament. Originally scheduled for 2020, it was postponed due to the COVID-19 pandemic. England emerged victorious, defeating Pakistan by five wickets in the final to clinch their second ICC Men's T20 World Cup title.",
                answer="England",
            ),
            ContextRecallOutput(
                classifications=[
                    ContextRecallClassification(
                        statement="England",
                        reason="The context clarifies that England won the 2022 edition (which was originally scheduled for 2020).",
                        attributed=1,
                    ),
                ]
            ),
        ),
        (
            ContextRecallInput(
                question="What is the tallest mountain in the world?",
                context="The Andes is the longest continental mountain range in the world, located in South America. It stretches across seven countries and features many of the highest peaks in the Western Hemisphere. The range is known for its diverse ecosystems, including the high-altitude Andean Plateau and the Amazon rainforest.",
                answer="Mount Everest.",
            ),
            ContextRecallOutput(
                classifications=[
                    ContextRecallClassification(
                        statement="Mount Everest.",
                        reason="The provided context discusses the Andes mountain range, which does not include Mount Everest or directly relate to the world's tallest mountain.",
                        attributed=0,
                    ),
                ]
            ),
        ),
    ]
```
> Few-Shot prompt 생성

<br>

```python
result = await metric.ascore(
    user_input=QUESTION, retrieved_contexts=retrieved_contexts, reference=REFERENCE
)
```
> metric 측정

<br>

```python
class ContextRecall(BaseMetric):
    # ... 

    async def ascore(
        self,
        user_input: str,
        retrieved_contexts: List[str],
        reference: str,
    ) -> MetricResult:
        # ... 

        # Combine contexts into a single string
        context = "\n".join(retrieved_contexts) if retrieved_contexts else ""

        # Create input data and generate prompt
        input_data = ContextRecallInput(
            question=user_input, context=context, answer=reference
        )
        prompt_string = self.prompt.to_string(input_data)

        # Get classifications from LLM
        result = await self.llm.agenerate(prompt_string, ContextRecallOutput)

        # Calculate score
        if not result.classifications:
            return MetricResult(value=np.nan)

        # Count attributions
        attributions = [c.attributed for c in result.classifications]
        score = sum(attributions) / len(attributions) if attributions else np.nan

        return MetricResult(value=float(score))
```
> reference를 claim으로 나누고, 각 claim이 청크에서 유추할 수 있는지 여부를 검증 후 context recall 계산

<br>

## 진단
| Context Precision | Context Recall | 해석 |
|---|---|---|
| 높음 | 낮음 | top-k가 작거나 정답을 구성하는 다른 근거를 retriever가 놓치고 있을 확률이 높음<br>- 문서의 청킹 방식 등 문서 자체를 점검 |
| 낮음 | 낮음 | retrieval 과정 전반적인 점검이 필요 |

<br>

# Faithfulness
- 답변의 claim들이 검색된 문서만으로 추론 가능한 비율.
- reference와는 비교하지 않는다. response가 context로부터 나왔는지를 확인하는, 순수한 hallucination 검출 지표다.
- `검색된 문서가 뒷받침해주는 response claim 수 / response claim 수`

<br>

## 예시
질문: "교통비 영수증은 언제 첨부해야 해?"

검색된 청크: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다."

response: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다. 숙박비도 항상 첨부해야 한다."
- A: 교통비 10만원 초과 시 첨부
- B: 숙박비도 항상 첨부

계산:
```
A → 청크에서 직접 추론 가능 → verdict = 1
B → 청크에 숙박비 언급이 아예 없음 → verdict = 0

faithfulness = (1 + 0) / 2 = 0.5
```

B가 실제로는 맞는 말이어도(reference에 있어도) 상관없다. Faithfulness는 reference를 아예 보지 않고, "지금 검색된 청크들만으로 이 주장을 추론할 수 있는가"만 본다. 즉 "답변이 틀렸다"가 아니라 "근거 없이 말했다"를 측정하는 지표다.

<br>

## Ragas 코드 분석
```python
metric = Faithfulness(llm=get_judge_llm())
```
> `Faithfulness` 생성

<br>

```python
class Faithfulness(BaseMetric):
    # ...

    def __init__(self, llm: "InstructorBaseRagasLLM", name: str = "faithfulness", **kwargs):
        self.llm = llm
        self.statement_generator_prompt = StatementGeneratorPrompt()  # 1단계: statement 분해용
        self.nli_statement_prompt = NLIStatementPrompt()               # 2단계: NLI 판정용

        super().__init__(name=name, **kwargs)
```
> `Faithfulness` 생성자

<br>

```python
class StatementGeneratorPrompt(
    BasePrompt[StatementGeneratorInput, StatementGeneratorOutput]
):
    """Prompt for breaking down answers into atomic statements."""

    input_model = StatementGeneratorInput
    output_model = StatementGeneratorOutput

    instruction = """Given a question and an answer, analyze the complexity of each sentence in the answer. Break down each sentence into one or more fully understandable statements. Ensure that no pronouns are used in any statement."""

    examples = [
        (
            StatementGeneratorInput(
                question="Who was Albert Einstein and what is he best known for?",
                answer="He was a German-born theoretical physicist, widely acknowledged to be one of the greatest and most influential physicists of all time. He was best known for developing the theory of relativity, he also made important contributions to the development of the theory of quantum mechanics.",
            ),
            StatementGeneratorOutput(
                statements=[
                    "Albert Einstein was a German-born theoretical physicist.",
                    "Albert Einstein is recognized as one of the greatest and most influential physicists of all time.",
                    "Albert Einstein was best known for developing the theory of relativity.",
                    "Albert Einstein made important contributions to the development of the theory of quantum mechanics.",
                ]
            ),
        ),
    ]
```
> 주어진 문장을 "대명사 없는 독립 문장" 리스트로 쪼개도록 가이드하는 Few-Shot 프롬프트

<br>

```python
class NLIStatementPrompt(BasePrompt[NLIStatementInput, NLIStatementOutput]):
    """Prompt for evaluating statement faithfulness against context using NLI."""

    input_model = NLIStatementInput
    output_model = NLIStatementOutput

    instruction = """Your task is to judge the faithfulness of a series of statements based on a given context. For each statement you must return verdict as 1 if the statement can be directly inferred based on the context or 0 if the statement can not be directly inferred based on the context."""

    examples = [
        (
            NLIStatementInput(
                context="John is a student at XYZ University. He is pursuing a degree in Computer Science. He is enrolled in several courses this semester, including Data Structures, Algorithms, and Database Management. John is a diligent student and spends a significant amount of time studying and completing assignments. He often stays late in the library to work on his projects.",
                statements=[
                    "John is majoring in Biology.",
                    "John is taking a course on Artificial Intelligence.",
                    "John is a dedicated student.",
                    "John has a part-time job.",
                ],
            ),
            NLIStatementOutput(
                statements=[
                    StatementFaithfulnessAnswer(
                        statement="John is majoring in Biology.",
                        reason="John's major is explicitly stated as Computer Science, not Biology.",
                        verdict=0,
                    ),
                    StatementFaithfulnessAnswer(
                        statement="John is taking a course on Artificial Intelligence.",
                        reason="The context mentions courses in Data Structures, Algorithms, and Database Management, but does not mention Artificial Intelligence.",
                        verdict=0,
                    ),
                    StatementFaithfulnessAnswer(
                        statement="John is a dedicated student.",
                        reason="The context states that John is a diligent student who spends a significant amount of time studying and completing assignments.",
                        verdict=1,
                    ),
                    StatementFaithfulnessAnswer(
                        statement="John has a part-time job.",
                        reason="There is no information in the context about John having a part-time job.",
                        verdict=0,
                    ),
                ]
            ),
        ),
    ]
```
> 각 statement가 context에서 유래되었는지를 검증하도록 가이드하는 Few-Shot 프롬프트

<br>

```python
result = await metric.ascore(
    user_input=QUESTION, response=RESPONSE, retrieved_contexts=retrieved_contexts
)
```
> metric 측정 <br>
> Context Precision/Recall과 달리 `reference`가 아니라 `response`를 받는다

<br>

```python
class Faithfulness(BaseMetric):
    # ...

    async def ascore(self, user_input: str, response: str, retrieved_contexts: List[str]) -> MetricResult:
        # ... 

        # Step 1: Break response into atomic statements
        statements = await self._create_statements(user_input, response)
        if not statements:
            return MetricResult(value=float("nan"))

        # Step 2: Join all contexts and evaluate statements against them
        context_str = "\n".join(retrieved_contexts)
        verdicts = await self._create_verdicts(statements, context_str)

        # Step 3: Compute faithfulness score
        score = self._compute_score(verdicts)
        return MetricResult(value=float(score))

    def _compute_score(self, verdicts: NLIStatementOutput) -> float:
        # ... 

        faithful_statements = sum(1 if s.verdict else 0 for s in verdicts.statements)
        num_statements = len(verdicts.statements)

        if num_statements > 0:
            score = faithful_statements / num_statements
        else:
            score = float("nan")

        return score
```
> response를 statement로 쪼갠 뒤, 합쳐진 청크 하나에 대고 전부 한 번에 판정하여 faithfulness 비율을 계산

<br>

## 진단
환각 여부를 확인하는, generation 단계에 대한 테스트다.

| Retrieval 성능 | Faithfulness | 해석 |
|---|---|---|
| 낮음 | 낮음 | 검색된 문서가 아예 관련이 없어서 에이전트가 지어낼 수밖에 없었다는 뜻<br>- retrieval부터 점검 |

<br>

# Response Relevancy
- 답변이 질문 형태에 얼마나 잘 반응했는가를 확인한다.
- response를 바탕으로 "이 답변은 원래 무슨 질문에 대한 답이었을까"를 역으로 추론해 질문을 `strictness`(=N)개 만든 뒤, 그 합성 질문들이 원래 질문과 임베딩 공간에서 얼마나 비슷한지를 계산한다.
- `Answer Relevancy = (1/N) × Σᵢ cos_sim(Eᵢ, Eₒ)` (Eᵢ = i번째 합성 질문의 임베딩, Eₒ = 원 질문의 임베딩)
- retrieved_contexts, reference 둘 다 쓰지 않는다. response와 user_input만 있으면 계산 가능하다.

<br>

## 예시
질문: "교통비 영수증은 언제 첨부해야 해?"

response: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다."

계산 (strictness=3, LLM이 response만 보고 합성 질문 3개 생성):
```
합성 질문1: "교통비 영수증은 언제 첨부해야 해?"        sim = 0.95
합성 질문2: "교통비가 얼마 넘으면 영수증이 필요해?"      sim = 0.90
합성 질문3: "영수증 첨부 기준 금액이 얼마야?"           sim = 0.85

noncommittal 전부 0 (전부 회피성 아님)
score = mean(0.95, 0.90, 0.85) * 1 = 0.90
```

<br>

## Ragas 코드 분석
```python
metric = AnswerRelevancy(llm=get_judge_llm(), embeddings=get_judge_embeddings())
```
> `AnswerRelevancy` 생성

<br>

```python
class AnswerRelevancy(BaseMetric):
    # ...

    def __init__(
        self,
        llm: "InstructorBaseRagasLLM",
        embeddings: "BaseRagasEmbedding",
        name: str = "answer_relevancy",
        strictness: int = 3,
        **kwargs,
    ):
        # Set attributes explicitly before calling super()
        self.llm = llm
        self.embeddings = embeddings
        self.strictness = strictness
        self.prompt = AnswerRelevancePrompt()  # Initialize prompt class once

        # Call super() for validation
        super().__init__(name=name, **kwargs)
```
> 생성자 — `strictness`(기본 3)가 response로부터 합성 질문을 몇 개 생성할지 결정

<br>

```python
class AnswerRelevancePrompt(BasePrompt[AnswerRelevanceInput, AnswerRelevanceOutput]):
    """Answer relevance evaluation prompt with structured input/output."""

    input_model = AnswerRelevanceInput
    output_model = AnswerRelevanceOutput

    instruction = """Generate a question for the given answer and identify if the answer is noncommittal.
Give noncommittal as 1 if the answer is noncommittal (evasive, vague, or ambiguous) and 0 if the answer is substantive.
Examples of noncommittal answers: "I don't know", "I'm not sure", "It depends"."""

    examples = [
        (
            AnswerRelevanceInput(response="Albert Einstein was born in Germany."),
            AnswerRelevanceOutput(
                question="Where was Albert Einstein born?",
                noncommittal=0,
            ),
        ),
        (
            AnswerRelevanceInput(
                response="The capital of France is Paris, a city known for its architecture and culture."
            ),
            AnswerRelevanceOutput(
                question="What is the capital of France?",
                noncommittal=0,
            ),
        ),
        (
            AnswerRelevanceInput(
                response="I don't know about the groundbreaking feature of the smartphone invented in 2023 as I am unaware of information beyond 2022."
            ),
            AnswerRelevanceOutput(
                question="What was the groundbreaking feature of the smartphone invented in 2023?",
                noncommittal=1,
            ),
        ),
    ]
```
> 프롬프트 — `response` 바탕으로, `{question, noncommittal}`을 출력 <br>
> 대답하기 어려운 response의 경우, noncommittal=1

<br>

```python
result = await metric.ascore(user_input=QUESTION, response=RESPONSE)
```
> metric 측정

<br>

```python
class AnswerRelevancy(BaseMetric):
    # ...

    async def ascore(self, user_input: str, response: str) -> MetricResult:
        # ...

        # Generate multiple questions from response
        generated_questions = []
        noncommittal_flags = []

        for _ in range(self.strictness):
            # Create input data and generate prompt
            input_data = AnswerRelevanceInput(response=response)
            prompt_string = self.prompt.to_string(input_data)
            result = await self.llm.agenerate(prompt_string, AnswerRelevanceOutput)

            if result.question:
                generated_questions.append(result.question)
                noncommittal_flags.append(result.noncommittal)

        if not generated_questions:
            return MetricResult(value=0.0)

        # Check if all responses are noncommittal
        all_noncommittal = np.all(noncommittal_flags)

        # Embed the original question
        question_vec = np.asarray(
            await self.embeddings.aembed_text(user_input)
        ).reshape(1, -1)

        # Embed the generated questions
        gen_question_vec = np.asarray(
            await self.embeddings.aembed_texts(generated_questions)
        ).reshape(len(generated_questions), -1)

        # Calculate cosine similarity
        norm = np.linalg.norm(gen_question_vec, axis=1) * np.linalg.norm(
            question_vec, axis=1
        )
        cosine_sim = (
            np.dot(gen_question_vec, question_vec.T).reshape(
                -1,
            )
            / norm
        )

        # Score is average cosine similarity, reduced to 0 if response is noncommittal
        score = cosine_sim.mean() * int(not all_noncommittal)

        return MetricResult(value=float(score))
```
> Response 바탕으로 질문 생성하기 위해 `strictness`번 LLM 호출 <br>
> 생성된 모든 질문이 noncommittal인 경우엔 0점 반환

<br>

## 진단
| Faithfulness / Factual Correctness | Response Relevancy | 해석 |
|---|---|---|
| 낮음 | 높음 | "그럴듯하게 말은 하는데 내용이 틀린" 실패 유형 |
| 낮음 | 낮음 | 질문의 논점 자체를 벗어났거나(동문서답), 답변을 회피함 |

<br>

# Factual Correctness
- 최종 답변이 reference와 사실적으로 얼마나 일치하는가를 Precision/Recall/F1로 계산한다.
- retrieved_contexts는 아예 보지 않는다. 검색이 지저분했든 깨끗했든 최종 결과만 평가한다.
- response, reference 각각을 claim으로 쪼갠 뒤 TP, FP, FN을 다음처럼 산출한다.
  - TP = reference에 있는 response claim
  - FP = reference에 없는 response claim
  - FN = response에 없는 reference claim
- 기본값은 F1(`mode="f1"`)이다.
- Faithfulness는 reference를 안 보고 retrieved_contexts 바탕으로 response를 검증하는 데 반해, Factual Correctness는 retrieved_contexts를 안 보고 reference 바탕으로 response를 검증한다는 점이 대조적이다.

<br>

## 예시
질문: "교통비 영수증은 언제 첨부해야 해?"

reference: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다. 숙박비는 항상 필요하다."

response: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다. 숙박비는 3박 이상일 때만 필요하다."

계산 (mode="f1"):
```
response를 claim으로 분해 → reference로 검증
  A(교통비 10만원 초과 시 첨부) → reference가 뒷받침 → verdict=1
  B(숙박비 3박 이상 시 필요)    → reference는 "항상 필요"라 모순 → verdict=0
  tp = 1, fp = 1

reference를 claim으로 분해 → response로 검증
  R1(교통비 10만원 초과 시 첨부) → response가 커버 → verdict=1
  R2(숙박비 항상 필요)          → response는 "3박 이상만"이라 모순 → verdict=0
  fn = 1 (R2가 안 커버됨)

precision = tp / (tp+fp) = 1/2 = 0.5
recall    = tp / (tp+fn) = 1/2 = 0.5
f1        = 2 × 0.5 × 0.5 / (0.5+0.5) = 0.5
```

<br>

## Ragas 코드 분석
```python
metric = FactualCorrectness(llm=get_judge_llm())  # 기본값 mode="f1"
```
> `FactualCorrectness` 생성

<br>

```python
class FactualCorrectness(BaseMetric):
    # ...

    def __init__(
        self,
        llm: "InstructorBaseRagasLLM",
        mode: t.Literal["precision", "recall", "f1"] = "f1",
        beta: float = 1.0,
        atomicity: t.Literal["low", "high"] = "low",
        coverage: t.Literal["low", "high"] = "low",
        name: str = "factual_correctness",
        **kwargs,
    ):
        # Set attributes explicitly before calling super()
        self.llm = llm
        self.mode = mode
        self.beta = beta
        self.atomicity = atomicity
        self.coverage = coverage
        self.prompt = ClaimDecompositionPrompt()
        self.nli_prompt = NLIStatementPrompt()

        # Validate beta parameter
        if not isinstance(beta, (int, float)):
            raise ValueError(
                "Beta must be a float. A beta > 1 gives more weight to recall, while beta < 1 favors precision."
            )

        # Call super() for validation (without passing llm in kwargs)
        super().__init__(name=name, **kwargs)
```
> 생성자 — 프롬프트 2개(claim 분해용, NLI 검증용). <br>
> `atomicity`/`coverage`로 claim을 얼마나 잘게/넓게 쪼갤지 조절한다.

<br>

```python
class ClaimDecompositionPrompt(
    BasePrompt[ClaimDecompositionInput, ClaimDecompositionOutput]
):
    """Prompt for decomposing text into claims with configurable atomicity and coverage."""

    input_model = ClaimDecompositionInput
    output_model = ClaimDecompositionOutput

    instruction = """Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
Follow the level of atomicity and coverage as shown in the examples."""

    # Store all example sets for different atomicity/coverage combinations
    _all_examples: Dict[
        Tuple[str, str], List[Tuple[ClaimDecompositionInput, ClaimDecompositionOutput]]
    ] = {
        ("low", "low"): [
            (
                ClaimDecompositionInput(
                    response="Charles Babbage was a French mathematician, philosopher, and food critic.",
                    atomicity="low",
                    coverage="low",
                ),
                ClaimDecompositionOutput(
                    claims=["Charles Babbage was a mathematician and philosopher."]
                ),
            ),
            (
                ClaimDecompositionInput(
                    response="Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics.",
                    atomicity="low",
                    coverage="low",
                ),
                ClaimDecompositionOutput(
                    claims=[
                        "Albert Einstein was a German physicist.",
                        "Albert Einstein developed relativity and contributed to quantum mechanics.",
                    ]
                ),
            ),
        ],
        ("low", "high"): [
            (
                ClaimDecompositionInput(
                    response="Charles Babbage was a French mathematician, philosopher, and food critic.",
                    atomicity="low",
                    coverage="high",
                ),
                ClaimDecompositionOutput(
                    claims=[
                        "Charles Babbage was a French mathematician, philosopher, and food critic."
                    ]
                ),
            ),
            (
                ClaimDecompositionInput(
                    response="Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics.",
                    atomicity="low",
                    coverage="high",
                ),
                ClaimDecompositionOutput(
                    claims=[
                        "Albert Einstein was a German theoretical physicist.",
                        "Albert Einstein developed the theory of relativity and also contributed to the development of quantum mechanics.",
                    ]
                ),
            ),
        ],
        ("high", "low"): [
            (
                ClaimDecompositionInput(
                    response="Charles Babbage was a French mathematician, philosopher, and food critic.",
                    atomicity="high",
                    coverage="low",
                ),
                ClaimDecompositionOutput(
                    claims=[
                        "Charles Babbage was a mathematician.",
                        "Charles Babbage was a philosopher.",
                    ]
                ),
            ),
            (
                ClaimDecompositionInput(
                    response="Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics.",
                    atomicity="high",
                    coverage="low",
                ),
                ClaimDecompositionOutput(
                    claims=[
                        "Albert Einstein was a German theoretical physicist.",
                        "Albert Einstein developed the theory of relativity.",
                    ]
                ),
            ),
        ],
        ("high", "high"): [
            (
                ClaimDecompositionInput(
                    response="Charles Babbage was a French mathematician, philosopher, and food critic.",
                    atomicity="high",
                    coverage="high",
                ),
                ClaimDecompositionOutput(
                    claims=[
                        "Charles Babbage was a mathematician.",
                        "Charles Babbage was a philosopher.",
                        "Charles Babbage was a food critic.",
                        "Charles Babbage was French.",
                    ]
                ),
            ),
            (
                ClaimDecompositionInput(
                    response="Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics.",
                    atomicity="high",
                    coverage="high",
                ),
                ClaimDecompositionOutput(
                    claims=[
                        "Albert Einstein was a German theoretical physicist.",
                        "Albert Einstein developed the theory of relativity.",
                        "Albert Einstein contributed to the development of quantum mechanics.",
                    ]
                ),
            ),
        ],
    }

    # Default examples (low atomicity, low coverage)
    examples = _all_examples[("low", "low")]
```
> `NLIStatementPrompt`는 Faithfulness/Noise Sensitivity와 완전히 동일. <br>
> atomicity는 claim을 쪼개는 정도 <br>
> coverage는 주어진 문장을 claim에 반영하는 정도

<br>

```python
result = await metric.ascore(response=RESPONSE, reference=REFERENCE)
```
> metric 측정

<br>

```python
class FactualCorrectness(BaseMetric):
    # ...

    async def ascore(self, response: str, reference: str) -> MetricResult:
        # ...

        # Step 1: Get claim verifications to match legacy behavior exactly
        # Legacy always does: decompose response → verify against reference
        reference_response = await self._decompose_and_verify_claims(
            response, reference
        )

        if self.mode != "precision":
            # For recall and f1, also do: decompose reference → verify against response
            response_reference = await self._decompose_and_verify_claims(
                reference, response
            )
        else:
            response_reference = np.array([], dtype=bool)

        # Step 2: Compute TP, FP, FN exactly like legacy
        tp = int(np.sum(reference_response))
        fp = int(np.sum(~reference_response))
        if self.mode != "precision":
            fn = int(np.sum(~response_reference))
        else:
            fn = 0

        # Step 3: Compute final score based on mode
        if self.mode == "precision":
            score = tp / (tp + fp + 1e-8)
        elif self.mode == "recall":
            score = tp / (tp + fn + 1e-8)
        else:  # f1
            score = fbeta_score(tp, fp, fn, self.beta)

        return MetricResult(value=float(np.round(score, 2)))

    async def _decompose_and_verify_claims(
        self, text_to_decompose: str, reference_text: str
    ) -> np.ndarray:
        """Decompose text into claims and verify against reference."""
        claims = await self._decompose_claims(text_to_decompose)
        if not claims:
            return np.array([], dtype=bool)

        verdicts = await self._verify_claims(claims, reference_text)
        if not verdicts.statements:
            return np.array([], dtype=bool)

        return np.array([bool(stmt.verdict) for stmt in verdicts.statements])
```
> `reference_response = await self._decompose_and_verify_claims(response, reference)` <br>
> - response를 claim으로 쪼개고, reference에 있는지 검증 <br>
> - TP, FP 계산 <br>
> `response_reference = await self._decompose_and_verify_claims(reference, response)` <br>
> - reference를 claim으로 쪼개고, response에 있는지 검증 <br>
> - FN 계산

<br>

## 진단
| Faithfulness | Factual Correctness | 해석 |
|---|---|---|
| 높음 | 높음 | 정상 — 검색한 문서에 근거해 정답과도 일치 |
| 높음 | 낮음 | 검색된 문서 내용은 충실히 옮겼는데(환각 없음), 그 문서 자체가 틀렸거나 엉뚱한 문서를 가져온 것<br>- retrieval 문제 |
| 낮음 | 낮음 | 검색 문서에도 없는 걸 지어냈고, 그게 정답과도 다름 |
| 낮음 | 높음 | 검색 문서엔 없는 말을 했는데 우연히 정답과는 일치한 경우<br>- 모델이 자기 기본 지식으로 답하고 검색 결과는 무시했을 가능성이 큼 |

<br>

# Noise Sensitivity
- 검색된 "관련 있는" 문서의 노이즈 때문에(`mode="relevant"`) 또는 "무관한" 문서에 낚여서(`mode="irrelevant"`) 틀린 답을 했는가를 본다.
- Faithfulness/Factual Correctness는 "틀렸다/안 틀렸다"만 보지만, 이 지표는 그 오류가 어떤 종류의 검색 결과에서 비롯됐는지까지 구분한다.
- response, reference를 각각 statement로 쪼갠 뒤, 검색된 청크 하나하나에 대해 두 statement 집합 각각이 그 청크로부터 추론 가능한지(NLI)를 판정한다.
  - noise sensitivity (relevant) = reference와 불일치하면서 **relevant** 문서로 뒷받침되는 response claim 개수 / response claim 전체 개수
  - noise sensitivity (irrelevant) = reference와 불일치하면서 **irrelevant** 문서로만 뒷받침되는 response claim 개수 / response claim 전체 개수

<br>

## 예시
질문: "교통비 영수증은 언제 첨부해야 해?"

reference: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다."

검색된 청크:
- 청크1 (relevant, reference를 뒷받침함): "교통비가 10만원을 초과하면 영수증을 첨부해야 한다."
- 청크2 (irrelevant, reference와 무관함): "연차는 매년 15일 발생한다."

response: "교통비가 10만원을 초과하면 영수증을 첨부해야 한다. 연차는 매년 15일 발생한다."
- A: 교통비 10만원 초과 시 첨부 — 정답과 일치
- B: 연차는 매년 15일 발생 — 질문과 무관하지만 청크2와는 정확히 일치

계산:
```
A → reference와 일치 → "틀린 statement" 아님 → 두 모드 다 카운트 안 됨
B → reference와 불일치 → "틀린 statement" → 어느 청크에서 비롯됐는지가 중요

  B는 청크1(relevant)엔 없고, 청크2(irrelevant)엔 정확히 있음 → B는 irrelevant 문서에서 비롯된 오답

relevant   = (틀렸고 relevant 문서에서 비롯된 것) / 전체 = 0 / 2 = 0.0
irrelevant = (틀렸고 irrelevant 문서에서 비롯된 것) / 전체 = 1 / 2 = 0.5
```

같은 response, 같은 청크인데 모드에 따라 완전히 다른 결과값이 나온다.

<br>

## Ragas 코드 분석
```python
relevant_metric = NoiseSensitivity(llm=get_judge_llm(), mode="relevant")
irrelevant_metric = NoiseSensitivity(llm=get_judge_llm(), mode="irrelevant")
```
> 두 모드는 **완전히 같은 클래스**, `mode` 파라미터만 다르다

<br>

```python
class NoiseSensitivity(BaseMetric):
    # ...

    def __init__(
        self,
        llm: "InstructorBaseRagasLLM",
        name: str = "noise_sensitivity",
        mode: Literal["relevant", "irrelevant"] = "relevant",
        **kwargs,
    ):
        # Set attributes explicitly before calling super()
        self.llm = llm
        self.mode = mode
        self.statement_prompt = StatementGeneratorPrompt()
        self.faithfulness_prompt = StatementFaithfulnessPrompt()

        # Validate mode
        if mode not in {"relevant", "irrelevant"}:
            raise ValueError(
                f"Invalid argument passed for 'mode': {mode}. Must be 'relevant' or 'irrelevant'."
            )

        # Call super() for validation (without passing llm in kwargs)
        super().__init__(name=name, **kwargs)
```
> 생성자 — 프롬프트 2개는 Faithfulness와 이름은 다르지만 `statement_generator_prompt()`/`nli_statement_prompt()` 함수를 그대로 호출해서 만든 **Faithfulness와 동일한 프롬프트 문자열**.

<br>

```python
result = await metric.ascore(
    user_input=QUESTION, response=RESPONSE, reference=REFERENCE, retrieved_contexts=retrieved_contexts
)
```
> metric 측정 — 4개 인자 전부 필요

<br>

```python
class NoiseSensitivity(BaseMetric):
    # ...

    async def ascore(
        self,
        user_input: str,
        response: str,
        reference: str,
        retrieved_contexts: List[str],
    ) -> MetricResult:
        # ...

        # Step 1: Decompose reference and response into statements
        gt_statements = await self._decompose_answer_into_statements(
            reference, user_input
        )
        ans_statements = await self._decompose_answer_into_statements(
            response, user_input
        )

        # Step 2: Evaluate statement faithfulness against each retrieved context
        gt_verdictslist = []
        ans_verdictslist = []

        for ctx in retrieved_contexts:
            gt_verdicts = await self._evaluate_statement_faithfulness(
                gt_statements, ctx
            )
            gt_verdictslist.append(np.array(gt_verdicts))

            ans_verdicts = await self._evaluate_statement_faithfulness(
                ans_statements, ctx
            )
            ans_verdictslist.append(np.array(ans_verdicts))

        # Step 3: Build matrices for computation (exact legacy shape handling)
        answers = {}
        answers["retrieved2ground_truth"] = np.array(gt_verdictslist).T
        answers["retrieved2answer"] = np.array(ans_verdictslist).T

        # Evaluate answer statements against reference (ground truth)
        gt_to_ans_verdicts = await self._evaluate_statement_faithfulness(
            ans_statements, reference
        )
        answers["ground_truth2answer"] = np.array(gt_to_ans_verdicts)
        answers["ground_truth2answer"] = np.array([answers["ground_truth2answer"]])

        answers = {k: v.astype(bool) for k, v in answers.items()}

        # Step 4: Compute noise sensitivity score
        score = self._compute_score(answers)

        return MetricResult(value=float(score))

    def _compute_score(self, answers: Dict) -> float:
        """Compute noise sensitivity score from faithfulness matrices."""
        incorrect = ~answers["ground_truth2answer"]

        # Compute relevant retrievals (needed for both modes)
        relevant_retrieved = np.max(
            answers["retrieved2ground_truth"], axis=0, keepdims=True
        )
        relevant_faithful = np.max(
            relevant_retrieved & answers["retrieved2answer"], axis=1
        )

        if self.mode == "irrelevant":
            irrelevant_retrieved = ~relevant_retrieved
            irrelevant_faithful = np.max(
                irrelevant_retrieved & answers["retrieved2answer"], axis=1
            )
            irrelevant_faithful &= ~relevant_faithful

            return float(np.mean(irrelevant_faithful & incorrect))

        else:  # mode == "relevant"
            return float(np.mean(relevant_faithful & incorrect))
```
> LLM 호출 횟수 (청크 N개 기준):
> - `_decompose_answer_into_statements`: 2번 — reference, response 각각 분해
> - `_evaluate_statement_faithfulness`: 청크당 2번(gt/ans) × N개 청크
> - 마지막 검증: 1번 — ans vs reference
>
> 총 **(2N + 3)번** — 6개 메트릭 중 호출 횟수가 가장 많다.

<br>

## 진단
| 패턴 | 해석 |
|---|---|
| relevant만 높음 | 검색은 관련 문서를 잘 가져오는데, 그 문서 안의 디테일이나 조건절을 잘못 일반화<br>- 문서의 노이즈 제거를 위해 청크 분할이나 생성 쪽 프롬프트를 점검 |
| irrelevant만 높음 | 무관한 문서가 자꾸 같이 검색되고, 그 내용을 답변에 섞어 씀<br>- Precision@K, Context Precision부터 확인 (검색 청결도 문제일 가능성) |
| noise는 낮은데 Faithfulness/Factual Correctness도 낮음 | 오류가 검색 결과 어디에도 근거 없는 순수 hallucination |

<br>

# 정리
Ragas 소스코드를 직접 뜯어보면서, 각 지표가 metric을 어떻게 측정하는지, LLM을 judge로 써서 measurement를 할 때 프롬프트는 어떤 식으로 설계하고 그 결과를 어떤 과정을 거쳐 점수로 환산하는지 이해할 수 있었다.

<br>

# 출처
- [Ragas Docs](https://docs.ragas.io/en/stable/)
- [Context Precision](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/)
- [Context Recall](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/)
- [Faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/)
- [Response Relevancy](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/answer_relevance/)
- [Factual Correctness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/factual_correctness/)
- [Noise Sensitivity](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/noise_sensitivity/)
