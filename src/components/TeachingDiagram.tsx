import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import "./pages.css";

type DiagramKind = "loop" | "array" | "pointer" | "function";
interface Frame {
  line: number;
  explanation: string;
  values: [string, string][];
  output?: string;
}
const lessons: Record<
  DiagramKind,
  { title: string; code: string[]; frames: Frame[] }
> = {
  loop: {
    title: "A loop, one step at a time",
    code: [
      "int sum = 0;",
      "for (int i = 0; i < 3; ++i) {",
      "    sum += i;",
      "}",
      'printf("%d\\n", sum);',
    ],
    frames: [
      {
        line: 0,
        explanation:
          "Initialize sum to 0 before reading it. No output has been produced.",
        values: [
          ["sum", "0"],
          ["i", "not declared yet"],
        ],
        output: "",
      },
      {
        line: 1,
        explanation:
          "Initialize i to 0. The condition 0 < 3 is true, so enter the loop.",
        values: [
          ["sum", "0"],
          ["i", "0"],
        ],
        output: "",
      },
      {
        line: 2,
        explanation:
          "Add i to sum: 0 + 0 = 0. After the body, ++i changes i to 1.",
        values: [
          ["sum", "0"],
          ["i", "0 → 1"],
        ],
        output: "",
      },
      {
        line: 1,
        explanation: "The condition 1 < 3 is true. Enter the body again.",
        values: [
          ["sum", "0"],
          ["i", "1"],
        ],
        output: "",
      },
      {
        line: 2,
        explanation:
          "Add i to sum: 0 + 1 = 1. After the body, ++i changes i to 2.",
        values: [
          ["sum", "1"],
          ["i", "1 → 2"],
        ],
        output: "",
      },
      {
        line: 1,
        explanation:
          "The condition 2 < 3 is true. There is one more iteration.",
        values: [
          ["sum", "1"],
          ["i", "2"],
        ],
        output: "",
      },
      {
        line: 2,
        explanation:
          "Add i to sum: 1 + 2 = 3. After the body, ++i changes i to 3.",
        values: [
          ["sum", "3"],
          ["i", "2 → 3"],
        ],
        output: "",
      },
      {
        line: 1,
        explanation:
          "The condition 3 < 3 is false. Leave the loop. i goes out of scope at the end of the for statement.",
        values: [
          ["sum", "3"],
          ["i", "out of scope"],
        ],
        output: "",
      },
      {
        line: 4,
        explanation:
          "Print sum. This curated trace predicts 3 followed by a newline. Compile the example separately to verify its actual execution.",
        values: [
          ["sum", "3"],
          ["i", "out of scope"],
        ],
        output: "3\n",
      },
    ],
  },
  array: {
    title: "An array has a boundary",
    code: [
      "int scores[3] = {7, 9, 4};",
      "int first = scores[0];",
      "scores[1] = 8;",
      "/* scores[3] is outside the array. */",
    ],
    frames: [
      {
        line: 0,
        explanation:
          "scores is an array object containing three int elements. Its valid indices are 0, 1, and 2. An array is not a pointer object.",
        values: [
          ["length", "3"],
          ["valid indices", "0 … 2"],
          ["scores", "{7, 9, 4}"],
        ],
      },
      {
        line: 1,
        explanation:
          "scores[0] reads the first element, 7. Index 0 is within the boundary.",
        values: [
          ["length", "3"],
          ["first", "7"],
          ["selected index", "0"],
        ],
      },
      {
        line: 2,
        explanation:
          "scores[1] = 8 changes the middle element. The array still has three elements.",
        values: [
          ["length", "3"],
          ["scores", "{7, 8, 4}"],
          ["selected index", "1"],
        ],
      },
      {
        line: 3,
        explanation:
          "Index 3 is outside this array. Reading or writing scores[3] has undefined behavior. No output or value can be predicted for that invalid access.",
        values: [
          ["length", "3"],
          ["invalid index", "3"],
          ["allowed last index", "2"],
        ],
      },
    ],
  },
  pointer: {
    title: "An address is not the object itself",
    code: [
      "/* NULL comes from <stddef.h>. */",
      "int *p = NULL;",
      "int *q = NULL;",
      "{",
      "    int number = 7;",
      "    p = &number;",
      "    q = p;",
      "    *q = 9;",
      "}",
      "/* Do not use p or q now. */",
    ],
    frames: [
      {
        line: 4,
        explanation:
          "number is an int object storing 7, inside a nested block. p and q are separate pointer objects initialized to NULL outside the block. The label “address A” is symbolic; no real numeric address is assumed.",
        values: [
          ["number", "7"],
          ["number address", "A"],
          ["p and q", "NULL"],
        ],
      },
      {
        line: 5,
        explanation:
          "p stores address A, the address of number. & obtains an address; *p would access the pointed-to object. p and number are separate objects.",
        values: [
          ["number", "7"],
          ["p stores", "address A"],
          ["*p", "7"],
        ],
      },
      {
        line: 6,
        explanation:
          "q copies the pointer value stored in p. p and q are distinct pointer objects that alias the same number object.",
        values: [
          ["number", "7"],
          ["p stores", "address A"],
          ["q stores", "address A"],
        ],
      },
      {
        line: 7,
        explanation:
          "*q = 9 changes number. Since p points to the same live object, *p now also reads 9. Neither pointer value changed.",
        values: [
          ["number", "9"],
          ["*p", "9"],
          ["*q", "9"],
        ],
      },
      {
        line: 8,
        explanation:
          "At the closing brace, number’s lifetime ends. The pointer values become indeterminate; do not read or dereference them. A copied address does not extend an object’s lifetime. Assign a valid pointer value before any later use.",
        values: [
          ["number", "lifetime ended"],
          ["p and q values", "indeterminate"],
        ],
      },
    ],
  },
  function: {
    title: "A call creates local state",
    code: [
      "int add_one(int value) {",
      "    value = value + 1;",
      "    return value;",
      "}",
      "int count = 4;",
      "int result = add_one(count);",
    ],
    frames: [
      {
        line: 4,
        explanation:
          "The caller has a count object storing 4. The function has not been called yet.",
        values: [
          ["caller count", "4"],
          ["result", "not initialized yet"],
        ],
      },
      {
        line: 5,
        explanation:
          "Calling add_one(count) copies count’s value into the parameter named value. The parameter is a separate local object, not an alias for count.",
        values: [
          ["caller count", "4"],
          ["parameter value", "4"],
          ["call state", "entered"],
        ],
      },
      {
        line: 1,
        explanation:
          "The function changes its local parameter from 4 to 5. The caller’s count remains 4 because C passes this int by value.",
        values: [
          ["caller count", "4"],
          ["parameter value", "5"],
        ],
      },
      {
        line: 2,
        explanation:
          "return provides the value 5 to the caller. The parameter’s lifetime ends when this call returns.",
        values: [
          ["caller count", "4"],
          ["returned value", "5"],
          ["parameter", "lifetime ending"],
        ],
      },
      {
        line: 5,
        explanation:
          "The caller initializes result with the returned value, 5. count is still 4. Every later call gets its own parameter object.",
        values: [
          ["caller count", "4"],
          ["caller result", "5"],
          ["parameter", "lifetime ended"],
        ],
      },
    ],
  },
};

export function TeachingDiagram({ kind }: { kind: DiagramKind }) {
  const [step, setStep] = useState(0);
  const [prediction, setPrediction] = useState("");
  const [showPrediction, setShowPrediction] = useState(false);
  useEffect(() => {
    setStep(0);
    setPrediction("");
    setShowPrediction(false);
  }, [kind]);
  const lesson = lessons[kind];
  const frame = lesson.frames[Math.min(step, lesson.frames.length - 1)];
  const activeStep = Math.min(step, lesson.frames.length - 1);
  return (
    <section className="teaching-diagram" aria-labelledby={`diagram-${kind}`}>
      <div className="section-top">
        <div>
          <span className="section-label">CURATED TEACHING SIMULATION</span>
          <h3 id={`diagram-${kind}`}>{lesson.title}</h3>
        </div>
        <span className="muted">
          {activeStep + 1} / {lesson.frames.length}
        </span>
      </div>
      <p className="muted diagram-disclaimer">
        A hand-authored explanation of this example, not a live trace of your
        code. Symbolic addresses and call boxes are models; they do not specify
        ISO C’s storage implementation.
      </p>
      {kind === "loop" ? (
        <div className="trace-prediction">
          <label htmlFor="trace-prediction">
            Before stepping, what will sum print?
          </label>
          <div className="row">
            <input
              id="trace-prediction"
              value={prediction}
              onChange={(event) => {
                setPrediction(event.target.value);
                setShowPrediction(false);
              }}
              placeholder="Your predicted output"
              maxLength={40}
            />
            <button
              className="button secondary small"
              onClick={() => setShowPrediction(true)}
              disabled={!prediction.trim()}
            >
              Compare prediction
            </button>
          </div>
          {showPrediction ? (
            <p
              role="status"
              className={prediction.trim() === "3" ? "status-text" : "muted"}
            >
              {prediction.trim() === "3"
                ? "Your prediction matches this curated trace: 0 + 1 + 2 = 3."
                : "This trace ends with 3. Follow how sum changes at each iteration. Verify actual execution using Run."}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="diagram-grid">
        <pre
          className="diagram-source"
          aria-label="Source with current line highlighted"
        >
          <code>
            {lesson.code.map((line, index) => (
              <span
                key={index}
                className={frame.line === index ? "current-line" : ""}
              >
                <span aria-hidden="true" className="diagram-line-number">
                  {index + 1}
                </span>
                <span>{line}</span>
                {frame.line === index ? (
                  <span className="sr-only"> Current step</span>
                ) : null}
              </span>
            ))}
          </code>
        </pre>
        <div className="diagram-state">
          {kind === "array" ? (
            <div className="array-model" aria-label="Array diagram">
              <div className="array-label">scores · 3 int elements</div>
              <div className="array-cells">
                {[7, activeStep >= 2 ? 8 : 9, 4].map((value, index) => (
                  <div
                    key={index}
                    className={`array-cell ${(activeStep === 1 && index === 0) || (activeStep === 2 && index === 1) ? "selected" : ""}`}
                  >
                    <small>index {index}</small>
                    <strong>{value}</strong>
                  </div>
                ))}
                <div
                  className={`array-boundary ${activeStep === 3 ? "selected" : ""}`}
                >
                  <small>index 3</small>
                  <strong>×</strong>
                  <span>outside</span>
                </div>
              </div>
              <p className="muted">
                The dashed boundary cannot be read or written.
              </p>
            </div>
          ) : null}
          {kind === "pointer" ? (
            <div
              className={`pointer-model ${activeStep === 4 ? "invalid-lifetime" : ""}`}
              aria-label="Pointer diagram"
            >
              {activeStep >= 1 ? (
                <div className="pointer-objects">
                  <div className="memory-object">
                    <small>pointer object p</small>
                    <code>
                      {activeStep === 4 ? "indeterminate" : "address A"}
                    </code>
                  </div>
                  {activeStep >= 2 ? (
                    <div className="memory-object">
                      <small>pointer object q</small>
                      <code>
                        {activeStep === 4 ? "indeterminate" : "address A"}
                      </code>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {activeStep >= 1 ? (
                <div className="pointer-arrow">
                  <ArrowRight size={25} aria-hidden="true" />
                  <span>
                    {activeStep === 4 ? "access invalid" : "points to"}
                  </span>
                </div>
              ) : null}
              <div className="memory-object pointed-object">
                <small>int object number · A</small>
                <strong>
                  {activeStep === 4
                    ? "Lifetime ended"
                    : activeStep >= 3
                      ? 9
                      : 7}
                </strong>
              </div>
            </div>
          ) : null}
          {kind === "function" ? (
            <div className="function-model" aria-label="Function-call model">
              <div className="call-box">
                <small>Caller</small>
                <code>count = 4</code>
                <code>
                  result = {activeStep === 4 ? "5" : "not initialized"}
                </code>
              </div>
              {activeStep >= 1 && activeStep < 4 ? (
                <>
                  <span className="call-direction">
                    {activeStep >= 3 ? "← return 5" : "copy 4 →"}
                  </span>
                  <div className="call-box parameter-box">
                    <small>add_one call</small>
                    <code>value = {activeStep >= 2 ? 5 : 4}</code>
                    <span>
                      {activeStep === 3
                        ? "local lifetime ending"
                        : "separate parameter object"}
                    </span>
                  </div>
                </>
              ) : activeStep === 4 ? (
                <p className="muted">
                  The call has returned. Its parameter object no longer exists.
                </p>
              ) : null}
            </div>
          ) : null}
          <dl className="trace-values">
            {frame.values.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <code>{value}</code>
                </dd>
              </div>
            ))}
          </dl>
          {kind === "loop" ? (
            <div className="trace-output">
              <small>Simulated output</small>
              <pre>
                <code>{frame.output || "(nothing yet)"}</code>
              </pre>
            </div>
          ) : null}
        </div>
      </div>
      <p className="diagram-explanation" aria-live="polite" aria-atomic="true">
        {frame.explanation}
      </p>
      <div className="diagram-controls">
        <button
          className="button secondary small"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          disabled={activeStep === 0}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Previous
        </button>
        <button
          className="button small"
          onClick={() =>
            setStep((current) =>
              Math.min(lesson.frames.length - 1, current + 1),
            )
          }
          disabled={activeStep === lesson.frames.length - 1}
        >
          Next step
          <ArrowRight size={15} aria-hidden="true" />
        </button>
        <button
          className="button secondary small"
          onClick={() => {
            setStep(0);
            setShowPrediction(false);
          }}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Reset
        </button>
      </div>
    </section>
  );
}

export default TeachingDiagram;
