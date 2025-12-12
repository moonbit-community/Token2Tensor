---
title: Chapter 2. MoonBit 与 MiniMoonBit
---

## MoonBit 与 MiniMoonBit

本章的目标，是向你介绍我们将在全书中使用的主角语言 **MoonBit**，以及基于它构造出的教学子集 **MiniMoonBit**。在实现编译器之前，先对语言本身有一个直观、系统的理解，会让后续的所有章节都变得顺理成章：你会更容易看清楚每一个语法特性在前端、类型系统和后端中的“投影”。

MoonBit 是一门国产的、面向工程实践的现代编程语言，它在语法和类型系统上吸收了 **OCaml** 与 **Rust** 等语言的许多经验教训，同时又结合了对 WebAssembly、多后端编译和工具链的深度支持。这使得它非常适合作为“实现其它语言的语言”：写编译器、解释器、静态分析工具、以及需要严谨类型保证的业务系统，都很自然。

在本书中，我们会一边使用 MoonBit 编写 MiniMoonBit 编译器，一边逐步说明 MoonBit 的关键语言特性。你不需要事先非常熟悉 MoonBit，只要有一门现代编程语言的经验（例如 C/C++、Java、Rust、Go 等），就足以跟上本章的节奏。

---

### 为什么用 MoonBit 来写编译器？

理论上，你几乎可以用任何一门通用语言来实现编译器：C、C++、Java、Python 乃至 JavaScript。但在实践中，不同语言在以下几个方面会带来非常不一样的开发体验：

- **类型系统是否足够表达我们想要的抽象？**

  - 编译器内部有大量树状结构、代数数据类型、递归定义和不可变数据，我们希望用类型来表达这些结构的“形状”，而不是全部塞进 `void*` 或统一的 `Object`。
- **模式匹配是否足够强大？**

  - 编译器的大部分工作，都是在各种“树”上做遍历与变换。语言原生的模式匹配可以极大简化代码，并让每一种情况都在语法层面被“点名”处理。
- **闭包和高阶函数是否够用？**

  - 编译器管线中会频繁出现“以函数作为参数”的场景：遍历、重写、折叠、组合……一个支持函数式风格的语言，会让这些写法自然得多。
- **运行时和工具链是否友好？**

  - 我们需要良好的构建系统、测试框架、多后端支持，以便轻松运行大量测试样例，甚至把自己的编译器编译成 WebAssembly 在浏览器里运行。

MoonBit 在这些方面都给出了相当不错的答案：它支持模块化的包系统、代数数据类型、模式匹配、闭包与泛型，同时在工程实践中对多后端支持和测试实践也颇为重视。对一本“边讲理论边写代码”的书来说，这是一个非常合适的载体。

而 **MiniMoonBit** 则是 MoonBit 的一个语法子集。它的设计原则是：

- **足够小**：语法简单，方便在书中完整展示词法、语法和类型规则。
- **足够真**：不是玩具语言，能写出光线追踪、Lisp 解释器和神经网络训练这类“真程序”。
- **足够 MoonBit**：大体风格与 MoonBit 一致，让读者可以自然迁移到完整 MoonBit 的开发中。

在后续章节中，你会看到：MiniMoonBit 的几乎每一个特性，都能够在 MoonBit 中找到“原型”；而我们在 MoonBit 里为 MiniMoonBit 编写的编译器，也完全是一个真实可用的工程项目。

---

## 如何安装 MoonBit

在你开始阅读和实践本书之前，建议先在本地安装好 MoonBit 工具链。这样你可以一边阅读代码，一边亲手运行、修改、测试。

你可以访问 MoonBit 的官网（在浏览器中输入）：

`https://www.moonbitlang.cn`

在官网上，你可以看到文档、示例项目以及安装说明。如果你使用 VS Code，那么安装 MoonBit 工具链只需要两步：

- 在 VS Code 插件市场中搜索 `moonbit`。
- 安装官方的 MoonBit 扩展，扩展会帮你完成工具链下载与配置。

如果你希望在终端或其他编辑器环境下使用 MoonBit，可以直接使用安装脚本。

### macOS / Linux

在终端中执行：

```shell
curl -fsSL https://cli.moonbitlang.cn/install/unix.sh | bash
```

脚本会自动下载并配置所需的可执行文件。安装完成后，你应该可以在终端中运行：

```shell
moon --help
```

来查看可用子命令。

### Windows

在 PowerShell 中执行：

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser; irm https://cli.moonbitlang.cn/install/powershell.ps1 | iex
```

同样地，安装成功后，你可以在终端中尝试运行：

```powershell
moon --help
```

如果你之前从未在本机安装过编译器工具链，建议在这里多花几分钟，确认环境能正常工作。接下来的所有例子，你都可以在自己的机器上直接执行。

---

## 初始化一个 MoonBit 项目

安装好工具链后，我们可以用一条命令创建一个新的 MoonBit 项目。在任意一个空目录中打开终端，执行：

```shell
moon new project
```

这里的 `project` 是你的项目名称，你也可以换成其它名字。命令执行完成后，会在当前目录下生成一个名为 `project` 的子目录，里面就是一个结构完整的 MoonBit 项目。

切换到该目录下，你可以使用 `tree`（或在图形界面中查看）来了解项目结构：

```shell
> tree
.
├── AGENTS.md
├── LICENSE
├── README.mbt.md
├── README.md -> README.mbt.md
├── cmd
│   └── main
│       ├── main.mbt
│       └── moon.pkg.json
├── moon.mod.json
├── moon.pkg.json
├── project.mbt
└── project_test.mbt

3 directories, 10 files
```

其中：

- `cmd/main/main.mbt`：包含了一个可执行程序的入口函数 `main`。
- `project.mbt`：一个示例库代码文件，用于演示如何编写可复用的函数。
- `project_test.mbt`：对应的测试文件，展示如何编写测试块。
- `moon.mod.json`：项目级别的配置文件，类似于“模块清单”。
- 顶层 `moon.pkg.json`：包管理相关配置，后续章节会有更详细的说明。

现在，你已经可以运行项目中自带的示例程序了：

```shell
> moon run main
89
```

这条命令会编译并运行 `cmd/main` 包中的 `main` 函数。

同样，你也可以直接运行测试：

```shell
> moon test
Total tests: 2, passed: 2, failed: 0.
```

如果想看看到底跑了哪些测试，可以加上 `--verbose` 选项：

```shell
> moon test --verbose
[username/project] test project_test.mbt:2 ("fib") ok
[username/project] test project_test.mbt:12 ("sum") ok
Total tests: 2, passed: 2, failed: 0.
```

最后，我们来看一下 `moon.mod.json` 的内容：

```json
{
  "name": "username/project",
  "version": "0.1.0",
  "readme": "README.mbt.md",
  "repository": "",
  "license": "Apache-2.0",
  "keywords": [],
  "description": ""
}
```

这里记录了项目的基本元信息：名称、版本、许可证、说明文档等。`moon.pkg.json` 则用来描述依赖和包相关信息，在实现 MiniMoonBit 编译器时，我们也会用到它。

到这里，你已经有了一个可以编译、可以测试的 MoonBit 项目。接下来，我们从语言本身的语法开始，逐步认识 MoonBit。

---

## 函数声明

MoonBit 是一门静态类型的函数式/命令式混合语言，函数是最基本的构造块。一个简单的函数声明大致如下：

```moonbit
fn add(x: Int, y: Int) -> Int {
  x + y
}
```

含义非常直观：

- 使用关键字 `fn` 声明函数。
- `add` 是函数名。
- `(x: Int, y: Int)` 是参数列表，指定了参数名和参数类型。
- `-> Int` 表示返回值类型为 `Int`。
- 花括号中的部分是函数体，最后一个表达式的值即为返回值。

MoonBit 的 **全局函数声明是位置无关的**：也就是说，一个函数可以调用在文件后面甚至其它模块中定义的函数，而不需要像 C 语言那样先写“前置声明”。例如：

```moonbit
fn muladd(a: Int, b: Int, c: Int) -> Int {
  let r = mul(a, b)
  add(r, c) 
}

fn mul(a: Int, b: Int) -> Int {
  a * b
}

fn add(a: Int, b: Int) -> Int {
  a + b
}
```

这里 `muladd` 在 `mul` 和 `add` 定义之前就使用了它们，但编译器会在整个模块范围内收集所有顶层声明，因此不会有问题。这也让我们在组织代码结构时更加灵活。

在后续章节，我们会为 MiniMoonBit 设计类似的函数声明语法，并在语法分析和类型检查阶段重点处理这些结构。

## 外部函数

---

({介绍外部函数ffi的用法})

---

## 变量声明

MoonBit 支持不可变变量和可变变量，分别使用 `let` 和 `let mut` 声明：

```moonbit
fn arith(a: Int, b: Int) -> Int {
  let r1 = a + b
  let r2 = a - b
  let mut r3 = a * b
  let mut r4 = a / b
  ...
}
```

- 使用 `let` 声明的变量 **不可被重新赋值**。
- 使用 `let mut` 声明的变量则允许在后续代码中多次更新。

如果我们对一个使用 `let` 声明的变量尝试重新赋值，编译器会给出明确的错误提示：

```moonbit
fn main {
  let x = 1
  x = 2
}
```

编译后会得到类似的错误信息：

```shell
Error: [4087]
   ╭─[ /Users/Tokens2Tensors/examples/main/main.mbt:4:3 ]
   │
 4 │   x = 2;
   │   ┬  
   │   ╰── The variable x is not mutable.
───╯
Failed with 1 warnings, 1 errors.
```

反过来，如果我们使用 `let mut` 声明了一个变量，但在整个作用域中从未对其进行过可变更新，编译器也会提出友好的建议：

```moonbit
fn main {
  let mut x = 1
}
```

对应的错误/警告信息类似：

```shell
Error: [0015]
   ╭─[ /Users/Tokens2Tensors/examples/main/main.mbt:3:11 ]
   │
 3 │   let mut x = 1;
   │           ┬  
   │           ╰── Error (warning): The mutability of 'x' is never used, try remove `mut`.
───╯
Failed with 0 warnings, 1 errors.
```

这种对可变性的检查，非常适合语言实现工作：我们可以放心地使用不可变绑定来表示语法树和中间表示，而在需要原地更新性能的地方再显式使用 `mut`。

---

## 结构体

MoonBit 支持使用 `struct` 定义结构体类型，用来把若干字段组织到一起：

```moonbit
struct Point {
  x: Int
  y: Int
}
```

你可以像这样构造和使用结构体值：

```moonbit
fn origin() -> Point {
  Point { x: 0, y: 0 }
}

fn shift_right(p: Point, dx: Int) -> Point {
  Point::{ x: p.x + dx, y: p.y }
}
```

在后续的编译器实现中，我们会大量使用结构体来表示 **抽象语法树（AST）节点、类型描述、IR 节点** 等数据结构，使得代码更加清晰和自文档化。

---

## 代数数据类型（ADT）

MoonBit 使用 `enum` 关键字支持代数数据类型（Algebraic Data Types，简称 ADT）。这类类型非常适合用来描述“有限多种形态”的值，例如颜色、语法树节点、错误类型等。

一个简单的例子：

```moonbit
enum Color {
  RGB(Int, Int, Int)
  RGBA(Int, Int, Int, Int)
}
```

这里的 `Color` 有两种可能的构造方式：

- `RGB(r, g, b)`：只包含三个分量。
- `RGBA(r, g, b, a)`：多了一个 alpha（透明度）分量。

在编译器实现中，ADT 的威力会更加明显。例如，我们可以这样定义一棵非常简化的表达式树：

```moonbit
enum Expr {
  IntLit(Int)
  Add(Expr, Expr)
  Mul(Expr, Expr)
}
```

然后使用模式匹配（下一节会详细介绍）编写一个语义解释函数：

```moonbit
fn eval(e: Expr) -> Int {
  match e {
    IntLit(n) => n
    Add(e1, e2) => eval(e1) + eval(e2)
    Mul(e1, e2) => eval(e1) * eval(e2)
  }
}
```

这种把“数据的形状”和“对不同形状的处理逻辑”紧密绑定在一起的风格，非常契合编译器程序的特性。你会在 MiniMoonBit 的词法分析、语法分析、类型检查和 IR 设计中一次次看到 ADT 的身影。

---

## 数组与视图（Array 与 ArrayView）

在实现编译器或数值程序时，我们不可避免地要处理大量序列数据。MoonBit 提供了 **可变数组** **`Array[T]`**  和 **不可变视图** **`ArrayView[T]`**  这两种常用结构。

可以像这样创建和操作数组：

```moonbit
let a = [1, 2, 3, 4, 5]
a.push(6)      // a 现在是 [1, 2, 3, 4, 5, 6]

let v1 = a[:]   // v1 是一个视图，内容对应 [1, 2, 3, 4, 5, 6]
let v2 = a[1:5] // v2 是一个视图，内容对应 [2, 3, 4, 5]
```

这里有几点值得注意：

- **数组（Array）是可变的**：你可以 `push`、修改某个索引位置的元素等。
- **视图（ArrayView）是不可变的**：它更多是一个“窗口”，用来以只读方式访问某一段数组内容，特别适合在函数式遍历、模式匹配中使用。

在后文讲到函数式循环和模式匹配时，你会看到 `ArrayView` 出现在很多例子中。对于编译器实现来说，用视图来表示“还未处理”的部分列表，是一种既安全又高效的常见手法。

> #### 旁注：`Array::push` 需要 `mut` 吗？
>
> 很多来自 Rust 生态的读者在看到 `Array` 的用法时，都会问这样一个问题：如果我写 `let arr: Array[Int] = [1]`，然后调用 `arr.push(2)`，这在 MoonBit 里是允许的吗？
> 在 Rust 中，对应的写法是 `let arr: Vec<i32> = vec![1]; arr.push(2);`，这会立刻触发一个编译错误：
>
> ```shell
> error[E0596]: cannot borrow `arr` as mutable, as it is not declared as mutable
>  --> src/main.rs:5:5
>   |
> 5 |     arr.push(3);
>   |     ^^^ cannot borrow as mutable
>   |
> help: consider changing this to be mutable
>   |
> 3 |     let mut arr: Vec<i32> = vec![1, 2];
>   |         +++
> ```
>
> 这是因为在 Rust 里，使用普通的 `let` 声明时，通过这个绑定只能以“只读”的方式使用值；只有写成 `let mut arr = ...`，才能通过 `arr` 去修改底层数据。`mut` 同时承担了“这个名字能否被重新赋值”和“能否通过这个名字修改数据”这两层含义。
>
> MoonBit 在这里采取了一个稍微不同的设计：**`mut`** **只表示“这个变量名能不能被重新绑定”，而不控制底层数据本身是否可变。**  换句话说：
>
> - 写成 `let arr = [1]` 之后，`arr.push(2)` 是被允许的；
> - 但 `arr = [2]` 这样的写法是不被允许的，因为它试图让变量名指向一个全新的数组；
> - 如果你确实需要重新绑定变量名，那么应该写成 `let mut arr = [1]`，之后就可以在合适的地方让 `arr` 指向另一个数组。
>
> 这种把“**指向是否可变**”和“**数据本身是否可变**”分开的做法，有点类似 C 语言中区分 `T * const` 和 `const T *`：前者表示“指针本身不能改”，后者表示“不能通过这个指针修改数据”。在某些场景下，这种区分能让类型信息更加精确，也更贴近程序员的直觉。
>
> 在 MoonBit 中，如果你希望的是“数组本身也是只读的”，可以显式地使用只读数组类型 `ReadOnlyArray[T]`，例如：
>
> ```moonbit
> let arr: ReadOnlyArray[Int] = [1, 2, 3]
> ```
>
> 这样一来，类型系统就会在编译期禁止对 `arr` 进行 `push`、`clear` 等修改操作。类似的理念也会体现在结构体等数据结构上：**是否可变主要由类型本身来决定，而不是由绑定上的** **`mut`** **关键字来决定**。

---

## 模式匹配

MoonBit 拥有非常强大的模式匹配能力，在许多地方都可以使用模式匹配来替代冗长的 `if-else` 结构。这对编译器实现尤其重要：我们会在语法树、类型和中间表示上大量使用它。

### `match` 表达式

最常见的模式匹配形式是 `match` 表达式。它根据值的不同形态，选择不同的分支执行。

#### 匹配 Option

MoonBit 中的可选类型可以写作 `Option[T]`，也可以用语法糖 `T?` 来表示。下面是一个简单的例子：

```moonbit
// 这里的 Int? 是一个语法糖，代表 `Option[Int]`
fn is_some(x: Int?) -> Bool {
  match x {
    Some(_) => true
    None => false
  }
}
```

`Some(_)` 表示“包含某个 Int 值，但不关心具体是多少”，`None` 则表示空值。

#### 匹配布尔值

布尔值的匹配虽然可以用 `if` 来替代，但用 `match` 写出来往往更统一，尤其是在你已经在同一个函数里匹配其它形态时：

```moonbit
fn bool_to_int(b: Bool) -> Int {
  match b {
    true => 1
    false => 0
  }
}
```

在 MiniMoonBit 中，我们也会允许对布尔表达式使用类似的匹配。

#### 匹配整数字面量与区间

MoonBit 支持对整数进行精确值匹配和区间匹配。例如：

```moonbit
fn sign(val: Int) -> String {
  match val {
    1..<_ => "positive"
    0 => "zero"
    _..<0 => "negative"
  }
}
```

这里：

- `1..<_` 表示所有 **大于等于 1** 的整数。
- `_..<0` 表示所有 **小于 0** 的整数。
- 中间单独的 `0` 匹配值为零的情况。

这种写法不仅在业务逻辑中常见，在处理某些 IR 指令或寄存器编号等范围判断时也会非常方便。

#### 匹配元组

当我们需要对一对或者多元组的值进行分类处理时，模式匹配同样可以大显身手：

```moonbit
fn classify_pair(p: (Int, Int)) -> String {
  match p {
    (0, 0) => "both zero"
    (x, 0) => "y is zero"
    (0, y) => "x is zero"
    (x, y) => "both non-zero"
  }
}
```

在编译器实现中，我们可以用这种方式对某些“标记 + 载荷”的结构进行解构和分类。

#### 匹配字符串

字符串同样可以在 `match` 中直接使用字面量模式：

```moonbit
fn greet(s: String) {
  match s {
    "hello" => println("match hello")
    "world" => println("match world")
    other => println("match others: \{other}")
  }
}
```

上例中的 `other` 是一个绑定变量，用来捕获所有不匹配前两个分支的字符串。

#### 匹配结构体

结构体的字段也可以直接在 `match` 模式中解构。下面我们用一个 `Point` 结构体来判断点所在的象限或者轴上位置：

```moonbit
struct Point {
  x: Int
  y: Int
}

fn loc_of_point(p: Point) -> String {
  match p {
    { x: 0, y: 0 } => "origin"
    { x: 0, y: _ } => "on y-axis"
    { x: _, y: 0 } => "on x-axis"
    { x: 1..<_, y: 1..<_ } => "first quadrant"
    { x: _..<0, y: 1..<_ } => "second quadrant"
    { x: _..<0, y: _..<0 } => "third quadrant"
    { x: 1..<_, y: _..<0 } => "fourth quadrant"
  }
}
```

这里我们总共区分了 7 种情况：原点、x 轴、y 轴以及四个象限。这种写法在后续对抽象语法树节点分类时会非常常见。

#### 匹配数组

对数组进行模式匹配时，我们可以使用 `[..]` 语法来匹配开头元素和“剩余部分”：

```moonbit
fn describe_first(arr: Array[Int]) {
  match arr {
    [1, ..] => println("the first element of array is 1")
    [2, ..] => println("the first element of array is 2")
    [3, ..] => println("the first element of array is 3")
    [_, ..] => println("the first element of array is not 1, 2, or 3")
    [] => println("the array is empty")
  }
}
```

`[..]` 部分通常会搭配 `ArrayView` 使用，用来逐步“剥离”数组的头元素，这在后面介绍的函数式循环中会再次出现。

---

### `is` 表达式

如果我们仅仅想要判断一个值是否符合某种模式，而不需要同时匹配多种情况，使用完整的 `match` 有时显得有些啰嗦。例如，判断一个 `Int?` 是否为 `Some`：

```moonbit
fn is_some(x: Int?) -> Bool {
  match x {
    Some(_) => true
    None => false
  }
}
```

MoonBit 提供了一个更简洁的写法：`is` 表达式：

```moonbit
fn is_some(x: Int?) -> Bool {
  x is Some(_)
}
```

`is` 表达式在处理 **嵌套模式** 时尤其方便，看下面这个例子：

```moonbit
struct Point {
  x: Int
  y: Int
}

fn is_in_first_quad(p: Point?) -> Bool {
  p is Some(pt) && pt is { x: 1..<_, y: 1..<_ } 
}
```

这里我们先用 `p is Some(pt)` 检查 `p` 是否是一个 `Some`，并在为真时把内部的 `Point` 绑定到 `pt`。接着再用 `pt is { ... }` 来检查它是否落在第一象限。这种循序渐进的写法非常贴合人类对条件判断的思维方式。

---

### 卫语句 `guard`

在函数内部，我们经常需要断定“某个条件必然成立”，否则就提前退出或抛错。传统的写法通常是：

```moonbit
fn must_be_some_int(x: Int?) -> Unit raise {
  if x is Some(i) {
    println("x is Some(\{i})")
  } else {
    fail("x is None")
  }
}
```

这种写法的一个小问题是：**真正的业务逻辑被包裹在了** **`if`** **的分支内部**，导致主体代码缩进较深，可读性略差。

MoonBit 提供了 `guard` 语句，让我们可以“先把不符合条件的情况处理掉，然后再写主逻辑”：

```moonbit
fn must_be_some_int(x: Int?) -> Unit raise {
  guard x is Some(i) else {
    fail("x is None")
  }
  println("x is Some(\{i})")
}
```

这里 `guard` 的含义是：

- 如果条件 `x is Some(i)` 为真，那么继续往下执行，且把内部值绑定到 `i`。
- 如果条件不满足，则执行 `else` 分支中的代码（通常是 `return`、`fail` 或抛出异常），并终止当前函数。

这种“先排除异常情况，再讲主线逻辑”的写法，在编译器实现中也非常常见。你可以在处理错误输入、非法语法或类型不匹配时大量使用它，使代码更加线性、易读。

---

### `lexmatch` 正则表达式匹配

除了结构化的模式匹配，MoonBit 还提供了 `lexmatch` 这样的工具，用于基于正则表达式对字符串进行词法级别的解析。它在构造词法分析器时尤其有用。

下面是一个简单的例子：判断一个字符串是否以数字开头，并把数字部分和剩余部分分离出来：

```moonbit
fn is_start_with_a_number(str: String) -> Unit {
  lexmatch str with longest {
    (("\d+" as n), rest) => println("number part is \{n}, rest is \{rest}") 
    _ => println("not start with a number")
  }
}

fn main {
  let s = "123abc"
  is_start_with_a_number(s)
}
```

这里：

- `lexmatch str with longest` 表示对字符串 `str` 进行词法匹配，选择“最长匹配”的分支。
- `"\d+" as n` 是一个正则模式，匹配一个或多个数字，并把匹配到的那一段绑定到变量 `n`。
- `rest` 则表示匹配完成后剩下的字符串。

运行上述程序，会得到输出：

```shell
> moon run main
number part is 123, rest is abc
```

在 MiniMoonBit 的词法分析章节中，我们会从更底层的角度来实现 Tokenizer，但理解 `lexmatch` 能帮助你快速建立对“按模式切分字符串”的直觉。

---

## 分支

和大多数编程语言一样，MoonBit 支持 `if-else` 分支语句：

```moonbit
fn max(a: Int, b: Int) -> Int {
  if a > b { a } else { b }
}
```

这里 `if` 表达式本身有值：如果条件为真，整个表达式的值是 `a`，否则为 `b`。在函数体中返回的就是这个值。在 MiniMoonBit 中，我们也会采用类似的设计，使得 `if` 既可以作为语句，也可以作为表达式参与更复杂的组合。

---

## 循环

### `for` 循环

MoonBit 既支持类似 C 语言的计数式 `for` 循环，也支持更高层的迭代式循环。

计数式循环：

```moonbit
fn sum(min: Int, max: Int, step: Int) -> Int {
  let mut total = 0
  for i = min; i < max; i = i + step {
    total += i
  }
  total
}
```

迭代式循环：

```moonbit
fn sum_arr(arr: Array[Int]) -> Int {
  let mut total = 0
  for e in arr {
    total += e
  }
  total
}
```

在编译器实现中，我们会同时支持命令式循环和更函数式的遍历方式，以便在不同场景下平衡可读性与性能。

### `while` 循环

`while` 循环提供了最基本的“条件为真就继续”的控制结构：

```moonbit
fn search(arr: Array[Int], e: Int) -> Int? {
  let mut idx = 0
  while idx < arr.length() {
    if arr[idx] == e {
      return idx
    }
    idx = idx + 1
  }
  None
}
```

这里我们返回 `Int?`，表示可能找到索引，也可能找不到。MiniMoonBit 中对应的循环语法和返回约定会与此类似。

---

## 函数式循环

MoonBit 还有一个非常有特色的构造——**函数式循环** **`loop`**，它的用法看起来有点像 `match`，但语义上是一个带状态的“尾递归折叠”。

来看一个示例：用 `loop` 来对数组求和：

```moonbit
fn sum_arr(arr: Array[Int]) -> Int {
  loop (0, arr[:]) {  // 这里的 [:] 是对 arr 取 ArrayView
    (t, [e, ..rest]) => continue (t + e, rest)
    (t, []) => break t
  }
}
```

解释一下这段代码：

- `loop (0, arr[:])`：初始状态是一个二元组 `(0, arr[:])`，其中

  - `0` 是当前累积的和。
  - `arr[:]` 是把数组转换成视图，用来表示“还没处理的那一段”。
- 第一条分支 `(t, [e, ..rest]) => continue (t + e, rest)` 表示：

  - 如果当前视图至少有一个元素 `e`，并且剩余部分为 `rest`，那么下一轮循环的状态变为 `(t + e, rest)`。
- 第二条分支 `(t, []) => break t` 表示：

  - 如果当前视图已经是空的 `[]`，那么退出循环，并返回 `t`。

如果输入数组是 `[1, 2, 3, 4, 5]`，状态演化过程大致是：

```plaintext
(0, [1, 2, 3, 4, 5])
(1, [2, 3, 4, 5])
(3, [3, 4, 5])
(6, [4, 5])
(10, [5])
(15, []) => 返回 15
```

从编译器实现者的角度看，`loop` 是把“显式递归”通过语法糖和编译器支持变成了一种易读、易优化的结构。MiniMoonBit 的 IR 设计中，我们也会讨论如何用更底层的跳转和基本块来表示这样的高层循环。

---

## 闭包

MoonBit 支持在函数内部定义函数，并允许内部函数捕获外部作用域的变量，这就是闭包（closure）。例如：

```moonbit
fn make_adder(x: Int) -> (Int) -> Int {
  fn adder(y: Int) -> Int {
    x + y
  }
  adder
}
```

这里：

- 外层函数 `make_adder` 接受一个参数 `x`。
- 内层函数 `adder` 使用了外层的 `x`，并返回 `x + y`。
- `make_adder` 返回的是这个内部函数本身，因此我们可以写出：

```moonbit
fn demo() {
  let add2 = make_adder(2)
  println(add2(10)) // 打印 12
}
```

在运行时，`add2` 不仅仅是一段代码，还携带了它捕获的环境（`x = 2`）。在本书后面讲到 **闭包转换** 时，我们会详细解释编译器如何把这样的高层抽象拆解为低层的数据结构与函数指针，使其能在无闭包概念的机器上正确运行。

---

## 泛型与 trait

MoonBit 支持泛型（即参数化类型），并通过 `trait` 提供了一种约束和抽象行为的方式。这对于构建可复用的库和工具链非常重要。

### 函数泛型

我们可以编写对任意类型 `T` 都适用的函数，例如对数组中的每个元素执行一个操作：

```moonbit
fn[T] each(arr: Array[T], f: (T) -> Unit) -> Unit {
  for e in arr {
    f(e)
  } 
}
```

这里：

- `fn[T]` 表示函数对类型参数 `T` 泛型。
- `Array[T]` 是元素类型为 `T` 的数组。
- 参数 `f` 是一个函数，从 `T` 到 `Unit`。

### 使用 trait 约束泛型

很多时候，我们希望对泛型类型施加一些约束，例如“必须支持相等性比较”。这时可以使用 `trait` 作为约束：

```moonbit
fn[T: Eq] all_equal(arr: Array[T], elem: T) -> Bool {
  loop (true, arr[:]) {
    (b, [e, ..rest]) => continue (b && (e == elem), rest)
    (b, []) => break b
  }
}
```

这里：

- `T: Eq` 表示类型参数 `T` 必须实现 `Eq` 这个 trait。
- `Eq` 是标准库中的一个 trait，表示“可比较相等”。

要为某个类型实现 `Eq`，我们可以编写如下代码：

```moonbit
struct Point {
  x: Int
  y: Int
}

impl Eq for Point with equal(self: Point, other: Point) -> Bool {
  self.x == other.x && self.y == other.y
}
```

这样一来，我们就可以对 `Array[Point]` 使用 `all_equal` 函数了。

同理，我们也可以自定义 trait。例如，假设我们有一个表示形状的 trait：

```moonbit
trait Shape {
  is_shape(Self) -> Bool
}
```

任何实现了 `Shape` 的类型，都需要给出一个名为 `is_shape` 的函数定义。在 MiniMoonBit 的设计中，我们会选择 trait 的一个子集，以便在书中把类型推导与约束检查讲清楚。

---

## `derive`

在很多场景下，我们只需要为某个结构体或枚举自动生成一些“机械重复”的 trait 实现，例如：

- `Show`：把值转换成字符串，方便打印和调试。
- `Eq`：判断两个值是否相等。
- `Hash`：为值生成哈希值，以便用在哈希表中。

MoonBit 提供了 `derive` 语法来自动生成这些实现：

```moonbit
struct Point {
  x: Int
  y: Int
} derive(Show, Eq)
```

需要注意的是：**参与 derive 的所有字段类型本身也必须实现对应的 trait**。例如，要为 `Point` derive `Show`，那么 `Int` 自然已经实现了 `Show`；对于自定义类型，也需要先确保它们具备相应的 trait 实现。

在实现 MiniMoonBit 编译器时，我们会暂时不实现 `derive` 这样偏“语法糖”的特性，而是重点关注核心语义。但理解它有助于你在阅读完整 MoonBit 代码时更轻松。

---

## 错误处理

({这里需要添加有关错误处理的内容})

---

## 测试块

可靠的编译器离不开大量测试。MoonBit 提供了内置的测试块语法，以及一组常用的断言函数。

常用测试工具包括：

- `assert_eq`
- `assert_true`
- `assert_false`
- `inspect`：检查目标值的字符串表示形式是否符合预期

下面是一个简单示例：

```moonbit
fn add(x: Int, y: Int) -> Int {
  x + y
}

test "Test add function" {
  assert_eq(add(1, 2), 3)
  assert_true(add(4, 5) == 9)
  assert_false(add(1, 3) == 7)
  inspect(add(2, 3), content = "5")
}
```

使用 `moon test` 命令即可运行这些测试块：

```shell
> moon test --verbose
[username/hello] test main/main.mbt:5 ("Test add function") ok
Total tests: 1, passed: 1, failed: 0.
```

在本书的 MiniMoonBit 项目中，我们会始终保持“先写（或同时写）测试，再实现功能”的节奏，从而帮助你验证各个阶段的实现是否正确。

---

## 文档测试

MoonBit 还支持 **文档测试（doctest）** ：你可以在文档注释中嵌入示例代码，`moon test` 会自动提取并运行这些示例，以确保文档中的代码始终可编译、可运行。

例如：

```moonbit
///|
/// examples 
///
/// ‍```moonbit
/// assert_eq(add(1, 2), 3)
/// ‍```
pub fn add(x: Int, y: Int) -> Int {
  x + y
}
```

运行：

```shell
> moon test --verbose
[username/hello] test main/main.mbt:4 (#0) ok
Total tests: 1, passed: 1, failed: 0.
```

在编写 MiniMoonBit 编译器时，我们也会借助类似思路，在说明性文档中插入可以直接运行的示例，用测试来保证文档与实现始终同步。

---

## 多后端支持

MoonBit 的一个重要特性是对多后端的原生支持。默认情况下，`moon run` 使用 **WebAssembly** 后端，但你也可以通过命令行的 `--target` 选项，或在 `moon.mod.json` 中配置 `preferred-target` 来选择其它后端。

使用 **native** 后端（通过生成 C 代码再编译为本地二进制）：

```shell
moon run main --target native
```

使用 **JavaScript** 后端来运行测试：

```shell
moon test main --target js
```

使用 **LLVM** 后端：

```shell
moon run main --target llvm
```

你也可以在 `moon.mod.json` 中添加 `preferred-target` 字段，这样就不必在每次运行时都手动添加 `--target` 选项：

```json
{
  "name": "username/hello",
  "version": "0.1.0",
  "readme": "README.md",
  "repository": "",
  "license": "Apache-2.0",
  "keywords": [],
  "description": "",
  "preferred-target": "native"
}
```

对我们这本书而言，多后端支持有两层意义：

- 一方面，我们可以方便地在不同平台上运行 MiniMoonBit 编译器本身。
- 另一方面，它也让我们有机会在后文谈论“自制编译器如何对接不同后端”的问题，例如直接输出 LLVM IR 或 RISC-V 汇编。

---

## MiniMoonBit 要支持的内容

在了解了 MoonBit 的主要特性之后，我们可以更清晰地说明：**MiniMoonBit 打算支持哪些语言构造**。总体上，它会包含以下几大类：

- **基本语法与绑定**

  - 变量声明：`let` 与 `let mut`
  - 函数声明与调用
- **复合数据类型**

  - 结构体声明
  - 代数数据类型（`enum`）
- **控制流**

  - `if` 分支
  - `for` 循环
  - `while` 循环
  - `match` 模式匹配
- **函数式特性**

  - 一等函数与闭包
  - 简单的泛型与 trait 约束（精简版）
- **数组与视图**

  - `Array` 与 `ArrayView` 及其基本操作

这些构造已经足以表达我们在后面章节中要实现的三个项目：光线追踪、Lisp 解释器和神经网络训练。更重要的是，它们覆盖了现代语言设计中的许多关键点：类型系统、模式匹配、闭包语义、中间表示与优化、寄存器分配等。

在接下来的章节中，我们会从词法和语法开始，一点点为 MiniMoonBit 添砖加瓦。最终，你会看到：**从 Token 到 Tensor 的路径，其实就是从 MoonBit 到 MiniMoonBit 再到机器世界的一条清晰道路。**
