---
title: Chapter 6. 语法分析 - 简单表达式
---

在前一章中，我们已经为 MiniMoonBit 构建了一个能解析 **类型（Type）**  的语法分析器。本章要跨过表达式解析这一座真正的“高山”——在绝大多数语言里，**表达式（expression）部分往往是语法分析中最棘手的部分**：

- 表达式形态极其丰富：常量、变量、函数调用、数组访问、结构体与枚举构造……
- 运算符众多：一元运算符、二元运算符，外加一整套优先级和结合性规则；
- 稍不注意，就会在优先级、括号处理、错误提示等细节上踩坑。

在 MiniMoonBit 中，我们会用一条相对“温和”的路径来征服这座高山：

1. 先弄清楚所谓的“**基础元素**”是什么——比如 `1`、`a`、`log(1)`、`vec[1]` 这类单元；
2. 再在此基础上，逐步构造出更复杂的表达式结构；
3. 最后处理一元运算符与二元运算符，解决优先级问题。

在实现上，我们会把表达式分成三层来处理：

- **`AtomExpr`**：最基础的“原子表达式”；
- **`ApplyExpr`**：在原子表达式基础上叠加函数调用、数组下标、字段访问等“应用操作”；
- **`Expr`**：在 `ApplyExpr` 的基础上再叠加一元、二元运算符，形成完整的表达式。

这一层层的拆分，会让我们的语法分析代码保持清晰，同时也便于后面做类型检查和 IR 转换。

---

## AtomExpr：原子表达式

我们先从最底层开始：**什么叫“原子表达式”（****`AtomExpr`** **）？**

直觉上，你可以把下面这些东西都看作“原子”：

- 字面量：`1`、`2.0`、`'a'`、`"hello"`；
- 变量名：`x`、`y`；
- 简单的括号表达式：`(1 + 2)`；
- 元组表达式：`(1, 2, 3 + 4)`；
- 数组表达式：`[1, 2, 3 + 4]`；
- 枚举构造表达式：`Color::Red`、`Color::Rgb(255, 0, 0)`；
- 结构体构造表达式：`Point::{ x: 1, y: 2 }`。

### AtomExpr 是“表达式世界的基石”

> **问：****`Atom`** **不是“不可再分”的意思吗？** **`(1, 2)`**  **这样的东西里明明还有子表达式，为什么也叫 AtomExpr？**
>
> 从实现角度看，`AtomExpr` 的“原子性”并不是说它内部再也没有结构，而是指：
> **在更高一层的表达式组合中，我们把它当作一个整体单元来使用。** 
> 比如在处理运算符优先级时，我们不会把 `1` 和 `2` 拿出来单独和 `+`/`*` 比较，而是先把括号、数组、元组等握成一个“球”，再在这些“球”和运算符之间做组合。
>
> 换句话说：
>
> - `AtomExpr` 是“在表达式组合层面上不再继续拆分”的单位；
> - 但在 AST 内部，它仍然可以有丰富的子结构，这些子结构会在后续阶段（如类型检查、IR 生成）中被用到。

根据我们在词法分析阶段定义的 Token 种类，可以把属于 `AtomExpr` 的形态大致列出来：

1. 整数，包括 `Int`、`Int64`、`UInt`、`UInt64`；
2. 浮点数，包括 `Float`、`Double`；
3. 字符与字符串字面量，包括 `Char`、`String`；
4. 标识符（变量名），例如 `x`，以及带前缀的形式：`Int::to_double`、`Array::make` 等；
5. **Unit** 值 `()`；
6. 括号表达式：`(1 + 2)`；
7. 元组表达式：`(1, 2, 3 + 4)`；
8. 数组表达式：`[1, 2, 3 + 4]`；
9. 枚举构造表达式：`Color::Red`、`Color::Rgb(255, 0, 0)`；
10. 结构体构造表达式：`Point::{ x: 1, y: 2 }`、`User::{ name: "Alice", phone: "1234" }`。

> 这里特别说一下 **Unit**：
> 在函数式编程中，一般会把“只有一个值的类型”称为 Unit 类型，它的唯一值通常写作 `()`。
> 如果你更熟悉 C 语言，可以**暂时**把它类比成 `void`，但要注意：
>
> - C 的 `void` 更像是“没有值”，不能用在变量上；
> - 而 Unit 则是真正有“值”的类型，只不过这个值没有携带任何额外信息。
>   在 MiniMoonBit 里，我们会频繁用到 Unit，尤其是在某些“主要是靠副作用工作”的表达式和语句上。

### 用 BNF 描述 AtomExpr

我们可以用一小段 BNF 来概括 AtomExpr 的语法形态：

```plaintext
atom_expr :
    int | int64 | uint | uint64
  | double | float | char | string
  | (upper "::")? lower
  | "(" ")"
  | "(" expr ")"
  | "(" expr_list ")"
  | "[" expr_list "]"
  | enum_construct
  | struct_construct
  ;

expr_list :
  expr ("," expr)* ","?

enum_construct:
  (upper "::")? upper ("(" expr_list ")")?

struct_construct:
  upper "::" "{" field_list? "}"

field_list:
  field_expr ("," field_expr)* ","?

field_expr:
  lower ":" expr
```

这里的：

- `|` 表示“或者”；
- `?` 表示“出现 0 次或 1 次”（可选）；
- `*` 表示“出现 0 次或多次”；
- 末尾的 `","?` 意味着允许在最后一个元素后面保留一个“拖尾逗号”（trailing comma）。

### 用代数数据类型刻画 AtomExpr

在 MiniMoonBit 的实现中，我们用一个枚举来表示各种 AtomExpr 形态：

```moonbit
pub enum AtomExprKind {
  Int(Int)                    // 1, 42, etc
  Int64(Int64)                // 1L, 42L, etc
  UInt(UInt)                  // 1U, 42U, etc
  UInt64(UInt64)              // 1UL, 42UL, etc
  Double(Double)              // 1.0, 3.14, etc
  Float(Double)               // 1.0F, 3.14F (stored as Double)
  Char(Char)                  // 'a', '\n', etc
  Bool(Bool)                  // true | false
  String(String)              // "hello", etc
  Ident(String?, String)      // var, Array::make
  Unit                        // ()
  Paren(Expr)                 // (expr)
  Tuple(Array[Expr])          // (expr, expr, ...)
  Array(Array[Expr])          // [expr, expr, ...]
  EnumConstruct(String?, String, Array[Expr]) // EnumTag::Variant(expr, ...)
  StructConstruct(StructConstructExpr)        // StructName::{ field: expr, ... }
}
```

与前几章类似，我们再包一层，把“具体形态”和“源代码 Token 区间”绑在一起：

```moonbit
pub struct AtomExpr {
  kind : AtomExprKind
  toks : ArrayView[Token]
}
```

这里的 `toks` 是一段 `ArrayView[Token]`，表示这个 AtomExpr 在原代码中对应的是哪一段 Token 视图。这在调试和错误提示时非常重要：
无论是类型错误还是运行时错误，都可以很容易地把问题定位回具体的源代码片段。

为了方便构造，我们再定义一个小小的辅助函数：

```moonbit
pub fn AtomExpr::new(
  kind : AtomExprKind,
  init_tokens : ArrayView[Token],
  rest_tokens : ArrayView[Token],
) -> AtomExpr {
  let toks = slice_tokens(init_tokens, rest_tokens)
  AtomExpr::{ kind, toks }
}

fn slice_tokens(
  init_tokens: ArrayView[Token],
  rest_tokens: ArrayView[Token]
) -> ArrayView[Token] {
  let start_offset = init_tokens.start_offset()
  let end_offset = rest_tokens.start_offset()
  let diff_offset = end_offset - start_offset
  init_tokens[0:diff_offset]
}
```

`slice_tokens` 的含义是：
**根据“解析前的 Token 视图”和“解析结束后的剩余视图”，裁剪出中间那一段刚刚被消费掉的 Token 区间。** 
这段区间正好就是当前 AST 节点在源代码里的对应位置。

### 解析简单 AtomExpr：字面量与标识符

接下来，我们来看看 `parse_atom_expr` 的雏形。它的类型签名与前面解析类型的函数类似：

```moonbit
fn parse_atom_expr(
  tokens: ArrayView[Token]
) -> (AtomExpr, ArrayView[Token]) raise ParseError {
  ...
}
```

我们的基本约定是：

- **输入**：当前还没解析的 Token 视图；
- **输出**：一个 `AtomExpr` 节点，以及消费掉对应 Token 之后剩余的 Token 视图；
- **错误**：如果看到的 Token 不符合 AtomExpr 的语法，就抛出 `ParseError`。

先从最简单的几种情况开始：各种字面量和标识符。

```moonbit
fn parse_atom_expr(
  tokens: ArrayView[Token]
) -> (AtomExpr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens
  let (kind, rest) = match tokens {
    [{ kind: Int(v),     .. }, .. rest]    => (Int(v), rest)
    [{ kind: Int64(v),   .. }, .. rest]    => (Int64(v), rest)
    [{ kind: UInt(v),    .. }, .. rest]    => (UInt(v), rest)
    [{ kind: UInt64(v),  .. }, .. rest]    => (UInt64(v), rest)
    [{ kind: Double(v),  .. }, .. rest]    => (Double(v), rest)
    [{ kind: Float(v),   .. }, .. rest]    => (Float(v), rest)
    [{ kind: Char(c),    .. }, .. rest]    => (Char(c), rest)
    [{ kind: Bool(v),    .. }, .. rest]    => (Bool(v), rest)
    [{ kind: String(s),  .. }, .. rest]    => (String(s), rest)
    // 普通小写开头标识符：x, y
    [{ kind: Lower(ident), .. }, .. rest] =>
      (Ident(None, ident), rest)
    // 带前缀的标识符：Array::make, Int::to_double
    [ { kind: Upper(tag), .. },
      { kind: Symbol("::"), .. },
      { kind: Lower(ident), .. }, .. rest] =>
      (Ident(Some(tag), ident), rest)
    // 其它情况：不是合法的 AtomExpr
    tokens =>
      raise ParseError((tokens[0], "Invalid atom expression"))
  }
  let atom_expr = AtomExpr::new(kind, init_tokens, rest)
  (atom_expr, rest)
}
```

这里我们使用了 MoonBit 的数组模式匹配能力：

- `[{ kind: Int(v), .. }, .. rest]`
  表示：当前视图中第一个元素是 `kind: Int(v)` 的 Token，其余部分记作 `rest`；
- `[..]` 中的 `..` 表示“这个结构体的其它字段我不关心”；
- 外层的 `.. rest` 则表示“剩余的 Token 视图”。

当看到不符合任何 AtomExpr 开头形态的 Token 时，我们直接抛出 `ParseError`，并让上层调用者（例如表达式解析或语句解析）去负责把错误展示给用户。

### 为复杂 AtomExpr 预留入口

像括号表达式、数组表达式、枚举构造、结构体构造等，都需要在内部调用 `parse_expr` 或 `parse_expr_list`。
由于我们目前还没有实现完整的 `Expr` 解析，可以先只留出接口：

```moonbit
fn parse_expr(
  tokens: ArrayView[Token]
) -> (Expr, ArrayView[Token]) raise ParseError {
  ...
}
```

同时，在 `parse_atom_expr` 中为复杂形态预留分支：

```moonbit
pub fn parse_atom_expr(
  tokens : ArrayView[Token],
) -> (AtomExpr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens
  let (kind, rest) = match tokens {
    // ... 前面的字面量与标识符分支 ...
    [ { kind: Upper(name), .. },
      { kind: Symbol("::"), .. },
      { kind: Bracket('{'), .. }, ..rest] =>
      parse_struct_construct(name, rest)
    [{ kind: Upper(name), .. }, ..rest] =>
      parse_enum_construct(name, rest)
    [{ kind: Bracket('('), .. }, ..rest] =>
      parse_paren_expr(rest)
    [{ kind: Bracket('['), .. }, ..rest]  =>
      parse_array_expr(rest)
    tokens =>
      raise ParseError((tokens[0], "Invalid atom expression"))
  }
  let atom_expr = AtomExpr::new(kind, init_tokens, rest)
  (atom_expr, rest)
}
```

配套的几个辅助解析函数可以先只声明出类型，暂时用 `...` 作为函数体占位，等到我们实现完 `Expr` 之后，再回过头来填上：

```moonbit
fn parse_paren_expr(
  tokens : ArrayView[Token],
) -> (AtomExprKind, ArrayView[Token]) raise ParseError {
  ...
}

fn parse_array_expr(
  tokens : ArrayView[Token],
) -> (AtomExprKind, ArrayView[Token]) raise ParseError {
  ...
}

fn parse_enum_construct(
  name: String,
  tokens : ArrayView[Token],
) -> (AtomExprKind, ArrayView[Token]) raise ParseError {
  ...
}

pub fn parse_struct_construct(
  name: String,
  tokens : ArrayView[Token],
) -> (AtomExprKind, ArrayView[Token]) raise ParseError {
  ...
}
```

MoonBit 允许在函数体中写 `...` 作为“尚未实现”的占位符；如果程序在运行时执行到了这里，会触发运行时错误。这在“先搭建整体骨架，再逐步填充细节”的场景中非常方便。

---

## ApplyExpr：在 AtomExpr 上叠加“应用”

有了 `AtomExpr` 之后，我们可以更正式地来定义“**应用表达式**”（`ApplyExpr`）的概念。

直觉上，一个 `ApplyExpr` 要么是：

- **单纯的** **`AtomExpr`**，比如 `42`、`x`、`log(1)`；
- 要么是在现有表达式上叠加了一些“应用操作”：

  - 数组访问：`arr[1]`；
  - 字段访问：`p.x`；
  - 函数调用：`log(1)`。

考虑下面这些例子：

- `mat[1][2]`
- `point_arr[1].x`

在 `mat[1][2]` 中：

- `mat` 是一个 `AtomExpr`；
- `mat[1]` 是一个 `ApplyExpr`（数组访问）；
- 在这个基础上再接 `[2]`，又得到一个新的 `ApplyExpr`。

这提示我们：**ApplyExpr 应该是“递归的”：ApplyExpr 可以在已有 ApplyExpr 的基础上再叠加一层访问或调用。**

### ApplyExpr 的语法形态（BNF）

我们可以用下面这段 BNF 来描述 ApplyExpr：

```plaintext
apply_expr :
    atom_expr
  | apply_expr "[" expr "]"
  | apply_expr "." lower
  | apply_expr "(" arg_list? ")"

arg_list :
  expr ("," expr)* ","?
```

其中：

- `arg_list` 可以为空，因此在函数调用中既可以有 `f()`，也可以有 `f(1, 2, 3)`；
- 允许在参数列表最后保留一个拖尾逗号；
- 需要注意的是，**数组访问、字段访问、函数调用的“被访问/被调用的对象”本身必须是** **`apply_expr`** **，而不是单纯的** **`atom_expr`**。
  这是为了支持像 `mat[1][2]`、`point_arr[1].x` 这样多层嵌套的结构。

### ApplyExpr 的数据结构

对应到 MoonBit，我们可以这样定义：

```moonbit
pub(all) enum ApplyExprKind {
  AtomExpr(AtomExpr)                 // 1, 2, 3, x
  ArrayAccess(ApplyExprKind, Expr)   // arr[1]
  FieldAccess(ApplyExprKind, String) // p.x
  Call(ApplyExprKind, Array[Expr])   // log(1)
}

pub struct ApplyExpr {
  kind: ApplyExprKind
  toks: ArrayView[Token]
}
```

这里的关键点在于：

- `ArrayAccess` / `FieldAccess` / `Call` 的第一个参数都是一个 `ApplyExprKind`，表示“被访问/被调用的对象”，它本身可能已经是一个复杂的 ApplyExpr；
- `AtomExpr` 那一层被包在 `ApplyExprKind::AtomExpr` 中。

### 解析 ApplyExpr：从 AtomExpr 出发向右生长

`parse_apply_expr` 的类型签名依然沿用之前的风格：

```moonbit
pub fn parse_apply_expr(
  tokens : ArrayView[Token],
) -> (ApplyExpr, ArrayView[Token]) raise ParseError {
  ...
}
```

整体思路是：

1. 先解析出一个 `AtomExpr`，得到最初的“基石”；
2. 然后在一个循环中，查看后面的 Token：

    - 如果是 `[`，则解析一个索引表达式，形成新的 `ArrayAccess`；
    - 如果是 `.`，则解析一个字段名，形成新的 `FieldAccess`；
    - 如果是 `(`，则解析参数列表，形成新的 `Call`；
    - 否则就停止，返回当前的 ApplyExpr。

不过在实现时，我们还要额外考虑一个细节：**换行的影响**。

MoonBit 允许在语句末尾不写分号，例如：

```moonbit
fn f() -> Int { ... }

let x = f
()
```

上面这段代码中：

- `let x = f` 是一行完整的赋值语句，`x` 的类型是函数类型；
- 下一行的 `()` 是一个单独的表达式语句。

而在下面这段中：

```moonbit
fn f() -> Int { ... }

let x = f()
```

`x` 的类型则是 `Int`。
这也就意味着：**是否换行，会直接影响语义**。在解析 ApplyExpr 的时候，我们必须注意：
`f()` 这种形式只能在与 `f` 同一行时被视为函数调用；如果 `()` 出现在下一行，就应当被看作是下一条独立的表达式。

于是，在实现 `parse_apply_expr` 时，我们会记住“上一次应用发生在哪一行”，并在匹配 `[` / `.` / `(` 时检查行号是否一致。

一个简化版的实现大致如下：

```moonbit
pub fn parse_apply_expr(
  tokens : ArrayView[Token],
) -> (ApplyExpr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  // 1. 先解析一个 AtomExpr
  let (atom_expr, tokens) = parse_atom_expr(tokens)
  let mut last_apply_line = atom_expr.toks.unwrap().line
  let mut apply_expr = ApplyExprKind::AtomExpr(atom_expr)

  // 如果下一个 token 既不是 '[' 也不是 '.' 也不是 '('，直接返回
  if !(tokens is [
        { kind: Bracket('[') | Symbol(".") | Bracket('('), .. }, ..
      ]) {
    let apply = ApplyExpr::new(apply_expr, init_tokens, tokens)
    return (apply, tokens)
  }

  // 2. 否则进入循环，不断叠加数组访问 / 字段访问 / 函数调用
  let (apply_expr_kind, tokens) = loop tokens {
    // 数组访问：arr[expr]
    [{ kind: Bracket('['), line, .. }, .. tokens] if line == last_apply_line => {
      let (index_expr, tokens) = parse_expr(tokens)
      guard tokens is [{ kind: Bracket(']'), line, .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expected ']'"))
      }
      apply_expr = ArrayAccess(apply_expr, index_expr)
      last_apply_line = line
      continue tokens
    }

    // 字段访问：obj.field
    [{ kind: Symbol("."), .. },
     { kind: Lower(field), line, .. }, .. tokens] => {
      apply_expr = FieldAccess(apply_expr, field)
      last_apply_line = line
      continue tokens
    }

    // 函数调用：f(...) 或 f()
    [{ kind: Bracket('('), line, .. }, .. tokens] if line == last_apply_line => {
      // 无参数调用：f()
      if tokens is [{ kind: Bracket(')'), line, .. }, .. tokens] {
        apply_expr = Call(apply_expr, [])
        last_apply_line = line
        continue tokens
      }
      // 有参数调用：f(arg1, arg2, ...)
      let (args, tokens) = parse_expr_list(tokens)
      guard tokens is [{ kind: Bracket(')'), line, .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expected ')'"))
      }
      apply_expr = Call(apply_expr, args)
      last_apply_line = line
      continue tokens
    }

    // 都不是这三种情况，退出循环
    tokens =>
      break (apply_expr, tokens)
  }

  let apply = ApplyExpr::new(apply_expr_kind, init_tokens, tokens)
  (apply, tokens)
}
```

这样，一旦我们遇到一个 `ApplyExpr` 的“根”，就可以顺着右边的 `[ ... ]`、`.field`、`(args)` 让表达式自然地“向右生长”，直到不再出现这些符号为止。

---

## Expr：带运算符与优先级的完整表达式

我们已经有了：

- 表达式的最小构造块：`AtomExpr`；
- 可以在其上叠加应用操作的 `ApplyExpr`。

接下来，我们就可以着手处理 **一元运算符** 和 **二元运算符**，构造完整的表达式 `Expr`。

我们先用一个看上去“理所当然”的 BNF 来描述：

```plaintext
expr :
    apply_expr
  | expr binary_op expr
  | "!" apply_expr
  | "-" apply_expr
  ; 

binary_op: 
    "+" | "-" | "*" | "/" | "%"
  | ">" | "<" | "==" | "!=" | ">=" | "<="
  | "&" | "|" | "&&" | "||" | ">>" | "<<"
```

这段规则表达了三个意思：

1. 一个表达式可以是一个 `ApplyExpr`；
2. 也可以是“表达式 + 二元运算符 + 表达式”；
3. 也可以是以一元运算符 `!` 或 `-` 开头，后接一个 `ApplyExpr`。

### 旁注：这个 EBNF 有什么问题？

> 从形式语言的角度看，这个 EBNF 明显存在两个问题：
>
> 1. **左递归**：
>     规则 `expr : expr binary_op expr` 是典型的左递归形式，很多基于递归下降的自动语法生成器（如 ANTLR、Yacc 的某些配置）会直接拒绝这样的写法；
> 2. **没有体现优先级与结合性**：
>     在这套规则下，`1 + 2 * 3` 究竟是先加后乘还是先乘后加，是完全模糊的。
>
> 不过在本书中，我们是**手写 Parser**，而不是直接把这套 EBNF 喂给某个语法生成器。
> 对我们来说，EBNF 更多地扮演的是“帮我们理清数据结构与形态”的角色，而真正的解析策略则可以自由选择：
>
> - Pratt parsing；
> - shunting-yard 算法；
> - precedence climbing；
> - 含回溯的递归下降等。
>
> 这里我们会选用一种相对直观、实现简洁的方式：**基于运算符栈和表达式栈的优先级爬升算法（precedence climbing / shunting-yard 变体）** 。

### Expr 的数据结构

根据上面的 EBNF，我们可以先设计出 `ExprKind`：

```moonbit
pub(all) enum ExprKind {
  ApplyExpr(ApplyExpr)                 // 直接是一个 ApplyExpr
  BinaryExpr(BinaryOp, ExprKind, ExprKind) // 左右都是 ExprKind
  NotExpr(ApplyExpr)                  // !apply_expr
  NegExpr(ApplyExpr)                  // -apply_expr
  // 其它更复杂的表达式（if / match / block / loop 等）会在后续章节加入
}

pub(all) struct Expr {
  kind : ExprKind
  toks : ArrayView[Token]
}
```

在 MiniMoonBit 的完整实现中，`ExprKind` 还会包含块表达式、`if-else`、`match`、`for`、`while` 等等。
本章暂时只关注“简单表达式”这一块，后面章节会继续往这个枚举中添砖加瓦。

### 解析策略：先解析一个“简单头部”，再按优先级合并

我们把 `parse_expr` 的签名定为：

```moonbit
pub fn parse_expr(
  tokens : ArrayView[Token],
) -> (Expr, ArrayView[Token]) raise ParseError {
  ...
}
```

解析一个表达式时，首先会解析出一个“简单的头部表达式”（`head_expr`），它有三种基本形态：

1. 直接是一个 `ApplyExpr`，例如 `1`、`x`、`log(1)`；
2. 以逻辑非 `!` 开头，后接一个 `ApplyExpr`，例如 `!x`；
3. 以负号 `-` 开头，后接一个 `ApplyExpr`，例如 `-42`。

我们可以把这部分解析逻辑抽出来，写成一个内部辅助函数 `parse_simple_expr`：

```moonbit
pub fn parse_expr(
  tokens : ArrayView[Token],
) -> (Expr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  fn parse_simple_expr(
    tokens: ArrayView[Token]
  ) -> (ExprKind, ArrayView[Token]) raise ParseError {
    match tokens {
      // 以逻辑非开头：!apply_expr
      [{ kind: Not, .. }, .. rest] => {
        let (apply_expr, rest) = parse_apply_expr(rest)
        let not_expr = NotExpr(apply_expr)
        (not_expr, rest)
      }
      // 以减号开头：-apply_expr
      [{ kind: BinaryOp(Sub), .. }, .. rest] => {
        let (apply_expr, rest) = parse_apply_expr(rest)
        let neg_expr = NegExpr(apply_expr)
        (neg_expr, rest)
      }
      // 既不是 Not 也不是前缀 -，就解析一个 ApplyExpr
      tokens => {
        let (apply_expr, tokens) = parse_apply_expr(tokens)
        let expr = ApplyExpr(apply_expr)
        (expr, tokens)
      }
    }
  }

  let (head_expr, tokens) = parse_simple_expr(tokens)
  ...
}
```

接下来，就是“二元运算符 + 优先级”的部分。

### 用栈实现二元运算符的优先级

我们引入两个栈：

- `op_stack`：运算符栈，存放还未“归约”的 `BinaryOp`；
- `expr_stack`：表达式栈，存放还未结合成更大表达式的子表达式。

大致流程是：

1. 把 `head_expr` 压入 `expr_stack`；
2. 检查后面的 Token，如果第一个是 `BinaryOp`，则：

    - 解析下一个 `simple_expr`（右操作数）；
    - 根据新运算符与 `op_stack` 栈顶运算符的优先级关系，决定是否先把栈顶运算符“归约”成一个 `BinaryExpr`；
    - 然后把当前运算符压入 `op_stack`，右操作数压入 `expr_stack`；
    - 重复这个过程，直到不再看到 `BinaryOp`；
3. 把 `op_stack` 里剩下的运算符全部依次“归约”；
4. 最后栈里剩下的唯一表达式，就是整棵表达式树的根。

为了比较优先级，我们需要一个简单的 `precedence` 函数：

```moonbit
fn precedence(op : BinaryOp) -> Int {
  match op {
    Or                => 1
    And               => 2
    Eq | NE           => 3
    LT | GT | LE | GE => 4
    BitOr             => 5
    BitAnd            => 7
    ShiftLeft
    | ShiftRight      => 8
    Add | Sub         => 9
    Mul | Div | Mod   => 10
  }
}
```

然后，我们就可以完成 `parse_expr` 的主体了：

```moonbit
pub fn parse_expr(
  tokens : ArrayView[Token],
) -> (Expr, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  fn parse_simple_expr(
    tokens: ArrayView[Token]
  ) -> (ExprKind, ArrayView[Token]) raise ParseError {
    ...
  }

  // 先解析出头部表达式
  let (head_expr, tokens) = parse_simple_expr(tokens)

  let op_stack : Array[BinaryOp] = Array::new()
  let expr_stack : Array[ExprKind] = Array::new()
  expr_stack.push(head_expr)

  let mut tokens = tokens

  // 主循环：不断读取后续的 BinaryOp 和 simple_expr
  while tokens is [{ kind: BinaryOp(op), .. }, .. rest] {
    let (next_expr, rest) = parse_simple_expr(rest)

    // 依据优先级，决定是否先归约栈顶的运算符
    while !op_stack.is_empty() &&
          precedence(op) <= precedence(op_stack.last().unwrap()) {
      let right = expr_stack.pop().unwrap()
      let left  = expr_stack.pop().unwrap()
      let bop   = op_stack.pop().unwrap()
      let new_expr = BinaryExpr(bop, left, right)
      expr_stack.push(new_expr)
    }

    op_stack.push(op)
    expr_stack.push(next_expr)
    tokens = rest
  }

  // 把剩余的运算符全部归约掉
  while !op_stack.is_empty() {
    let right = expr_stack.pop().unwrap()
    let left  = expr_stack.pop().unwrap()
    let bop   = op_stack.pop().unwrap()
    let new_expr = BinaryExpr(bop, left, right)
    expr_stack.push(new_expr)
  }

  let expr_kind = expr_stack.pop().unwrap()
  let expr = Expr::new(expr_kind, init_tokens, tokens)
  (expr, tokens)
}
```

> 如果你熟悉 Dijkstra 的 **shunting-yard 算法**，会发现两者在思想上非常接近：
>
> - 都维护了“运算符栈”和“输出栈”（这里是表达式栈）；
> - 遇到新运算符时，根据优先级与栈顶运算符比较，决定是否先把栈顶运算符弹出并结合操作数；
> - 最终都得到一棵符合优先级规则的表达式树。
>
> 你可以拿一个具体例子，比如 `1 + 2 * 3 << 1`，按上面的代码一步步手动推演栈的变化过程，会对这个算法有更直观的理解。

---

## 完整的 AtomExpr 解析

前面我们在实现 `AtomExpr` 解析时，有一些复杂形态（括号表达式、数组表达式、枚举构造、结构体构造）暂时留空。
现在有了完整的 `parse_expr`，就可以把这些部分补齐了。

### 括号表达式：`()`, `(expr)`, `(e1, e2, ...)`

括号表达式有三种可能：

1. `()`：Unit 值；
2. `(expr)`：单个表达式，用 `Paren` 包一层；
3. `(expr1, expr2, ...)`：元组表达式。

对应的解析函数如下：

```moonbit
fn parse_paren_expr(
  tokens : ArrayView[Token],
) -> (AtomExprKind, ArrayView[Token]) raise ParseError {
  let (exprs, tokens) = match tokens {
    // 立即遇到右括号：()
    [{ kind: Bracket(')'), ..}, ..tokens] =>
      ([], tokens)
    // 否则解析一个 expr_list
    tokens => {
      let (exprs, tokens) = parse_expr_list(tokens)
      guard tokens is [{ kind: Bracket(')'), .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expected ')'"))
      }
      (exprs, tokens)
    }
  }

  let kind = match exprs.length() {
    0 => AtomExprKind::Unit
    1 => AtomExprKind::Paren(exprs[0])
    _ => AtomExprKind::Tuple(exprs)
  }
  (kind, tokens)
}
```

### 数组表达式：`[e1, e2, ...]`

数组表达式语法上与括号表达式非常类似，只是用方括号包裹：

```moonbit
fn parse_array_expr(
  tokens : ArrayView[Token],
) -> (AtomExprKind, ArrayView[Token]) raise ParseError {
  let (exprs, tokens) = match tokens {
    // 立即遇到右中括号：[]
    [{ kind: Bracket(']'), ..}, ..tokens] =>
      ([], tokens)
    tokens => {
      let (exprs, tokens) = parse_expr_list(tokens)
      guard tokens is [{ kind: Bracket(']'), .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expected ']'"))
      }
      (exprs, tokens)
    }
  }
  let kind = AtomExprKind::Array(exprs)
  (kind, tokens)
}
```

### 枚举构造表达式：`Color::Red` / `Red` / `Color::RGB(255, 0, 0)`

枚举构造有几种变体：

- 只有枚举名：`Red`（依赖上下文推断枚举类型）；
- 带枚举类型前缀：`Color::Red`；
- 带参数：`Color::RGB(255, 0, 0)`。

解析函数可以写成：

```moonbit
fn parse_enum_construct(
  name: String,
  tokens : ArrayView[Token],
) -> (AtomExprKind, ArrayView[Token]) raise ParseError {
  // 先看看是否有 ::VariantName
  let (tag, variant_name, tokens) = match tokens {
    [{ kind: Symbol("::"), .. },
     { kind: Upper(variant), .. },
     .. tokens] =>
      (Some(name), variant, tokens)
    // 没有 ::，那 name 本身就是 variant 名
    _ =>
      (None, name, tokens)
  }

  // 接下来看看是否有参数列表
  guard tokens is [{ kind: Bracket('('), .. }, .. tokens] else {
    let kind = EnumConstruct(tag, variant_name, [])
    return (kind, tokens)
  }

  let (exprs, tokens) = parse_expr_list(tokens)
  guard tokens is [{ kind: Bracket(')'), ..}, .. tokens] else {
    raise ParseError((tokens[0], "Expected ')'"))
  }

  let kind = EnumConstruct(tag, variant_name, exprs)
  (kind, tokens)
}
```

### 结构体构造表达式：`Point::{ x: 1, y: 2 }`

结构体构造的语法树可以这样表示：

```moonbit
pub struct StructConstructExpr {
  name: String
  fields: Array[(String, Expr)]
}
```

解析函数如下：

```moonbit
pub fn parse_struct_construct(
  name: String,
  tokens : ArrayView[Token],
) -> (AtomExprKind, ArrayView[Token]) raise ParseError {
  let (fields, tokens) = match tokens {
    // 立即遇到 '}'，说明没有字段：Struct::{}
    [{ kind: Bracket('}'), ..}, ..tokens] =>
      ([], tokens)
    tokens => {
      let (field_exprs, tokens) = parse_field_expr_list(tokens)
      guard tokens is [{ kind: Bracket('}'), ..}, ..tokens] else {
        raise ParseError((tokens[0], "Expected '}'"))
      }
      (field_exprs, tokens)
    }
  }

  let struct_construct = StructConstructExpr::{ name, fields }
  (StructConstruct(struct_construct), tokens)
}
```

### 辅助：解析 `expr_list`

很多地方（括号表达式、数组表达式、函数调用、枚举构造）都会用到 `expr_list`，我们可以抽成一个公共函数：

```moonbit
fn parse_expr_list(
  tokens: ArrayView[Token]
) -> (Array[Expr], ArrayView[Token]) raise ParseError {
  let exprs : Array[Expr] = Array::new()

  // 先解析第一个 expr
  let (expr, tokens) = parse_expr(tokens)
  exprs.push(expr)

  // 再根据逗号决定是否继续解析更多 expr
  let tokens = loop tokens {
    // 遇到逗号后紧跟着右括号，说明这是一个允许的拖尾逗号： (e1, e2,)
    [{ kind: Symbol(","), .. },
     { kind: Bracket(_), .. }, .. rest] =>
      break rest

    // 普通逗号，后面还有更多 expr
    [{ kind: Symbol(","), .. }, .. tokens] => {
      let (expr, rest) = parse_expr(tokens)
      exprs.push(expr)
      continue rest
    }

    // 既不是逗号也不是括号，说明 expr_list 结束
    tokens =>
      break tokens
  }

  (exprs, tokens)
}
```

### 辅助：解析结构体字段列表 `field_expr_list`

最后，我们还需要一个函数来解析结构体构造中的字段列表：

```moonbit
fn parse_field_expr_list(
  tokens: ArrayView[Token]
) -> (Array[(String, Expr)], ArrayView[Token]) raise ParseError {
  let fields : Array[(String, Expr)] = Array::new()

  // 先解析第一个字段：field : expr
  let tokens = match tokens {
    [{ kind: Lower(field), .. },
     { kind: Symbol(":"), .. }, 
     .. tokens] => {
      let (expr, rest) = parse_expr(tokens)
      fields.push((field, expr))
      rest
    }
    tokens =>
      raise ParseError((tokens[0], "Expected `lower` : expr"))
  }

  // 再解析后续的字段，允许拖尾逗号
  let tokens = loop tokens {
    // 逗号后紧跟 '}'，说明这是最后一个字段，且带拖尾逗号
    [{ kind: Symbol(","), .. },
     { kind: Bracket('}'), .. }, .. rest] =>
      break rest

    // 逗号后是下一个字段
    [{ kind: Symbol(","), .. }, 
     { kind: Lower(field), .. },
     { kind: Symbol(":"), .. }, .. tokens] => {
      let (expr, rest) = parse_expr(tokens)
      fields.push((field, expr))
      continue rest
    }

    // 没有逗号也允许继续解析一个字段（用于容忍少写逗号的情况）
    [{ kind: Lower(field), .. },
     { kind: Symbol(":"), .. }, .. tokens] => {
      let (expr, rest) = parse_expr(tokens)
      fields.push((field, expr))
      continue rest
    }

    // 其它情况视为字段列表结束
    tokens =>
      break tokens
  }

  (fields, tokens)
}
```

---

## 小结

在本章中，我们围绕 **表达式解析** 这条主线，完成了以下工作：

- 把表达式分成三层：`AtomExpr` → `ApplyExpr` → `Expr`，
  先解决“原子单元”和“应用操作”，再解决一元/二元运算符与优先级；
- 用代数数据类型清晰地刻画了各类 AtomExpr（字面量、标识符、括号/元组/数组、枚举构造、结构体构造）和 ApplyExpr（数组访问、字段访问、函数调用）；
- 基于模式匹配和 ArrayView，给出了简洁直观的 `parse_atom_expr` 与 `parse_apply_expr` 实现；
- 使用运算符栈和表达式栈，实现了一个易于理解的二元运算符优先级算法，让 `parse_expr` 能正确处理复杂表达式；
- 在完成 `Expr` 之后，又回过头来补全了括号表达式、数组表达式、枚举构造与结构体构造的解析函数。

到这里，我们已经可以为 MiniMoonBit 程序构造出一棵结构完整的“表达式子树”。
在下一章中，我们会在此基础上继续向外扩展，处理各种语句（`let`、赋值、`if`、`while`、`for` 等）以及更高层级的语法结构，为类型检查和后续的中间表示转换做好准备。
