export interface DiagnosticHelp {
  title: string;
  explanation: string;
}
const rules: [RegExp, DiagnosticHelp][] = [
  [
    /expected [‘']?;|expected.*before.*}/,
    {
      title: "A statement may be missing its semicolon.",
      explanation:
        "Check the line just before this location as well. The compiler reports where it became unable to continue parsing.",
    },
  ],
  [
    /undeclared|not declared/,
    {
      title: "The compiler cannot find this name.",
      explanation:
        "Check its spelling, declaration, and scope. A name declared inside a block is visible only in that block.",
    },
  ],
  [
    /implicit declaration of function/,
    {
      title: "A function declaration is missing.",
      explanation:
        "Include the correct standard header or declare your own function before calling it.",
    },
  ],
  [
    /format .*expects argument|format.*has type/,
    {
      title: "The format and argument types disagree.",
      explanation:
        "Match each printf conversion with the argument type: %d for int, %zu for size_t, and %f for double.",
    },
  ],
  [
    /undefined reference/,
    {
      title: "The linker cannot find a definition.",
      explanation:
        "A declaration describes a function; its definition must also be compiled and linked.",
    },
  ],
  [
    /AddressSanitizer: heap-use-after-free/,
    {
      title: "Freed storage was used.",
      explanation:
        "An object can no longer be accessed after free. Track ownership and remove remaining aliases before release.",
    },
  ],
  [
    /AddressSanitizer:.*buffer-overflow/,
    {
      title: "An access went outside an object.",
      explanation:
        "Check indices, array length, and text capacity including the terminating NUL character.",
    },
  ],
  [
    /runtime error: signed integer overflow/,
    {
      title: "A signed calculation exceeded its range.",
      explanation:
        "Signed overflow is undefined behavior in C. Check bounds before performing the calculation.",
    },
  ],
];
export function explainDiagnostic(message: string): DiagnosticHelp | null {
  return rules.find(([pattern]) => pattern.test(message))?.[1] ?? null;
}
