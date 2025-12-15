---
title: 语法分析 - 顶层语法结构
---

到目前为止，我们已经为 MiniMoonBit 构建了从 Token 到表达式、语句的完整前端框架：

- 第 5 章：从类型的角度出发，解析 `Type`；
- 第 6 章：解析简单表达式（`AtomExpr` / `ApplyExpr` / `Expr`）；
- 第 7 章：在表达式之上进一步构建各种语句和复杂表达式（`if`、`while`、`for`、`match`、`block`、局部函数等）。

本章要完成的，是语法分析的最后一环：**顶层语法结构（Top Level）** 。
换句话说，我们要回答这样一个问题：

- 当我们把一个完整的 MiniMoonBit 源文件交给编译器时，
  最外层到底允许出现哪些结构？
  这些结构在语法分析器中又应该如何组织？

在 MiniMoonBit 中，顶层结构主要包含五类：

- **结构体定义**：`struct`；
- **枚举定义**：`enum`；
- **顶层** **`let`** **绑定**：全局常量；
- **顶层函数**：以及特殊的 `main` 函数；
- **外部函数声明**：`extern`，用于对接 C 等外部语言。

本章将依次介绍这几类顶层结构的 BNF、AST 设计与解析函数，最后把它们汇总成一个 `Program` 结构，为后续类型检查和代码生成提供入口。

---

## 结构体定义：`struct`

我们先来看结构体定义。通过观察前面章节中已经出现过的 `struct` 例子，可以抽象出如下 BNF：

```plaintext
struct_def:
  "struct" upper generic? "{" field_def_list? "}"

field_def_list:
  field_def (";" field_def)* ";"?

field_def:
  "mut"? lower ":" type
```

这里有几个要点：

- `struct` 后面跟一个以大写字母开头的名字（`upper`），例如 `Point`；
- 可以携带可选的泛型参数 `generic`，形如 `struct Point[T] { ... }`；
- 花括号中是若干字段，每个字段一行，字段之间分号 `;` 可选；
- 每个字段可以用可选的 `mut` 标记为可变字段。

### 泛型参数 `generic`

MiniMoonBit 支持带泛型参数的结构体，为了简单起见，我们只允许用大写标识符表示类型参数：

```plaintext
generic:
  "[" upper_list "]"

upper_list:
  upper ("," upper)*
```

例如：

```moonbit
struct Ref[T] {
  mut value: T
}
```

### Struct 的 AST 设计

在 AST 中，我们可以这样表示结构体定义及其字段：

```moonbit
pub struct StructDef {
  name          : String
  generic_types : Array[String]
  fields        : Array[StructField]
  toks          : ArrayView[Token]
}

pub struct StructField {
  name  : String
  is_mut: Bool
  ty    : Type
}
```

其中：

- `generic_types` 存储结构体声明中的类型参数名称列表（如 `["T"]`）；
- `fields` 是字段列表，每个字段有名字、可变性标记以及字段类型；
- `toks` 记录了整段 `struct` 定义在源文件中的 Token 区间，方便后续错误提示。

### 解析结构体定义：`parse_struct_def`

结构体定义的解析流程与前几章的模式基本一致：

```moonbit
pub fn parse_struct_def(
  tokens : ArrayView[Token],
) -> (StructDef, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(Struct), .. }, .. tokens] else {
    println("Compiler ICE: Misuse parse_struct_def")
    panic()
  }

  // 结构体名：必须是 Upper
  guard tokens is [{ kind: Upper(name), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect struct name"))
  }

  // 可选的泛型参数列表
  let (generic_params, tokens) = match tokens {
    [{ kind: Bracket('['), .. }, .. tokens] => {
      let (params, tokens) = parse_generic_params(tokens)
      guard tokens is [{ kind: Bracket(']'), .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expect ']'"))
      }
      (params, tokens)
    }
    _ =>
      ([], tokens)
  }

  // 左花括号
  guard tokens is [{ kind: Bracket('{'), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect '{'"))
  }

  let fields : Array[StructField] = Array::new()

  // 解析字段列表，直到遇到 '}'
  let tokens = loop tokens {
    [{ kind: Bracket('}'), .. }, .. rest] =>
      break rest
    tokens => {
      let (field, rest) = parse_struct_field(tokens)
      fields.push(field)
      continue rest
    }
  }

  let toks = slice_tokens(init_tokens, tokens)
  let struct_def = StructDef::{ name, generic_types: generic_params, fields, toks }

  (struct_def, tokens)
}
```

### 解析字段：`parse_struct_field`

字段定义 `field_def` 的形式是：

- 可选关键字 `mut`；
- 小写字段名；
- 冒号与字段类型；
- 可选分号或换行。

对应的解析函数如下：

```moonbit
pub fn parse_struct_field(
  tokens : ArrayView[Token],
) -> (StructField, ArrayView[Token]) raise ParseError {
  // 是否带 mut
  let (is_mut, tokens) = match tokens {
    [{ kind: Keyword(Mut), .. }, ..tokens] =>
      (true, tokens)
    tokens =>
      (false, tokens)
  }

  // 字段名
  guard tokens is [{ kind: Lower(name), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect struct field name"))
  }

  // 冒号
  guard tokens is [{ kind: Symbol(":"), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect ':' after struct field name"))
  }

  // 字段类型
  let (ty, tokens) = parse_type(tokens)

  let struct_field = StructField::{ name, is_mut, ty }

  // 分号可选：用 end_stmt 与 let/expr 的策略保持一致
  let last_tok = ty.toks.last().unwrap()
  let tokens = end_stmt(last_tok, tokens)

  (struct_field, tokens)
}
```

### 解析泛型参数：`parse_generic_params`

前面我们提到过 `generic` 的 BNF，现在来看它的解析实现：

```moonbit
pub fn parse_generic_params(
  tokens : ArrayView[Token],
) -> (Array[String], ArrayView[Token]) raise ParseError {
  let generic_params : Array[String] = []

  let tokens = match tokens {
    [{ kind: Upper(t), .. }, .. tokens] => {
      generic_params.push(t)
      tokens
    }
    tokens =>
      raise ParseError((tokens[0], "Expected upper ident"))
  }

  let tokens = loop tokens {
    [{ kind: Symbol(","), .. }, { kind: Upper(t), .. }, .. tokens] => {
      generic_params.push(t)
      continue tokens
    }
    tokens =>
      break tokens
  }

  (generic_params, tokens)
}
```

> 在完整的 MoonBit 中，泛型参数列表还可以带 trait 约束、生命周期等更复杂的信息。
> MiniMoonBit 目前只保留最核心的一层：**一串大写标识符**，
> 足够支撑后续的类型检查和简单的多态支持。

---

## 枚举定义：`enum`

与结构体类似，MiniMoonBit 中的枚举定义也支持泛型。
BNF 可以概括为：

```plaintext
enum_def:
  "enum" upper generic? "{" enum_field_list "}"

enum_field_list:
  enum_field (";" enum_field)* ";"

enum_field:
  Upper ("(" type_list ")" )?
```

这里：

- `EnumDef` 的名字是一个大写开头标识符；
- 每个枚举变体（`enum_field`）本身也是一个 `Upper` 标识符；
  +- 变体可以带零个或多个参数类型，例如：

  - `Red`
  - `Rgb(Int, Int, Int)`

### Enum 的 AST

我们可以为枚举定义与枚举变体设计如下 AST：

```moonbit
pub struct EnumDef {
  name          : String
  generic_types : Array[String]
  enum_fields   : Array[EnumField]
  toks          : ArrayView[Token]
}

pub struct EnumField {
  name  : String
  types : Array[Type]
}
```

### 解析 `enum_def`

解析函数 `parse_enum_def` 的结构与 `parse_struct_def` 非常相似：

```moonbit
pub fn parse_enum_def(
  tokens : ArrayView[Token],
) -> (EnumDef, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(Enum), .. }, .. tokens] else {
    println("Expected 'enum' keyword")
    panic()
  }

  guard tokens is [{ kind: Upper(name), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expected enum name"))
  }

  let (generic_params, tokens) = match tokens {
    [{ kind: Bracket('['), .. }, .. tokens] => {
      let (params, tokens) = parse_generic_params(tokens)
      guard tokens is [{ kind: Bracket(']'), .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expected ']'"))
      }
      (params, tokens)
    }
    tokens =>
      ([], tokens)
  }

  guard tokens is [{ kind: Bracket('{'), .. }, .. rest] else {
    raise ParseError((tokens[0], "Expected '{' after enum name"))
  }

  let enum_fields : Array[EnumField] = Array::new()

  let rest = loop rest {
    [{ kind: Bracket('}'), .. }, .. rest] =>
      break rest
    tokens => {
      let (enum_field, rest2) = parse_enum_field(tokens)
      enum_fields.push(enum_field)
      continue rest2
    }
  }

  let toks = slice_tokens(init_tokens, rest)
  let enum_def = EnumDef::{ name, generic_types: generic_params, enum_fields, toks }

  (enum_def, rest)
}
```

### 解析枚举变体：`parse_enum_field`

根据 BNF：

- 变体名：`Upper`；
- 可选参数列表：`(type_list)`；
- 每个字段可以用分号或换行结尾。

解析函数大致如下（注意对草稿中的一些小疏漏进行了修正）：

```moonbit
pub fn parse_enum_field(
  tokens : ArrayView[Token],
) -> (EnumField, ArrayView[Token]) raise ParseError {
  // 变体名
  guard tokens is [{ kind: Upper(name), .. } as name_tok, .. tokens] else {
    raise ParseError((tokens[0], "Expected enum field name"))
  }

  let mut last_tok = name_tok

  let (types, tokens) = match tokens {
    // 带参数列表的变体：Variant(T1, T2, ...)
    [{ kind: Bracket('('), .. }, .. tokens] => {
      let (types, tokens) = parse_type_list(tokens)
      guard tokens is [{ kind: Bracket(')'), .. } as paren_tok, .. tokens] else {
        raise ParseError((tokens[0], "Expected ')'"))
      }
      last_tok = paren_tok
      (types, tokens)
    }
    // 不带参数
    tokens =>
      ([], tokens)
  }

  let enum_field = EnumField::{ name, types }

  // 行末分号可选
  let tokens = end_stmt(last_tok, tokens)

  (enum_field, tokens)
}
```

> 这里用到的 `parse_type_list` 可以参考前面章节解析函数参数列表时的实现：
> 它的作用是在一对括号内部按逗号切分多个 `Type`，并允许拖尾逗号。

---

## 顶层 `let`：`top_let`

MiniMoonBit 允许在顶层定义全局绑定（类似“全局常量”）。但与函数内部的 `let` 相比，有两个重要区别：

1. **顶层不允许** **`let mut`**
    如果你需要“可变的全局状态”，必须通过显式的引用类型来控制，例如：

    ```moonbit
    let xval : Ref[Int] = Ref::new(1)
    // 或使用数组
    let xval : Array[Int] = [1]
    ```
2. **顶层** **`let`** **不支持模式匹配**
    也就是说，像 `let (a, b) = (1, 2)` 这样的写法不能出现在顶层，只能出现在函数体内部。

基于这些约束，顶层 `let` 的 BNF 很简单：

```plaintext
top_let:
  "let" lower (":" type)? "=" expr ";"
```

### AST 与解析

AST 结构：

```moonbit
pub struct TopLet {
  name : String
  ty   : Type?
  expr : Expr
  toks : ArrayView[Token]
}
```

解析函数：

```moonbit
pub fn parse_top_let(
  tokens : ArrayView[Token],
) -> (TopLet, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(Let), .. }, .. tokens] else {
    println("Expected 'let' keyword at the beginning of top let")
    panic()
  }

  guard tokens is [{ kind: Lower(name), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect a lower ident"))
  }

  let (ty, tokens) = match tokens {
    [{ kind: Symbol(":"), .. }, .. tokens] => {
      let (ty, rest) = parse_type(tokens)
      (Some(ty), rest)
    }
    tokens =>
      (None, tokens)
  }

  guard tokens is [{ kind: AssignOp(Assign), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect '='"))
  }

  let (expr, tokens) = parse_expr(tokens)

  let last_tok = expr.toks.last().unwrap()
  let tokens = end_stmt(last_tok, tokens)

  let toks = slice_tokens(init_tokens, tokens)
  let top_let = TopLet::{ name, ty, expr, toks }

  (top_let, tokens)
}
```

---

## 顶层函数：`top_function`

与局部函数相比，**顶层函数的语法更规则一些**：

- 参数类型与返回类型必须显式标注；
- 允许带“类型标签”（类似方法所属的类型前缀），形如：

  ```moonbit
  fn Point::new(x: Int, y: Int) -> Point { ... }
  ```
- 唯一的特例是 `main` 函数：

  - 不带参数列表；
  - 不带返回类型标注；
  - 默认返回 `Unit` 类型的值。

对应的 BNF 可以写成：

```plaintext
top_function:
  top_decl_func | main_func

top_decl_func:
  "fn" (upper"::")? lower "(" param_list? ")" "->" type block_expr

param_list:
  param ("," param)* ","?

param:
  lower ":" type

main_func:
  "fn" "main" block_expr
```

在实现时，我们不必在 AST 层面区分 `top_decl_func` 和 `main_func`，可以统一为一个 `TopFunction`：

```moonbit
pub(all) struct TopFunction {
  typeTag    : String
  fname      : String
  param_list : Array[Param]
  ret_ty     : Type
  body       : BlockExpr
  toks       : ArrayView[Token]
}

pub(all) struct Param {
  name : String
  ty   : Type
}
```

### 解析顶层函数：`parse_top_function`

解析函数的大致流程是：

1. 匹配 `fn`；
2. 可选的 `TypeTag::` 前缀；
3. 函数名 `fname`；
4. 如果是 `main`，直接解析一个 `block_expr`，返回类型默认为 `Unit`；
5. 否则：

    - 解析参数列表；
    - 解析 `->` 与返回类型；
    - 解析 `block_expr`。

对应实现如下：

```moonbit
pub fn parse_top_function(
  tokens : ArrayView[Token],
) -> (TopFunction, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens is [{ kind: Keyword(Fn), .. }, .. tokens] else {
    println("Compiler ICE: Misuse parse_top_function")
    panic()
  }

  // 可选 typeTag
  let (typeTag, tokens) = match tokens {
    [{ kind: Upper(t), .. }, { kind: Symbol("::"), .. }, .. tokens] =>
      (t, tokens)
    tokens =>
      ("", tokens)
  }

  // 函数名
  guard tokens is [{ kind: Lower(fname), .. }, .. tokens] else {
    raise ParseError((tokens[0], "Expect a lower ident"))
  }

  // main 函数特例：无参、无返回类型标注
  let (param_list, ret_ty, tokens) = if !(fname is "main") {
    guard tokens is [{ kind: Bracket('('), .. }, .. tokens] else {
      raise ParseError((tokens[0], "Expect '('"))
    }

    let (param_list, tokens) = parse_param_list(tokens)

    guard tokens is [{ kind: Bracket(')'), .. }, .. tokens] else {
      raise ParseError((tokens[0], "Expect ')'"))
    }

    guard tokens is [{ kind: Symbol("->"), .. }, .. tokens] else {
      raise ParseError((tokens[0], "Expect '->'"))
    }

    let (ret_ty, tokens) = parse_type(tokens)

    (param_list, ret_ty, tokens)
  } else {
    // main 的返回类型固定为 Unit
    let ret_type = Type::{ kind: Primitive("Unit"), toks: [] }
    ([], ret_type, tokens)
  }

  let (body, tokens) = parse_block_expr(tokens)

  let toks = slice_tokens(init_tokens, tokens)
  let top_function = TopFunction::{ typeTag, fname, param_list, ret_ty, body, toks }

  (top_function, tokens)
}
```

参数列表解析由 `parse_param_list` 负责：

```moonbit
pub fn parse_param_list(
  tokens : ArrayView[Token],
) -> (Array[Param], ArrayView[Token]) raise ParseError {
  let params : Array[Param] = Array::new()

  let tokens = loop tokens {
    // 第一个参数
    [{ kind: Lower(_), .. }, ..] as tokens => {
      let (param, rest) = parse_param(tokens)
      params.push(param)
      continue rest
    }

    // 逗号后面的参数
    [{ kind: Symbol(","), .. }, { kind: Lower(_), .. }, ..] as tokens => {
      let (param, rest) = parse_param(tokens[1:])
      params.push(param)
      continue rest
    }

    // 允许拖尾逗号：fn f(x: Int, y: Int,) ...
    [{ kind: Symbol(","), .. }, { kind: Bracket(')'), .. }, ..] as tokens =>
      break tokens[1:]

    // 参数列表结束
    [{ kind: Bracket(')'), .. }, ..] as tokens =>
      break tokens

    tokens =>
      raise ParseError((tokens[0], "Invalid param list"))
  }

  (params, tokens)
}
```

---

## 外部函数：`extern function`

最后，我们来看如何在 MiniMoonBit 中声明外部函数（例如来自 C 标准库的函数）。
在 MoonBit 中，如果我们希望调用外部 C 函数 `sin`，常见的写法是：

```moonbit
extern "C" fn sin(x: Double) -> Double = "sin"
extern "C" fn cos(x: Double) -> Double = "cos"

fn main {
  let sin1 = sin(1.0)
  let cos1 = cos(1.0)
  println("sin(1) = \{sin1}")
  println("cos(1) = \{cos1}")
}
```

对应的 BNF 可以写成：

```plaintext
extern_function:
  "extern" str "fn" lower "(" param_list ")" ("->" type)? "=" str
```

其中：

- 第一个字符串字面量（`str`）通常表示外部 ABI，例如 `"C"`；
- 函数名 `lower` 是在 MiniMoonBit 内部使用的名字；
- 最后一个字符串字面量是实际链接到的外部符号名（如 `"sin"`）。

### ExternFunction 的 AST 与解析

AST 结构如下：

```moonbit
pub struct ExternFunction {
  fname      : String
  param_list : Array[Param]
  ret_ty     : Type?
  ffi_name   : String
  toks       : ArrayView[Token]
}
```

解析函数：

```moonbit
pub fn parse_extern_function(
  tokens : ArrayView[Token],
) -> (ExternFunction, ArrayView[Token]) raise ParseError {
  let init_tokens = tokens

  guard tokens
    is [{ kind: Keyword(Extern), .. },
        { kind: String(_), .. },
        { kind: Keyword(Fn), .. },
        { kind: Lower(fname), .. },
        { kind: Bracket('('), .. },
        .. tokens] else {
    raise ParseError((tokens[0], "failed to parse extern"))
  }

  // 参数列表
  let (param_list, tokens) = match tokens {
    [{ kind: Bracket(')'), .. }, .. tokens] =>
      ([], tokens)
    tokens => {
      let (param_list, tokens) = parse_param_list(tokens)
      guard tokens is [{ kind: Bracket(')'), .. }, .. tokens] else {
        raise ParseError((tokens[0], "Expect ')'"))
      }
      (param_list, tokens)
    }
  }

  // 可选返回类型
  let (ret_ty, tokens) = if tokens
    is [{ kind: Symbol("->"), .. }, .. rest_tokens] {
    let (ret_ty, tokens) = parse_type(rest_tokens)
    (Some(ret_ty), tokens)
  } else {
    (None, tokens)
  }

  // 绑定到外部符号名
  guard tokens
    is [{ kind: AssignOp(Assign), .. },
        { kind: String(ffi_name), .. } as last_tok,
        .. tokens] else {
    raise ParseError((tokens[0], "Expect '=' and ffi name string"))
  }

  let tokens = end_stmt(last_tok, tokens)
  let toks = slice_tokens(init_tokens, tokens)

  let extern_function = ExternFunction::{
    fname, param_list, ret_ty, ffi_name, toks,
  }

  (extern_function, tokens)
}
```

> 后续在代码生成阶段，我们会根据 `ExternFunction` 中的 `ffi_name` 在 C/LLVM 层面生成适当的声明或调用指令，使得 MiniMoonBit 能够平滑地与外部库协作。

---

## Program：汇总所有顶层结构

到这里，我们已经拥有了：

- `StructDef`：结构体定义；
- `EnumDef`：枚举定义；
- `TopLet`：顶层 `let` 绑定；
- `TopFunction`：顶层函数；
- `ExternFunction`：外部函数声明。

最后一步，是把它们汇总成一个 `Program` 结构，作为整个语法分析阶段的输出。

### Program 的结构设计

与其它 AST 节点不同，`Program` 并不强调“语法顺序”本身，而更像是一个**顶层符号表管理者**：

- 在 MiniMoonBit 中，顶层定义的顺序并不重要；
- 不像 C 那样必须在使用之前显式声明；
- 我们更希望能快速根据名字找到对应的定义。

因此，一个自然的设计是使用若干 `Map` 来存放不同类别的顶层符号：

```moonbit
pub(all) struct Program {
  source_file    : String
  top_lets       : Map[String, TopLet]
  top_functions  : Map[String, TopFunction]
  extern_funcions: Map[String, ExternFunction]
  struct_defs    : Map[String, StructDef]
  enum_defs      : Map[String, EnumDef]
  tokens         : Array[Token]
}
```

### `parse`：从 Token 序列到 Program

`parse` 函数的职责是：

- 接收整个文件的 Token 数组；
- 记录 `source_file` 名称；
- 从头到尾扫描 Token，根据关键字决定调用哪一个具体的顶层解析函数；
- 把解析得到的结构加入对应的 Map 中；
- 遇到 `EOF` 时停止。

实现如下：

```moonbit
pub fn parse(tokens : Array[Token]) -> Program raise ParseError {
  guard tokens is [tok, ..] else {
    raise ParseError((tokens[0], "Empty token array passed to parser"))
  }

  let source_file    = tok.file
  let top_lets       = Map::new()
  let top_functions  = Map::new()
  let extern_funcions= Map::new()
  let struct_defs    = Map::new()
  let enum_defs      = Map::new()

  loop tokens[:] {
    // extern function
    [{ kind: Keyword(Extern), .. }, ..] as tokens => {
      let (extern_fn, rest) = parse_extern_function(tokens)
      extern_funcions.set(extern_fn.fname, extern_fn)
      continue rest
    }

    // 顶层函数
    [{ kind: Keyword(Fn), .. }, ..] as tokens => {
      let (top_fn, rest) = parse_top_function(tokens)
      // 使用 whole_name 避免方法同名冲突
      // 如 Point::new 和 Rect::new 应视为不同函数
      top_functions.set(top_fn.whole_name(), top_fn)
      continue rest
    }

    // 顶层 let
    [{ kind: Keyword(Let), .. }, ..] as tokens => {
      let (top_let, rest) = parse_top_let(tokens)
      top_lets.set(top_let.name, top_let)
      continue rest
    }

    // 结构体定义
    [{ kind: Keyword(Struct), .. }, ..] as tokens => {
      let (struct_def, rest) = parse_struct_def(tokens)
      struct_defs.set(struct_def.name, struct_def)
      continue rest
    }

    // 枚举定义
    [{ kind: Keyword(Enum), .. }, ..] as tokens => {
      let (enum_def, rest) = parse_enum_def(tokens)
      enum_defs.set(enum_def.name, enum_def)
      continue rest
    }

    // EOF：正常结束
    [{ kind: EOF, .. }, ..] =>
      break

    // 其它任何 Token：顶层非法
    tokens =>
      raise ParseError((tokens[0], "Unexpected token in top level"))
  }

  let prog = Program::{
    source_file,
    top_lets,
    top_functions,
    extern_funcions,
    struct_defs,
    enum_defs,
    tokens,
  }

  prog
}
```

> 在后续的类型检查与代码生成阶段，我们会从 `Program` 出发：
> 遍历所有 `struct_defs` 与 `enum_defs` 建立类型环境，
> 遍历 `top_functions` 和 `extern_funcions` 建立函数环境，
> 再对每个函数/表达式进行类型推断与 IR 转换。

---

## 小结：从 Token 到 Program

本章完成了 MiniMoonBit 语法分析的最后一块拼图：

- 定义并解析了所有 **顶层语法结构**：`struct`、`enum`、顶层 `let`、顶层函数与外部函数；
- 通过 `Program` 结构把这些分散的定义收拢到一处，用 `Map` 按名字组织，方便后续阶段高效查找；
- 在实现上，延续了前几章的风格：以 BNF 为起点，用代数数据类型刻画 AST，再用 ArrayView + 模式匹配写出简洁的解析函数。

从第 4 章的 Tokenizer，到本章的 `Program`，我们已经完成了整个 **语法前端** 的搭建：
给定一段 MiniMoonBit 源代码，编译器现在可以为我们构造出一棵结构清晰的抽象语法树，并带着精确的位置信息。
接下来，我们将进入更“抽象”的一部分：**类型检查与解糖**，让这棵语法树“长出类型”和更规整的内部表示，为中间代码和后端生成打下基础。
