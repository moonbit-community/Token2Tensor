---
title: Chapter 4. 词法分析
---

MiniMoonBit 编译器真正“接触”源代码的第一个环节，就是**词法分析**。

从操作系统的角度看，一个以 `.mbt` 为后缀的源文件，和 `.md`、`.txt`、`.c` 文件并没有什么本质区别：它们都是一串文本。甚至和最常见的 `.docx` 相比，源代码文件反而要简单得多——`.docx` 里面还夹杂着大量结构化的 XML/样式信息，而 `.mbt` 文件就是一行一行的字符。

编译器之所以能够“运行”一串字符串，是因为它内部进行了若干 **分阶段的转换**：
从字符到 Token，从 Token 到语法树，再到类型检查、中间代码、Machine IR，直到最后变成 CPU 可以识别的二进制机器码。

而这条流水线的第一个环节，就是本章要讲的 **词法分析**。

> 问：所有编译器都会从“词法分析”开始吗？
>
> 答：如果严格地说，其实不完全是。以 C 语言为例，很多编译器会在词法分析之前加一个“预处理（preprocess）”步骤，先展开宏、处理 `#include` 等指令。一些早期、比较朴素的 C 编译器，预处理阶段甚至是用纯文本替换实现的。但在现代实现中，预处理本身往往也要依赖词法分析的结果。对你来说，只要记住：**词法分析一定是整个编译过程最前面的几个步骤之一，是一条基本必经之路** 就足够了。

---

## 什么是词法分析（lexer）

词法分析（Lexical Analysis）的任务，用一句话概括就是：**把源代码这串字符流，切分成有意义的“词”（Token）并做初步归类**。

仍然以我们在第 3 章中反复出现的那个例子为线索：

```moonbit
fn muladd(a: Int, b: Int, c: Int) -> Int {
  return a * b + c;
}
```

如果你做过一些自然语言处理（NLP）的工作，可以把词法分析先想象成最朴素的“分词”——把连续的字符串拆成一小段一小段：

```plaintext
"fn"  "muladd"  "("  "a"  ":"  "Int"  ","  "b"  ":"  "Int"
","   "c"       ":"  "Int"  ")"  "->"  "Int"  "{"  "return"
"a"   "*"       "b"  "+"   "c"  ";"   "}"
```

这已经是一个“最粗糙”的词法分析结果了。但对于一个真正可用、工程级的编译器来说，这还远远不够。我们不仅要把文本切开，更重要的是要为每一段标明它的**性质**：

- 哪些是关键字（`fn`、`return` 等）；
- 哪些是类型名或结构体名；
- 哪些是变量名；
- 哪些是各种运算符、括号和符号。

这就引出了 MiniMoonBit 里的 Token 设计。

---

## Token 的归类

在 MiniMoonBit 中，我们会遇到的 Token 大致可以按照下面的方式归类。你可以把这一节理解为“语言的词表说明书”：今后在写词法分析代码时，我们会一一对照这些类别来实现。

### 布尔字面量

也就是 `true`、`false`。`true` 代表“真”，`false` 代表“假”。我们把它们在 Token 层面标记成 `Bool`。

### 32 位有符号整数字面量

包括最常见的十进制形式：`1`、`2`、`3` 等等，也包括十六进制形式：`0x1`、`0xff`、`0xabcd` 等。

为什么要特别强调“32 位整数”？因为在底层实现上，整数都是**定长的位宽**，例如 32 位或者 64 位。虽然有些语言在前端提供“任意精度整数”，但那通常是通过库和运行时模拟出来的，而不是由硬件直接支持。

对于 MiniMoonBit 而言，如果直接支持任意精度整数，会明显增加实现难度，也会让后续的 IR 和 Machine IR 设计变得更复杂。因此，我们在设计上选择**区分不同位宽的整数字面量**。这里的 32 位有符号整数字面量，我们记作 `Int`。

### 32 位无符号整数字面量

我们约定，如果在整数字面量的后面加一个 `U` 后缀，例如 `1U`、`2U`、`3U` 等，那么它是一个 32 位无符号整数字面量，对应的 Token 种类我们记作 `UInt`。

### 64 位有符号整数字面量

很多底层架构天然支持 64 位整数。于是我们约定，如果在整数字面量的后面加一个 `L` 后缀，例如 `1L`、`2L`、`42L` 等，那么它是一个 64 位有符号整数字面量，记作 `Int64`。

### 64 位无符号整数字面量

同理，如果在整数字面量的后面加上 `UL` 后缀，例如 `1UL`、`2UL`、`42UL` 等，那么它是一个 64 位无符号整数字面量，记作 `UInt64`。

### 双精度浮点数字面量

常见的小数形式，例如 `1.0`、`2.5`、`3.14`；以及科学计数法形式，例如 `1.0e-3`、`2.5e+2` 等。

当我们遇到这种形式的浮点数时，MiniMoonBit 统一把它们视为**双精度浮点数**，对应的 Token 种类是 `Double`。

### 单精度浮点数字面量

如果浮点数字面量的后面加上一个 `F` 后缀，例如 `1.0F`、`2.5F` 等，我们把它视为**单精度浮点数**，对应 Token 种类为 `Float`。

### 字符字面量

例如 `'a'`、`'b'`、`'c'` 这样使用单引号包裹，内部只有一个字符的形式。对应的 Token 种类为 `Char`。

在词法分析中，需要额外注意**转义符**的处理：例如 `'\n'` 在源代码里看上去是两个字符 `\` 和 `n`，但在编译器内部，它应该被视为一个“换行符”字符；`'\t'` 则是制表符，以此类推。

### 字符串字面量

例如 `"hello world"`、`"morning"` 这样使用双引号包裹、内部包含多个字符的形式。对应的 Token 种类为 `String`。

字符串同样需要处理转义符，例如：

- `"\n"` 表示换行；
- `"\""` 表示一个双引号；
- `"\t"` 表示制表符。

这些在词法分析阶段就需要被正确识别出来。

### 关键字（keyword）

关键字本质上也是“标识符”，只不过它们在语言设计中被赋予了特殊含义，不能被用作普通变量名。我们把它们在 Token 层面标记成 `Keyword`。

在 MiniMoonBit 中，我们会用到的关键字包括：

`fn`、`struct`、`let`、`mut`、`if`、`else`、`while`、`for`、`return`、`break`、`continue`、`extern`、`enum`、`match`。

### 自定义标识符

对于 MiniMoonBit 来说，除了关键字以外，其它所有名字都是“自定义标识符”。MiniMoonBit 在设计上，对“是否以大写字母开头”做了区分：

- 以小写字母开头的标识符，在 Token 种类上记作 `Lower`；
- 以大写字母开头的标识符，在 Token 种类上记作 `Upper`。

这种区分有助于在后续的语法分析和类型检查中，快速判断一个名字更有可能是“类型名/构造器名”，还是“局部变量名/函数名”等。

### 二元运算符

包括加减乘除、取模，以及比较运算、位运算、逻辑运算等。我们统一把它们归类成 `BinaryOp`：

- 基本算术运算：`+`、`-`、`*`、`/`、`%`
- 比较运算：`==`、`!=`、`<`、`>`、`<=`、`>=`
- 位运算：`&`、`|`
- 位移运算：`<<`、`>>`
- 逻辑运算：`&&`、`||`

> 问：`+` 和 `-` 这两个符号，一定是二元运算符吗？
>
> 答：不一定。表达式 `+3`、`-2` 在很多语言中都是合法的，此时 `+` 和 `-` 表示一元的“取正”“取负”。但在**纯词法分析阶段**，我们还不知道它们将来在语法上是“一元”还是“二元”。因此，一个常见做法是：**在词法分析时一律把它们记作运算符 Token**，然后在语法分析阶段根据前后文来区分是“取负”还是“减法”。MiniMoonBit 采用的也是这种思路。

> 问：词法分析中怎么处理 `-1`？它是一个 `Int`，还是一个运算符 `-` 加上一个 `Int`？
>
> 答：在 MiniMoonBit 中，我们选择后者：`-1` 会被切分成两个 Token：一个 `BinaryOp(Sub)`，一个 `Int(1)`。至于它最终是否表示“负一”，还是参与某个更大的表达式，这要在语法分析阶段再决定。

### 赋值运算符

例如 `=`、`+=`、`-=`、`*=` 等符号。我们把它们统一标记成 `AssignOp`。之所以与普通的二元运算符区分开，是因为在语法和语义上，它们的作用更接近“语句级”的赋值，而不是“纯表达式级”的运算。

### 括号

MiniMoonBit 主要有三种括号：

- 圆括号：`(`、`)`
- 方括号：`[`、`]`
- 花括号：`{`、`}`

在本书中，我们为了讲解方便，统一用一个 `Bracket` Token 来代表这 6 种情况。

### 符号（symbol）

MiniMoonBit 中还会出现不少不属于“运算符”“括号”的符号，例如：

- 点号：`.`
- 逗号：`,`
- 分号：`;`
- 冒号：`:`
- 双冒号：`::`
- 单箭头：`->`
- 双箭头：`=>`

我们把它们统一标记成 `Symbol`。

### 通配符

单独的下划线 `_` 在 MiniMoonBit 中有特别的含义：它是“通配符”，常用于模式匹配中表示“我不关心这个位置的具体值”。在 Token 层面，我们为它准备了一个独立的种类：`Wildcard`。

### End Of File（EOF）

在词法分析结束后，我们会在 Token 序列的末尾**额外添加一个** **`EOF`**，表示“文件结束”。这是实践中非常常见的一个小技巧。

有了 `EOF` 之后，在语法分析时，如果在一个“本不应该结束”的地方读到了 `EOF`，我们就可以迅速给出友好的错误提示；而如果没有 `EOF`，就需要在代码中反复检查“数组下标是否越界”，让实现变得更啰嗦。

---

## TokenKind

弄清楚我们会遇到哪些 Token 之后，就可以在 MoonBit 代码中把它们表示出来了。在 MiniMoonBit 的实现中，`TokenKind` 大致长这样：

```moonbit
///|
pub(all) enum TokenKind {
  Bool(Bool)         // true, false
  Int(Int)           // 1, 42（注意：-100 会被拆成 '-' 和 100）
  Int64(Int64)       // 1L, 42L
  UInt(UInt)         // 1U, 42U
  UInt64(UInt64)     // 1UL, 42UL
  Double(Double)     // 1.0, 2.5e+1
  Float(Float)       // 1.0F, 3.14F
  Char(Char)         // 'a', '\n'
  String(String)     // "hello", "world"
  Keyword(Keyword)   // fn, if, ...
  Upper(String)      // Point, Shape
  Lower(String)      // x, y, z
  BinaryOp(BinaryOp) // +, -, *, /, %, ==, !=, <, >, <=, >=, &&, ||
  AssignOp(AssignOp) // =, +=, -=, *=, /=, %=
  Bracket(Char)      // (, ), [, ], {, }
  Symbol(String)     // . , ; : :: -> => 
  Wildcard           // _
  EOF
}
```

这里我们并没有把所有内容都统一表示成 `String`，而是根据性质的不同，选择更具体的类型。例如：

- 对布尔字面量，直接存成 `Bool`；
- 对整数、浮点数，直接存成对应的数值类型；
- 对关键字、运算符，则再细分成单独的枚举。

以关键字为例，我们用一个单独的枚举来记录它是哪一个关键字：

```moonbit
///|
pub(all) enum Keyword {
  Fn
  Struct
  Let
  Mut
  If
  Else
  While
  For
  Return
  Break
  Continue
  Extern
  Enum
  Match
}
```

二元运算符同样有自己的枚举：

```moonbit
///|
pub(all) enum BinaryOp {
  Add        // +
  Sub        // -
  Mul        // *
  Div        // /
  Mod        // %
  ShiftLeft  // <<
  ShiftRight // >>
  Eq         // ==
  NE         // !=
  LT         // <
  GT         // >
  LE         // <=
  GE         // >=
  And        // &&
  Or         // ||
  BitAnd     // &
  BitOr      // |
}
```

赋值运算符也类似：

```moonbit
///|
pub(all) enum AssignOp {
  Assign      // =
  PlusAssign  // +=
  MinusAssign // -=
  MultAssign  // *=
  DivAssign   // /=
  ModAssign   // %=
}
```

> 问：为什么不直接用字符串保存 `"+="`、`"fn"` 这些内容，而要再多绕一层枚举？
>
> 答：这是为了**更好地利用 MoonBit 的类型系统**。想象一下，如果我们在语法分析阶段要检测一个 Token 是否是 `fn` 关键字，而我们用的是字符串，那么一旦你在代码里误写成了 `Keyword("fm")`，编译器是没法在编译期帮你发现这个错误的，只能在运行时语法分析失败，迫使你去调试。而如果我们使用 `Keyword(Fn)` 这样的枚举写法，那么任何拼写错误都会在编译期暴露出来。
>
> 问：既然如此，为什么不把所有的 `Bracket`、`Symbol` 都改成枚举呢？
>
> 答：其实是可以的，而且在更偏向工程实践的实现中，我也推荐这么做。例如你可以用 `TokenKind::LParen` 代替 `Bracket('(')`，用 `TokenKind::Comma` 代替 `Symbol(",")`。对于本书来说，我们希望示例代码在**第一眼阅读时更直观**，看到 `Bracket('(')` 很容易就能联想到源代码中的左括号，因此在这里保留了部分“字符/字符串形式”的表示。等你对整体结构更熟悉之后，完全可以尝试把这些也改写成更严格的枚举版本。

---

## Token

有了 `TokenKind`，我们就可以定义真正的 `Token` 结构。

最简单的版本长这样：

```moonbit
///|
pub struct Token {
  kind: TokenKind
}
```

对于一个极简教学编译器来说，这已经足够使用了：Token 就是“带着种类标签的一块小数据”。
但对于一个希望支持更复杂功能的编译器，我们往往还希望 Token 携带更多信息，尤其是**错误信息相关的上下文**。

例如，在语法分析时报错时，我们通常希望知道：

- 当前 Token 来自哪个源文件；
- 在文件中的第几行、第几列；
- 当前这一行的完整文本是什么。

为了实现这些功能，我们可以把 `Token` 设计得稍微“胖”一点：

```moonbit
///|
pub struct Token {
  kind: TokenKind
  line: Int
  col: Int
  idx: Int
  code: String
  file: String
}
```

现在，每个 Token 不仅包含了自己的种类信息，还携带了：

- `line`：行号；
- `col`：列号；
- `idx`：在整个源文件中的字符索引；
- `code`：完整的源代码字符串；
- `file`：源文件名。

有了这些信息，错误提示就可以做得非常友好：在类型检查或语法分析阶段，一旦发现问题，就能把对应行打印出来，并用“箭头”精确指向具体列。

> 问：一个 Token 里面还塞了 `code` 和 `file`，会不会太占空间了？
>
> 答：不会。MoonBit 在实现上会对“大对象”使用引用管理，这里的 `code` 和 `file` 实际上都是指针或引用，而不是每个 Token 都复制一份完整的字符串。只要你不刻意去手动 `copy`，单个 Token 的占用是比较有限的。
> 更重要的是，这样设计可以让我们在 **Chapter 8**、**Chapter 9** 看到从高层 Token 到 LLVM IR、CIR 的整个流程时，始终能追溯回“原始的那一行代码”，这也是用 MoonBit 实现 MiniMoonBit 的一个优势：你看到的不只是抽象的理论，而是真实运行中的实现。

---

## 词法分析：我们想要的函数长什么样？

从类型签名的角度看，所谓“实现一个词法分析器”，最直接的目标就是写出这样一个函数：

```moonbit
pub fn tokenize(
  code: String,
  source_file: String
) -> Array[Token] raise TokenizeError {
  ...
}
```

也就是说：

- **输入**：一整段源代码字符串，以及它的文件名；
- **输出**：一个 `Array[Token]`，表示从头到尾扫描出来的 Token 序列；
- **错误处理**：在扫描过程中，一旦遇到不合法的字符、格式错误的数字等情况，就抛出 `TokenizeError`。

在 MiniMoonBit 中，我们把 `TokenizeError` 定义得相对简单一些：

```moonbit
pub suberror TokenizeError String derive(Show)
```

也就是：词法分析阶段产生的错误，本质上就是一条带字符串信息的错误。通过 `derive(Show)`，我们可以轻松地把它打印出来。

后面几节会逐步完善这个 `tokenize` 函数的主体。

---

## 我们需要先学 DFA / NFA 吗？

许多传统的编译原理教材，在讲词法分析时都会花相当多的篇幅介绍：

- 正则表达式；
- 不确定有限自动机（NFA）；
- 确定有限自动机（DFA）；
- 以及如何把正则转换成 NFA、再转换成 DFA。

这些内容在理论上非常漂亮，也确实是很多词法分析生成器（例如 `lex`、`flex`、`re2c` 等）的基础。但在**实现一个具体的 MiniMoonBit 词法分析器**时，我们其实可以走一条更加工程化、也更加贴近 MoonBit 特色的道路：

- MoonBit 本身支持强大的模式匹配；
- 还有 `loop` 这种函数式循环；
- 再加上 `lexmatch` 这样的“内建正则匹配”工具。

这意味着我们并不需要手写一个通用的“正则引擎”，也不需要亲自把正则画成 NFA、DFA。
在本章中，我们会**先用直观的模式匹配方式实现 MiniMoonBit 的词法分析**，在这个过程中你自然会对“自动机”形成感性认识；如果你对更加形式化的 DFA／NFA 感兴趣，可以在这之后再去阅读相应教材。

接下来，我们先快速认识一下 MoonBit 为我们准备的几件小工具。

---

### `String` 与 `StringView`

在扫描字符串时，一个常用技巧是：使用一个“视图（view）”来表示**还没处理的那一段子串**。在 MoonBit 里，对 `String` 做切片操作得到的就是一个 `StringView`。

```moonbit
let s = "hello, world"
let s2 = s[1:5]
println(s2)  // 打印：ello
```

这里的 `s[1:5]` 并不会复制一份新的完整字符串，而是得到对原字符串的一个“窗口视图”。在词法分析中，我们会用 `code[:]` 表示“从头到尾的一整段视图”，然后在每次识别完一个 Token 后，把视图向前推进。

---

### 函数式循环：用 `loop` 扫描字符串

在第 2 章我们已经见过 MoonBit 的函数式循环 `loop`。它的典型使用方式是：
给定一个初始状态，不断根据当前状态匹配不同分支，直到遇到 `break` 为止。

下面这个例子用 `loop` 来统计字符串中数字字符的个数：

```moonbit
fn number_count(str: String) -> Int {
  let mut num_cnt = 0
  loop str[:] {
    ['0'..='9', ..rest] => {
      num_cnt += 1
      continue rest
    }
    [_, ..rest] => {
      continue rest
    }
    [] => break num_cnt
  }
}

fn main {
  number_count("123abc567") |> println // 打印出 6
}
```

这里有几个关键点值得注意：

- `loop str[:]` 的含义是：把 `str` 转换成一个 `StringView`，作为循环的“当前状态”；
- 模式 `['0'..='9', ..rest]` 表示：如果当前视图的第一个字符是数字，就计数加一，并把剩余部分 `rest` 作为下一轮循环的状态；
- 模式 `[_, ..rest]` 表示：第一个字符不是数字，就直接跳过；
- 模式 `[]` 表示：视图已经为空，循环结束，返回计数结果。

词法分析器的主循环会和这个例子非常相似：只是我们在每一步“识别出来的东西”，不再是“数字字符”，而是一个个更加复杂的 Token。

---

### `lexmatch`：用正则表达式匹配前缀

有些 Token 的结构用纯模式匹配写起来会稍微冗长，比如浮点数字面量、科学计数法、十六进制整数等。
MoonBit 的 `lexmatch` 语法提供了一个在“词法分析层面”使用正则表达式的工具。

下面这个例子判断一个字符串是否以数字开头，并把数字部分和剩余部分分离出来：

```moonbit
fn is_start_with_a_number(str: String) -> Unit {
  lexmatch str with longest {
    (("\d+" as n), rest) => println("number part is \{n}, rest is \{rest}") 
    _ => println("not start with a number")
  }
}

fn main {
  let s = "123abc"
  is_start_with_a_number(s) // 打印：number part is 123, rest is abc
}
```

这里：

- `lexmatch str with longest` 表示：对字符串 `str` 做多分支正则匹配，并选择“最长匹配”的那个分支；
- `"\d+" as n` 是一个正则模式，匹配一个或多个数字，并把匹配到的那一段绑定到变量 `n` 上；
- `rest` 则代表匹配完成之后剩余的那一段字符串。

稍后在“识别数字”一节中，我们会用 `lexmatch` 来帮忙处理浮点数与整数的前缀匹配。

---

## 识别标识符

有了 `StringView`、`loop` 和模式匹配，我们就可以开始完善 `tokenize` 函数了。
大致思想是：维护当前的行号、列号和全局索引，然后在一个 `loop code[:]` 中，根据当前视图的第一个字符来决定接下来要走哪一个分支。

下面是一个简化后的版本（省略了部分分支，只展示和标识符相关的部分）：

```moonbit
///|
pub fn tokenize(
  code: String,
  source_file?: String = "demo",
) -> Array[Token] raise TokenizeError {
  let source_code = code
  let tokens = Array::new()
  let mut line = 1
  let mut col = 1
  let mut idx = 0
  loop code[:] {
    [] => {
      let tok = Token::new(EOF,
        line, col, idx, source_code, source_file)
      tokens.push(tok)
      break
    }
    [' ' | '\t' | '\r', ..rest] => {
      col += 1; idx += 1
      continue rest
    }
    ['\n', ..rest] => {
      line += 1; col = 1; idx += 1
      continue rest
    }
    ['A'..='Z', ..] as code => {
      let sb = StringBuilder::new()
      let rest = loop code {
        ['A'..='Z' | 'a'..='z' |
         '0'..='9' | '_' as c, ..rest] => {
          sb.write_char(c)
          col += 1; idx += 1
          continue rest
        }
        rest => break rest
      }
      let ident = sb.to_string()
      let tok = Token::new(Upper(ident),
        line, col, idx, source_code, source_file)
      tokens.push(tok)
      continue rest
    }
    ['_' | 'a'..='z', ..] as code => {
      let (ident, len, rest) = tokenize_lower_ident(code)
      col += len
      idx += len
      let tok = Token::new(ident,
        line, col, idx, source_code, source_file)
      tokens.push(tok)
      continue rest
    }
    ...
    [c, ..rest] => raise TokenizeError("Unexpected char '\{c}'")
  }
}
```

这个函数式循环里，各个分支大致含义是：

- **第一个分支**：如果字符串视图已经为空，说明代码已经扫描结束，于是构造一个 `EOF` Token，压入数组，然后 `break` 退出循环。
- **第二、第三个分支**：处理空白字符。遇到空格、制表符时，只需要列号和索引加一；遇到换行符时，则行号加一、列号重置为 1。
- **第四个分支**：遇到**大写字母开头**时，说明这是一个 `Upper` 标识符。
  内层使用一个 `loop code` 循环，持续收集由大小写字母、数字和下划线组成的最长前缀，构造出完整的标识符字符串 `ident`，最后生成一个 `Upper(ident)` Token。
- **第五个分支**：遇到**小写字母或下划线开头**时，说明这是一个可能的关键字、布尔字面量、`Lower` 标识符，或者 `_` 通配符。这里我们把处理逻辑下放到辅助函数 `tokenize_lower_ident` 中。
- **最后一个分支**：如果都不匹配，说明遇到了不认识的字符，抛出 `TokenizeError`。

接下来看看 `tokenize_lower_ident` 的实现：

```moonbit
///|
fn tokenize_lower_ident(code: StringView) -> (TokenKind, Int, StringView) {
  let sb = StringBuilder::new()
  let rest = loop code {
    ['a'..='z' | 'A'..='Z' | '0'..='9' | '_' as c, ..rest] => {
      sb.write_char(c)
      continue rest
    }
    rest => break rest
  }
  let ident = sb.to_string()
  let kind = match ident {
    "true" => Bool(true)
    "false" => Bool(false)
    "fn" => Keyword(Fn)
    "struct" => Keyword(Struct)
    "let" => Keyword(Let)
    "mut" => Keyword(Mut)
    "if" => Keyword(If)
    "else" => Keyword(Else)
    "while" => Keyword(While)
    "for" => Keyword(For)
    "return" => Keyword(Return)
    "break" => Keyword(Break)
    "continue" => Keyword(Continue)
    "extern" => Keyword(Extern)
    "enum" => Keyword(Enum)
    "match" => Keyword(Match)
    "_" => Wildcard
    _ => Lower(ident)
  }
  (kind, ident.length(), rest)
}
```

可以看到，它的模式和大写字母开头的情况非常类似：先把一整段由字母、数字和下划线组成的前缀收集出来，然后再用一个 `match` 把它分类：

- 如果是 `"true"` / `"false"`，就变成 `Bool`；
- 如果是 `fn`、`struct`、`if` 等关键字，就变成相应的 `Keyword` 变体；
- 如果是 `_`，就变成 `Wildcard`；
- 否则，才视为普通的 `Lower` 标识符。

---

## 识别符号与运算符

理解了“标识符”的识别方式之后，其它符号的处理就相对直接了：在 `tokenize` 函数的主循环里，按照“**长度优先、最长匹配**”的思路，依次判断各种符号前缀即可。

下面的代码片段展示了如何识别 `"+="` 和 `"+"` 两种情况：

```moonbit
///|
pub fn tokenize(
  code: String,
  source_file?: String = "demo",
) -> Array[Token] raise TokenizeError {
  ...
  loop code[:] {
    ...
    [.."+=", ..rest] => {
      let tok = Token::new(AssignOp(PlusAssign),
        line, col, idx, source_code, source_file)
      tokens.push(tok)
      col += 2
      idx += 2
      continue rest
    }
    ['+', ..rest] => {
      let tok = Token::new(BinaryOp(Add),
        line, col, idx, source_code, source_file)
      tokens.push(tok)
      col += 1
      idx += 1
      continue rest
    }
    ...
    [c, ..rest] => raise TokenizeError("Unexpected char '\{c}'")
  }
}
```

这里我们重点观察两点：

- 模式 `[.."+=", ..rest]` 是 MoonBit 的一个语法糖，等价于 `['+', '=', ..rest]`，表示“当前视图的前两个字符是 `+` 和 `=`”；
- 我们**先**匹配 `"+="`，**再**匹配 `"+"`。如果把这两个分支调换顺序，`"+="` 就会先被 `"+"` 分支截胡，变成两个 Token（`BinaryOp(Add)` 和 `AssignOp(Assign)`），导致我们永远走不到 `"+="` 分支。

MoonBit 的编译器/静态分析器会对这种情况给出友好的提示：如果某个模式分支在当前模式顺序下“永远不可能被命中”，它会报出 `Warning (unreachable_code)`，提醒你调整分支顺序。这在实现复杂的词法分析器时非常有帮助。

MiniMoonBit 中的符号种类很多，这里就不一一展开展示了。读者可以在阅读本书配套代码时，对照 `TokenKind` 自己尝试补全这些分支，这会是一次很好的练习。

> #### 为什么 MoonBit 用方括号表示泛型？
>
> 在 MoonBit 的语言设计上，一个常被问到的问题是：**为什么 MoonBit 选择用方括号**  **`[]`**  **来表示泛型参数**，例如 `Array[T]`、`Map[K, V]`、`Option[T]`，而不是像 C++、Rust、TypeScript 那样使用尖括号 `<>`？
>
> 首先需要说明的是，采用“方括号 + 类型参数”这种设计的并不只有 MoonBit。例如：
>
> - 在 Python 中，现代的类型标注会写成 `list[int]`、`dict[str, int]`；
> - 在 Go 中，泛型类型和函数的类型参数写成 `type List[T any] []T`、`func MapKeys[K comparable, V any](m map[K]V) []K`。
>
> 之所以会出现这样的设计选择，很大一部分原因，其实可以从“词法分析”的视角看得更清楚---**最大的麻烦来自于这个符号：**   **`>>`** 。
>
> 假设 MoonBit 也用尖括号来写泛型，那么像 `Array<Array<Int>>` 这样的代码在词法层面就会产生一个歧义：中间的 `>>` 究竟是**两个连续的右尖括号**（结束两个泛型实参列表），还是一个**右移运算符**？
> 如果我们沿用前面“最长匹配”的写法，`tokenize` 函数里往往会出现类似的分支：
>
> ```moonbit
> ///|
> pub fn tokenize(
>   code: String,
>   source_file?: String = "demo",
> ) -> Array[Token] raise TokenizeError {
>   ...
>   loop code[:] {
>     ...
>     [..">>", ..rest] => {
>       ... // 这里应该把 ">>" 当成移位运算，还是当成两个 '>'？
>     }
>     ['>', ..rest] => {
>       ...
>     }
>     ...
>   }
> }
> ```
>
> 一旦允许使用 `<T>` 这种语法，在看到 `>>` 的那一刻，**仅凭词法信息其实并不足以判断**：当前是否正处在一个“嵌套泛型参数列表的结尾”，还是在一个普通表达式里写了 `a >> b`。为了处理这种情况，现实中的语言实现常见的做法有下面两种：
>
> 1. **在词法分析里塞进一小块语法分析**
>     也就是说，词法分析器在处理 `>` 或 `>>` 时，需要知道“**当前是不是在泛型实参列表中**”或者“**前面是不是一个类型名**”等语法层面的上下文。然后根据这些信息来决定到底把它切成 `>` `>` 两个 Token，还是一个 `>>`。这会让原本应该“只关心字符和 Token 分类”的词法器承担一部分语法职责，实现起来既不优雅，也不利于维护。
> 2. **在词法阶段只产生单个**  **`>`** **，把右移运算留给语法阶段组合**
>     另一种做法是，让词法分析器从不产生 `>>` 这个 Token，而总是产生两个连续的 `>`，然后在语法分析处理表达式时，如果发现有两个紧挨着的 `>` 并处在合适的位置，就把它们视作一个右移运算符。这类思路在不少现代 C++、Rust 编译器中都可以看到，虽然可以工作，但需要在语法规则里增加不少“特殊情况”。
>
> 无论采用哪一种方案，**都会让编译器实现本身变得更复杂**：要么是词法分析器引入上下文依赖、难以复用；要么是语法规则里充斥各种“如果前后都是整数表达式，就把紧挨着的两个 `>` `>` 合并成 `>>`”的特殊逻辑。
> 从工程实践的角度看，这些“微妙但麻烦的小细节”既影响编译器性能，也会让整个项目更难维护。
>
> 这也是为什么，近些年越来越多的新语言宁可避开 `<T>` 这种写法，**直接选择使用方括号来表示泛型参数**：从使用者的角度看，`Array[T]`、`Map[K, V]`、`Option[T]` 依然非常直观；而从实现者的角度看，像 `>>` 这样的词法歧义也随之消失，词法分析器可以放心地把 `>>` 始终视为位移运算符，而不必顾虑嵌套泛型的结尾。
>
> 对于 MoonBit 和 MiniMoonBit 而言，这样的设计让我们的词法分析和语法分析都保持了更清晰的分工，也让本书中展示的实现更加简洁。

---

## 识别数字

数字字面量通常是词法分析里**最容易变得“啰嗦”** 的一部分：

- 有十进制整数：`0`、`123`；
- 有十六进制整数：`0x1`、`0xFF`；
- 有带小数点的浮点数：`1.0`、`3.14`；
- 还有带指数的科学计数法：`1.0e-3`、`2.5e+2`；
- 再加上各种后缀：`U`、`L`、`UL`、`F`……

完全可以想象，如果我们只用 `loop` 写模式匹配，把所有情况一个个拆解出来，代码会非常长，也不太利于修改。

这里我们就用上一节提到的 `lexmatch` 来帮忙。首先，在 `tokenize` 的主循环中，当遇到以数字开头的情况时，调用一个辅助函数 `tokenize_number`：

```moonbit
///|
pub fn tokenize(
  code: String,
  source_file?: String = "demo",
) -> Array[Token] raise TokenizeError {
  ...
  loop code[:] {
    ...
    ['0'..='9', ..] as code => {
      let (tok_kind, len, rest) = tokenize_number(code)
      let tok = Token::new(tok_kind,
        line, col, idx, source_code, source_file)
      tokens.push(tok)
      col += len
      idx += len
      continue rest
    }
    ...
    [c, ..rest] => raise TokenizeError("Unexpected char '\{c}'")
  }
}
```

这里的 `tokenize_number` 返回三个量：

- 识别出来的 `TokenKind`；
- 这次一共消费了多少个字符 `len`；
- 剩余的字符串视图 `rest`。

由于数字解析过程中也有可能失败（比如数字太大、格式非法等），我们让 `tokenize_number` 返回一个可能抛出 `TokenizeError` 的结果，用 `?` 操作符把错误向上传递。

接下来看看 `tokenize_number` 的核心逻辑。思路是：用几个正则表达式，按照“最长优先”的方式匹配不同形式的数字前缀：

```moonbit
fn tokenize_number(
  code : StringView,
) -> (TokenKind, Int, StringView) raise TokenizeError {
  lexmatch code with longest {
    // Case 1：带可选指数部分的浮点数，例如 1.23、3.14e+5
    (("([0-9]+\.[0-9]+)([eE][\+\-]?[0-9]+)?") as f, rest) => {
      // 判断是否带 F 后缀
      let (num_str, rest2, is_float) = match rest {
        ['F', ..r] => (f, r, true)
        _ => (f, rest, false)
      }
      if is_float {
        let n = @strconv.parse_double(num_str) catch {
          err => raise TokenizeError("invalid float literal '\{num_str}': \{err}")
        }
        (Float(Float::from_double(n)), num_str.length() + 1, rest2)
      } else {
        let n = @strconv.parse_double(num_str) catch {
          err => raise TokenizeError("invalid double literal '\{num_str}': \{err}")
        }
        (Double(n), num_str.length(), rest2)
      }
    }
    // Case 2：十六进制整数，例如 0x1f、0XFF
    (("0[xX][0-9a-fA-F]+") as num_str, rest) => {
      let (kind, len, rest) = parse_int_with_suffix(num_str, rest, 16)
      (kind, len, rest)
    }
    // Case 3：十进制整数
    (("[0-9]+") as num_str, rest) => {
      let (kind, len, rest) = parse_int_with_suffix(num_str, rest, 10)
      (kind, len, rest)
    }
    // 其它情况
    _ => raise TokenizeError("invalid number literal")
  }
}
```

为了让代码更整洁，我们把“根据后缀解析不同位宽和有无符号”的逻辑抽成了另一个辅助函数 `parse_int_with_suffix`。它接收纯数字部分 `num_str`、后续字符串视图 `rest`，以及进制 `base`，然后根据后缀决定产生哪种整数 Token：

```moonbit
fn parse_int_with_suffix(
  num_str: StringView,
  rest: StringView,
  base: Int,
) -> (TokenKind, Int, StringView) raise TokenizeError {
  match rest {
    // 64 位无符号：UL
    [.."UL", ..rest] => {
      let n = @strconv.parse_uint64(num_str, base~) catch {
        err => raise TokenizeError("invalid UInt64 literal '\{num_str}': \{err}")
      }
      (UInt64(n), num_str.length() + 2, rest)
    }
    // 64 位有符号：L
    ['L', ..rest] => {
      let n = @strconv.parse_int64(num_str, base~) catch {
        err => raise TokenizeError("invalid Int64 literal '\{num_str}': \{err}")
      }
      (Int64(n), num_str.length() + 1, rest)
    }
    // 32 位无符号：U
    ['U', ..rest] => {
      let n = @strconv.parse_uint(num_str, base~) catch {
        err => raise TokenizeError("invalid UInt literal '\{num_str}': \{err}")
      }
      (UInt(n), num_str.length() + 1, rest)
    }
    // 默认：32 位有符号
    rest => {
      let n = @strconv.parse_int(num_str, base~) catch {
        err => raise TokenizeError("invalid Int literal '\{num_str}': \{err}")
      }
      (Int(n), num_str.length(), rest)
    }
  }
}
```

这里我们用到了 MoonBit 标准库中的 `@strconv` 模块，它为我们提供了一系列 `parse_*` 函数，可以直接把字符串转换成对应的数值类型：

```moonbit
let i = "123"
let n = @strconv.parse_int(i) catch {
  err => { ... } // 处理错误
}

let f = "12.34"
let d = @strconv.parse_double(f) catch {
  err => { ... } // 处理错误
}
```

需要注意的是，这些 `parse_*` 函数本身就可能抛出错误（例如遇到非法字符、数值超出范围等）。因此，我们在词法分析器中要记得使用 `catch` 或 `?` 来把这些错误包装成 `TokenizeError` 抛出去。

---

## 小结

在本章中，我们围绕 MiniMoonBit 的 `tokenize` 函数，完成了从“字符流”到“Token 序列”的第一步转换，并在这个过程中引入了：

- **Token 分类**：包括布尔、整数与浮点字面量、字符串与字符、关键字、标识符、运算符、括号、符号、通配符以及 `EOF` 等；
- **`TokenKind`** **与** **`Token`** **结构**：既能精确表达 Token 种类，又能记录行列号、源文件等上下文信息；
- **函数式循环与** **`StringView`**：用 `loop` 在字符串视图上进行“按前缀匹配、推进视图”的扫描；
- **`lexmatch`** **与**  **`@strconv`**：用正则表达式和标准库解析复杂的数字字面量。

如果你正确实现了词法分析器，对本章开头给出的 `muladd` 函数进行词法分析，打印出来的 Token 序列大致会是这样（为便于阅读，这里省略了行号、列号等信息）：

```plaintext
Keyword(Fn)
Lower("muladd")
Bracket('(')
Lower("a")
Symbol(":")
Upper("Int")
Symbol(",")
Lower("b")
Symbol(":")
Upper("Int")
Symbol(",")
Lower("c")
Symbol(":")
Upper("Int")
Bracket(')')
Symbol("->")
Upper("Int")
Bracket('{')
Keyword(Return)
Lower("a")
BinaryOp(*)
Lower("b")
BinaryOp(+)
Lower("c")
Symbol(";")
Bracket('}')
EOF
```

到这里，我们已经为后续的语法分析打好了坚实的基础。
在下一章中，我们会在这些 Token 的基础上，逐步构造出 MiniMoonBit 的抽象语法树，走完从 Token 到 AST 的这一段旅程。
