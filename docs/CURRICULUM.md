# C Forge curriculum map

C17 course version 1: **12 modules, 48 substantive lessons, 105 assessed exercises, 12 module checkpoints, 3 guided projects, and 39 searchable reference entries.**

The checked-in [manifest](../content/manifest.json) was written before authoring. Titles can change without changing IDs. Lesson and exercise versions start at 1; attempts retain the version they assessed. C++ is a separate future course and has no working navigation in this release. C17 is the deliberate baseline, not the latest standard. C23 notes are labeled and do not change C17 grading.

Each lesson has one objective, short explanations, a runnable worked example, line-by-line notes, a prediction, two exercises, a recap, and a retrieval question. Estimated 5–12 minute lessons are pacing guides. The fourth lesson of each module is a checkpoint. Project milestones add nine assessed exercises beyond the 96 lesson exercises.

For each lesson below, the two stable exercise IDs are `<lesson ID>-guided` and `<lesson ID>-independent`. The full JSON includes all prompts, starter files, allowed inputs, public cases, server grading contracts, three hints, solutions, explanations, concept tags, and versions. Hidden tests and reference solutions remain server content.

## First program

Turn C source into an executable, explain its entry point, and repair small syntax mistakes.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `source-to-program` | Explain the separate compile and run steps of a minimal C program. | None | 8 |  |
| `printing-text` | Use newline and quote escapes to format a small text report. | `source-to-program` | 8 |  |
| `statements-and-comments` | Distinguish executable statements from comments and repair a compiler-reported source error. | `printing-text` | 8 |  |
| `first-program-checkpoint` | Build and explain a small report without copying a malformed template. | `statements-and-comments` | 10 | Yes |

## Values and expressions

Represent values with suitable types and calculate small numerical results without unsafe assumptions.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `variables-and-types` | Initialize named values and choose basic types for quantities. | `first-program-checkpoint` | 8 |  |
| `arithmetic-and-conversions` | Distinguish integer division from floating-point division and control evaluation order. | `variables-and-types` | 8 |  |
| `formats-and-sizeof` | Match printf argument types and use sizeof without assuming fixed type widths. | `arithmetic-and-conversions` | 8 |  |
| `values-checkpoint` | Calculate a bounded numerical report with correct conversions and formatting. | `formats-and-sizeof` | 10 | Yes |

## Decisions

Express branching rules, combine conditions, and test representative boundaries.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `comparisons-and-truth` | Build conditions with comparisons and distinguish equality from assignment. | `values-checkpoint` | 8 |  |
| `branching-rules` | Implement ordered if/else rules and test their boundary values. | `comparisons-and-truth` | 8 |  |
| `short-circuit-and-switch` | Use evaluation order to guard division and handle a small discrete choice. | `branching-rules` | 8 |  |
| `decisions-checkpoint` | Combine validity checks and ordered classifications without changing the data. | `short-circuit-and-switch` | 10 | Yes |

## Repetition

Trace bounded loops, accumulate results, and repair termination or off-by-one mistakes.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `while-and-invariants` | Trace a bounded while loop and identify how it terminates. | `decisions-checkpoint` | 9 |  |
| `for-and-bounds` | Read the three parts of a for loop and choose an inclusive or exclusive bound. | `while-and-invariants` | 8 |  |
| `accumulators-and-control` | Maintain a running total and distinguish continue from break. | `for-and-bounds` | 8 |  |
| `repetition-checkpoint` | Compute a count, total, and mean from generated values without off-by-one or initialization errors. | `accumulators-and-control` | 11 | Yes |

## Functions and decomposition

Split numerical rules into small, testable functions and explain calls, scope, and lifetime.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `parameters-and-results` | Define a function with parameters and a return value. | `repetition-checkpoint` | 8 |  |
| `prototypes-and-scope` | Use prototypes and local scope to organize functions. | `parameters-and-results` | 8 |  |
| `value-and-lifetime` | Explain pass-by-value and the lifetime of a local object. | `prototypes-and-scope` | 8 |  |
| `functions-checkpoint` | Combine testable functions and trace a bounded recursive call. | `value-and-lifetime` | 10 | Yes |

## Arrays and strings

Process bounded datasets and NUL-terminated text without crossing capacity.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `array-indices-and-length` | Process a fixed-length array using a valid index bound. | `functions-checkpoint` | 8 |  |
| `character-arrays` | Distinguish character-array capacity from string length. | `array-indices-and-length` | 8 |  |
| `text-and-capacity` | Copy and append strings only when destination capacity permits. | `character-arrays` | 8 |  |
| `arrays-checkpoint` | Apply array bounds and distinguish a safe string from an invalid read. | `text-and-capacity` | 10 | Yes |

## Pointers and memory

Use addresses and pointer parameters while preserving object lifetime and array bounds.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `addresses-and-dereference` | Distinguish a pointer object from the object it designates. | `arrays-checkpoint` | 8 |  |
| `pointer-parameters` | Use pointer output parameters with a clear success contract. | `addresses-and-dereference` | 8 |  |
| `arrays-to-pointers` | Use array-to-pointer conversion and bounded pointer arithmetic. | `pointer-parameters` | 8 |  |
| `pointers-checkpoint` | Review valid pointer operations and identify expired storage. | `arrays-to-pointers` | 10 | Yes |

## Input and validation

Read complete lines and validate integers, malformed input, EOF, and truncation.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `bounded-line-input` | Use fgets while recognizing newline, EOF, and incomplete lines. | `pointers-checkpoint` | 8 |  |
| `strtol-and-end-pointer` | Validate conversion using the end pointer and errno. | `bounded-line-input` | 8 |  |
| `range-and-truncation` | Handle EOF and long input without parsing a truncated prefix. | `strtol-and-end-pointer` | 8 |  |
| `input-checkpoint` | Compose bounded reading, conversion, and domain validation. | `range-and-truncation` | 10 | Yes |

## Structured data

Model and update meaningful records with explicit state.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `struct-members` | Define a struct and read or update its members. | `input-checkpoint` | 10 |  |
| `typedef-and-enum` | Use typedef and enum to express a record state without magic numbers. | `struct-members` | 10 |  |
| `arrays-of-records` | Traverse a bounded record array and derive a result. | `typedef-and-enum` | 10 |  |
| `records-checkpoint` | Maintain a bounded collection with clear success and failure outcomes. | `arrays-of-records` | 12 | Yes |

## Dynamic allocation

Own dynamically allocated storage and grow it without losing valid data.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `allocate-and-release` | Allocate initialized storage, check failure, and release it once. | `records-checkpoint` | 10 |  |
| `ownership-and-failure` | Document who releases storage and avoid dangling aliases. | `allocate-and-release` | 10 |  |
| `safe-growth` | Use realloc with checked size arithmetic and an atomic failure contract. | `ownership-and-failure` | 10 |  |
| `allocation-checkpoint` | Review allocation failures and verify a small owned collection. | `safe-growth` | 12 | Yes |

## Files and program structure

Persist data, report I/O errors, and organize a multi-file C program.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `file-errors-and-persistence` | Open, write, read, and close a text file with explicit error handling. | `allocation-checkpoint` | 10 |  |
| `arguments-and-formats` | Validate command-line arguments and document an interoperable text format. | `file-errors-and-persistence` | 10 |  |
| `headers-and-linking` | Separate declarations from definitions and link a multi-file program. | `arguments-and-formats` | 10 |  |
| `structure-checkpoint` | Combine file contracts, error paths, modules, and an explicit build command. | `headers-and-linking` | 12 | Yes |

## Debugging and integration

Use warnings, debuggers, sanitizers, and edge cases to investigate C behavior.

| Stable lesson ID | Objective | Prerequisite | Minutes | Checkpoint |
|---|---|---|---:|---|
| `warnings-and-gdb` | Use compiler warnings and a repeatable debugger workflow. | `structure-checkpoint` | 10 |  |
| `sanitizers-and-lifetime` | Use ASan and UBSan while understanding what they do not prove. | `warnings-and-gdb` | 10 |  |
| `behavior-and-portability` | Distinguish undefined, unspecified, and implementation-defined behavior. | `sanitizers-and-lifetime` | 10 |  |
| `debugging-checkpoint` | Combine independent cases, bounds reasoning, and diagnostic tools. | `behavior-and-portability` | 12 | Yes |

## Guided projects

Each project contains a brief, prerequisites, persisted starter workspace, three assessed milestones, a final rubric, and an explained full reference implementation. Earlier project work stays in its own project ID.

| Project | Prerequisites | Assessed milestones |
|---|---|---|
| Numerical toolkit (`numerical-toolkit`) | `functions-checkpoint` | 1. Sum provided values (`functions-checkpoint-project-total`); 2. Find the range (`functions-checkpoint-project-span`); 3. Compose the report (`functions-checkpoint-project-summary`) |
| A small record manager (`record-manager`) | `input-checkpoint`, `records-checkpoint` | Validate a duration before mutation (`records-checkpoint-project-parse`); Append a complete record (`records-checkpoint-project-add`); List and summarize useful state (`records-checkpoint-project-summary`) |
| Terminal study tracker (`study-tracker`) | `allocation-checkpoint`, `structure-checkpoint`, `debugging-checkpoint` | Own a growable record collection (`debugging-checkpoint-project-vector`); Persist and validate a text format (`debugging-checkpoint-project-persistence`); Integrate, build, and inspect the tool (`debugging-checkpoint-project-cli`) |

The numerical toolkit uses provided bounded values after ordinary functions. The record manager adds robust batch input and fixed-capacity records after strings, pointers, and parsing. The final study tracker owns dynamic records, persists a documented format, has separate source/header files, and includes a Makefile. Its simple direct-write save checks errors but is not crash-atomic; its reference explanation states this limitation.

## Assessment and assistance

Of 105 exercises, 98 compile and execute C and seven are explicit conceptual diagnoses with a deterministic text answer. Function contracts exercise normal, empty, singleton, boundary, and invalid-input behavior as applicable. They test behavior rather than one textual implementation. Some introductory printing and supplied-data edits have only one observable output; loop/function-use goals in those activities are explicitly reflection criteria, not regex-enforced structural grades. Later parameterized cases reject hardcoded public-sample solutions.

Undefined-behavior diagnoses never require one output. Deliberately malformed or incorrect starters are described in their prompts; they are not ordinary reference solutions. The worked examples and solutions are the trusted authoring corpus. Learner runs always use the isolated runner integration and never the authoring host utility.

Hints have a conceptual nudge, a concrete strategy, and near-solution guidance. Explicit solution reveal records help usage, and completion is distinct from independent proficiency. Review uses the application’s documented deterministic intervals; estimates and review suggestions make no medical or guaranteed-learning claim.

## Manual prerequisite and accuracy audit

The curriculum’s transition audit inspected the following relationships in addition to the automated graph check:

- **Arrays to pointers:** array length is demonstrated in declaration scope; array-parameter notation is labeled scaffolding. The pointer module explains parameter adjustment, conversion exceptions, explicit count, bounded arithmetic, aliasing, and one-past access. It never claims arrays and pointers are interchangeable.
- **Pointers to input:** output parameters preserve previous values on failure. fgets, strchr, NULL, end pointers, errno, and range checks appear only after strings, pointers, and ordinary calls. The complete-line helper is labeled and then explained through its probe-and-drain behavior.
- **Lifetime to allocation:** expired automatic objects and borrowed aliases are taught before malloc. Allocation lessons check failure, initialize objects, explain one owner, guard size multiplication, and commit realloc only through a temporary. Stack/heap labels are stated as common implementation models.
- **Allocation to files:** record and vector invariants precede persisted collections. File loads validate all records in a temporary owner and retain previous state on failure. I/O success includes close errors. Command-line inputs have explicit conversion and bounds.
- **Numeric portability:** printf formats match promoted argument types; no fixed int width is assumed. Large bounded totals use long where the minimum int range would be insufficient. Signed overflow is guarded before arithmetic. C23 features stay in a labeled reference note.

The audit is a practical editorial review, not a proof that every possible implementation, learner path, or input is correct. Review format choices and prerequisites again when content versions change.

## Verification

```sh
npm run content:audit
npm run content:verify -- --trusted-authoring
npm run content:verify
```

`content:audit` validates schemas, counts, unique/stable IDs, manifest order, prerequisite cycles/references, objective uniqueness, staged hints, runnable function harnesses, project assessment references, and prohibited source patterns. It cannot establish pedagogical quality by itself.

`--trusted-authoring` compiles and runs only finite version-controlled examples and reference solutions with explicit C17 and warnings. It does not read learner drafts and does not verify sandbox isolation. The default verifier requires the isolated runner; in this cloud environment that execution gate is unavailable because rootless Podman is absent and Docker cannot create a namespace. Do not relabel trusted authoring execution as isolated learner execution.

Authoring checks also rejected four safe representative wrong solutions: integer-division mean, zero-initialized maximum for negative data, an always-NULL finder, and a hardcoded toolkit sample report. Two intentionally invalid diagnosis snippets were compiled to confirm array-bound/local-address warnings and never executed. Integrated command outcomes are recorded in the verification report.
## Sources consulted

Official pages were inspected through the web research tool on 2026-10-13. [GCC C standard support](https://gcc.gnu.org/projects/c-status.html) and [language standards](https://gcc.gnu.org/onlinedocs/gcc/Standards.html) confirm explicit `-std=c17`, distinguish C17 from C23, and describe support by compiler version. GCC’s current default has changed since GCC 14; the application therefore never inherits it.

[GCC instrumentation options](https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html) documents the address/undefined sanitizers and debugging flags used by the runner integration. The application keeps sanitizer evidence distinct from a correctness proof and does not use diagnostics execution in this cloud while isolation is unavailable.

The [IES instructional practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1) informed the alternating worked examples, active exercises, delayed retrieval, and graphics with verbal descriptions. C Forge’s deterministic review schedule is an engineering choice, not a validated personalization or medical intervention.
