---
title: Chapter 7. 语法分析 - 语句与复杂表达式
---

在第 5、6 章中，我们已经为 MiniMoonBit 建起了语法分析的“骨架”：
类型 `Type` 的解析、简单表达式 `Expr` 的解析都已经到位。
从本章开始，我们要把目光从“表达式内部结构”扩展到整个语句和复杂控制结构上：`let` / `let mut` 声明、赋值语句、`block`、`if` / `while` / `for`、`match`，乃至局部函数（local function）。

本章的目标有两层：

- 从语法层面把各种语句和复杂表达式“接上来”，让 MiniMoonBit 具备现代语言常见的控制结构；
- 从实现层面，继续练习如何把 BNF 规则翻译成清晰的 AST 结构和手写 Parser 函数。

如果说第 6 章是围绕“如何解析一颗复杂的表达式树”，那么本章可以看作是“如何让这些表达式树在更大范围内组合：组成语句、组成块、组成控制流结构”。

---

## `let mut` 语句

现在，我们已经有能力解析任意复杂的表达式了，是时候从最基础的语句开始：**可变变量声明语句** **`let mut`**。

对应的 BNF 很简单：

```plaintext
let_mut_stmt :
  "let" "mut" lower ( ":" type )? "=" expr ";"
```

这条规则的含义是：

- 以关键字 `let mut` 开头；
- 接一个小写标识符作为变量名；
- 可选的类型标注 `: type`；
- 一个 `=`，后面是一条表达式；
- 以分号 `;` 或换行结束（具体结尾规则稍后会详细说明）。

我们先为 `let mut` 语句定义 AST 结构：

```moonbit
pub(all) struct LetMutStmt {
  name : String
  ty   : Type?
  expr : Expr
  toks : ArrayView[Token]
}
```

这里的 `Type?` 是 MoonBit 中的一个语法糖，表示 `Option[Type]`：
如果有显式的类型标注，就存为 `Some(ty)`；否则就是 `None`，后续由类型推断来补全。

解析函数实现也比较直接：

```moonbit
pub fn parse_let_mut_stmt(
  tokens : ArrayView[Token],
) -> (LetMutStmt, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  // 必须以 `let mut` 开头，否则说明调用者用错了这个函数
  guard tokens
    is [{ kind: Keyword(Let), .. }, 
        { kind: Keyword(Mut), .. }, .. tokens] else {
    println("Compiler ICE: Misuse parse_let_mut_stmt: not starting with 'let mut'")
    panic()
  }

  // 变量名：一个小写标识符
  guard tokens is [{ kind: Lower(name), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect a lower ident"))
  }

  // 可选的类型标注
  let (ty, tokens) = match tokens {
    [{ kind: Symbol(":"), .. }, .. tokens] => {
      let (ty, tokens) = parse_type(tokens)
      (Some(ty), tokens)
    }
    _ => (None, tokens)
  }

  // 等号
  guard tokens is [{ kind: AssignOp(Assign), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect '='"))
  }

  // 右侧表达式
  let (expr, tokens) = parse_expr(tokens)

  let toks = slice_tokens(init_tokens, tokens)
  let let_mut_stmt = LetMutStmt::{ name, ty, expr, toks }

  // 处理语句结尾的分号或换行
  let last_tok = expr.toks.last().unwrap()
  let tokens = end_stmt(last_tok, tokens)

  (let_mut_stmt, tokens)
}
```

### 语句末尾的分号处理

在很多语言中（比如 C/C++、Rust），**分号是语句结束的硬性标志**；
漏写分号往往会触发语法错误。

MoonBit 的设计稍微友好一些：
**一条语句可以以分号结束，也可以在行尾直接换行而不写分号。**

例如：

```moonbit
fn main {
  let x = 1   // Ok
  let y = 2;  // Ok
  let z = 3   // Ok
}
```

要实现这种行为，我们引入一个统一的辅助函数 `end_stmt` 来处理语句结尾：

```moonbit
fn end_stmt(
  last_tok: Token,
  tokens: ArrayView[Token]
) -> ArrayView[Token] raise ParseError {
  match tokens {
    // 情况 1：后面是分号，跳过分号
    [{ kind: Symbol(";"), ..}, .. tokens] =>
      tokens

    // 情况 2：后面是右花括号，说明语句自然结束
    [{ kind: Bracket('}'), ..}, ..] =>
      tokens

    // 情况 3：后面的第一个 token 行号与 last_tok 不同，说明发生了换行
    [{ line, ..}, ..] if line != last_tok.line =>
      tokens

    // 其它情况：既没有分号，也没有换行，更不是 block 结束，说明缺少语句终结符
    _ =>
      raise ParseError((last_tok, "Expect ';' or line break"))
  }
}
```

之后，我们在所有需要“以语句方式出现”的解析函数末尾，都可以复用 `end_stmt` 来完成分号/换行判断逻辑。

---

## `let` 与模式：Pattern 语法

相比 `let mut` 语句只能绑定一个简单的标识符，MoonBit 的 `let` 语句要更灵活一些：
**左边可以是一个简单标识符，也可以是元组模式（pattern）** ，例如：

```moonbit
let (a, b) = (1, 2)
```

执行完之后，`a` 的值是 `1`，`b` 的值是 `2`。

### 旁注：`let pattern` 的演进

> 在许多现代语言中（Haskell、ML、Rust 等），`let` 语句的左边往往是一个 **模式（pattern）** ，而不仅仅是一个变量名。
> 例如：
>
> ```moonbit
> enum Color {
>   RGB(Int, Int, Int)
> }
>
> fn print_rgb(color: Color) {
>   let RGB(r, g, b) = color
>   println("r: \{r}, g: \{g}, b: \{b}")
> }
> ```
>
> 在早期的 MoonBit 版本中，甚至还支持更加丰富的 `let` 模式：
>
> - 数组模式：`let [a, ..] = arr`
>   如果 `arr` 是 `[1, 2, 3]`，则 `a` 的值为 `1`；
> - 多值枚举的解包：`let Some(x) = val`
>   相当于隐式地做了一个 `unwrap`，如果 `val` 是 `Some(42)`，则 `x` 为 `42`。
>
> 然而，实践中发现这些写法虽然简洁，但也带来了**安全隐患**：
>
> - 数组模式可能隐含下标越界；
> - 多值枚举的 `let` 模式匹配本质上会引入隐藏的 `unwrap`，一旦匹配失败就会 panic。
>
> 因此，现代 MoonBit 更倾向于把这些“部分匹配”的情况显式地写成 `match` 或 `guard + is`，
> 例如：
>
> ```moonbit
> guard arr is [a, ..] else { ... }
> guard val is Some(x) else { ... }
> ```
>
> 这样一来，所有可能失败的匹配都变成了显式的控制流，而不是藏在 `let` 语句里。

在 MiniMoonBit 中，我们不会实现 MoonBit 支持的全部模式功能，但会支持一个合理的子集：

- 标识符模式：`x`；
- 元组模式：`(x, y)`；
- 通配符 `_`。

对应的 BNF 可以写成：

```plaintext
pattern :
    lower
  | "_"
  | "(" pattern_list ")"

pattern_list:
  ("," pattern)*
```

### Pattern 的数据结构与解析

我们用一个简单的枚举来表示 Pattern：

```moonbit
pub(all) enum PatternKind {
  Wildcard
  Ident(String)
  Tuple(Array[Pattern])
}

pub(all) struct Pattern {
  kind : PatternKind
  toks : ArrayView[Token]
}
```

解析 `PatternKind` 的代码与前面解析类型列表的写法非常相似：

```moonbit
pub fn parse_pattern_kind(
  tokens : ArrayView[Token],
) -> (PatternKind, ArrayView[Token]) raise ParseError {
  match tokens {
    [{ kind: Wildcard, .. }, .. tokens] =>
      (Wildcard, tokens)

    [{ kind: Lower(ident), .. }, .. tokens] =>
      (Ident(ident), tokens)

    [{ kind: Bracket('('), .. } as tok, .. tokens] => {
      let (patterns, tokens) = parse_pattern_kind_list(tokens)
      guard tokens is [{ kind: Bracket(')'), .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expected ')'"))
      }
      let patternkind = match patterns.length() {
        0 =>
          raise ParseError((tok, "Invalid pattern: empty tuple"))
        1 =>
          patterns[0].kind
        _ =>
          PatternKind::Tuple(patterns)
      }
      (patternkind, tokens)
    }

    tokens =>
      raise ParseError((tokens[0], "Invalid pattern"))
  }
}
```

其中 `parse_pattern_kind_list` 用来解析形如 `(p1, p2, p3)` 的模式列表：

```moonbit
fn parse_pattern_kind_list(
  tokens: ArrayView[Token]
) -> (Array[Pattern], ArrayView[Token]) raise ParseError {
  fn is_legal_pattern_token(tok: Token) -> Bool {
    match tok.kind {
      Lower(_) | Wildcard | Bracket('(') => true
      _ => false
    }
  }

  let patterns : Array[Pattern] = Array::new()

  guard tokens is [tok, ..] && is_legal_pattern_token(tok) else {
    raise ParseError((tokens[0], "Expected pattern token"))
  }

  let tokens = loop tokens {
    [tok, ..] as rest if is_legal_pattern_token(tok) => {
      let (pat, rest) = parse_pattern(rest)
      patterns.push(pat)
      continue rest
    }
    [{ kind: Symbol(","), .. }, tok, ..] as rest if
    is_legal_pattern_token(tok)=> {
      let (pat, rest) = parse_pattern(rest[1:])
      patterns.push(pat)
      continue rest
    }
    tokens =>
      break tokens
  }

  (patterns, tokens)
}
```

### `let` 语句的语法解析

有了 Pattern 之后，我们就可以处理更一般的 `let` 语句了。
它的 BNF 很自然：

```plaintext
let_stmt:
  "let" pattern (":" type)? "=" expr ";"
```

对应的 AST 与解析函数如下：

```moonbit
pub(all) struct LetStmt {
  pattern : Pattern
  ty      : Type?
  expr    : Expr
  toks    : ArrayView[Token]
}

pub fn parse_let_stmt(
  tokens : ArrayView[Token],
) -> (LetStmt, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(Let), .. }, .. tokens] else {
    println("Compiler ICE: Misuse parse_let_stmt")
    panic()
  }

  let (pattern, tokens) = parse_pattern(tokens)

  let (ty, tokens) = match tokens {
    [{ kind: Symbol(":"), .. }, ..] => {
      let (ty, tokens) = parse_type(tokens)
      (Some(ty), tokens)
    }
    _ => (None, tokens)
  }

  guard tokens is [{ kind: AssignOp(Assign), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expected '='"))
  }

  let (expr, tokens) = parse_expr(tokens)

  let toks = slice_tokens(init_tokens, tokens)
  let let_stmt = LetStmt::{ pattern, ty, expr, toks }

  let last_tok = expr.toks.last().unwrap()
  let tokens = end_stmt(last_tok, tokens)

  (let_stmt, tokens)
}
```

> **问：为什么** **`let`** **允许左边是 pattern，而** **`let mut`** **只允许一个简单标识符？**
>
> **答**：这主要出于两个方面的考虑：
>
> 1. 在现代语言设计中，我们往往鼓励**默认使用不可变绑定**：
>
>     - C 语言里，`int x` 是可变的，`const int x` 反而要多写几个关键字；
>     - 而在 Rust / MoonBit 中，不可变绑定是默认值，可变绑定需要显式写出 `mut`。
> 2. 对可变变量做“复杂解构”往往容易引入难以察觉的 bug：
>
>     - 如果放开 `let mut (a, b) = ...`，很容易出现“一部分可变、一部分只读”的微妙情形；
>     - 通过约束 `let mut` 的左边只能是一个标识符，可以在语义上更清晰地表达“我要声明一个单一的可变变量”。
>
> 因此，本书中的 MiniMoonBit 选择了一种折中方案：
>
> - `let`：左侧允许 pattern，适合一次性解构多个不可变绑定；
> - `let mut`：左侧只允许标识符，如果需要多个可变变量，就写多条语句。

---

## 赋值语句与 LeftValue

赋值语句的基本形式是：

```moonbit
x = 1
```

更一般地，它可以写成：

```plaintext
assign_stmt :
  left_value assign_op expr ;
```

这里的 `assign_op` 包括 `=`, `+=`, `-=`, `*=`, `/=`, `%=` 等。

### LeftValue：左值的形态

赋值语句的左边不仅可以是简单标识符 `x`、`y`，也可以是：

- 数组元素：`arr[1]`；
- 结构体字段：`point.x`；
- 更复杂的组合，例如：`mat[1][2]`、`point_arr[1].x` 等等。

因此，我们需要一个专门的 `LeftValue` 结构来描述“可以出现在赋值左边的东西”：

```plaintext
left_value:
    lower
  | left_value "[" expr "]"
  | left_value "." lower
  ;
```

对应的 AST：

```moonbit
pub enum LeftValueKind {
  Ident(String)
  ArrayAccess(LeftValue, Expr)
  FieldAccess(LeftValue, String)
}

pub struct LeftValue {
  kind: LeftValueKind
  toks: ArrayView[Token]
}
```

解析 `LeftValue` 的方式与 `ApplyExpr` 十分类似：

```moonbit
pub fn parse_left_value(
  tokens : ArrayView[Token],
) -> (LeftValue, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  // 首先必须是一个小写标识符
  guard tokens is [{ kind: Lower(ident), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect a lower ident"))
  }

  let mut left_value = LeftValueKind::Ident(ident)

  // 如果后面既不是 '[' 也不是 '.'，说明这是一个最简单的 left_value
  if !(tokens is [{ kind: Bracket('[') | Symbol("."), .. }, ..]) {
    let toks = slice_tokens(init_tokens, tokens)
    let left_value = LeftValue::{ kind: left_value, toks }
    return (left_value, tokens)
  }

  let (left_value_kind, rest) = loop tokens {
    // 数组访问：lv[expr]
    [{ kind: Bracket('['), .. }, .. tokens] => {
      let (index_expr, tokens) = parse_expr(tokens)
      guard tokens is [{ kind: Bracket(']'), .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expect ']'"))
      }
      left_value = ArrayAccess(left_value, index_expr)
      continue tokens
    }

    // 字段访问：lv.field
    [{ kind: Symbol("."), .. },
     { kind: Lower(field), .. }, .. tokens] => {
      left_value = FieldAccess(left_value, field)
      continue tokens
    }

    // 其它情况：结束
    tokens =>
      break (left_value, tokens)
  }

  let toks = slice_tokens(init_tokens, rest)
  let left_value = LeftValue::{ kind: left_value_kind, toks }
  (left_value, rest)
}
```

> **问：为什么不直接复用** **`ApplyExpr`** **做左值？**
>
> **答**：`ApplyExpr` 允许字面量作为“根”，例如 `1` 或 `'a'`，如果直接用它来做左值，在语法阶段就会默认接受诸如 `1 = 3` 这样的写法。
> 虽然这样的错误最终可以在类型检查阶段被捕获，但从语义上讲，这并不是一个合理的“左值”形态。
> 因此，我们宁可为 LeftValue 单独引入一套更严格的 AST，从语法层面就排除掉明显不合理的赋值左侧。

### 赋值语句的解析

根据 BNF，我们可以直接写出赋值语句的 AST 与解析函数：

```moonbit
pub(all) struct AssignStmt {
  left_value : LeftValue
  op         : AssignOp
  expr       : Expr
  toks       : ArrayView[Token]
}

pub fn parse_assign_stmt(
  tokens : ArrayView[Token],
) -> (AssignStmt, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  let (left_value, tokens) = parse_left_value(tokens)

  guard tokens is [{ kind: AssignOp(op), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect an assign operator"))
  }

  let (expr, tokens) = parse_expr(tokens)
  let toks = slice_tokens(init_tokens, tokens)

  let assign_stmt = AssignStmt::{ left_value, op, expr, toks }

  let last_tok = expr.toks.last().unwrap()
  let tokens = end_stmt(last_tok, tokens)

  (assign_stmt, tokens)
}
```

---

## 语句总体抽象：`Stmt`

到目前为止，我们已经实现了三类语句：

- `let mut` 语句；
- `let` 语句；
- 赋值语句。

在一门完整的语言中，我们还会遇到：

- **表达式语句**：例如返回类型为 Unit 的表达式 `println("Hello")`；
- **`return`** **语句**：可以带一个返回表达式，也可以不带；
- **`break`** **语句**：跳出循环；
- **`continue`** **语句**：开始下一次循环；
- 以及后续要实现的：

  - `while` 语句；
  - `for` 语句；
  - 局部函数定义（local function）。

我们可以为所有这些语句形态设计一个统一的枚举：

```moonbit
pub enum StmtKind {
  LetStmt(LetStmt)
  LetMutStmt(LetMutStmt)
  AssignStmt(AssignStmt)
  WhileStmt(WhileStmt)
  ForStmt(ForStmt)
  ExprStmt(Expr)
  ReturnStmt(Expr?)
  Break
  Continue
  LocalFunction(LocalFunction)
}
```

解析任意一条语句的任务就交给 `parse_stmt`。
它的职责是：**通过观察“第一个（或前几个）Token”，判断应该走哪一条具体的解析分支**。

下面是部分实现（省略后面还没介绍到的分支）：

```moonbit
pub fn parse_stmt(
  tokens : ArrayView[Token]
) -> (Stmt, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens
  match tokens {
    // let mut ...
    [{ kind: Keyword(Let), .. }, { kind: Keyword(Mut), .. }, ..] as tokens => {
      let (let_mut_stmt, rest) = parse_let_mut_stmt(tokens)
      let stmt = Stmt::new(LetMutStmt(let_mut_stmt), init_tokens, rest)
      (stmt, rest)
    }

    // let ...
    [{ kind: Keyword(Let), .. }, ..] as tokens => {
      let (let_stmt, rest) = parse_let_stmt(tokens)
      let stmt = Stmt::new(LetStmt(let_stmt), init_tokens, rest)
      (stmt, rest)
    }

    // while ...
    [{ kind: Keyword(While), .. }, ..] as tokens => {
      let (while_stmt, rest) = parse_while_stmt(tokens)
      let stmt = Stmt::new(WhileStmt(while_stmt), init_tokens, rest)
      (stmt, rest)
    }

    // for ...
    [{ kind: Keyword(For), .. }, ..] as tokens => {
      let (for_stmt, rest) = parse_for_stmt(tokens)
      let stmt = Stmt::new(ForStmt(for_stmt), init_tokens, rest)
      (stmt, rest)
    }

    // fn ... （局部函数）
    [{ kind: Keyword(Fn), .. }, ..] as tokens => {
      let (local_fn, rest) = parse_local_function(tokens)
      let stmt = Stmt::new(LocalFunction(local_fn), init_tokens, rest)
      (stmt, rest)
    }

    ...
  }
}
```

在这个基础框架之上，我们接下来会陆续加入 `return`、`break`、`continue`、表达式语句等分支。

---

## `return`、`break` 与 `continue`

`return`、`break`、`continue` 这三种语句，在语法层面都很简单，但在解析时有一个共同的细节：
**它们后面可能紧跟一个表达式，也可能什么都没有（直接分号或换行结束）** 。

我们可以先写一个辅助函数，判断“此刻是不是已经到达了语句结尾”：

```moonbit
fn is_semi_or_brace_or_newline(
  line: Int,
  tokens: ArrayView[Token]
) -> (Bool, ArrayView[Token]) {
  if tokens is [{ kind: Symbol(";"), .. }, ..] {
    (true, tokens)
  } else if tokens is [{ kind: Bracket('}'), .. }, ..] {
    (true, tokens)
  } else if tokens is [tok, ..] &&
    tok.line != line {
    (true, tokens)
  } else {
    (false, tokens)
  }
}
```

### `return` 语句

`return` 语句的 BNF 可以写成：

```plaintext
return_stmt:
  "return" expr?
```

解析时，逻辑是：

- 如果在 `return` 关键字之后立刻遇到分号 / `}` / 换行，则说明这是一个不带返回值的 `return`；
- 否则就尝试解析一个表达式，作为返回值。

在 `parse_stmt` 中对应的分支可以这样写：

```moonbit
pub fn parse_stmt(
  tokens : ArrayView[Token]
) -> (Stmt, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens
  match tokens {
    ...
    [{ kind: Keyword(Return), line, .. }, .. tokens] => {
      let (expr, rest) = match is_semi_or_brace_or_newline(line, tokens) {
        (true, tokens) => (None, tokens)
        (false, tokens) => {
          let (expr, tokens) = parse_expr(tokens)
          (Some(expr), tokens)
        }
      }
      let stmt = Stmt::new(ReturnStmt(expr), init_tokens, rest)
      (stmt, rest)
    }
    ...
  }
}
```

### `break` 与 `continue`

在完整的 MoonBit 语言中，由于要支持 `loop` 这种函数式循环，`break` / `continue` 后面是可以带表达式的。
在 MiniMoonBit 中，我们选择一个更简单的子集：**`break`** **和** **`continue`** **后面不带表达式，只需要以分号或换行结束即可**。

对应的解析分支如下：

```moonbit
pub fn parse_stmt(
  tokens : ArrayView[Token]
) -> (Stmt, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens
  match tokens {
    ...
    [{ kind: Keyword(Break), line, .. }, ..] as tokens => {
      match is_semi_or_brace_or_newline(line, tokens) {
        (true, rest) => {
          let stmt = Stmt::new(Break, init_tokens, rest)
          (stmt, rest)
        }
        (false, _) =>
          raise ParseError((tokens[0], "Expected ';'"))
      }
    }
    [{ kind: Keyword(Continue), line, .. }, ..] as tokens => {
      match is_semi_or_brace_or_newline(line, tokens) {
        (true, rest) => {
          let stmt = Stmt::new(Continue, init_tokens, rest)
          (stmt, rest)
        }
        (false, _) =>
          raise ParseError((tokens[0], "Expected ';'"))
      }
    }
    ...
  }
}
```

---

## 表达式语句与赋值语句的判别

一个略微微妙的地方是：**以小写标识符开头的语句，到底是赋值语句，还是单纯的表达式语句？**

例如：

- 赋值语句：`foo = 1`；
- 表达式语句：`foo(1, 2)`；
- 更复杂的组合：`foo[1].x = 42`、`foo[1](a, b)` 等。

单纯看第一个 Token 是不够的，甚至看第二个 Token 也不够，因为中间可能出现 `[index]` 或 `.field` 才接上赋值号。

一个简单而有效的策略是：

1. 当第一个 Token 是小写标识符时，先尝试把它解析成一个 `LeftValue`；
2. 看解析完的下一个 Token：

    - 如果是 `AssignOp`，说明这一行是赋值语句；
    - 否则，是表达式语句；
3. 无论是哪种情况，都“丢弃”刚才解析出来的 `LeftValue`，**从原始 Token 视图重新开始解析**：

    - 对于赋值语句，调用 `parse_assign_stmt`；
    - 对于表达式语句，调用 `parse_expr`。

对应的 `parse_stmt` 分支如下：

```moonbit
pub fn parse_stmt(
  tokens : ArrayView[Token]
) -> (Stmt, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens
  match tokens {
    ...
    [{ kind: Lower(_), .. }, ..] as tokens => {
      // 先试着解析出一个 LeftValue，看它后面是不是赋值操作符
      let (_, rest) = parse_left_value(tokens)
      if rest is [{ kind: AssignOp(_), .. }, ..] {
        let (assign_stmt, rest) = parse_assign_stmt(tokens)
        let stmt = Stmt::new(AssignStmt(assign_stmt), init_tokens, rest)
        (stmt, rest)
      } else {
        // 否则当作表达式语句
        let (expr, rest) = parse_expr(tokens)
        let last_tok = expr.toks.last().unwrap()
        let rest = end_stmt(last_tok, rest)
        let stmt = Stmt::new(ExprStmt(expr), init_tokens, rest)
        (stmt, rest)
      }
    }
    ...
  }
}
```

这样，我们就优雅地解决了“以标识符开头的语句，到底是赋值还是表达式”的歧义问题。

---

## 块表达式：`BlockExpr`

接下来是 **块表达式**（`BlockExpr`）。
在 MoonBit 中，一个块不仅是一个语句序列，**还是一个表达式**。它的值是块内部最后一个表达式的值：

```moonbit
let x = { let a = 1; let b = 2; a + b }
// x 的值是 3
```

在 AST 中，我们这样表示 BlockExpr：

```moonbit
pub struct BlockExpr {
  stmts: Array[Stmt]
  toks: ArrayView[Token]
}
```

解析逻辑也相当直接：
从左花括号 `{` 开始，不断解析语句，直到遇到右花括号 `}`。

```moonbit
pub fn parse_block_expr(
  tokens : ArrayView[Token],
) -> (BlockExpr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Bracket('{'), .. }, .. tokens] else {
    println("Expected '{' at the beginning of a block expression.")
    panic()
  }

  let stmts : Array[Stmt] = Array::new()

  let tokens = loop tokens {
    [{ kind: Bracket('}'), .. }, .. rest] =>
      break rest
    tokens => {
      let (stmt, tokens) = parse_stmt(tokens)
      stmts.push(stmt)
      continue tokens
    }
  }

  let toks = slice_tokens(init_tokens, tokens)
  let block_expr = BlockExpr::{ stmts, toks }

  (block_expr, tokens)
}
```

有了 `BlockExpr` 之后，我们需要在 `ExprKind` 中增加相应分支：

```moonbit
pub enum ExprKind {
  // ... 其它表达式 ...
  BlockExpr(BlockExpr)
}
```

并在 `parse_expr` 的一开始就对 `{` 做专门处理：

```moonbit
pub fn parse_expr(
  tokens : ArrayView[Token],
) -> (Expr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  match tokens[0].kind {
    Bracket('{') => {
      let (block, rest) = parse_block_expr(tokens)
      let kind = ExprKind::BlockExpr(block)
      let expr = Expr::new(kind, init_tokens, rest)
      return (expr, rest)
    }
    _ => ()
  }

  // ... 其它表达式的处理（if / match / 普通 expr 等） ...
}
```

> **注意**：MoonBit 不允许两个块表达式之间直接进行二元运算，比如 `{ 1 + 2 } * { 3 + 4 }`。
> 这是语言设计者在可读性上的一个刻意选择。
> 因此，把 BlockExpr 的解析放在 `parse_expr` 的最前面，也有助于在类型检查阶段对这种写法做更严格的约束。

---

## `if` 表达式

接下来是 `if` 表达式。
在 MoonBit 中，`if` 也同样是一个表达式：它有一个条件表达式，一个 `then` 块，以及一个可选的 `else` 块。`else` 部分要么是一个直接的块，要么是另一个 `if` 表达式（`else if`）。

对应的 BNF 可以写成：

```plaintext
if_expr:
    "if" expr block_expr else_block?

else_block:
  "else" (block_expr | if_expr)
```

由于 `else` 可以接另一层 `if`，我们用 `Either` 来表示“二选一”的结构：

```moonbit
pub(all) struct IfExpr {
  cond       : Expr
  then_block : BlockExpr
  else_block : Either[IfExpr, BlockExpr]?
  toks       : ArrayView[Token]
}
```

解析函数的实现如下：

```moonbit
pub fn parse_if_expr(
  tokens : ArrayView[Token],
) -> (IfExpr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(If), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect 'if'"))
  }

  let (cond, tokens) = parse_expr(tokens)
  let (then_block, tokens) = parse_block_expr(tokens)

  let (else_block, tokens) = match tokens {
    // else if ...
    [{ kind: Keyword(Else), .. }, { kind: Keyword(If), .. }, ..] as tokens => {
      let (else_if, tokens) = parse_if_expr(tokens[1:])
      (Some(Either::Left(else_if)), tokens)
    }

    // else { ... }
    [{ kind: Keyword(Else), .. }, { kind: Bracket('{'), .. }, ..] as tokens => {
      let (else_block, tokens) = parse_block_expr(tokens[1:])
      (Some(Either::Right(else_block)), tokens)
    }

    // 没有 else
    _ =>
      (None, tokens)
  }

  let toks = slice_tokens(init_tokens, tokens)
  let if_expr = IfExpr::{ cond, then_block, else_block, toks }

  (if_expr, tokens)
}
```

与 BlockExpr 一样，我们需要在 `ExprKind` 和 `parse_expr` 中把 `if` 作为一种特殊的表达式形态处理：

```moonbit
pub enum ExprKind {
  // .. other expr
  IfExpr(IfExpr)
}

pub fn parse_expr(
  tokens : ArrayView[Token],
) -> (Expr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  match tokens[0].kind {
    Keyword(If) => {
      let (if_expr, rest) = parse_if_expr(tokens)
      let kind = ExprKind::IfExpr(if_expr)
      let expr = Expr::new(kind, init_tokens, rest)
      return (expr, rest)
    }
    _ => ()
  }

  // ... 其它表达式 ...
}
```

> 你可能会问：
>  **“如果 then 块和 else 块的最后一个表达式返回类型不同怎么办？”** 
> 这是类型检查阶段要关心的问题，在本章的语法分析中，我们只需要保证语法结构正确即可。
> 在后面的类型检查章节中，我们会要求所有分支最终的结果类型必须一致，否则就报类型错误。

---

## `while` 与 `for` 循环

有了 `block` 和 `if` 之后，接下来就是循环结构了。

### `while` 语句

`while` 的 BNF 十分简单：

```plaintext
while_stmt:
  "while" expr block_expr
```

AST 与解析函数可以这样写：

```moonbit
pub struct WhileStmt {
  cond : Expr
  body : BlockExpr
  toks : ArrayView[Token]
}

pub fn parse_while_stmt(
  tokens : ArrayView[Token],
) -> (WhileStmt, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(While), .. }, .. tokens] else {
    println("Compiler ICE: Misuse parse_while_stmt")
    panic()
  }

  let (cond, tokens) = parse_expr(tokens)
  let (body, tokens) = parse_block_expr(tokens)

  let toks = slice_tokens(init_tokens, tokens)
  let while_stmt = WhileStmt::{ cond, body, toks }

  (while_stmt, tokens)
}
```

### `for` 语句：受限的 C 风格循环

MoonBit 中的 `for` 比较特别，它支持两种形态：

- C 风格的三段式 `for`；
- 迭代式的 `for-in` 循环。

在 MiniMoonBit 中，我们选择只支持一种受限的 C 风格三段式循环：

```moonbit
for i = 0; i < 10; i = i + 1 {
  println(i)
}
```

之所以说是“受限”，是因为与 C/C++ 的 `for` 相比，MoonBit 对初始化和步进部分做了更严格的约束：

- 初始化部分必须是简单赋值（`lower = expr`），而不是任意表达式；
- 步进部分也必须是对这些变量做简单的赋值（`lower assign_op expr`），不能是任意函数调用或复杂表达式。

例如下面两种写法在 MoonBit 中都是不允许的：

```moonbit
// 报错：步进表达式必须是简单赋值形式
for i = []; i.length() < 10; i.push(1) {
  ...
}

// 报错：步进表达式必须只更新初始化中的变量
let mut x = 10
for i = 0; i < 10; i = i + 1, x = i + 1 {
  ...
}
```

这类约束在一定程度上牺牲了一些“语法自由度”，但换来了更清晰的语义与更容易实现的优化。

BNF 可以写成：

```plaintext
for_stmt:
  "for" for_inits? ";" expr? ";" for_steps? block_expr

for_inits :
  for_init ("," for_init)*

for_init:
  lower "=" expr

for_steps:
  for_step ("," for_step)*

for_step:
  lower assign_op expr
```

在解析时，我们依次处理：

1. `for` 关键字；
2. 可选的初始部分 `for_inits`；
3. 分号；
4. 可选的循环条件表达式 `expr`；
5. 再一个分号；
6. 步进部分 `for_steps`；
7. 循环体 `block_expr`。

解析函数如下：

```moonbit
pub fn parse_for_stmt(
  tokens : ArrayView[Token],
) -> (ForStmt, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(For), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect 'for'"))
  }

  let (inits, tokens) = parse_for_inits(tokens)

  guard tokens is [{ kind: Symbol(";"), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect ';'"))
  }

  // 循环条件可以为空
  let (cond, tokens) = if tokens is [{ kind: Symbol(";"), .. }, .. tokens] {
    (None, tokens)
  } else {
    let (expr, tokens) = parse_expr(tokens)
    guard tokens is [{ kind: Symbol(";"), .. }, .. tokens] else {
      raise ParseError((tokens[0], "Expect ';'"))
    }
    (Some(expr), tokens)
  }

  let (steps, tokens) = parse_for_steps(tokens)
  let (body, tokens) = parse_block_expr(tokens)

  let toks = slice_tokens(init_tokens, tokens)
  let for_stmt = ForStmt::{ inits, cond, steps, body, toks }

  (for_stmt, tokens)
}
```

其中 `parse_for_inits` 和 `parse_for_steps` 分别负责解析初始化部分和步进部分：

```moonbit
pub fn parse_for_inits(
  tokens : ArrayView[Token],
) -> (Array[(String, Expr)], ArrayView[Token]) raise ParseError {
  let inits : Array[(String, Expr)] = Array::new()

  let tokens = match tokens {
    [{ kind: Lower(name), .. },
     { kind: AssignOp(Assign), .. }, .. tokens] => {
      let (expr, rest) = parse_expr(tokens)
      inits.push((name, expr))
      rest
    }
    tokens =>
      tokens // 允许没有初始化部分
  }

  let tokens = loop tokens {
    [{ kind: Symbol(","), .. },
     { kind: Lower(name), .. },
     { kind: AssignOp(Assign), .. },
     .. tokens] => {
      let (expr, rest) = parse_expr(tokens)
      inits.push((name, expr))
      continue rest
    }
    tokens =>
      break tokens
  }

  (inits, tokens)
}

pub fn parse_for_steps(
  tokens : ArrayView[Token],
) -> (Array[(String, AssignOp, Expr)], ArrayView[Token]) raise ParseError {
  let steps : Array[(String, AssignOp, Expr)] = Array::new()

  let tokens = match tokens {
    [{ kind: Lower(name), .. },
     { kind: AssignOp(op), .. }, .. tokens] => {
      let (expr, rest) = parse_expr(tokens)
      steps.push((name, op, expr))
      rest
    }
    tokens =>
      tokens // 允许没有步进部分
  }

  let tokens = loop tokens {
    [{ kind: Symbol(","), .. },
     { kind: Lower(name), .. },
     { kind: AssignOp(op), .. }, .. tokens] => {
      let (expr, rest) = parse_expr(tokens)
      steps.push((name, op, expr))
      continue rest
    }
    tokens =>
      break tokens
  }

  (steps, tokens)
}
```

> ### 旁注：MoonBit 中的 while / for 表达式
>
> 在本书的 MiniMoonBit 里，我们把 `while` 和 `for` 设计成“纯语句”，它们本身不产生值。
> 但在完整的 MoonBit 中，`while` 和 `for` 也可以作为 **表达式** 存在，并且支持 `else` 分支与带值的 `break` / `continue`。
>
> 例如：
>
> ```moonbit
> let result = while condition {
>   if should_break {
>     break "early exit value"
>   }
> } else {
>   "normal completion value"
> }
> ```
>
> 或：
>
> ```moonbit
> let sum = for i = 1, acc = 0; i <= 6; i = i + 1 {
>   if i % 2 == 0 {
>     continue i + 1, acc + i
>   }
> } else {
>   acc
> }
> ```
>
> 这类高级特性需要在语义和类型检查层面做更多设计，本书会在闭包转换与控制流相关章节里再做一些延伸性的讨论；
> 对于 MiniMoonBit 来说，目前的“语句版 while/for”已经足够支撑后续的编译管线。

在实现完 `while_stmt` 和 `for_stmt` 之后，不要忘记回到 `parse_stmt` 中，补上相应分支（前文已经展示了完整写法）。

---

## `match` 表达式

最后，我们来看一个在 MoonBit 中非常重要、也非常有表达力的结构：**`match`** **表达式**。

`match` 的作用是：对一个表达式的结果做模式匹配，并根据不同的分支执行不同的表达式。
每个分支称为一个 `match_arm`，由三部分构成：

1. `pattern`：要匹配的模式；
2. 可选的 `match_guard`：一个附加的布尔条件；
3. `body`：匹配成功、条件通过后要执行的表达式。

BNF 可以写成：

```plaintext
match_expr :
  "match" expr "{" match_arm+ "}"

match_arm:
  pattern match_guard? "=>" expr ";"

match_guard:
  "if" expr
```

需要注意的是，每个 `match_arm` 的末尾有一个**可以省略的分号**，这会在实现中稍微带来一点麻烦；
我们稍后会利用 `end_stmt` 来消除这种麻烦。

### 扩展 Pattern：布尔值、整数与枚举

在 `let` 语句中，我们只支持了标识符、通配符和元组模式。
而在 `match` 中，我们需要支持更多的模式形式，比如：

- 布尔常量：`true` / `false`；
- 整数常量：`0`、`1`、`42`；
- 简单的枚举模式：`Color::Red`、`Color::RGB(r, g, b)` 等。

我们可以将 Pattern 的 BNF 扩展为：

```plaintext
pattern :
    lower
  | "_"
  | boolean
  | int
  | (upper "::")? upper ("(" pattern_list ")")?
  | "(" pattern_list ")"
  ;
```

对应地，Pattern 的数据结构扩展为：

```moonbit
pub enum PatternKind {
  Wildcard
  Boolean(Bool)
  Integer(Int)
  Ident(String)
  Tuple(Array[Pattern])
  EnumVariant(String?, String, Array[Pattern])
}
```

解析函数 `parse_pattern_kind` 也要做相应扩展：

```moonbit
pub fn parse_pattern_kind(
  tokens : ArrayView[Token],
) -> (PatternKind, ArrayView[Token]) raise ParseError {
  match tokens {
    [{ kind: Wildcard, .. }, .. tokens] =>
      (Wildcard, tokens)

    [{ kind: Lower(ident), .. }, .. tokens] =>
      (Ident(ident), tokens)

    // 括号模式（元组）
    [{ kind: Bracket('('), .. } as tok, .. tokens] => {
      let (patterns, tokens) = parse_pattern_kind_list(tokens)
      guard tokens is [{ kind: Bracket(')'), .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expected ')'"))
      }
      let kind = match patterns.length() {
        0 =>
          raise ParseError((tok, "Invalid pattern: empty tuple"))
        1 =>
          patterns[0].kind
        _ =>
          PatternKind::Tuple(patterns)
      }
      (kind, tokens)
    }

    // 负整数常量：-42
    [{ kind: BinaryOp(Sub), .. },
     { kind: Int(v), .. }, .. tokens] =>
      (Integer(-v), tokens)

    // 正整数常量
    [{ kind: Int(v), .. }, .. tokens] =>
      (Integer(v), tokens)

    // 布尔常量
    [{ kind: Bool(v), .. }, .. tokens] =>
      (Boolean(v), tokens)

    // 枚举模式：Tag::Variant(...) 或 Variant(...)
    [{ kind: Upper(name1), .. }, .. tokens] => {
      let (tag, enum_name, tokens) = match tokens {
        [{ kind: Symbol("::"), .. },
         { kind: Upper(name2), .. }, ..tokens] => {
          (Some(name1), name2, tokens)
        }
        _ =>
          (None, name1, tokens)
      }

      match tokens {
        [{ kind: Bracket('('), .. }, ..tokens] => {
          let (patterns, tokens) = parse_pattern_kind_list(tokens)
          guard tokens is [{ kind: Bracket(')'), .. }, .. tokens] else {
            raise ParseError((tokens[0], "Expected ')'"))
          }
          (EnumVariant(tag, enum_name, patterns), tokens)
        }
        _ =>
          (EnumVariant(tag, enum_name, []), tokens)
      }
    }
  }
}
```

> **问：这样一来，****`let 1 = 2`** **这种语句在语法上不就变得“合法”了吗？**
>
> **答**：是的，从语法角度看，`1` 被视为一个 `Integer` 模式，是合法的。
> 但在语义上，这样的 `let` 显然没有意义，甚至在类型上根本不成立。
> 我们会把这类错误留到 **类型检查** 阶段去发现——那里可以利用“模式类型”和“右边表达式类型”的信息，做更加精细的检查。
> 在语法设计中，有时需要在“语法完备性”和“早期报错”之间做权衡：
> 过于保守的语法规则会变得很复杂；合适地把一部分工作交给类型检查，有时反而能让整体实现更加清晰。

### MatchArm 的 AST 与解析

每个 `match` 分支——`match_arm`——可以这样表示：

```moonbit
pub struct MatchArm {
  pattern     : Pattern
  match_guard : Expr?
  body        : Expr
  toks        : ArrayView[Token]
}
```

解析函数对应于 BNF：

```moonbit
pub fn parse_match_arm(
  tokens : ArrayView[Token],
) -> (MatchArm, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  let (pattern, tokens) = parse_pattern(tokens)

  // 可选的 match guard：if expr
  let (match_guard, tokens) = match tokens {
    [{ kind: Keyword(If), .. }, .. rest] => {
      let (guard_expr, rest) = parse_expr(rest)
      (Some(guard_expr), rest)
    }
    tokens =>
      (None, tokens)
  }

  guard tokens is [{ kind: Symbol("=>"), .. }, .. rest] else {
    raise ParseError((tokens[0], "Expected `=>` in match arm"))
  }

  let (body, tokens) = parse_expr(rest)

  let toks = slice_tokens(init_tokens, tokens)
  let match_arm = MatchArm::{ pattern, match_guard, body, toks }

  // 注意：末尾分号可以省略，用 end_stmt 统一处理
  let last_tok = body.toks[body.toks.length() - 1]
  let tokens = end_stmt(last_tok, tokens)

  (match_arm, tokens)
}
```

### `match` 表达式的解析

最后，我们来实现 `match_expr` 本身。
它的 AST 大致可以是：

```moonbit
pub struct MatchExpr {
  cond : Expr
  arms : Array[MatchArm]
  toks : ArrayView[Token]
}
```

解析函数：

```moonbit
pub fn parse_match_expr(
  tokens : ArrayView[Token],
) -> (MatchExpr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(Match), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expected 'match' keyword"))
  }

  let (expr, tokens) = parse_expr(tokens)

  guard tokens is [{ kind: Bracket('{'), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expected `{` after match expression"))
  }

  let arms : Array[MatchArm] = Array::new()

  let tokens = loop tokens {
    [{ kind: Bracket('}'), .. }, .. tokens] =>
      break tokens
    tokens => {
      let (arm, rest) = parse_match_arm(tokens)
      arms.push(arm)
      continue rest
    }
  }

  let toks = slice_tokens(init_tokens, tokens)
  let match_expr = MatchExpr::{ cond: expr, arms, toks }

  (match_expr, tokens)
}
```

同样，我们需要在 `ExprKind` 和 `parse_expr` 中加入 `MatchExpr` 分支：

```moonbit
pub enum ExprKind {
  // .. other expr
  MatchExpr(MatchExpr)
}

pub fn parse_expr(
  tokens : ArrayView[Token],
) -> (Expr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  match tokens[0].kind {
    Keyword(Match) => {
      let (match_expr, rest) = parse_match_expr(tokens)
      let kind = ExprKind::MatchExpr(match_expr)
      let expr = Expr::new(kind, init_tokens, rest)
      return (expr, rest)
    }
    _ => ()
  }

  // ... 其它表达式 ...
}
```

---

## 局部函数（Local Function）

最后，我们来实现一个非常重要、也为后续闭包转换铺路的特性：**local function**，也就是在函数内部再定义函数。

在语法层面，local function 与顶层函数非常相似：

```plaintext
local_function:
  "fn" lower "(" local_arg_list? ")" ("->" type)? block_expr

local_arg_list:
  local_arg ("," local_arg)* ","?

local_arg:
  lower (":" type)?
```

AST 可以写成：

```moonbit
pub struct LocalFunction {
  fname      : String
  param_list : Array[(String, Type?)]
  ret_ty     : Type?
  body       : BlockExpr
  toks       : ArrayView[Token]
}
```

解析函数的实现如下：

```moonbit
pub fn parse_local_function(
  tokens : ArrayView[Token],
) -> (LocalFunction, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(Fn), .. }, .. tokens] else {
    println("Compiler ICE: Misuse parse_local_function")
    panic()
  }

  guard tokens is [{ kind: Lower(fname), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect lower ident as function name"))
  }

  guard tokens is [{ kind: Bracket('('), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect '('"))
  }

  let (param_list, tokens) = match tokens {
    [{ kind: Bracket(')'), .. }, .. tokens] =>
      ([], tokens)
    tokens => {
      let (param_list, tokens) = parse_local_arg_list(tokens)
      guard tokens is [{ kind: Bracket(')'), .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expect ')'"))
      }
      (param_list, tokens)
    }
  }

  let (ret_ty, tokens) = match tokens {
    [{ kind: Symbol("->"), .. }, .. tokens] => {
      let (ty, tokens) = parse_type(tokens)
      (Some(ty), tokens)
    }
    tokens =>
      (None, tokens)
  }

  let (body, tokens) = parse_block_expr(tokens)

  let toks = slice_tokens(init_tokens, tokens)
  let local_function = LocalFunction::{ fname, param_list, ret_ty, body, toks }

  (local_function, tokens)
}
```

其中 `parse_local_arg_list` 负责处理参数列表：

```moonbit
pub fn parse_local_arg_list(
  tokens : ArrayView[Token],
) -> (Array[(String, Type?)], ArrayView[Token]) raise ParseError {
  let params : Array[(String, Type?)] = Array::new()

  let tokens = match tokens {
    [{ kind: Lower(name), .. }, 
     { kind: Symbol(":"), .. }, .. tokens] => {
      let (ty, tokens) = parse_type(tokens)
      params.push((name, Some(ty)))
      tokens
    }
    [{ kind: Lower(name), .. }, .. tokens] => {
      params.push((name, None))
      tokens
    }
    tokens =>
      raise ParseError((tokens[0], "Expected a lower ident"))
  }

  let tokens = loop tokens {
    [{ kind: Symbol(","), .. },
     { kind: Lower(name), .. },
     { kind: Symbol(":"), .. }, .. tokens] => {
      let (ty, tokens) = parse_type(tokens)
      params.push((name, Some(ty)))
      continue tokens
    }
    [{ kind: Symbol(","), .. },
     { kind: Lower(name), .. }, .. tokens] => {
      params.push((name, None))
      continue tokens
    }
    // 允许拖尾逗号：fn f(x: Int, y: Int,) ...
    [{ kind: Symbol(","), .. },
     { kind: Bracket(')'), .. }, ..] as tokens => {
      break tokens[1:]
    }
    tokens =>
      break tokens
  }

  (params, tokens)
}
```

定义完 LocalFunction 之后，别忘了在 `StmtKind` 和 `parse_stmt` 中加入 `LocalFunction` 的分支（前文已经展示了如何接入）。

---

## 本章小结

本章我们从表达式走向了完整的语句与复杂控制结构，实现了 MiniMoonBit 语法分析器的一个“里程碑节点”：

- **语句级别**：实现了 `let mut`、`let`、赋值、`return`、`break`、`continue`、`while`、受限版 `for` 以及表达式语句；
- **表达式级别**：在第 6 章的基础上，进一步加入了 `BlockExpr`、`IfExpr`、`MatchExpr` 等复杂表达式结构；
- **模式匹配**：扩展了 pattern 的能力，使其既能服务于 `let`，也能支撑 `match` 的模式匹配；
- **局部函数**：为后续闭包与环境捕获奠定了语法基础。

在这一系列工作之后，我们已经拥有了一棵结构丰富、类型信息尚待填充的语法树。
接下来的章节中，我们会进入 **类型检查与解糖** 的世界，让这棵语法树“长上类型”，并逐步将高级语法糖还原成更核心、更便于优化与代码生成的中间形式。
