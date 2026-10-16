import {
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type PointerEvent,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Play,
  Check,
  Lightbulb,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  History,
  Bookmark,
  Code2,
  ChevronRight,
  NotebookPen,
  Eye,
  Save,
  Terminal,
  BookOpen,
  FileCode2,
  Cog,
  AppWindow,
} from "lucide-react";
import type {
  CourseMap,
  LearnerState,
  LessonResponse,
  Draft,
} from "../../shared/app";
import type {
  PublicExercise,
  PublicLesson,
  SourceFiles,
} from "../../shared/content";
import type { RunnerOutcome, JobState } from "../../shared/runner";
import { api, getLocalOwner, readLocalHistory } from "../lib/api";
import { useDraft } from "../lib/autosave";
import { Results } from "./Results";
import { Dialog } from "./Dialog";
import type { EditorHandle } from "./Editor";
const Editor = lazy(() => import("./Editor"));
const Diagram = lazy(() => import("./TeachingDiagram"));
interface Props {
  course: CourseMap;
  state: LearnerState;
  onRefresh: () => void;
}
export default function LessonPage({ course, state, onRefresh }: Props) {
  const { id } = useParams(),
    [search, setSearch] = useSearchParams();
  const lesson = useQuery({
    queryKey: ["lesson", id, getLocalOwner()],
    queryFn: () => api<LessonResponse>(`/api/lessons/${id}`),
  });
  if (lesson.isLoading)
    return (
      <p className="loading" role="status">
        Opening lesson…
      </p>
    );
  if (!lesson.data)
    return (
      <div className="page">
        <h1>Lesson unavailable</h1>
        <p>{lesson.error?.message}</p>
        <button onClick={() => void lesson.refetch()}>Retry</button>
      </div>
    );
  const { lesson: l, exercises } = lesson.data;
  const all = [...exercises];
  const requested = search.get("exercise");
  const projectQuery = search.get("project");
  return (
    <LessonLoader
      key={`${id}:${requested ?? ""}`}
      lesson={l}
      exercises={all}
      requested={requested}
      project={projectQuery}
      course={course}
      state={state}
      onRefresh={onRefresh}
      setExercise={(exerciseId) =>
        setSearch({ ...Object.fromEntries(search), exercise: exerciseId })
      }
    />
  );
}
function LessonLoader(props: {
  lesson: PublicLesson;
  exercises: PublicExercise[];
  requested: string | null;
  project: string | null;
  course: CourseMap;
  state: LearnerState;
  onRefresh: () => void;
  setExercise: (id: string) => void;
}) {
  const project = useQuery({
    queryKey: ["project-workspace", props.project, getLocalOwner()],
    queryFn: () =>
      api<{ exercises: PublicExercise[] }>(`/api/projects/${props.project}`),
    enabled: !!props.project,
  });
  const requested = props.requested;
  const extra = project.data?.exercises.find((e) => e.id === requested);
  const defaultExercise =
    props.state.resume?.lessonId === props.lesson.id
      ? props.exercises.find((e) => e.id === props.state.resume?.exerciseId)
      : undefined;
  const active =
    props.exercises.find((e) => e.id === requested) ??
    extra ??
    defaultExercise ??
    props.exercises[0];
  if (props.project && project.isLoading)
    return (
      <p className="loading" role="status">
        Opening project files…
      </p>
    );
  return <Workspace key={active.id} {...props} exercise={active} />;
}
function Workspace({
  lesson,
  exercise,
  exercises,
  course,
  state,
  onRefresh,
  setExercise,
  project,
}: {
  lesson: PublicLesson;
  exercise: PublicExercise;
  exercises: PublicExercise[];
  course: CourseMap;
  state: LearnerState;
  onRefresh: () => void;
  setExercise: (id: string) => void;
  project: string | null;
}) {
  const save = useDraft(exercise.id, exercise.version, exercise.starter);
  const [predictionFeedback, setPredictionFeedback] = useState<{
      correct: boolean;
      answer: string;
      explanation: string;
    } | null>(null),
    [error, setError] = useState(""),
    [jobId, setJobId] = useState<string | null>(null),
    [immediate, setImmediate] = useState<{
      id: string;
      state: JobState;
      result: RunnerOutcome | null;
    } | null>(null),
    [modal, setModal] = useState<"reset" | "history" | "solution" | null>(null),
    [solution, setSolution] = useState<{
      files: SourceFiles;
      explanation: string;
    } | null>(null),
    [newFile, setNewFile] = useState(""),
    [conflictOpen, setConflictOpen] = useState(true);
  const editor = useRef<EditorHandle>(null),
    learnPane = useRef<HTMLDivElement>(null),
    restored = useRef(false),
    split = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; start: number } | null>(null);
  const runner = useQuery({
    queryKey: ["runner", course.course.id, getLocalOwner()],
    queryFn: () =>
      api<{ available: boolean; detail: string }>(
        `/api/runner?course=${course.course.id}`,
      ),
    refetchInterval: 15000,
  });
  const hints = useQuery({
    queryKey: ["help", exercise.id, getLocalOwner()],
    queryFn: () =>
      api<{ level: number; text: string }[]>(
        `/api/exercises/${exercise.id}/help`,
      ),
  });
  const localVersions = useQuery({
    queryKey: ["local-history", exercise.id, modal, getLocalOwner()],
    queryFn: () => readLocalHistory(exercise.id),
    enabled: modal === "history",
  });
  const versions = useQuery({
    queryKey: ["history", exercise.id, modal, getLocalOwner()],
    queryFn: () =>
      api<{ id: string; draft: Draft; reason: string; createdAt: string }[]>(
        `/api/drafts/${exercise.id}/history`,
      ),
    enabled: modal === "history",
  });
  const job = useQuery({
    queryKey: ["job", jobId, getLocalOwner()],
    queryFn: () =>
      api<{ id: string; state: JobState; result: RunnerOutcome | null }>(
        `/api/jobs/${jobId}`,
      ),
    enabled: !!jobId,
    refetchInterval: (q) =>
      q.state.data &&
      ["queued", "compiling", "running"].includes(q.state.data.state)
        ? 500
        : false,
  });
  const shown = job.data ?? immediate,
    data = save.data,
    step = data?.step ?? 0,
    conceptual = ["prediction", "diagnosis", "reflection"].includes(
      exercise.type,
    );
  const lessonIndex = course.lessons.findIndex((l) => l.id === lesson.id),
    module = course.modules.find((m) => m.id === lesson.moduleId)!,
    helpLevel = Math.max(0, ...(hints.data ?? []).map((h) => h.level));
  const prediction = data?.prediction ?? "",
    sanitize = data?.sanitize ?? false,
    mobileTab = data?.mobileTab ?? "learn";
  useEffect(() => {
    if (save.conflict) setConflictOpen(true);
  }, [save.conflict?.id]);
  useEffect(() => {
    if (data && !restored.current && learnPane.current) {
      learnPane.current.scrollTop = data.scrollAnchor;
      restored.current = true;
    }
  }, [data]);
  useEffect(() => {
    if (shown && !["queued", "compiling", "running"].includes(shown.state))
      onRefresh();
  }, [shown?.id, shown?.state]);
  async function run(mode: "run" | "check") {
    if (!data) return;
    setError("");
    save.update({ mobileTab: "results" });
    await save.flush();
    try {
      const j = await api<{
        id: string;
        state: JobState;
        result: RunnerOutcome | null;
      }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          exerciseId: exercise.id,
          mode,
          files: data.files,
          stdin: data.stdin,
          sanitize,
          mutationId: crypto.randomUUID(),
          ...(conceptual
            ? {
                answer: data.files["answer.txt"] ?? data.files[data.activeFile],
              }
            : {}),
        }),
      });
      setImmediate(j);
      setJobId(j.result ? null : j.id);
      if (j.result) onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The submission failed.");
    }
  }
  async function showHint() {
    try {
      await api(`/api/exercises/${exercise.id}/hint`, {
        method: "POST",
        body: JSON.stringify({ level: Math.min(3, helpLevel + 1) }),
      });
      void hints.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hint unavailable.");
    }
  }
  async function reveal() {
    try {
      setSolution(
        await api(`/api/exercises/${exercise.id}/solution`, {
          method: "POST",
          body: "{}",
        }),
      );
      void hints.refetch();
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Solution unavailable.");
    }
  }
  async function reset() {
    try {
      await save.archiveLocal("before reset");
      await save.flush();
      try {
        await api(`/api/drafts/${exercise.id}/archive`, {
          method: "POST",
          body: JSON.stringify({ data, reason: "before reset" }),
        });
      } catch {}
      save.update({
        files: exercise.starter,
        activeFile: Object.keys(exercise.starter)[0],
        cursor: { anchor: 0, head: 0 },
      });
      setModal(null);
      setSolution(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Cannot preserve the pre-reset draft. Reset cancelled.",
      );
      setModal(null);
    }
  }
  async function checkPrediction() {
    try {
      setPredictionFeedback(
        await api(`/api/lessons/${lesson.id}/predict`, {
          method: "POST",
          body: JSON.stringify({ answer: prediction }),
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Prediction could not be checked.",
      );
    }
  }
  function movePane(e: PointerEvent) {
    if (!drag.current || !split.current) return;
    save.update({
      paneSize: Math.max(
        25,
        Math.min(
          75,
          drag.current.start +
            ((e.clientX - drag.current.x) / split.current.clientWidth) * 100,
        ),
      ),
    });
  }
  if (!data)
    return (
      <p className="loading" role="status">
        Restoring your draft…{save.error}
      </p>
    );
  return (
    <div className="lesson-page">
      <div className="lesson-heading">
        <div>
          <p className="chapter-label">
            <span className="chapter-symbol">
              {String(course.modules.indexOf(module) + 1).padStart(2, "0")}
            </span>
            {project ? "Project workshop" : module.title}
            {lesson.checkpoint ? " · Chapter checkpoint" : ""}
          </p>
          <h1>{lesson.title}</h1>
          <p>{lesson.objective}</p>
        </div>
        <span className="lesson-duration">
          About {lesson.minutes} min
          <br />
          <small>Your pace, no timer.</small>
        </span>
      </div>
      <div className="lesson-steps" aria-label="Lesson steps">
        {["Learn", "Predict", "Practice", "Recap"].map((s, i) => (
          <button
            key={s}
            aria-current={step === i ? "step" : undefined}
            className={step === i ? "active" : ""}
            onClick={() => save.update({ step: i })}
          >
            <span>{i + 1}</span>
            {s}
          </button>
        ))}
        <span className="step-note">Completion comes from checks.</span>
      </div>
      <div
        className="mobile-workspace-tabs"
        role="tablist"
        aria-label="Workspace view"
      >
        {[
          { id: "learn", label: "Learn", icon: BookOpen },
          { id: "code", label: "Code", icon: Code2 },
          { id: "results", label: "Results", icon: Terminal },
        ].map(({ id, label, icon: Icon }) => (
          <button
            role="tab"
            key={id}
            aria-selected={mobileTab === id}
            tabIndex={mobileTab === id ? 0 : -1}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault();
                const ids = ["learn", "code", "results"] as const;
                const index =
                  (ids.indexOf(id as "learn" | "code" | "results") +
                    (event.key === "ArrowRight" ? 1 : 2)) %
                  3;
                save.update({ mobileTab: ids[index] });
                const tabs =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                    '[role="tab"]',
                  );
                tabs?.[index].focus();
              }
            }}
            onClick={() =>
              save.update({
                mobileTab:
                  id === "learn" ? "learn" : id === "code" ? "code" : "results",
              })
            }
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </div>
      <div
        className={`workspace mobile-${mobileTab}`}
        ref={split}
        style={{ "--lesson-width": `${data.paneSize}%` } as React.CSSProperties}
      >
        <div
          className="learn-pane"
          ref={learnPane}
          onScroll={(e) =>
            save.update({ scrollAnchor: e.currentTarget.scrollTop })
          }
        >
          {step === 0 ? (
            <>
              <div className="objective-callout">
                <div className="concept-icon">
                  <BookOpen size={23} />
                </div>
                <div>
                  <h2>One idea to take with you</h2>
                  <p>{lesson.objective}</p>
                </div>
              </div>
              {lesson.id === "source-to-program" ||
              lesson.id === "cpp-source-and-output" ? (
                <div
                  className="compile-pipeline"
                  aria-label="Compilation and execution are separate steps"
                >
                  <div>
                    <FileCode2 size={24} />
                    <strong>
                      {course.course.id === "cpp20" ? "main.cpp" : "main.c"}
                    </strong>
                    <small>
                      {course.course.id === "cpp20" ? "C++" : "C"} source text
                    </small>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <Cog size={24} />
                    <strong>Compile</strong>
                    <small>Check and translate</small>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <AppWindow size={24} />
                    <strong>Execute</strong>
                    <small>Run the program</small>
                  </div>
                </div>
              ) : null}
              <div className="lesson-prose">
                {lesson.explanation.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              {lesson.visualization ? (
                <Suspense fallback={<p>Loading the teaching diagram…</p>}>
                  <Diagram kind={lesson.visualization} />
                </Suspense>
              ) : null}
              <section className="worked-example">
                <div className="section-bar">
                  <h3>Worked example</h3>
                  <span className="muted">
                    {lesson.brokenExample
                      ? "Intentionally broken"
                      : course.course.standard}
                  </span>
                </div>
                {Object.entries(lesson.workedExample).map(([name, code]) => (
                  <div key={name}>
                    <small className="file-caption">{name}</small>
                    <pre>
                      <code>{code}</code>
                    </pre>
                  </div>
                ))}
                {lesson.workedExampleInput ? (
                  <p className="muted">
                    Example batch input:{" "}
                    <code>
                      {JSON.stringify(lesson.workedExampleInput.stdin)}
                    </code>
                  </p>
                ) : null}
              </section>
              <details className="walkthrough" open>
                <summary>Read it line by line</summary>
                {lesson.walkthrough.map((line, i) => (
                  <p key={i}>
                    <span>{i + 1}</span>
                    {line}
                  </p>
                ))}
              </details>
              <div className="learn-practice-preview">
                <Code2 size={21} />
                <div>
                  <strong>Your turn is next.</strong>
                  <p>{exercise.objective}</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => save.update({ step: 2 })}
                >
                  Try practice
                  <ChevronRight size={16} />
                </button>
              </div>
              <button
                className="button primary"
                onClick={() => save.update({ step: 1 })}
              >
                Predict before you run
                <ArrowRight size={17} />
              </button>
            </>
          ) : null}
          {step === 1 ? (
            <section className="prediction-section">
              <div className="concept-icon purple">
                <Eye size={24} />
              </div>
              <h2>Pause. Trace. Predict.</h2>
              <p>{lesson.prediction.question}</p>
              <label>
                Your prediction
                <textarea
                  value={prediction}
                  maxLength={2000}
                  onChange={(e) => save.update({ prediction: e.target.value })}
                  rows={4}
                  placeholder="Write the output or the key idea…"
                />
              </label>
              <button
                className="button primary"
                onClick={() => void checkPrediction()}
                disabled={!prediction.trim()}
              >
                Compare prediction
              </button>
              {predictionFeedback ? (
                <div className="notice">
                  <strong>
                    {predictionFeedback.correct
                      ? "Your prediction matches."
                      : "Compare the reasoning."}
                  </strong>
                  <pre>{predictionFeedback.answer}</pre>
                  <p>{predictionFeedback.explanation}</p>
                  <p>
                    This prediction does not mark the coding exercise passed.
                  </p>
                </div>
              ) : null}
              <button
                className="button secondary"
                onClick={() => save.update({ step: 2 })}
              >
                Apply the idea
                <ArrowRight size={17} />
              </button>
            </section>
          ) : null}
          {step === 2 ? (
            <>
              <div className="exercise-switcher">
                {exercises.map((e, i) => (
                  <button
                    key={e.id}
                    aria-pressed={e.id === exercise.id}
                    className={e.id === exercise.id ? "selected" : ""}
                    onClick={() => {
                      void save.flush();
                      setExercise(e.id);
                    }}
                  >
                    {i === 0 ? "Guided practice" : "Independent attempt"}
                    {state.progress.some(
                      (p) => p.exerciseId === e.id && p.completed,
                    ) ? (
                      <Check size={15} />
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="practice-prompt">
                <span className="exercise-symbol">
                  <Code2 size={22} />
                </span>
                <h2>{project ? "Project milestone" : exercise.objective}</h2>
                <p>{exercise.prompt}</p>
                <small>
                  Assessment:{" "}
                  {exercise.type === "function"
                    ? "Behavior across function test cases"
                    : conceptual
                      ? "Conceptual answer"
                      : exercise.type === "numeric"
                        ? "Numeric output within documented tolerance"
                        : "Program behavior and output"}{" "}
                  · v{exercise.version}
                </small>
              </div>
              <details className="contract">
                <summary>Inputs and public examples</summary>
                <p>{exercise.allowedInputs}</p>
                {exercise.examples.map((c, i) => (
                  <div key={i}>
                    <h4>{c.label}</h4>
                    <p>
                      Input: <code>{JSON.stringify(c.stdin)}</code>
                    </p>
                    <pre>{c.expected}</pre>
                    {c.harness ? (
                      <details>
                        <summary>Provided test driver</summary>
                        <pre>{c.harness}</pre>
                      </details>
                    ) : null}
                  </div>
                ))}
                <p>
                  {conceptual
                    ? "This check compares a short answer. Capitalization and extra whitespace are ignored. Use the wording requested in the question."
                    : "Check includes additional cases. Output normalization changes CRLF line endings and removes one final newline. Spaces and internal blank lines matter."}
                </p>
              </details>
              <div className="hint-section">
                {(hints.data ?? [])
                  .filter((h) => h.level <= 3)
                  .map((h) => (
                    <div key={h.level} className="notice hint">
                      <strong>Hint {h.level}</strong>
                      <p>{h.text}</p>
                    </div>
                  ))}
                <button
                  className="button secondary"
                  onClick={() => void showHint()}
                  disabled={helpLevel >= 3}
                >
                  <Lightbulb size={17} />
                  {helpLevel === 0
                    ? "A conceptual hint"
                    : helpLevel === 1
                      ? "A more specific strategy"
                      : "Near-solution guidance"}
                </button>
                <button
                  className="text-button"
                  onClick={() => setModal("solution")}
                >
                  Reveal explained solution
                </button>
                <small>
                  Help is recorded. A helped check can complete practice, and
                  schedules an independent revisit.
                </small>
              </div>
              {solution ? (
                <section className="notice solution">
                  <h3>Reference solution</h3>
                  {Object.entries(solution.files).map(([n, c]) => (
                    <div key={n}>
                      <strong>{n}</strong>
                      <pre>{c}</pre>
                    </div>
                  ))}
                  <p>{solution.explanation}</p>
                  <button onClick={() => setModal("reset")}>
                    Start a fresh attempt
                  </button>
                  <p>
                    Try the other exercise without help to demonstrate
                    independent proficiency.
                  </p>
                </section>
              ) : null}
              <button
                className="button secondary"
                onClick={() => save.update({ step: 3 })}
              >
                Read the recap
                <ArrowRight size={17} />
              </button>
            </>
          ) : null}
          {step === 3 ? (
            <section className="recap">
              <div className="concept-icon mint">
                <Check size={24} />
              </div>
              <h2>Keep this idea.</h2>
              <p>{lesson.recap}</p>
              <h3>Retrieve it later</h3>
              <p>{lesson.retrieval.question}</p>
              <p className="muted">
                Verified checks schedule reviews at 1, 3, 7, 14, and 30 days.
                Hints and failed checks bring the concept back sooner. Moving to
                another lesson does not award mastery.
              </p>
              <button
                className="button primary"
                onClick={() => save.update({ step: 2 })}
              >
                Return to practice
                <ArrowLeft size={17} />
              </button>
            </section>
          ) : null}
          <details className="lesson-notes">
            <summary>
              <NotebookPen size={16} />
              Your notes & bookmark
            </summary>
            <label>
              Notes
              <textarea
                aria-label="Notes"
                rows={4}
                value={data.notes}
                onChange={(e) => save.update({ notes: e.target.value })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={data.bookmark}
                onChange={(e) => save.update({ bookmark: e.target.checked })}
              />
              <Bookmark size={16} />
              Bookmark this exercise
            </label>
          </details>
        </div>
        <div
          className="pane-divider"
          role="separator"
          aria-label="Resize lesson pane"
          aria-orientation="vertical"
          aria-valuemin={25}
          aria-valuemax={75}
          aria-valuenow={Math.round(data.paneSize)}
          tabIndex={0}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, start: data.paneSize };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={movePane}
          onPointerUp={() => (drag.current = null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              save.update({
                paneSize: Math.max(
                  25,
                  Math.min(
                    75,
                    data.paneSize + (e.key === "ArrowLeft" ? -2 : 2),
                  ),
                ),
              });
            }
          }}
        />
        <div className="code-pane">
          <div className="editor-card">
            <div className="editor-top">
              <span>
                <Code2 size={17} />
                {conceptual ? "Your answer" : "Code workspace"}
              </span>
              <span
                className={`save-status ${save.conflict ? "warning-text" : ""}`}
                role="status"
              >
                <Save size={13} />
                {save.status}
              </span>
            </div>
            <div className="file-tabs" role="group" aria-label="Source files">
              {Object.keys(data.files).map((name) => (
                <button
                  aria-pressed={data.activeFile === name}
                  key={name}
                  onClick={() =>
                    save.update({
                      activeFile: name,
                      cursor: { anchor: 0, head: 0 },
                    })
                  }
                >
                  {name}
                </button>
              ))}
              <button
                aria-label="Draft history"
                title="Draft history"
                onClick={() => setModal("history")}
              >
                <History size={16} />
              </button>
              <button
                aria-label="Restore starter code"
                title="Restore starter code"
                onClick={() => setModal("reset")}
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <div className="editor-region">
              {conceptual ? (
                <label className="answer-input">
                  Short answer
                  <textarea
                    value={
                      data.files["answer.txt"] ?? data.files[data.activeFile]
                    }
                    onChange={(e) =>
                      save.update({
                        files: {
                          ...data.files,
                          [data.activeFile]: e.target.value,
                        },
                      })
                    }
                    rows={10}
                  />
                </label>
              ) : (
                <Suspense
                  fallback={
                    <div className="loading">
                      Loading the locally bundled editor…
                    </div>
                  }
                >
                  <Editor
                    ref={editor}
                    value={data.files[data.activeFile]}
                    cursor={data.cursor}
                    filename={data.activeFile}
                    onChange={(value, cursor) =>
                      save.update({
                        files: { ...data.files, [data.activeFile]: value },
                        cursor,
                      })
                    }
                    onRun={() => void run("run")}
                  />
                </Suspense>
              )}
            </div>
            <div className="editor-toolbar">
              <div>
                <span
                  className={`language-logo small ${course.course.id === "cpp20" ? "cpp-logo" : ""}`}
                >
                  {course.course.id === "cpp20" ? "C++" : "C"}
                </span>
                <span>
                  {course.course.standard} ·{" "}
                  {course.course.id === "cpp20" ? "G++" : "GCC"} 14
                </span>
              </div>
              <div>
                <button
                  className="button run-button"
                  onClick={() => void run("run")}
                  disabled={
                    conceptual ||
                    (!!shown &&
                      ["queued", "compiling", "running"].includes(shown.state))
                  }
                >
                  <Play size={16} />
                  Run
                </button>
                <button
                  className="button check-button"
                  onClick={() => void run("check")}
                  disabled={
                    !!shown &&
                    ["queued", "compiling", "running"].includes(shown.state)
                  }
                >
                  <Check size={17} />
                  Check
                </button>
              </div>
            </div>
            <p id="editor-help" className="editor-help">
              Ctrl/⌘ + Enter runs. Tab moves focus; Ctrl + ] indents. Input is
              batch-based.
            </p>
          </div>
          {project || Object.keys(exercise.starter).length > 1 ? (
            <details className="project-files">
              <summary>Manage project files</summary>
              <label>
                New filename
                <input
                  value={newFile}
                  onChange={(e) => setNewFile(e.target.value)}
                  placeholder={
                    course.course.id === "cpp20" ? "helper.cpp" : "helper.c"
                  }
                />
              </label>
              <button
                onClick={() => {
                  if (
                    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(c|h|cpp|hpp|txt)$/.test(
                      newFile,
                    ) ||
                    newFile.includes("..") ||
                    Object.keys(data.files).length >= 12 ||
                    Object.hasOwn(data.files, newFile)
                  ) {
                    setError(
                      "Use a unique simple .c, .h, .cpp, .hpp, or .txt filename. Limit: 12 files.",
                    );
                    return;
                  }
                  save.update({
                    files: { ...data.files, [newFile]: "" },
                    activeFile: newFile,
                  });
                  setNewFile("");
                }}
              >
                Add file
              </button>
            </details>
          ) : null}
          <details className="stdin-panel">
            <summary>
              Batch standard input <span>Optional for Run</span>
            </summary>
            <label>
              Text supplied to the program
              <textarea
                aria-label="Text supplied to the program"
                value={data.stdin}
                maxLength={8192}
                rows={3}
                onChange={(e) => save.update({ stdin: e.target.value })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={sanitize}
                onChange={(e) => save.update({ sanitize: e.target.checked })}
              />
              Diagnostics mode (AddressSanitizer + UndefinedBehaviorSanitizer)
            </label>
            <small>
              Passing tests or sanitizers does not prove correctness.
            </small>
          </details>
          <Results
            standard={course.course.standard}
            job={shown ?? null}
            runner={runner.data}
            error={error}
            onCancel={() => {
              if (shown)
                void api(`/api/jobs/${shown.id}/cancel`, { method: "POST" })
                  .then(() => job.refetch())
                  .catch((e) => setError(e.message));
            }}
            onLocation={(file, line, col) => {
              const sourceFile = file.startsWith("/src/")
                ? file.slice("/src/".length)
                : file;
              if (Object.hasOwn(data.files, sourceFile)) {
                save.update({ activeFile: sourceFile });
                setTimeout(() => editor.current?.focusLine(line, col), 50);
              }
            }}
          />
          {save.error ? (
            <div className="notice error">
              <p>{save.error}</p>
              <button onClick={() => void save.flush()}>Retry save</button>
              {save.draft?.contentVersion !== exercise.version ? (
                <button onClick={() => void save.retryCurrentVersion()}>
                  Keep code and retry current exercise version
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="lesson-footer">
        <div>
          {lessonIndex > 0 ? (
            <Link
              className="button secondary"
              to={`/lesson/${course.lessons[lessonIndex - 1].id}`}
              onClick={() => void save.flush()}
            >
              <ArrowLeft size={16} />
              Previous lesson
            </Link>
          ) : (
            <Link className="button secondary" to="/path">
              Learning path
            </Link>
          )}
        </div>
        <p className="muted">
          {state.progress.some(
            (p) => p.exerciseId === exercise.id && p.proficient,
          )
            ? "Verified independently"
            : state.progress.some(
                  (p) => p.exerciseId === exercise.id && p.completed,
                )
              ? "Completed with practice due"
              : "Your draft and progress are separate."}
        </p>
        {lessonIndex < course.lessons.length - 1 ? (
          <Link
            className="button primary"
            to={`/lesson/${course.lessons[lessonIndex + 1].id}`}
            onClick={() => void save.flush()}
          >
            Next lesson
            <ArrowRight size={17} />
          </Link>
        ) : (
          <Link className="button primary" to="/projects">
            Build the capstone
            <ArrowRight size={17} />
          </Link>
        )}
      </div>
      {save.conflict && !conflictOpen ? (
        <div className="notice warning">
          Two drafts are preserved. Account sync is paused.
          <button onClick={() => setConflictOpen(true)}>
            Resolve draft conflict
          </button>
        </div>
      ) : null}
      {save.conflict && conflictOpen ? (
        <Dialog
          title="Two drafts need your choice"
          onClose={() => setConflictOpen(false)}
        >
          <p>
            Both versions are preserved. Source files are never silently merged.
          </p>
          <div className="conflict-compare">
            <section>
              <h3>This device</h3>
              <pre>
                {Object.values(save.conflict.local.data.files).join("\n")}
              </pre>
              <button
                className="button primary"
                onClick={() => void save.resolve("local")}
              >
                Use this device’s version
              </button>
            </section>
            <section>
              <h3>Account · revision {save.conflict.remote.revision}</h3>
              <pre>
                {Object.values(save.conflict.remote.data.files).join("\n")}
              </pre>
              <button
                className="button secondary"
                onClick={() => void save.resolve("remote")}
              >
                Use account version
              </button>
            </section>
          </div>
        </Dialog>
      ) : null}
      {modal === "reset" ? (
        <Dialog title="Restore the starter?" onClose={() => setModal(null)}>
          <p>
            Your current saved version remains in draft history. This replaces
            the current files with the exercise starter.
          </p>
          <button className="button primary" onClick={() => void reset()}>
            Restore starter
          </button>
        </Dialog>
      ) : null}
      {modal === "solution" ? (
        <Dialog
          title="Reveal the explained solution?"
          onClose={() => setModal(null)}
        >
          <p>
            This records help used. You can still complete the lesson, and the
            concept will return for independent practice.
          </p>
          <button className="button primary" onClick={() => void reveal()}>
            Reveal solution
          </button>
        </Dialog>
      ) : null}
      {modal === "history" ? (
        <Dialog title="Recover a draft" onClose={() => setModal(null)}>
          <p>
            The account retains the last 20 ordinary versions plus the latest
            successful submission per exercise. Device snapshots include
            pre-reset drafts, even offline. Last successful checks are labeled.
          </p>
          {(localVersions.data ?? []).map((v) => (
            <details key={v.id}>
              <summary>
                On this device · {v.reason} ·{" "}
                {new Date(v.createdAt).toLocaleString()}
              </summary>
              <pre>{Object.values(v.draft.data.files).join("\n")}</pre>
              <button
                onClick={() => {
                  save.update(v.draft.data);
                  setModal(null);
                }}
              >
                Recover device snapshot
              </button>
            </details>
          ))}
          {versions.isLoading ? (
            <p>Loading versions…</p>
          ) : versions.error ? (
            <p className="notice error">{versions.error.message}</p>
          ) : !versions.data?.length ? (
            <p>No earlier account versions yet.</p>
          ) : (
            versions.data.map((v) => (
              <details key={v.id}>
                <summary>
                  {v.reason} · {new Date(v.createdAt).toLocaleString()}
                </summary>
                <pre>{Object.values(v.draft.data.files).join("\n")}</pre>
                <button
                  onClick={() => {
                    save.update(v.draft.data);
                    setModal(null);
                  }}
                >
                  Recover this version
                </button>
              </details>
            ))
          )}
        </Dialog>
      ) : null}
    </div>
  );
}
