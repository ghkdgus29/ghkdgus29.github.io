---
layout: post
author: Hyun 
title: Analyzing Ragas' RAG Evaluation Metrics
date:   2026-09-20 00:00:00 +0900
excerpt: "A source-code-level breakdown of Ragas' evaluation metrics"
categories:
 - Research
 - RAG
 - Evaluation
lang: en
lang_ref: /Understanding-RAG-Evaluation-Metrics-with-Ragas-KR/
---

# Introduction
What matters more than building a RAG pipeline is evaluating it. Getting a pipeline to just work isn't hard. But decisions like whether to add a reranker, change the chunking strategy, or tweak a prompt can only be made once you can tell whether things have actually gotten better than before. That's what a baseline is for, and only once you have one can you actually improve and tune the system.

The problem is that this is hard to judge by feel. Whether it's retrieval, generation, or simply that no relevant document existed in the first place — you can't tell just by looking at a single answer. [Ragas](https://github.com/explodinggradients/ragas) is an evaluation framework that helps you easily test which stage of the pipeline is at fault.

This post breaks down the 7 metrics Ragas provides (Context Precision, Precision@K, Context Recall, Faithfulness, Response Relevancy, Factual Correctness, Noise Sensitivity) one by one, with examples and source-level analysis, and summarizes what each metric actually means.

<br>

# Context Precision (Average Precision)
- A metric for how well the retrieved chunks are ranked. Different from the Precision@K used in IR.
- Formula: `Σ(Precision@k × relevance_k) / (total number of relevant items)`

<br>

## Example
Question: "When do I need to attach a receipt for travel expenses?"

reference: "You must attach a receipt if travel expenses exceed $100."

Retrieved chunks:
- Chunk 1 (1st, irrelevant): "Employees get 15 days of annual leave per year."
- Chunk 2 (2nd, relevant): "You must attach a receipt if travel expenses exceed $100."

<br>

Calculation:
```
k=1, precision@1 = 0/1 = 0, relevance_1 = 0
k=2, precision@2 = 1/2 = 0.5, relevance_2 = 1

AP = ((0 * 0) + (0.5 * 1)) / 1 = 0.5
```

We did retrieve one relevant document, but just because it landed in 2nd place, the score drops to 0.5. If that same document had been ranked 1st, `precision@1=1.0` would carry straight into the numerator and AP would come out to 1.0. Also, if the very first document retrieved is relevant, the score is a perfect 1.0 no matter how many irrelevant documents come after it.

<br>

## Ragas Source Analysis
```python
metric = ContextPrecision(llm=get_judge_llm())
```
> Instantiates `ContextPrecision`

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
> `ContextPrecision`'s parent class

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
> Builds the few-shot prompt

<br>

```python
result = await metric.ascore(
    user_input=QUESTION, reference=REFERENCE, retrieved_contexts=retrieved_contexts
)
```
> Measures the metric

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
> Verifies whether each individual `retrieved_contexts` was necessary to produce the reference, then computes AP while preserving that order

<br>

## Diagnosis

| Context Precision (AP) | Interpretation |
|---|---|
| Low | Check the retrieval logic<br>- Add reranking, or check whether the similarity score calculation itself has a problem |

<br>

# Precision@K
- The proportion of documents among the top K retrieved that are actually relevant.
- `TP / (TP + FP) = (number of relevant documents among the top K retrieved) / K`

<br>

## Example
Question: "When do I need to attach a receipt for travel expenses?"

reference: "You must attach a receipt if travel expenses exceed $100."

Retrieved chunks:
- Chunk 1 (1st, irrelevant): "Employees get 15 days of annual leave per year."
- Chunk 2 (2nd, relevant): "You must attach a receipt if travel expenses exceed $100."

<br>

Calculation:
```
Precision@2 = 1 / (1 + 1) = 0.5
```

Unlike Context Precision, order isn't considered at all here. Whether chunk 1 comes first or second, the result is the same.

<br>

## Implementation
Ragas doesn't provide this out of the box, so you have to implement it yourself. Just take the verdicts obtained from `ContextPrecisionPrompt` and average them, with no regard to order.

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

## Diagnosis

| Context Precision (AP) | Precision@K | Interpretation |
|---|---|---|
| High | Low | The correct document is ranked high, but the remaining top-K slots are filled with irrelevant chunks<br>- Lower top-k, or adjust the reranker cutoff |
| Low | Low | A problem with the retriever itself<br>- Check the embeddings or the index |

<br>

# Context Recall
- The textbook definition of recall is `TP / (TP + FN) = (number of relevant documents retrieved) / (total number of relevant documents)`.
- But annotating which documents across an entire corpus are relevant for every single reference isn't realistic.
- So Ragas splits the reference into individual claims, and computes the fraction of those statements that can be inferred from the retrieved documents. In other words, it measures whether the retriever missed any evidence needed to produce the correct answer.
- `(number of reference claims supported by the retrieved documents) / (total number of reference claims)`

<br>

## Example
Question: "When do I need to attach a receipt for travel expenses?"

reference: "You must attach a receipt if travel expenses exceed $100. Lodging always requires a receipt."
- R1: attach a receipt when travel expenses exceed $100
- R2: lodging always requires a receipt

<br>

Retrieved chunks:
- Chunk 1: "You must attach a receipt if travel expenses exceed $100."
- Chunk 2: "Meeting rooms are booked through the calendar."

<br>

Calculation:
```
R1 → supported by chunk 1 → attributed = 1
R2 → not found in any chunk → attributed = 0

recall = (1 + 0) / 2 = 0.5
```

The reference was split into 2 sentences, but the retrieved chunks only support 1 of them (R1), so recall comes out to 0.5. Order doesn't matter here either.

<br>

## Ragas Source Analysis
```python
metric = ContextRecall(llm=get_judge_llm())
```
> Instantiates `ContextRecall`

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
> Builds the few-shot prompt

<br>

```python
result = await metric.ascore(
    user_input=QUESTION, retrieved_contexts=retrieved_contexts, reference=REFERENCE
)
```
> Measures the metric

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
> Splits the reference into claims, verifies whether each claim can be inferred from the chunks, then computes context recall

<br>

## Diagnosis

| Context Precision | Context Recall | Interpretation |
|---|---|---|
| High | Low | top-k is likely too small, or the retriever is probably missing other evidence needed to construct the answer<br>- Check the document itself, e.g. its chunking strategy |
| Low | Low | The retrieval pipeline as a whole needs a check |

<br>

# Faithfulness
- The proportion of claims in the answer that can be inferred from the retrieved documents alone.
- Doesn't compare against the reference. A pure hallucination-detection metric that checks whether the response actually came from the context.
- `(number of response claims supported by the retrieved documents) / (total number of response claims)`

<br>

## Example
Question: "When do I need to attach a receipt for travel expenses?"

Retrieved chunk: "You must attach a receipt if travel expenses exceed $100."

response: "You must attach a receipt if travel expenses exceed $100. Lodging also always requires a receipt."
- A: attach a receipt when travel expenses exceed $100
- B: lodging also always requires a receipt

<br>

Calculation:
```
A → directly inferable from the chunk → verdict = 1
B → the chunk never mentions lodging at all → verdict = 0

faithfulness = (1 + 0) / 2 = 0.5
```

It doesn't matter that B might actually be true (i.e. it appears in the reference). Faithfulness doesn't look at the reference at all — it only asks "can this claim be inferred from the currently retrieved chunks?" In other words, it measures "was this said without evidence," not "was this answer wrong."

<br>

## Ragas Source Analysis
```python
metric = Faithfulness(llm=get_judge_llm())
```
> Instantiates `Faithfulness`

<br>

```python
class Faithfulness(BaseMetric):
    # ...

    def __init__(self, llm: "InstructorBaseRagasLLM", name: str = "faithfulness", **kwargs):
        self.llm = llm
        self.statement_generator_prompt = StatementGeneratorPrompt()  # step 1: for splitting into statements
        self.nli_statement_prompt = NLIStatementPrompt()               # step 2: for NLI verdicts

        super().__init__(name=name, **kwargs)
```
> `Faithfulness`'s constructor

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
> A few-shot prompt that guides breaking a given sentence down into a list of "self-contained statements with no pronouns"

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
> A few-shot prompt that guides verifying whether each statement is derived from the context

<br>

```python
result = await metric.ascore(
    user_input=QUESTION, response=RESPONSE, retrieved_contexts=retrieved_contexts
)
```
> Measures the metric <br>
> Unlike Context Precision/Recall, this one takes `response` instead of `reference`

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
> Splits the response into statements, then judges all of them at once against a single merged block of context, and computes the faithfulness ratio

<br>

## Diagnosis
Tests the generation stage for hallucination.

| Retrieval performance | Faithfulness | Interpretation |
|---|---|---|
| Low | Low | Means the retrieved documents were simply not relevant at all, forcing the agent to make things up<br>- Start by checking retrieval |

<br>

# Response Relevancy
- Checks how well the answer responds to the shape of the question.
- Working backward from just the response, it infers "what question was this answer originally for," generates `strictness` (=N) such synthetic questions, and computes how similar those synthetic questions are to the original question in embedding space.
- `Answer Relevancy = (1/N) × Σᵢ cos_sim(Eᵢ, Eₒ)` (Eᵢ = embedding of the i-th synthetic question, Eₒ = embedding of the original question)
- Uses neither retrieved_contexts nor reference. It can be computed with just the response and the user_input.

<br>

## Example
Question: "When do I need to attach a receipt for travel expenses?"

response: "You must attach a receipt if travel expenses exceed $100."

Calculation (strictness=3, the LLM generates 3 synthetic questions from the response alone):
```
Synthetic question 1: "When do I need to attach a receipt for travel expenses?"       sim = 0.95
Synthetic question 2: "Above what amount do I need a receipt for travel expenses?"     sim = 0.90
Synthetic question 3: "What's the threshold amount for attaching a receipt?"           sim = 0.85

noncommittal is 0 for all three (none of them are evasive)
score = mean(0.95, 0.90, 0.85) * 1 = 0.90
```

<br>

## Ragas Source Analysis
```python
metric = AnswerRelevancy(llm=get_judge_llm(), embeddings=get_judge_embeddings())
```
> Instantiates `AnswerRelevancy`

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
> Constructor — `strictness` (default 3) determines how many synthetic questions to generate from the response

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
> The prompt — takes `response` as input and outputs `{question, noncommittal}` <br>
> If the response is hard to answer, noncommittal=1

<br>

```python
result = await metric.ascore(user_input=QUESTION, response=RESPONSE)
```
> Measures the metric

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
> Calls the LLM `strictness` times to generate questions from the response <br>
> Returns a score of 0 if every generated question turns out noncommittal

<br>

## Diagnosis

| Faithfulness / Factual Correctness | Response Relevancy | Interpretation |
|---|---|---|
| Low | High | The failure mode of "sounding plausible while the content is actually wrong" |
| Low | Low | Either missed the point of the question entirely, or the answer dodged it |

<br>

# Factual Correctness
- Computes how factually consistent the final answer is with the reference, using Precision/Recall/F1.
- Doesn't look at retrieved_contexts at all. Whether retrieval was messy or clean, it only evaluates the final result.
- Splits response and reference into claims each, and derives TP, FP, FN as follows:
  - TP = response claims that are present in the reference
  - FP = response claims that are not present in the reference
  - FN = reference claims that are not present in the response
- Defaults to F1 (`mode="f1"`).
- In contrast to Faithfulness, which verifies the response against retrieved_contexts without looking at reference, Factual Correctness verifies the response against reference without looking at retrieved_contexts.

<br>

## Example
Question: "When do I need to attach a receipt for travel expenses?"

reference: "You must attach a receipt if travel expenses exceed $100. Lodging always requires one."

response: "You must attach a receipt if travel expenses exceed $100. Lodging only requires one for stays of 3 nights or more."

Calculation (mode="f1"):
```
Decompose response into claims → verify against reference
  A (attach a receipt when travel expenses exceed $100) → supported by reference → verdict=1
  B (lodging required for stays of 3+ nights) → contradicts reference's "always required" → verdict=0
  tp = 1, fp = 1

Decompose reference into claims → verify against response
  R1 (attach a receipt when travel expenses exceed $100) → covered by response → verdict=1
  R2 (lodging always required) → response says "3+ nights only," a contradiction → verdict=0
  fn = 1 (R2 not covered)

precision = tp / (tp+fp) = 1/2 = 0.5
recall    = tp / (tp+fn) = 1/2 = 0.5
f1        = 2 × 0.5 × 0.5 / (0.5+0.5) = 0.5
```

<br>

## Ragas Source Analysis
```python
metric = FactualCorrectness(llm=get_judge_llm())  # defaults to mode="f1"
```
> Instantiates `FactualCorrectness`

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
> Constructor — 2 prompts (one for claim decomposition, one for NLI verification). <br>
> `atomicity`/`coverage` control how finely or broadly claims get split.

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
> `NLIStatementPrompt` is completely identical to the one used in Faithfulness/Noise Sensitivity. <br>
> atomicity is how finely claims get split up <br>
> coverage is how much of the original sentence ends up reflected in the claims

<br>

```python
result = await metric.ascore(response=RESPONSE, reference=REFERENCE)
```
> Measures the metric

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
> - splits the response into claims and verifies whether each is present in the reference <br>
> - computes TP, FP <br>

> `response_reference = await self._decompose_and_verify_claims(reference, response)` <br>
> - splits the reference into claims and verifies whether each is present in the response <br>
> - computes FN

<br>

## Diagnosis

| Faithfulness | Factual Correctness | Interpretation |
|---|---|---|
| High | High | Normal — grounded in the retrieved documents and consistent with the correct answer |
| High | Low | The retrieved document's content was faithfully carried over (no hallucination), but the document itself was wrong, or the wrong document was retrieved entirely<br>- A retrieval problem |
| Low | Low | Made something up that isn't even in the retrieved documents, and it's wrong compared to the reference too |
| Low | High | Said something that isn't in the retrieved documents, but it happens to match the reference anyway<br>- The model likely answered from its own baked-in knowledge and ignored the retrieval results |

<br>

# Noise Sensitivity
- Checks whether the answer went wrong because of noise in the "relevant" retrieved documents (`mode="relevant"`), or because it got thrown off by "irrelevant" documents (`mode="irrelevant"`).
- Faithfulness/Factual Correctness only tell you "wrong" vs. "not wrong," but this metric goes further and distinguishes what kind of retrieved result the error actually came from.
- Splits the response and the reference into statements each, then for every retrieved chunk, runs an NLI judgment (an inferability check) for both statement sets against that chunk.
  - `noise sensitivity (relevant) = (number of response claims that disagree with the reference but are supported by a **relevant** document) / (total number of response claims)`
  - `noise sensitivity (irrelevant) = (number of response claims that disagree with the reference but are supported only by an **irrelevant** document) / (total number of response claims)`

<br>

## Example
Question: "When do I need to attach a receipt for travel expenses?"

reference: "You must attach a receipt if travel expenses exceed $100."

Retrieved chunks:
- Chunk 1 (relevant, supports the reference): "You must attach a receipt if travel expenses exceed $100."
- Chunk 2 (irrelevant, unrelated to the reference): "Employees get 15 days of annual leave per year."

<br>

response: "You must attach a receipt if travel expenses exceed $100. Employees get 15 days of annual leave per year."
- A: attach a receipt when travel expenses exceed $100 — matches the correct answer
- B: employees get 15 days of annual leave per year — unrelated to the question, but matches chunk 2 exactly

<br>

Calculation:
```
A → matches the reference → not a "wrong statement" → not counted under either mode
B → doesn't match the reference → a "wrong statement" → which chunk it came from now matters

  B is absent from chunk 1 (relevant), but appears in chunk 2 (irrelevant) verbatim → B is a wrong answer that came from the irrelevant document

relevant   = (wrong, and came from a relevant document) / total = 0 / 2 = 0.0
irrelevant = (wrong, and came from an irrelevant document) / total = 1 / 2 = 0.5
```

Same response, same retrieved chunks — yet the two modes produce completely different scores.

<br>

## Ragas Source Analysis
```python
relevant_metric = NoiseSensitivity(llm=get_judge_llm(), mode="relevant")
irrelevant_metric = NoiseSensitivity(llm=get_judge_llm(), mode="irrelevant")
```
> The two modes are **the exact same class** — only the `mode` parameter differs

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
> Constructor — the two prompts are separate classes from Faithfulness's (defined in their own `noise_sensitivity` module), but internally they call shared helper functions (`statement_generator_prompt`/`nli_statement_prompt`) that reproduce the exact same instruction and examples, so they end up **producing the same shape of prompt as Faithfulness**.

<br>

```python
result = await metric.ascore(
    user_input=QUESTION, response=RESPONSE, reference=REFERENCE, retrieved_contexts=retrieved_contexts
)
```
> Measures the metric — all 4 arguments are required

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
> Number of LLM calls (for N retrieved chunks):
> - `_decompose_answer_into_statements`: 2 calls — decomposing the reference and the response separately
> - `_evaluate_statement_faithfulness`: 2 calls per chunk (gt/ans) × N chunks
> - one final verification call: ans vs reference
>
> Total: **(2N + 3) calls** — the highest call count of the 6 metrics.

<br>

## Diagnosis

| Pattern | Interpretation |
|---|---|
| relevant only high | Retrieval pulls in relevant documents fine, but over-generalizes the details or conditional clauses inside them<br>- To remove noise from the documents, check the chunking strategy or the generation-side prompt |
| irrelevant only high | Irrelevant documents keep getting retrieved too, and their content leaks into the answer<br>- Start by checking Precision@K and Context Precision (likely a retrieval-cleanliness problem) |
| noise is low, but so are Faithfulness/Factual Correctness | The error is pure hallucination, with no grounding in any of the retrieved results |

<br>

# Summary
Going through the Ragas source code directly, I came to understand how each metric actually measures things, how you design a prompt when using an LLM as a judge for the measurement, and what process the results go through to become a score.

<br>

# Sources
- [Ragas Docs](https://docs.ragas.io/en/stable/)
- [Context Precision](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/)
- [Context Recall](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/)
- [Faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/)
- [Response Relevancy](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/answer_relevance/)
- [Factual Correctness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/factual_correctness/)
- [Noise Sensitivity](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/noise_sensitivity/)
