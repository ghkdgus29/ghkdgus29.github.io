---
layout: post
author: Hyun 
title: 트랜스포머 구조 분석 
date:   2025-09-09 21:12:00 +0000
excerpt: "The Transformer architecture, introduced in the 2017 paper Attention Is All You Need, revolutionized natural language processing by addressing the limitations of RNNs and LSTMs. It introduced key innovations such as positional encoding and self-attention, enabling efficient parallel computation and the ability to capture long-range dependencies in sentences. These advancements have made the Transformer the foundation of modern large language models like GPT and LLaMA, driving faster training speeds and improved performance in NLP tasks."
categories:
 - Research
 - Transformer
 - AI
lang: kr
lang_ref: /Analysis-of-the-Transformer-architecture-EN/
---

# 자연어 처리와 Transformer 구조 
트랜스포머 구조는 2017년 논문 Attention is All You Need에서 처음 소개된 구조이다.
기존 자연어 처리 분야에서 주로 사용하던 RNN와 LSTM은 다음과 같은 문제점들이 있었다.
- 토큰을 순차적으로 처리해야해서, 학습 속도가 느렸다.
- 긴 문장을 처리하게 되면, 서로 먼 거리에 위치한 토큰들을 망각하는 문제가 있었다. 

트랜스포머 구조는 위 두가지 문제점을 효과적으로 해결함으로써, 현재까지도 자연어 처리 분야에서 주로 사용된다.

GPT-2부터 이어진 GPT family나 Llama와 같은 대부분의 LLM 역시 Transformer 구조를 사용하고 있다. (응답을 생성하는 모델들의 경우, decoder-only 구조인 경우가 많아보인다.)

<br>

# Transformer 구조 설명
![model architecture](/assets/images/posts/250904.png)
> model architecture <br>
> 왼쪽이 encoder, 오른쪽이 decoder

<br>

## Input Embedding
사람이 인식할 수 있는 문자열인 토큰을 기계가 인식할 수 있는 다차원 벡터값으로 변환한다.

ex) <br> I -> [1, 0] <br> love -> [2, 3] <br> only -> [4, -2] <br> you -> [-1, -3]

<br>

## Positional Encoding
`I love only you`, `Only I love you`  <br>
같은 단어들로 이루어져 있지만, 단어의 순서에 의해 완전히 다른 의미의 문장이 된다. 
같은 단어더라도 문장에서 위치가 어디냐는, 문장을 해석하는데 영향을 준다. 
즉, 언어에서 단어 순서는 중요하다. 

따라서, 문장에서 토큰이 어디에 위치해있는지를 나타내기 위한 추가 정보가 바로 Positional Encoding이다. 

$$
PE(pos, 2i) = \sin\left(\frac{pos}{10000^{\frac{2i}{d_{\text{model}}}}}\right)
$$

$$
PE(pos, 2i+1) = \cos\left(\frac{pos}{10000^{\frac{2i}{d_{\text{model}}}}}\right)
$$

Attention is All You Need 논문에선 다음과 같이 토큰의 위치(pos)와 벡터 차원(i)에 따라 삼각함수의 주파수를 바꾼값을 앞선 Input Embedding 결과값에 더해주어 위치 정보를 추가한다.

![pe](/assets/images/posts/250904-2.png)

ex) <br>
첫 번째 토큰에 대한 Positional Encoding 값이 [0, 1] <br>
두 번째 토큰에 대한 Positional Encoding 값이 [-0.93, 0.1]
세 번째 토큰에 대한 Positional Encoding 값이 [-0.87, -0.9]
네 번째 토큰에 대한 Positional Encoding 값이 [0.2, 0.8] 이라고 가정 <br>

I love only you의 세 번째 토큰인 only는 PE값을 더하면 [4, -2] + [-0.87, -0.9] = [3.13, -2.9] <br>
Only I love you의 첫 번째 토큰인 only는 PE값을 더하면 [4, -2] + [0, 1] = [4, -1] <br>

이처럼 같은 단어더라도, 위치에 따라 다른 값을 가질 수 있게 된다. 즉, 문장에서의 위치 정보를 반영하게 된다.

<br>

## Self-Attention (Multi-Head Attention)
단어는 주어진 문장안의 구성된 단어들의 영향을 받는다. <br>
`The pizza came out of the oven and it tasted good.`
주어진 문장에서 it은 명사를 지칭하는 대명사이기에 pizza일 수도 있고, oven일 수도 있다.
하지만 우리는 it이 pizza임을 알 수 있다. 그 이유는 문장 전체의 맥락을 보았기 때문이다. 

이는 다시말해, it 이라는 토큰은 자기 자신을 포함한, 문장을 이루는 모든 토큰들과의 연관성을 계산함으로써 문장의 맥락을 이해할 수 있음을 나타낸다.

각 토큰이, 문장을 이루는 모든 토큰들과의 중요성을 계산함으로써 어떤 토큰이 중요하고, 문장의 맥락을 이해하는 메커니즘을 Self-Attention이라 한다. 

![attention block](/assets/images/posts/250904-3.png)

<br>

### Scaled Dot-Product Attention
Multi-Head Attention layer의 각 구성요소이자, Self-Attention을 계산하는 가장 작은 기본단위는 Scaled Dot-Product Attention이다. 
이곳에선 3가지 중요한 용어가 등장한다.

- query
  - 토큰 임베딩 값에 positional encoding을 더해 구한 값에, 다른 가중치를 곱하여 얻은 값

- key
  - query와 같은 방식으로 또 다른 가중치를 곱하여 key를 얻는다

- value 
  - query, key값과 같은 방식으로 또 다른 가중치를 곱하여 value를 얻는다.
  - 단어의 특징을 나타내는 값 

query값을 다른 토큰들의 key값과 내적하여 얻은 값들이 너무 커지지 않게 스케일링 후, SoftMax 함수를 통과시켜 확률로서 정규화한다.
이 정규화된 확률을 각 토큰들의 value와 곱해줌으로써 최종적으로 토큰들간의 중요도를 산출해낸다. 

![img](/assets/images/posts/250905.png)
> 스케일링 생략
> query를 계산하는 weight, key를 계산하는 weight, value를 계산하는 weight는 토큰과 상관없이 동일하다. 



key, value는 각 토큰이 갖는 고정된 값이므로 매 query마다 다른 토큰의 key, value를 재계산할 필요없다. 
따라서, key, value는 첫 번째 query에 대한 attention을 계산할 때 최초로 계산한 뒤에는 메모리에 저장함으로써 두 번째 query부터는 더욱 빠르게 attention을 계산할 수 있다.
이렇게 key, value를 저장하는 것을 KV Cache라 한다.

<br>

#### Masking
decoder는 앞선 출력을 다시 입력으로 되먹이며 응답을 생성해내는 auto-regressive 속성을 가져야한다. 따라서, 시퀸스에서 선행 토큰은 후행 토큰의 값에 영향을 받아선 안된다. 
즉, 후행 토큰에 의해 앞에 위치한 선행 토큰의 attention 값이 바뀌어선 안된다.

이를 위해, 의도적으로 후행 토큰들의 key와의 내적값을 음의 무한대로 마스킹하여 후행 토큰이 영향을 주는 것을 방지한다. 정리하면, decoder는 n 번째 토큰을 만들기 위해 0 ~ n-1 번째 토큰만 고려한다.

![immmg](/assets/images/posts/250919.png)
> n 번째 토큰의 query값은, n+1 번째 이후의 토큰의 key값을 고려하지 않는다. 

<br>

## Encoder와 Decoder의 차이점
Decoder는 Decoder가 앞서 만들어 낸 output 토큰 값을 다시금 input 토큰으로 간주하여, 다음 토큰을 계속해서 생성해내는 auto-regressive 구조이다. 

또한 Encoder의 결과값들까지 input으로 사용하여 Self-Attention을 추가적으로 계산하는데, 이는 Encoder에 들어온 input에 대한 정보가 희석되지 않도록 하기 위함이다.
이 과정을 Encoder-Decoder Attention이라 한다.

Decoder는 문장 생성의 끝마침을 의미하는 EOS토큰이 나올때까지 토큰 생성을 반복한다.

<br>

# 결론
Transformer는 RNN, LSTM과 비교하여 크게 2가지 측면에서 발전을 이루었다.

1. positional encoding을 통해 주어진 문장안의 순서 정보를 한번에 추가할 수 있게 되었다. self attention 메커니즘은 주어진 문장에서 토큰 간의 거리와 상관없이 각 토큰들간의 관계성을 한번에 계산할 수 있다. 따라서 문장 안에서 토큰간의 거리가 멀어 정보 전달이 효율적으로 되지 않는 문제를 해결하였다.

2. self attention 메커니즘을 통해, 문장의 순서와 상관없이 문장 안의 모든 토큰들이 동시에 병렬적으로 관계성을 계산할 수 있게 되었다. 이는 GPU의 병렬 계산을 가능하게 함으로써 순차적으로 처리되었던 기존 RNN과 같은 모델 대비 빠른 학습속도를 이끌어냈다. 

<br>

# 출처
- https://www.youtube.com/watch?v=zxQyTK8quyY&t=1550s
- [Attention Is All You Need](/attachments/attention_is_all_you_need.pdf)
- [지연 시간 순삭! LLM 추론 구조와 효율적 애플리케이션 설계 / if(kakaoAI)2024](https://tech.kakaoent.com/tech/ifkakao-2024-llm/)