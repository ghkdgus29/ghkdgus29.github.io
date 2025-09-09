---
layout: post
author: Hyun 
title: Analysis of the Transformer architecture 
date:   2025-09-09 21:12:00 +0000
excerpt: "The Transformer architecture, introduced in the 2017 paper Attention Is All You Need, revolutionized natural language processing by addressing the limitations of RNNs and LSTMs. It introduced key innovations such as positional encoding and self-attention, enabling efficient parallel computation and the ability to capture long-range dependencies in sentences. These advancements have made the Transformer the foundation of modern large language models like GPT and LLaMA, driving faster training speeds and improved performance in NLP tasks."
categories:
 - Researching
 - Transformer
 - AI
---

# Natural Language Processing and the Transformer Architecture
The Transformer architecture was first introduced in the 2017 paper "Attention Is All You Need". 
Previously, RNN and LSTM, which were mainly used in the field of natural language processing, had the following problems:
- They had to process tokens sequentially, which slowed down the learning speed.
- When processing long sentences, there was a problem of forgetting tokens that were far apart from each other. 

<br>

The Transformer architecture effectively solved these two problems, and as a result, it is still mainly used in the field of natural language processing today.
Most LLMs, such as GPT family starting with GPT-2 and LLaMA, also used the Transformer architecture. (In the case of models that generate responses, they often seem to have a decoder-only structure.)

<br>

# Transformer Architecture Explanation
![model architecture](/assets/images/posts/250904.png)
> model architecture <br>
> The left is the encoder, the right is the decoder.

<br>

## Input Embedding
Converts tokens, which are strings recognizable by humans, into multi-dimensional vector values that can be recognized by a machine.

e.g.,<br> I -> [1, 0], <br> love -> [2, 3], <br> only -> [4, -2], <br> you -> [-1, -3]

<br>

## Positional Encoding
`I love only you`, `Only I love you` <br>
They are made up of the same words, but the order of the words makes them completely different sentences.
Even with the same word, its position in the sentence affects how the sentence is interpreted.
In other words, word order is important in language.

Therefore, Positional Encoding is additional information to indicate where a token is located in a sentence.

$$
PE(pos, 2i) =
sin\left(\frac{pos}{10000^{\frac{2i}{d_{\text{model}}}}}\right)
$$

$$
PE(pos, 2i+1) =
cos\left(\frac{pos}{10000^{\frac{2i}{d_{\text{model}}}}}\right)
$$

In the paper "Attention Is All You Need", the position information is incorporated by adding values from trigonometric function with varing frequencies-determined by the token's position _(pos)_ and the vector dimension _(i)_-to the previous input embedding result.

![positional embedding](/assets/images/posts/250904-2.png)

e.g., <br>
Assume the Positional Encoding value for the first token is [0, 1] <br>
The Positional Encoding value for the second token is [-0.93, 0.1] <br>
The Positional Encoding value for the third token is [-0.87, -0.9]  <br>
The Positional Encoding value for the fourth token is [0.2, 0.8] <br>

The third token in "I love only you" which is "only" becomes [4, -2] + [-0.87, -0.9] = [3.13, -2.9] when the PE value is added. <br>
The first token in "Only I love you", which is "only", becomes [4, -2] + [0, 1] = [4, -1] when the PE value is added. <br>

Thus, the same word can have different values based on its position. In other words, it reflects the position information in the sentence.

<br>

## Self-Attention (Multi-Head Attention)
Words are influenced by the other words that make up a given sentence. <br>
`The pizza came out of the oven and it tasted good.` <br>
In the given sentence, "it" is a pronoun that refers to a noun, so it could be "pizza" or "oven".
However, we know that "it" is "pizza". The reason is that we have seen the context of the entire sentence.

In other words, this means that the token "it" can understand the context of the sentence by calculating its relationship with all the tokens that make up the sentence, including itself. The mechanism by which each token calculates its importance with all the tokens that make up the sentence to understand which tokens are important and the context of the sentence is called Self-Attention.

![attention block](/assets/images/posts/250904-3.png)

<br>

### Scaled Dot-Product Attention
Each component of the Multi-Head Attention layer, and the smallest basic unit for calculating Self-Attention, is the Scaled Dot-Product Attention.
Three important terms appear here.

- query
  - A vector produced by applying a weight to the sum of the token embedding result and its positional encoding.

- key 
  - In the same way as the query, another weight is multiplied to obtain the key.

- value
  - In the same way as the query and key vectors, another weight is multiplied to obtain the value.
  - A vector that represents the characteristics of a word.

<br>

After scaling the vectors obtained by taking the dot product of the query with the key of other tokens so that they do not become too large, they are passed through the SoftMax function to be normalized as probabilities.
By multiplying this normalized probability by the value of each token, the importance between the tokens is finally calculated.

![scaled dot product example](/assets/images/posts/250905.png)
> Scaling omitted <br>
> The weights for calculating the query are the same regardless of the token. <br>
> The weights for calculating the key are the same regardless of the token. <br>
> The weights for calculating the value are the same regardless of the token. <br>

Since the key and value are fixed vectors for each token, there is no need to recalculate the key and value for each query.
Therefore, by storing the key and value in memory after their initial computation for the first query, subsequent attention operations can be performed more efficiently.
Storing the key and value in this way is called KV Cache.

<br>

## Memo on Masks
_This part is not accurate and needs to be supplemented with further study later._

I understood that the `Mask` is used in the training process within the decoder block.
The decoder must have an auto-regressive property, where it continuously produces results by feeding its previous output back as input.
However, the training dataset will have the complete correct answer that the decoder is supposed to output.

Therefore, for the decoder to generate the nth token, it should only see tokens from 0 to n-1. To prevent it from "cheating" by looking at future tokens, such as the (n+1)th token and beyond, I understood that the values from the (n+1)th token onwards are masked to negative infinity, effectively hiding them so they cannot be used in training. 
I believe I will understand this better with a deeper knowledge of the LLM learning process.

<br>

# Conclusion
The Transformer has made advancements in two major aspects compared to RNN and LSTM.

1. Through positional encoding, it became possible to add the order information within a given sentence all at once. The self-attention mechanism can calculate the relationships between each token at once, regardless of the distance between tokens in the sentence. Therefore, it solved the problem of inefficient information transfer when tokens are far apart within a sentence.

2. Through the self-attention mechanism, it became possible for all tokens within a sentence to calculate their relationships simultaneously and in parallel, regardless of the sentence order. This enabled parallel computation on GPUs, leading to faster training speeds compared to previous models like RNN that processed sequentially.

<br>

# Source 
- [Transformer Neural Networks, ChatGPT's foundation, Clearly Explained!!!](https://www.youtube.com/watch?v=zxQyTK8quyY&t=1550s)
- [Attention Is All You Need](/assets/attachments/attention_is_all_you_need.pdf)