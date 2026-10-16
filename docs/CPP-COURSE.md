# C++20 course

A complete introductory-to-intermediate path with 12 ordered modules, 48 lessons,
105 exercises, 12 checkpoints, three guided projects and 48 reference entries.
No C prerequisites are required. C++20 is an explicit course baseline.

| Chapter | Lessons |
| --- | --- |
| 1. First C++ programs | Source, compilation and output, Values and initialization, Integer and floating arithmetic, Checkpoint: a time converter |
| 2. Input and control flow | Checking input before use, Booleans and branches, Loops and boundaries, Checkpoint: batch totals |
| 3. Functions and references | Functions and return values, References and const parameters, Overloads, scope and names, Checkpoint: a bounded adjustment |
| 4. Strings and sequences | Strings and complete lines, Vectors and checked access, Arrays and nonowning spans, Checkpoint: a text counter |
| 5. Algorithms and associative containers | Sorting a sequence, Search and iterator validity, Maps and frequency tables, Checkpoint: unique sorted values |
| 6. Records and classes | Records and scoped enums, Classes and invariants, Construction, destruction and RAII, Checkpoint: a wallet invariant |
| 7. Ownership and lifetime | Pointers, observers and null, Exclusive ownership with unique_ptr, Shared ownership and weak observers, Checkpoint: return an owning value |
| 8. Templates and compile-time rules | Function templates and deduction, Class templates and value types, Concepts and constexpr, Checkpoint: a generic sum |
| 9. Errors and validated input | Optional values and absence, Exceptions and cleanup, Parsing a complete line, Checkpoint: validated scores |
| 10. Files and program structure | File streams and persistence, Headers, source files and linking, Namespaces and definition rules, Checkpoint: a file-backed total |
| 11. Modern abstraction | Lambdas and lazy views, Moves and valid object states, Virtual interfaces and destruction, Checkpoint: configurable behavior |
| 12. Debugging, tests and integration | Diagnostics and bounds checks, Tests and behavioral invariants, Complexity and container choice, Checkpoint: a complete score report |

## Assessment

57 exercises compile and check actual programs. Another 48 exercises assess
language rules with short conceptual answers and are labeled accordingly.
Every lesson includes an explained worked example, a prediction, staged hints,
an assessed coding task, a conceptual task and a retrieval question.

Compiler grading compares server-owned behavioral cases, including boundary
inputs. It does not inspect every implementation choice or prove correctness.
Reference solutions remain behind the existing reveal flow.

## Projects

**Number toolkit.** Build a batch statistics tool, then add ordering and distinct-value reporting.

- Total a batch: Read n in [0,100] and n integers in [-1000,1000]. Print their sum.
- Report extrema: Read n in [0,100] and n integers. Print empty if n is zero; otherwise print the minimum and maximum separated by one space.
- Distinct sorted report: Read n in [0,100] and n integers. Print the count of distinct values on the first line, then each distinct value on its own line in ascending order.

**Word index.** Build an ordered word index with frequency counts and lookup.

- Count records: Read n in [0,100] and n lowercase words. Print the number of distinct words.
- Build frequencies: Read n in [0,100] and n lowercase words. Print word and frequency pairs in lexical order, one pair per line.
- Query the index: Read n in [0,100], n lowercase words, q in [0,100], then q query words. Print the frequency of each query on its own line, including 0 for missing words. Do not insert missing query keys.

**File-backed gradebook.** Validate learner records, keep the best score per name, and round-trip the report through a file.

- Validate records: Read n in [0,100], followed by n name/score pairs. Names are lowercase words. Print invalid if any score is outside [0,100], otherwise print the number of accepted records.
- Retain the best score: Read n in [0,100] and n lowercase name/score pairs with scores in [0,100]. Keep the highest score for each name. Print name and score pairs in lexical name order.
- Save and restore the report: Read n in [0,100] and n lowercase name/score pairs. Reject scores outside [0,100] by printing invalid. Keep each name's best score, write the sorted report to grades.txt, close it, then print the lines read back. Print error for a file failure. Empty input produces no report lines.

## Scope and runtime

The course covers practical core C++ through templates, concepts, ownership,
file I/O, runtime polymorphism and integration. Specialized follow-on topics,
such as concurrency, coroutines, custom allocators and modules, are outside
this course. C++ is a large language; completing one course is not exhaustive
language or standard-library coverage.

Programs use `.cpp` and `.hpp` files and explicit `g++ -std=c++20 -x c++`.
The worker retains the same network, filesystem and resource restrictions used
for C17. Preflight checks both languages before advertising C++ availability.

Trusted authoring verification checks only fixed version-controlled examples
and solutions. Native sandbox verification requires the configured rootless
worker host; a successful local build does not establish isolation.
