---
title: Chapter 5. 语法分析 - 概念介绍与类型解析
---

本章，我们终于要正式踏入 **语法分析（parsing）**  的世界。

在第 4 章中，我们已经实现了一个功能完备的词法分析器：
它接收一整段源代码字符串，输出一串排好队的 Token 序列。
从“纯文本”走到“Token 序列”，你可以把它理解为：我们已经把原本模糊的一团墨迹，切分成了一个个清晰的“字”和“词”。

接下来，语法分析要做的事情，则是把这些“词”按照 MiniMoonBit 的语法规则重新组织起来，构造出一棵 **抽象语法树（AST, Abstract Syntax Tree）** 。
从本章开始直到后面几章，你会反复看到“树”这个词——因为语法分析、类型检查、代码生成，几乎都在和各种不同层次的树打交道。

本章的目标主要有三个：

- **从直觉出发，理解什么是语法分析，以及它和 BNF/EBNF 的关系；**
- **讨论一个常见问题：在今天这个工具极其丰富的时代，还有必要手写 Parser 吗？**
- **以“类型（Type）解析”为切入点，完整走一遍一个具体语法子系统的设计、错误处理与测试流程。**

后续章节会继续扩展到表达式、语句、顶层定义等更复杂的结构。本章你可以把注意力集中在“类型解析”这一条线上，体会语法分析的基本方法。

---

## 什么是语法分析

在很多传统教材里，讲到语法分析时，往往会先把一整页的 **BNF** 或 **EBNF** 语法列在读者面前，然后逐条解释这些产生式的含义。
BNF/EBNF 的形式化确实很重要，但如果一开始就堆给读者，容易让人觉得又枯燥又抽象。本书会走一条更接地气的路线：**先用直觉理解“分组”和“分层”，再把这种直觉和 BNF/EBNF 联系起来。**

### 从 Token 的“分组”开始

回顾一下第 4 章中的一个例子：

```moonbit
let mut x : Int = 1 + 2;
```

词法分析阶段，我们已经把这一串字符切成了若干 Token，大致是：

```plaintext
"let"  "mut"  "x"  ":"  "Int"  "="  "1"  "+"  "2"  ";"
```

从语法分析的角度看，这 10 个 Token 首先整体上构成了一个“更大的单元”，我们可以给它起一个名字，比如：

- `LetMutStmt`：代表一条带 `mut` 的变量声明语句（`Stmt` 是 Statement 的缩写）

如果用一种接近 BNF 的方式描述它，大致可以写成：

```plaintext
let_mut_stmt :
  "let" "mut" lower (":" type)? "=" expr ";"
```

其中：

- `lower`：表示以小写字母开头的标识符（`x`）
- `type`：表示一个类型（`Int`）
- `expr`：表示一个表达式（`1 + 2`）
- `(: type)?`：表示“冒号 + 类型”这一段是可选的

从“分组”的角度看，同一组 Token 同时扮演了不同层次的角色：

- `Int` 既是一个 `type`，也是这条 `let_mut_stmt` 的一部分；
- `1`、`+`、`2` 共同构成了一个 `expr`，同时也嵌套在这条语句内部。

如果我们把这种“分组 + 分层”的过程画成一棵树，就得到了所谓的 **语法树（parse tree / AST）** 。
BNF / EBNF 所做的事情，本质上就是用一种形式化的方式，描述“这一层怎样由下一层的若干部分组合而成”的规则。

> （本书不会对 BNF/EBNF 做过于形式化和系统的介绍。
> 你只需要把它们当作“描述 Token 如何归类与分层的规则语言”就足够了。
> 真正重要的是体会：**语法分析就是在这套规则的指导下，不断把 Token 归类成更大粒度的结构，最终形成一棵 AST。** ）

---

## 有必要手写 Parser 吗

几乎每一轮给同学或同事讲编译器入门时，我都会被问到一个问题：

> **今天已经有那么多成熟的语法分析工具了（ANTLR、Yacc/Bison、tree-sitter……），为什么还要自己手写 Parser 呢？**

这是一个非常现实、也非常重要的问题。
在工程实践中，确实有不少正式的商业项目直接使用这些工具；很多资深工程师也会认为：

- 自动生成的 Parser 更容易维护：只要改语法文件就好；
- 手写 Parser 容易引入 Bug，而且一旦出错，排查成本很高；
- 从人力成本和交付压力来看，使用成熟工具似乎是更理性的选择。

这些观点都**有一定道理**。本书并不是要否定语法工具的价值——恰恰相反，日后当你对编译器各个阶段都足够熟悉之后，合理使用这些工具，往往可以大幅提升生产效率。

但是，对我个人来说，有一个始终没有变过的态度：

- **在学习和掌握一门语言实现的过程中，我强烈建议你至少亲手实现一次 Parser。**

原因有两类：一类是比较“技术向”的，另一类则更偏“工程哲学”。

### 技术层面的理由

从纯技术角度看，手写 Parser 带来的一些好处往往在“第一印象”中并不明显，但在实践中却非常关键：

- **更灵活的错误处理与错误恢复**

  - 你可以在语法分析的任何一点，结合上下文灵活地构造错误信息；
  - 可以根据需要，在某些结构上实现更精细的错误恢复策略；
  - 对于教学项目，更容易展示“错误是怎样一步步传播与被截断的”。
- **自然地融合语法糖（desugaring）**

  - 很多高级语言在语法上提供各种方便的语法糖；
  - 手写 Parser 时，我们可以在“刚刚识别出某个结构”的时候，就顺手把它转换成核心形式，而不必再绕一大圈；
  - 这种“就地解糖”的方式，在阅读和调试时也更直观。
- **对语言语义有更直接的控制**

  - 一些语义上微妙的特性（比如模式匹配的覆盖性检查、局部上下文相关的语法）往往难以完全通过自动工具来表达；
  - 手写 Parser 时，你可以非常清楚地知道“在这一行代码上，编译器到底看到了什么、做了什么假设”。

当然，现代语法分析工具也在不断演进，很多问题都可以通过扩展机制解决。
真正关键的不是“工具一定不好”，而是：**如果你从没手写过 Parser，就很难真正理解工具生成的 Parser 在做什么，更难判断某个诡异的 Bug 究竟是工具的问题，还是你自己的语法规则写错了。**

### 工程哲学层面的理由：编译器是“严肃的程序”

还有一个我更看重的理由，和“编译器到底是什么样的一类软件”有关。

编译器和很多日常软件非常不一样：

- 做一个 Web 应用，你可以不知道操作系统内核的细节，只要 HTTP 请求/响应逻辑正确，业务就能跑；
- 做一个游戏，你可以不了解底层图形管线的所有细节，也照样能写出好玩的作品；
- 这些软件的 Bug 往往“只”会导致崩溃、界面异常或者数据不一致，严重当然也很严重，但通常是可恢复的。

而编译器则不同：

- **它是整个软件栈的“基础设施”之一**。
  一个微小的编译器 Bug，可能就意味着整个目标平台上所有依赖它的程序都有风险。
- 在很多场景下，**编译器 Bug 很难被察觉**。
  源代码看上去完全正确，测试也没覆盖到那一条奇怪的优化路径，只有在某个极端输入下才会暴露问题。

> 你可能注意到一个有趣的现象：
> 历史上“由编译器 Bug 直接导致的重大事故”案例并不多见。
> 这并不是因为编译器天生简单、容易写对，而是因为——
>
> - **绝大多数带有明显 Bug 的编译器，根本撑不到大规模商用就会被淘汰掉。**
> - 能进入生产环境、被广泛使用的编译器，背后都经过了长时间的验证和大量用户的“实战考验”。
>
> 换言之，这是一种类似“飞机为何很少失事”的幸存者偏差：
> 我们只看到了那些极为稳定、可靠的“幸存者”，而无数曾经不够稳定的实现，早就悄无声息地消失在历史里了。

即便如此，历史上还是出现过几起**确实由编译器或编译优化引发的严重安全问题或巨额损失**。下面挑几例做一个简要的介绍。

### 案例 1：Vyper 编译器 Bug 与 Curve Finance（2023）

- **背景**：
  Vyper 是一门为以太坊智能合约设计的高级语言，语法风格类似 Python。
  Curve Finance 则是 DeFi 领域的一个重要项目。
- **出错点**：
  某些版本的 Vyper 编译器（例如 0.2.15, 0.2.16, 0.3.0）在处理一个用于防止“重入攻击”（reentrancy attack）的修饰器（通常记作 `@nonreentrant`）时存在实现缺陷。
  在源代码层面，合约作者使用了标准的写法，逻辑上没有问题；但编译器在生成字节码时，**没有正确地实现这层保护机制**。
- **后果**：
  攻击者利用这一点，对若干资金池发起重入攻击，从中反复提取资金。
  公共报道中提及的损失规模大致在数千万美元量级。

这个案例非常典型地体现了“源代码是正确的，但编译器翻译错了”会带来什么后果：
合约审计人员、项目方、用户都很难在事前发现问题——因为大家看到的都是“看上去完全没问题的源码”，而真正的危险藏在了编译器生成的字节码里。

### 案例 2：Linux 内核与 GCC 优化（2009 左右）

第二类问题则和  **“激进优化”**  有关，其中一个广为人知的例子发生在 Linux 内核与 GCC 之间。

- **背景**：
  在内核代码中，开发者通常会显式检查指针是否为 `NULL`，以防止非法访问内存：

  ```c
  if (ptr == NULL)
      return -EINVAL;
  /* 下面安心使用 ptr */
  do_something(ptr->field);
  ```
- **编译器的“推理”** ：
  C 语言标准规定：一旦程序解引用了空指针，行为就是未定义（Undefined Behavior）。
  某些版本的 GCC 在看到“已经通过 `ptr->field` 访问了指针”时，会据此推断：

  > “既然程序能走到这里，说明 `ptr` 一定不是 `NULL`，否则程序早就崩了。”
  >

  于是，它就把后面显式写的 `if (ptr == NULL)` 安全检查，当成“多余的死代码”给优化掉了。
- **后果**：
  某些依赖空指针检查的安全机制被悄悄绕过，攻击者通过特殊手段映射 0 地址页，从而获取更高权限。
  这类问题在安全社区引发了长时间的争论：
  一方面，编译器严格遵循了标准关于未定义行为的规定；
  另一方面，传统的防御性编程习惯却在“过度优化”面前失效了。

这个案例提醒我们：**编译器作者对语言语义的每一个细节理解，都可能直接影响系统安全边界**。
如果你只是把“优化”当作黑盒，很难真正判断一个看似无害的优化是否会在安全场景下踩线。

### 案例 3：Dead Store Elimination 与密码清除

还有一类更“隐形”的问题与 **Dead Store Elimination（死存储消除）**  有关。

- **常见做法**：
  在处理密码、密钥等敏感数据时，很多库会在使用完之后显式清零：

  ```c
  void use_password(char *password, size_t len) {
      do_something(password);
      memset(password, 0, len);  // 试图把内存里的密码抹掉
  }
  ```
- **编译器的优化**：
  某些优化器在分析中发现：在 `memset` 之后，`password` 再也没有被读取过，于是就判定这次写入是“死存储”，为了性能把它直接删掉。
- **后果**：
  明文密码依然残留在内存中。
  一旦系统再出现类似 Heartbleed 这样的内存泄漏漏洞，攻击者就有机会直接读到本不该存在的敏感数据。

这类问题很难对应到“某一次特定事故”，但它确实在工业界造成了长期的安全隐患。
许多密码学库不得不引入专门的“不可优化清零函数”，或者在编译器层面增加对应的约定，来避免这类优化带来的安全后果。

---

综合来看，**编译器是极其严肃的程序**。
我的态度是：在你还没有真正弄清楚 Parser、类型检查、优化等各个环节在做什么之前，把大部分工作“交给工具”并不是最稳妥的做法。

- 在学习阶段，**手写 Parser 能逼着你把很多原本模糊的细节都看清楚**；
- 在工程阶段，即便你选择使用工具生成 Parser，**对底层原理的掌握也能让你做出更可靠的设计决策**。

当然，这并不意味着应当“一味拒绝所有工具”。
只要你：

- 清楚工具生成代码的结构与边界；
- 有能力做严谨的 code review；
- 能针对关键路径配套足够的测试与检查；

那么合理地使用工具（包括语法生成器、包括 AI 辅助）反而能让你走得更远。
但这一切的前提，是你对“如果我自己来写，它应该长什么样”有足够清晰的认识，而这正是本书希望帮你建立的直觉。

---

## 解析 Type：从语法规则到实现

在 MiniMoonBit 的语法中，“类型”本身就是一块相对独立、又非常关键的子系统。
为了让整本书的铺陈更加自然，我们先不急着解析所有表达式和语句，而是**先实现类型（Type）的解析**。
一方面，它的语法形态相对清晰；另一方面，它和后续的类型检查、泛型支持关系紧密，提前打好地基会让后面更顺畅。

### MiniMoonBit 中的几类类型形态

在 MoonBit / MiniMoonBit 中，你会经常看到下面几类类型写法：

- **基础类型**：`Int`、`Bool`、`Double` 等；
- **用户自定义类型**：例如 `Point`（可能对应某个 `struct Point { ... }`）；
- **参数化类型（泛型实例）** ：

  - `Array[Int]`
  - `Map[String, Int]`
  - `Result[Unit, String]`
- **乘积类型（Product）** ：

  - `(Int, Double, Bool)` 等，用一个圆括号括起来的一串类型；
- **函数类型**：

  - `(Int) -> Int`
  - `() -> Unit`
  - `(Int, Int) -> Double` 等。

从“语法形态”的角度观察，很容易得出一个结论：

1. **最基础的 Type 形态是一个以大写字母开头的标识符**

    - 在词法分析阶段，这就是一个 `Upper` Token，例如 `Int`、`Bool`、`Point`。
    - 至于它在语义上是“内置类型”还是“用户自定义类型”，这些差别会在**类型检查阶段**再去考虑，而不是在语法分析阶段纠结。
2. **参数化类型形态**：

    - 由一个 `Upper`，后接一个方括号包裹的类型列表；
    - 例如 `Array[Int]`、`Map[String, Int]`、`Result[Unit, String]`。
3. **乘积类型（Product）形态**：

    - 一个圆括号，里面是用逗号分隔的类型列表；
    - 例如 `(Int, Bool)`、`(String, Double, Unit)`；
    - 注意：从语法上看，`()`、`(Int)` 这些形态也都属于这一类，只是含义上可能会在后续阶段进一步细分成“Unit 类型”“单元组”等。
4. **函数类型形态**：

    - 形如 `(T1, T2, ...) -> TRet`；
    - 前半部分是一个类似 Product 的类型列表，后半部分是一个返回类型。

如果用接近 EBNF 的方式，把上面的观察记下来，大致是这样：

```plaintext
type :
    upper
  | upper "[" type_list "]"
  | "(" type_list ")"
  | "(" type_list ")" "->" type
  ;

type_list :
  type ("," type)*
```

这套规则并不复杂，但已经涵盖了我们在 MiniMoonBit 里打算支持的主流类型形态。接下来我们就来看看，怎样在 MoonBit 中把它们实现成实际的数据结构和解析函数。

### 用数据结构刻画 Type

在编译器实现中，我们通常会把“语法层面的类型”与“语义层面的类型信息”分开表示。
本章先关注语法层面，用一个 `TypeKind` 来表示各种不同的类型形态：

```moonbit
pub enum TypeKind {
  Primitive(String)                    // Int, Bool, Double, Point, ...
  Parameterized(String, Array[TypeKind]) // Array[Int], Map[K, V], ...
  Product(Array[TypeKind])             // (Int, Double), (String, Bool, Unit), ...
  Function(Array[TypeKind], TypeKind)  // (Int) -> Unit, (Int, Int) -> Double, ...
}

pub struct Type {
  kind: TypeKind
  toks: ArrayView[Token]  // 记录这个类型在源码中对应的 Token 片段
}
```

这里有几点设计意图可以提前说明：

- **`Primitive`**

  - 表示形如 `Int`、`Bool`、`Point` 这样的“单一名字类型”；
  - 它们在语义上可能是“内置类型”也可能是“用户定义类型”，但在语法分析阶段统一视为 `Primitive(name)`。
- **`Parameterized`**

  - 表示带类型参数的类型，例如 `Array[Int]`；
  - 第一个字段是类型构造器名称（`"Array"`），第二个字段是实参类型列表。
- **`Product`**

  - 表示用圆括号括起的一串类型，例如 `(Int, Double)`；
  - 之所以不用“Tuple”这个名字，是因为在后续语义阶段，我们可能会把一些特殊形态（如 `()`）解读为 `Unit` 类型，或者把单元素 `(Int)` 在某些场景下做额外处理。
- **`Function`**

  - 表示函数类型 `(T1, T2, ...) -> TRet`；
  - 前半部分是参数类型列表，后半部分是返回类型本身。

而在 `Type` 结构体中，我们额外保留了一个 `toks: ArrayView[Token]` 字段，用来记录这个类型在源码中对应的 Token 片段。
这在后续做错误提示、类型重建或生成调试信息时，会非常有用。

---

## 解析 Type：从 ArrayView 到模式匹配

有了数据结构，接下来就是设计解析函数。
在第 4 章中，我们已经见过 `ArrayView[Token]` 的用法：它可以看作是“对原始 Token 数组的一段视图”，支持在解析过程中向前推进。

例如，在解析：

```moonbit
let mut x : Int = 1
```

时：

- 词法分析得到完整的 Token 数组；
- 语法分析处理到冒号 `:` 时，可以把视图推进到 `Int = 1 ...` 这一段；
- 类型解析完成后，视图再推进到 `= 1 ...`，供后面的表达式解析使用。

### 从最简单的 `Primitive` 开始

我们先考虑最简单的一种情况：
视图开头是一个 `Upper` Token，例如 `Int`、`Point`。

```moonbit
fn parse_type_kind(
  tokens : ArrayView[Token],
) -> (TypeKind, ArrayView[Token]) {
  match tokens {
    [{ kind: Upper(name), .. }, .. rest] =>
      (Primitive(name), rest)
    ...
  }
}
```

逻辑非常直观：

- 如果当前视图的第一个 Token 是 `Upper(name)`，那么就把它解析成 `Primitive(name)`；
- 同时返回“消费掉第一个 Token 后的剩余视图 `rest`”。

注意这里的返回类型是 `(TypeKind, ArrayView[Token])` ——
我们既要告诉调用者“我解析出了一个什么样的类型”，也要告诉它“还剩下哪些 Token 没处理”。

### 参数化类型：`Array[Int]`、`Map[String, Int]` 等

接下来处理第二种情况：以大写标识符开头，后面紧跟一个左方括号 `[`，这往往意味着是一个参数化类型：

```moonbit
fn parse_type_kind(
  tokens : ArrayView[Token],
) -> (TypeKind, ArrayView[Token]) raise ParseError {
  match tokens {
    [{ kind: Upper(master), .. }, { kind: Bracket('['), .. }, .. rest] => {
      let (type_list, rest) = parse_type_kind_list(rest)
      guard rest is [{ kind: Bracket(']'), .. }, .. rest] else {
        raise ParseError((rest[0], "Expected ']'"))
      }
      (Parameterized(master, type_list), rest)
    }
    [{ kind: Upper(name), .. }, .. rest] =>
      (Primitive(name), rest)
    ...
  }
}
```

和刚才相比，这里多了几步：

- 确认形态是 `Upper(master)` 加上左方括号 `[`；
- 调用 `parse_type_kind_list` 解析后面的类型列表；
- 解析完列表之后，期望紧接着出现一个右方括号 `]`；
- 如果不是，就通过 `raise ParseError(...)` 抛出语法错误；
- 否则构造 `Parameterized(master, type_list)`。

注意分支的顺序：

- 必须先匹配“`Upper` + `[`”这一种更具体的情况；
- 再匹配单独的 `Upper`，否则像 `Array[Int]` 这样的输入会被过早地归类为 `Primitive("Array")`，后面的 `[` 就会被当成语法错误。

### Product 与 Function 类型：`(T1, T2)` 和 `(T1, T2) -> T`

第三类、第四类形态都是以左圆括号 `(` 开头的，我们可以把它们放在同一个分支里处理：

```moonbit
fn parse_type_kind(
  tokens : ArrayView[Token],
) -> (TypeKind, ArrayView[Token]) raise ParseError {
  match tokens {
    [{ kind: Upper(master), .. }, { kind: Bracket('['), .. }, .. rest] => {
      let (type_list, rest) = parse_type_kind_list(rest)
      guard rest is [{ kind: Bracket(']'), .. }, .. rest] else {
        raise ParseError((rest[0], "Expected ']'"))
      }
      (Parameterized(master, type_list), rest)
    }
    [{ kind: Upper(name), .. }, .. rest] =>
      (Primitive(name), rest)
    [{ kind: Bracket('('), .. }, .. rest] => {
      let (type_list, rest) = parse_type_kind_list(rest)
      guard rest is [{ kind: Bracket(')'), .. }, .. rest] else {
        raise ParseError((rest[0], "Expected ')'"))
      }
      match rest {
        // 函数类型：(T1, T2, ...) -> TRet
        [{ kind: Symbol("->"), .. }, .. rest] => {
          let (ret_ty, rest) = parse_type_kind(rest)
          (Function(type_list, ret_ty), rest)
        }
        // 乘积类型：(T1, T2, ...)
        rest =>
          (Product(type_list), rest)
      }
    }
    tokens =>
      raise ParseError((tokens[0], "Invalid type syntax"))
  }
}
```

这里我们做了几个重要判断：

- 如果一个类型以 `(` 开头，就先解析一个 `type_list`；
- 接着必须遇到 `)`，否则报错；
- 之后再看是否紧跟一个 `->`：

  - 如果有，则继续解析返回类型，构造 `Function`；
  - 如果没有，则把前面的 `type_list` 视为一个 `Product`。

这样一来，我们就用一个统一的模式把：

- `(Int, Double)`、`(String, Bool, Unit)` 等 Product 类型；
- `() -> Unit`、`(Int, Int) -> Double` 等函数类型；

都处理掉了。

### `parse_type_kind_list`：解析 `type_list`

`type_list` 的 EBNF 很简单：

```plaintext
type_list :
  type ("," type)*
```

对应到实现上，就是：

```moonbit
///|
/// type_list :
///   type ("," type)*
pub fn parse_type_kind_list(
  tokens : ArrayView[Token],
) -> (Array[TypeKind], ArrayView[Token]) raise ParseError {
  let types : Array[TypeKind] = Array::new()
  let (ty, tokens) = parse_type_kind(tokens)
  types.push(ty)
  let tokens = loop tokens {
    [{ kind: Symbol(","), .. }, ..rest] => {
      let (ty, rest) = parse_type_kind(rest)
      types.push(ty)
      continue rest
    }
    tokens => break tokens
  }
  (types, tokens)
}
```

思路是典型的“先吃一个，随后在循环中尝试吃更多”的模式：

- 一开始调用一次 `parse_type_kind`，至少解析出一个类型；
- 然后在循环中：

  - 如果看到逗号 `,`，就再解析下一个 `type`；
  - 否则退出循环，把已经收集到的类型列表返回。

### `parse_type`：在 Type 上再包一层

大部分时候，我们希望得到的不只是一个 `TypeKind`，而是一个带有位置信息的 `Type`。

```moonbit
///|
pub fn parse_type(
  tokens : ArrayView[Token],
) -> (Type, ArrayView[Token]) raise ParseError {
  let (kind, rest) = parse_type_kind(tokens)
  let ty = Type::new(kind, tokens, rest)
  (ty, rest)
}
```

`Type::new` 内部可以根据 `tokens` 与 `rest` 的差值，记录这段类型在整个 Token 流中的起止位置，方便后续做错误提示和调试。

---

## 错误处理：ParseError 与友好的报错信息

在教学实现里，一个常见的取舍是：

- 要不要做复杂的 **错误恢复（error recovery）** ？

工业级编译器往往会在语法分析阶段就尝试恢复，尽量在一次编译中找出多个错误，从而提升开发体验。
不过实现一个高质量的错误恢复系统本身就非常复杂，会占用相当多篇幅。本书中的 MiniMoonBit 选择了一条更简单的路线：

- **一旦遇到语法错误，就立即抛出** **`ParseError`** **，不做进一步恢复。**

这在教学上有两个好处：

- 更易于解释“错误是在哪里、为什么产生的”；
- 便于你专注在语法本身与解析过程，而不是一上来就陷入恢复策略的细节。

### ParseError 的定义

在 MiniMoonBit 中，我们把 `ParseError` 定义成一个携带 Token 和消息的错误类型：

```moonbit
pub suberror ParseError (Token, String)
```

在解析时，一旦遇到不符合预期的 Token，就可以直接：

```moonbit
raise ParseError((rest[0], "Expected ']'"))
```

或者：

```moonbit
raise ParseError((tokens[0], "Invalid type syntax"))
```

这些错误会一路向上传递，最终在 `main` 函数或调用者那一层被捕获，用来生成最终的报错信息。

### 为 ParseError 实现 Show：打印“带行号”的错误

要生成类似“文件名 + 行号 + 出错行 + 指示符”的报错信息，我们可以为 `ParseError` 实现 `Show` trait：

```moonbit
pub impl Show for ParseError with output(self, logger) {
  let ParseError((tok, msg)) = self
  let { line, col, code, file, .. } = tok

  // 第一行：文件名、行号和列号
  let head_line = "[\{file}:\{line}:\{col}] Error:"
  logger.write_string("\{head_line}\n")

  // 第二行：前一行（如果有）
  logger.write_string("\{line - 1}|")
  if line > 1 {
    let prev_line = get_code_at_line(code, line - 1)
    logger.write_string("\{prev_line}\n")
  } else {
    logger.write_string("\n")
  }

  // 第三行：出错行
  let code_line = get_code_at_line(code, line)
  logger.write_string("\{line}|\{code_line}\n")

  // 第四行：在 column 位置下方打印消息
  let indent = " ".repeat(col - 1)
  logger.write_string("\{line + 1}|\{indent}\{msg}\n")
}
```

这里我们用到了一个辅助函数 `get_code_at_line`，用于从整段源代码中截取某一行：

```moonbit
fn get_code_at_line(code : String, line : Int) -> String {
  loop (line, code[:], "") {
    (1, ['\n', ..], s) => break s
    (1, [c, ..code], s) => continue (1, code, "\{s}\{c}")
    (n, ['\n', ..code], s) => continue (n - 1, code, s)
    (n, [_, ..code], s) => continue (n, code, s)
    (_, _, s) => break s
  }
}
```

这段代码用的是比较“函数式”的写法：

- 状态元组中包含当前还要跳过多少行、剩余字符串视图以及当前累积的结果；
- 每次看到一个换行符，就让 `line` 计数减一；
- 当 `line` 递减到 1，开始把本行字符累加到结果字符串中。

最终生成的错误信息大致会是这样：

```plaintext
[err.mbt:5:20] Error:
4|
5|  let x : Array[Int>
6|                   ^ Expected ']'
```

对于一本教学性质的书来说，这样的错误信息已经相当友好：
读者可以清楚地看到是哪一行、哪一列出错，以及编译器期望得到什么。

> ### 旁注：如果想做错误恢复，可以从哪里入手？
>
> 虽然 MiniMoonBit 不打算实现完整的错误恢复系统，但这里简单给出一个方向：
> 在解析一个语句块时，当内部出现语法错误时，你可以选择 **不把错误直接抛到最顶层**，而是在当前块内做一些“同步点”（synchronization point）的恢复。
>
> 典型做法是：
>
> - 捕获 `ParseError`；
> - 在当前 Token 流中向前扫描，直到遇到下一个“比较安全的分界点”：
>
>   - 例如分号 `;`、右花括号 `}` 或某些关键字；
> - 抛弃这一段 Token，把解析器状态恢复到一个“干净”的位置；
> - 继续尝试解析后续语句。
>
> 这样做的好处是：一次编译可以报告多处错误；
> 代价则是解析器逻辑会复杂不少，需要格外小心不要因为恢复策略本身引入新的歧义。
> 如果你对这一块感兴趣，可以在完成本书的基础实现之后，尝试自己为 MiniMoonBit 的语句解析器加上一点简单的恢复逻辑。

---

## 测试 Type 解析的正确性

实现完解析逻辑之后，一个自然的问题是：**我们怎样确信刚写好的 Parser 在各种输入下都能正常工作？**

MoonBit 提供了原生的测试块语法，以及一组测试辅助函数。
在最初的版本里，我们可以用 `assert_true` 搭配模式匹配来测试 Type 解析的结果。

### 用 `assert_true` + 模式匹配做基础测试

例如，验证 `Primitive` 类型解析：

```moonbit
test "Primitive Type Parsing" {
  let code =
    #|Unit Int Bool Double Int64 Point String
  let tokens = @lexer.tokenize(code)

  let (ty, tok_view) = parse_type(tokens[:])
  assert_true(ty.kind is Primitive("Unit"))

  let (ty, tok_view) = parse_type(tok_view)
  assert_true(ty.kind is Primitive("Int"))

  let (ty, tok_view) = parse_type(tok_view)
  assert_true(ty.kind is Primitive("Bool"))

  let (ty, tok_view) = parse_type(tok_view)
  assert_true(ty.kind is Primitive("Double"))

  let (ty, tok_view) = parse_type(tok_view)
  assert_true(ty.kind is Primitive("Int64"))

  let (ty, tok_view) = parse_type(tok_view)
  assert_true(ty.kind is Primitive("Point"))

  let (ty, _) = parse_type(tok_view)
  assert_true(ty.kind is Primitive("String"))
}
```

同样的思路可以应用到参数化类型和 Product 类型上：

```moonbit
test "Parameterized Type Parsing" {
  let code =
    #|Array[Int] Map[String, Int] Result[Unit, String]
  let tokens = @lexer.tokenize(code)

  let (ty, tok_view) = parse_type(tokens[:])
  assert_true(ty.kind is Parameterized("Array", [Primitive("Int")]))

  let (ty, tok_view) = parse_type(tok_view)
  assert_true(
    ty.kind is Parameterized("Map", [Primitive("String"), Primitive("Int")]),
  )

  let (ty, _) = parse_type(tok_view)
  assert_true(
    ty.kind is Parameterized("Result", [Primitive("Unit"), Primitive("String")]),
  )
}

test "Product Type Parsing" {
  let code =
    #|(Int, Double)
    #|(String, Bool, Unit)
  let tokens = @lexer.tokenize(code)

  let (ty, tok_view) = parse_type(tokens[:])
  assert_true(
    ty.kind is Product(
      [Primitive("Int"), Primitive("Double")]
    )
  )

  let (ty, _) = parse_type(tok_view)
  assert_true(
    ty.kind is Product(
      [Primitive("String"), Primitive("Bool"), Primitive("Unit")]
    )
  )
}
```

这种写法在一开始尚可接受，但当：

- 语法树结构变得更深、更复杂时；
- 或者我们对 `TypeKind` 的内部结构做了一些调整时；

大量“层层解包 + 模式匹配”的断言就会显得笨重而脆弱。
这时，MoonBit 提供的 **`inspect`**  **+ 快照测试** 就非常有用了。

---

## 使用 `inspect` 做快照测试

MoonBit 的测试工具中有一个非常好用的小功能：`inspect`。
它的类型大致是：

```moonbit
inspect(&Show, content?: String)
```

含义是：

- 接收一个实现了 `Show` 的对象；
- 把它转换成字符串；
- 如果传入了 `content` 参数，就把转换结果与 `content` 做比较；
- 如果二者不一致，测试失败；否则测试通过。

### 一个最简单的例子

```moonbit
test "demo" {
  let a = 42
  inspect(a, content = "42")
}
```

如果把 `content` 改成 `"1"`，这条测试就会失败。

真正有趣的地方在于：
如果我们在一开始并不确定“某个结构打印出来是什么样子”，可以先**不写** **`content`**，而是调用：

```moonbit
inspect(a)
```

然后执行：

```shell
moon test --update
```

或：

```shell
moon test -u
```

MoonBit 会在测试文件中自动为你填入当前的“真实输出”，把它作为快照保存下来。
以后每次运行测试时，只要输出发生变化，测试就会失败，从而提醒你“某处行为变了，需要确认这是有意的修改还是 Bug”。

来看一个完整的示例：

```moonbit
test "demo" {
  let a = 42
  inspect(a)
  inspect(a, content = "1")
}
```

在第一次运行 `moon test -u` 之后，测试文件会被自动更新为：

```moonbit
test "demo" {
  let a = 42
  inspect(a, content = "42")
  inspect(a, content = "42")
}
```

接下来只需要人工检查一下 `"42"` 是否符合预期即可。

> **注意**：`inspect` 搭配 `moon test -u` 虽然可以大幅节省编写断言的工作量，但也有一个潜在风险：
> 如果在一次无意的修改中改变了行为，又不加思考地执行了 `moon test -u`，可能会把本应失败的测试“强行改成通过”。
> 因此，**在更新快照之前，务必确认这是你真正期望的行为变化。**

### 为 TypeKind 实现 Show

回到我们的 Type 解析。
如果我们为 `TypeKind` 实现一个合适的 `Show`，那么就可以非常自然地用 `inspect` 做快照测试了。

```moonbit
pub impl Show for TypeKind with output(self, logger) {
  let s = match self {
    Primitive(name) => name
    Parameterized(name, type_args) => {
      let args_str = type_args.map(TypeKind::to_string).join(", ")
      "\{name}[\{args_str}]"
    }
    Product(type_args) => {
      let args_str = type_args.map(TypeKind::to_string).join(", ")
      "(\{args_str})"
    }
    Function(param_types, ret_type) => {
      let params_str = param_types.map(TypeKind::to_string).join(", ")
      "(\{params_str}) -> \{ret_type}"
    }
  }
  logger.write_string(s)
}
```

这里我们约定：

- `Primitive("Int")` 打印为 `"Int"`；
- `Parameterized("Array", [Primitive("Int")])` 打印为 `"Array[Int]"`；
- `Product([Primitive("Int"), Primitive("Double")])` 打印为 `"(Int, Double)"`；
- `Function([Primitive("Int")], Primitive("Unit"))` 打印为 `"(Int) -> Unit"`。

### 用 `inspect` 重写测试

现在，我们可以把之前用 `assert_true + 模式匹配` 写的测试，改造成基于快照的形式。例如：

```moonbit
test "Primitive Type Parsing" {
  let code =
    #|Unit Int Bool Double Int64 Point String
  let tokens = @lexer.tokenize(code)

  let (ty, tok_view) = parse_type(tokens[:])
  inspect(ty.kind)

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind)

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind)

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind)

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind)

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind)

  let (ty, _) = parse_type(tok_view)
  inspect(ty.kind)
}
```

第一次运行 `moon test -u` 之后，它会被更新为：

```moonbit
test "Primitive Type Parsing" {
  let code =
    #|Unit Int Bool Double Int64 Point String
  let tokens = @lexer.tokenize(code)

  let (ty, tok_view) = parse_type(tokens[:])
  inspect(ty.kind, content = "Unit")

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind, content = "Int")

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind, content = "Bool")

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind, content = "Double")

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind, content = "Int64")

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind, content = "Point")

  let (ty, _) = parse_type(tok_view)
  inspect(ty.kind, content = "String")
}
```

对于参数化类型和 Product 类型，也可以用同样的方式：

```moonbit
test "Parameterized Type Parsing" {
  let code =
    #|Array[Int] Map[String, Int] Result[Unit, String]
  let tokens = @lexer.tokenize(code)

  let (ty, tok_view) = parse_type(tokens[:])
  inspect(ty.kind, content = "Array[Int]")

  let (ty, tok_view) = parse_type(tok_view)
  inspect(ty.kind, content = "Map[String, Int]")

  let (ty, _) = parse_type(tok_view)
  inspect(ty.kind, content = "Result[Unit, String]")
}

test "Product Type Parsing" {
  let code =
    #|(Int, Double)
    #|(String, Bool, Unit)
  let tokens = @lexer.tokenize(code)

  let (ty, tok_view) = parse_type(tokens[:])
  inspect(ty.kind, content = "(Int, Double)")

  let (ty, _) = parse_type(tok_view)
  inspect(ty.kind, content = "(String, Bool, Unit)")
}
```

当类型系统和语法树结构逐渐变得复杂时，快照测试能大大减少你手写断言的负担，并且在结构调整时提供更直观的差异对比。

---

## 覆盖率测试：让测试更“有广度”

最后，再来看一件经常被忽略但非常有价值的工具：**覆盖率测试**。

MoonBit 提供了 `moon coverage analyze` 命令，用来分析哪些代码行在测试运行中被执行到了，哪些则完全没有被覆盖。

一个典型的输出可能长这样：

```shell
> moon coverage analyze -p parser
   | pub fn parse_atom_expr(
   |   tokens : ArrayView[Token],
   | ) -> (AtomExpr, ArrayView[Token]) raise ParseError {
   |   let init_tokens = tokens
   |   match tokens {
   |     [{ kind: Int(v), .. }, .. rest] => {
   |       let expr = AtomExpr::new(Int(v), init_tokens, rest)
   |       (expr, rest)
   |     }
   | 46 [{ kind: Double(v), .. }, .. rest] => {
   |    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  <-- UNCOVERED
   |       let expr = AtomExpr::new(Double(v), init_tokens, rest)
   |       (expr, tokens)
   |     }
   |     [{ kind: Bool(v), .. }, .. rest] => {
   |       let expr = AtomExpr::new(Bool(v), init_tokens, rest)
   |       (expr, rest)
   |     }
   |     [{ kind: Lower(ident), .. }, .. rest] => {
   |       let expr = AtomExpr::new(Ident(ident), init_tokens, rest)
   |       (expr, rest)
   |     }
   | 58 [] => parser_unreachable();
   |    ^^^^^^^^^^^^^^^^^^^^^^^^^^^  <-- UNCOVERED
   |     // ... other cases
   | 60 [tok, ..] => {
   |    ^^^^^^^^^^^^^^  <-- UNCOVERED
   |       let msg = "Parse Error: Invalid Atom Expression" +
   |         " Expect Int, Float, Char, Bool, String, Ident, '(', '[' or Struct Construct" +
   | 63      " but found " + tok.kind.to_string()
   |    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  <-- UNCOVERED
   |       raise ParseError(msg)
   |     }
   |   }
   | }
```

从这个输出中，我们可以很直观地看到：

- 某些分支（比如解析 `Double` 的分支）从未在测试中被触发；
- 某些错误路径（`parser_unreachable`、报错分支）同样没有被覆盖。

基于这些信息，我们就可以有针对性地：

- 为 `Double` 字面量添加一些解析测试；
- 为错误路径构造一些“刻意写错的程序”，看看 Parser 是否给出预期的错误信息。

随着测试覆盖率的提高，我们就越有理由相信：
“在现实使用中遇到的大部分输入，都已经被某些测试样例间接覆盖过了。”

> **问：覆盖率高是不是就一定说明编译器很稳定？** 
> **答：当然不是。**
>
> 覆盖率只能说明“测试在执行时曾经经过了这些代码行”，并不能保证所有边界条件和组合路径都被验证过。
> 举个简单的例子：
>
> ```moonbit
> fn access(arr: Array[Int], idx: Int) -> Int {
>   arr[idx]
> }
>
> test "demo" {
>   let arr = [1, 2, 3, 4, 5]
>   assert_eq(access(arr, 1), 1)
> }
> ```
>
> 对于这段代码而言，覆盖率可以轻易达到 100%：
> 但一旦外部用户写出了 `access([1, 2], 3)` 这样的调用，依然会触发越界访问的问题。
>
> 覆盖率是一个非常有用的  **“导航工具”** ，可以帮助我们发现未经测试的分支和路径；
> 但它无法替代对边界条件、输入规模、异常场景的刻意设计。
> 在编译器这样复杂的系统里，覆盖率越高，系统稳定的“可能性”越大，但永远不可能靠覆盖率一个数字来保证“绝对正确”。

---

## 本章小结

本章我们围绕“语法分析”这个主题，以 **类型解析** 为主线，完成了几件事情：

- 从直觉出发理解了语法分析的本质：
  **不断对 Token 进行分组和分层，最终构造出一棵 AST。**
- 结合具体历史案例，讨论了“要不要手写 Parser”这一实践问题，
  并从技术与工程哲学两方面说明了：**至少手写一次 Parser 是非常值得的。**
- 设计并实现了 MiniMoonBit 中的 `TypeKind` / `Type` 数据结构，
  用 `ArrayView[Token]` + 模式匹配的方式实现了 `parse_type_kind` 与 `parse_type`。
- 利用 `ParseError` 和 `Show` 实现了带文件名、行号、列号的友好错误信息，
  并通过 `inspect` + 覆盖率测试构建起一套简单而实用的测试体系。

在接下来的章节里，我们会在这套语法分析框架上继续向外扩展：
先解析各种表达式（从最基础到逐步复杂），再解析语句和顶层结构，
最终构造出一棵完整的 MiniMoonBit 程序 AST，为类型检查和后续各个编译阶段打下坚实的基础。
