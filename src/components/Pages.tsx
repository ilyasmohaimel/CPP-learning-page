import { useDeferredValue, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlignJustify,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Braces,
  Bug,
  Calculator,
  Check,
  CheckCircle2,
  Clock3,
  Code2,
  Download,
  FileCode2,
  Files,
  FolderOpen,
  GitBranch,
  History,
  Keyboard,
  Layers3,
  Lightbulb,
  ListChecks,
  MemoryStick,
  MoveUpRight,
  Repeat2,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  Upload,
} from "lucide-react";
import type {
  CourseMap,
  LearnerState,
  Preferences,
  ReviewItem,
} from "../../shared/app";
import type {
  Project,
  PublicExercise,
  Reference,
  SourceFiles,
} from "../../shared/content";
import {
  api,
  appBasePath,
  getLocalOwner,
  purgeLocal,
  setLocalOwner,
} from "../lib/api";
import "./pages.css";

export interface PageProps {
  course: CourseMap;
  state: LearnerState;
  onRefresh: () => void;
}
type PublicProject = Omit<Project, "reference" | "explanation"> & {
  exercises: PublicExercise[];
};
interface ReviewResult {
  correct: boolean;
  explanation: string;
  dueAt: string;
}
interface ImportEffects {
  counts: Record<string, number>;
  warnings: string[];
}
interface Session {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}
interface Diagnostic {
  questions: { id: string; question: string; options: string[] }[];
}
interface DiagnosticResult {
  recommendations: string[];
  explanation: string;
}

const lessonHref = (
  lessonId: string,
  exerciseId?: string,
  projectId?: string,
) =>
  `/lesson/${encodeURIComponent(lessonId)}${exerciseId ? `?exercise=${encodeURIComponent(exerciseId)}${projectId ? `&project=${encodeURIComponent(projectId)}` : ""}` : ""}`;
const friendlyError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request did not finish. Try again.";
const prettyId = (id: string) => id.replaceAll("-", " ");
const chapterIcons = [
  Terminal,
  Calculator,
  GitBranch,
  Repeat2,
  Braces,
  AlignJustify,
  MoveUpRight,
  Keyboard,
  Layers3,
  MemoryStick,
  Files,
  Bug,
];
function ChapterMark({
  index,
  showNumber = false,
}: {
  index: number;
  showNumber?: boolean;
}) {
  const Icon = chapterIcons[index % chapterIcons.length];
  return (
    <span className={`chapter-marker marker-${index % 4}`} aria-hidden="true">
      <Icon size={22} strokeWidth={1.6} />
      {showNumber ? <small>{String(index + 1).padStart(2, "0")}</small> : null}
    </span>
  );
}
function formattedDate(value: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}
function completedLessons(course: CourseMap, state: LearnerState) {
  const completed = new Set(
    state.progress.filter((p) => p.completed).map((p) => p.exerciseId),
  );
  return new Set(
    course.lessons
      .filter(
        (l) =>
          l.exerciseIds.length > 0 &&
          l.exerciseIds.every((id) => completed.has(id)),
      )
      .map((l) => l.id),
  );
}
function PageHeading({
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof BookOpen;
}) {
  return (
    <header className="page-heading academy-heading">
      <div className="heading-title-row">
        <h1>{title}</h1>
        <span className="heading-symbol" aria-hidden="true">
          <Icon size={25} strokeWidth={1.5} />
        </span>
      </div>
      <p className="muted">{description}</p>
    </header>
  );
}
function RequestError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="notice error" role="alert">
      <p>{friendlyError(error)}</p>
      {retry ? (
        <button className="button secondary small" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function HomePage({ course, state }: PageProps) {
  const done = completedLessons(course, state);
  const next = course.lessons.find((l) => !done.has(l.id)) ?? course.lessons[0];
  const resumeLesson =
    course.lessons.find((l) => l.id === state.resume?.lessonId) ?? next;
  const exerciseIndex =
    resumeLesson?.exerciseIds.indexOf(state.resume?.exerciseId ?? "") ?? -1;
  const completedExercises = state.progress.filter((p) => p.completed).length;
  const proficient = state.progress.filter((p) => p.proficient).length;
  const due = state.reviews.filter(
    (r) => new Date(r.dueAt).getTime() <= Date.now(),
  );
  const nextIndex = course.lessons.findIndex((l) => l.id === next?.id);
  const suggested = course.lessons
    .slice(Math.max(nextIndex, 0))
    .filter((l) => !done.has(l.id));
  const sessionLessons: typeof suggested = [];
  let effort = 0;
  for (const lesson of suggested) {
    if (
      sessionLessons.length &&
      effort + lesson.minutes > state.preferences.sessionMinutes
    )
      break;
    sessionLessons.push(lesson);
    effort += lesson.minutes;
    if (
      effort >= state.preferences.sessionMinutes ||
      sessionLessons.length >= 3
    )
      break;
  }
  return (
    <div className="page academy-page">
      <PageHeading
        eyebrow="YOUR WORKSHOP"
        title="Make something click."
        description="A little understanding. A little practice. Pick up exactly where you left off."
        icon={Code2}
      />
      <div className="home-primary">
        <section className="continue-card" aria-labelledby="continue-heading">
          <div className="continue-topline">
            <span className="section-label">
              {state.resume ? "Continue learning" : "Your first lesson"}
            </span>
            <span className="course-standard">C17</span>
          </div>
          <div className="continue-content">
            <div className="continue-art" aria-hidden="true">
              {String(
                Math.max(
                  1,
                  course.modules.findIndex(
                    (m) => m.id === resumeLesson?.moduleId,
                  ) + 1,
                ),
              ).padStart(2, "0")}
            </div>
            <div>
              <p className="continue-chapter">
                Chapter{" "}
                {Math.max(
                  1,
                  course.modules.findIndex(
                    (m) => m.id === resumeLesson?.moduleId,
                  ) + 1,
                )}{" "}
                ·{" "}
                {
                  course.modules.find((m) => m.id === resumeLesson?.moduleId)
                    ?.title
                }
              </p>
              <h2 id="continue-heading">
                {resumeLesson?.title ?? course.course.title}
              </h2>
              <p>{resumeLesson?.objective}</p>
              {state.resume ? (
                <p className="resume-position">
                  <FileCode2 size={15} aria-hidden="true" />
                  Exercise{" "}
                  {exerciseIndex >= 0
                    ? exerciseIndex + 1
                    : state.resume.exerciseId}{" "}
                  · saved step {state.resume.step + 1}
                </p>
              ) : (
                <p className="resume-position">
                  <Clock3 size={15} aria-hidden="true" />
                  About {resumeLesson?.minutes ?? 8} minutes · no prior C
                  knowledge needed
                </p>
              )}
              {resumeLesson ? (
                <Link
                  className="button"
                  to={lessonHref(resumeLesson.id, state.resume?.exerciseId)}
                >
                  {state.resume ? "Resume lesson" : "Begin the course"}
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </div>
          <div className="continue-footer">
            <span>
              Your draft and current step are saved to your account when sync
              succeeds.
            </span>
            <Link to="/settings">
              Data & recovery
              <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </section>
        <aside
          className="panel session-panel"
          aria-labelledby="session-heading"
        >
          <h2 id="session-heading">
            Your {state.preferences.sessionMinutes}-minute session
          </h2>
          <p className="muted">
            A suggestion, never a countdown. Stop whenever you need to.
          </p>
          <ol className="session-list">
            {sessionLessons.map((lesson, index) => (
              <li key={lesson.id}>
                <span className="session-number">{index + 1}</span>
                <div>
                  <Link to={lessonHref(lesson.id)}>{lesson.title}</Link>
                  <small className="muted">About {lesson.minutes} min</small>
                </div>
              </li>
            ))}
          </ol>
          <Link className="text-link" to="/settings">
            Change your session preference
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </aside>
      </div>
      <div className="home-secondary">
        <section
          className="panel path-preview"
          aria-labelledby="path-preview-heading"
        >
          <div className="section-top">
            <div>
              <h2 id="path-preview-heading">
                From your first line to a useful CLI.
              </h2>
            </div>
            <Link className="text-link" to="/path">
              All chapters
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <p className="muted">
            {course.lessons.length} focused lessons, {course.modules.length}{" "}
            ordered chapters, {course.projects.length} guided projects. C and
            C++ are separate languages; this course teaches C.
          </p>
          <ol className="chapter-preview-list">
            {course.modules.slice(0, 4).map((module, i) => (
              <li key={module.id}>
                <ChapterMark index={i} />
                <div>
                  <Link to={`/path#${module.id}`}>{module.title}</Link>
                  <small className="muted">
                    Chapter {i + 1} ·{" "}
                    {module.lessonIds.filter((id) => done.has(id)).length} /{" "}
                    {module.lessonIds.length} lessons completed
                  </small>
                </div>
                <ArrowRight size={15} className="muted" aria-hidden="true" />
              </li>
            ))}
          </ol>
          {completedExercises > 0 ? (
            <p className="progress-explanation">
              {completedExercises} exercises completed · {proficient}{" "}
              demonstrated independently. Completion and proficiency are tracked
              separately.
            </p>
          ) : (
            <p className="progress-explanation">
              Your progress starts with your first checked exercise. Nothing to
              catch up on.
            </p>
          )}
        </section>
        <div className="home-side-stack">
          <section className="panel" aria-labelledby="review-summary-heading">
            <div className="panel-icon">
              <RotateCcw size={19} aria-hidden="true" />
            </div>
            <h2 id="review-summary-heading">Keep it familiar.</h2>
            <p className="muted">
              {due.length
                ? `${due.length} retrieval ${due.length === 1 ? "question is" : "questions are"} ready to revisit. Short reviews help you check what you still remember.`
                : state.reviews.length
                  ? "Your next review is scheduled. You can revisit a concept whenever you want."
                  : "After a checked exercise, a short retrieval question will appear here."}
            </p>
            <Link className="text-link" to="/review">
              {due.length ? "Start a short review" : "Open practice & review"}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </section>
          <section
            className="panel activity-panel"
            aria-labelledby="activity-heading"
          >
            <div className="section-top">
              <h2 id="activity-heading">Recent work</h2>
              <History size={17} className="muted" aria-hidden="true" />
            </div>
            {state.activity.length ? (
              <ul className="activity-list">
                {state.activity.slice(0, 4).map((activity) => {
                  const lesson = course.lessons.find((l) =>
                    l.exerciseIds.includes(activity.exerciseId),
                  );
                  return (
                    <li key={activity.id}>
                      <span
                        className={`activity-dot ${activity.passed ? "passed" : ""}`}
                        aria-hidden="true"
                      />
                      <div>
                        <Link
                          to={lessonHref(
                            lesson?.id ?? next?.id ?? "",
                            activity.exerciseId,
                          )}
                        >
                          {lesson?.title ?? prettyId(activity.exerciseId)}
                        </Link>
                        <small>
                          {activity.mode === "check"
                            ? activity.passed
                              ? "Check passed"
                              : activity.passed === false
                                ? "Check needs another attempt"
                                : "Check result"
                            : "Code run"}{" "}
                          {activity.mode !== "check" || activity.passed === null
                            ? ` · ${prettyId(activity.state)}`
                            : null}
                        </small>
                        <time className="muted" dateTime={activity.createdAt}>
                          {formattedDate(
                            activity.createdAt,
                            state.preferences.timezone,
                          )}
                        </time>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">
                No attempts yet. Runs and checks will appear here as you work.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function PathPage({ course, state }: PageProps) {
  const done = completedLessons(course, state);
  const recommended = course.lessons.find((l) => !done.has(l.id));
  const progress = new Map(state.progress.map((p) => [p.exerciseId, p]));
  const lessonById = new Map(course.lessons.map((l) => [l.id, l]));
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const diagnostic = useQuery({
    queryKey: ["diagnostic", getLocalOwner()],
    queryFn: () => api<Diagnostic>("/api/diagnostic"),
    enabled: showDiagnostic,
  });
  async function submitDiagnostic(event: React.FormEvent) {
    event.preventDefault();
    if (!diagnostic.data) return;
    setBusy(true);
    setDiagnosticError(null);
    try {
      setResult(
        await api<DiagnosticResult>("/api/diagnostic", {
          method: "POST",
          body: JSON.stringify({
            answers: diagnostic.data.questions.map((q) => answers[q.id] ?? ""),
          }),
        }),
      );
    } catch (error) {
      setDiagnosticError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page academy-page">
      <PageHeading
        eyebrow="THE C17 COURSE"
        title="One clear path. Your own pace."
        description="Build each idea on the last. Preview any lesson, revisit an old one, or start where your experience fits."
        icon={BookOpen}
      />
      <div className="path-intro">
        <div className="course-outline">
          <span>
            <strong>{course.modules.length}</strong> chapters
          </span>
          <span>
            <strong>{course.lessons.length}</strong> focused lessons
          </span>
          <span>
            <strong>{course.projects.length}</strong> guided projects
          </span>
          <span>
            <strong>{done.size}</strong> lessons completed
          </span>
        </div>
        <button
          className="button secondary small"
          onClick={() => setShowDiagnostic((value) => !value)}
        >
          <ListChecks size={16} aria-hidden="true" />
          {showDiagnostic ? "Close diagnostic" : "Already know some C?"}
        </button>
      </div>
      {showDiagnostic ? (
        <section
          className="panel diagnostic-panel"
          aria-labelledby="diagnostic-heading"
        >
          <h2 id="diagnostic-heading">Find a sensible starting point.</h2>
          <p className="muted">
            This optional diagnostic suggests lessons to revisit. It never locks
            lessons or awards independent proficiency.
          </p>
          {diagnostic.isPending ? (
            <p role="status">Loading questions…</p>
          ) : diagnostic.error ? (
            <RequestError
              error={diagnostic.error}
              retry={() => void diagnostic.refetch()}
            />
          ) : (
            <form onSubmit={submitDiagnostic}>
              {diagnostic.data?.questions.map((question, index) => (
                <fieldset key={question.id}>
                  <legend>
                    {index + 1}. {question.question}
                  </legend>
                  {question.options.map((option) => (
                    <label className="choice-label" key={option}>
                      <input
                        type="radio"
                        name={question.id}
                        value={option}
                        checked={answers[question.id] === option}
                        onChange={() =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: option,
                          }))
                        }
                        required
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
              <button
                className="button"
                disabled={busy || !diagnostic.data?.questions.length}
              >
                {busy ? "Checking your answers…" : "Show my suggestions"}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </form>
          )}
          {diagnosticError ? <RequestError error={diagnosticError} /> : null}
          {result ? (
            <div className="diagnostic-result notice" role="status">
              <p>{result.explanation}</p>
              {result.recommendations.length ? (
                <ul>
                  {result.recommendations.map((id) => (
                    <li key={id}>
                      <Link to={lessonHref(id)}>
                        {lessonById.get(id)?.title ?? prettyId(id)}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>You can choose any lesson below.</p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
      <div className="chapter-list">
        {course.modules.map((module, index) => {
          const moduleLessons = module.lessonIds
            .map((id) => lessonById.get(id))
            .filter((l): l is NonNullable<typeof l> => !!l);
          const moduleDone = moduleLessons.filter((l) => done.has(l.id)).length;
          return (
            <section className="chapter-card" id={module.id} key={module.id}>
              <div className="chapter-head">
                <ChapterMark index={index} />
                <div className="chapter-heading">
                  <div className="section-label">Chapter {index + 1}</div>
                  <h2>{module.title}</h2>
                  <p className="muted">{module.objective}</p>
                </div>
                <div className="chapter-progress">
                  <span>
                    {moduleDone}
                    <span className="muted"> / {moduleLessons.length}</span>
                  </span>
                  <small className="muted">lessons complete</small>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label={`${module.title} completed lessons`}
                    aria-valuenow={moduleDone}
                    aria-valuemin={0}
                    aria-valuemax={moduleLessons.length}
                  >
                    <span
                      style={{
                        width: `${moduleLessons.length ? (moduleDone / moduleLessons.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <ol className="lesson-path-list">
                {moduleLessons.map((lesson, lessonIndex) => {
                  const isDone = done.has(lesson.id);
                  const isNext = recommended?.id === lesson.id;
                  const independently = lesson.exerciseIds.every(
                    (id) => progress.get(id)?.proficient,
                  );
                  return (
                    <li
                      key={lesson.id}
                      className={isNext ? "recommended-lesson" : ""}
                    >
                      <span
                        className={`lesson-status ${isDone ? "complete" : ""}`}
                        aria-label={isDone ? "Completed" : "Not completed"}
                      >
                        {isDone ? (
                          <Check size={14} aria-hidden="true" />
                        ) : (
                          String(lessonIndex + 1).padStart(2, "0")
                        )}
                      </span>
                      <div className="lesson-row-content">
                        <div className="lesson-row-title">
                          <Link to={lessonHref(lesson.id)}>{lesson.title}</Link>
                          {lesson.checkpoint ? (
                            <span className="checkpoint-tag">Checkpoint</span>
                          ) : null}
                          {isNext ? (
                            <span className="next-label">Suggested next</span>
                          ) : null}
                        </div>
                        <p>{lesson.objective}</p>
                        <div className="lesson-meta">
                          <span>
                            <Clock3 size={12} aria-hidden="true" />
                            About {lesson.minutes} min
                          </span>
                          <span>{lesson.exerciseIds.length} exercises</span>
                          {isDone ? (
                            <span>
                              {independently
                                ? "Independent checks passed"
                                : "Completed · more practice available"}
                            </span>
                          ) : null}
                        </div>
                        <details className="prerequisite-details">
                          <summary>Prerequisites</summary>
                          <p>
                            {lesson.prerequisites.length
                              ? lesson.prerequisites.map((id, pIndex) => (
                                  <span key={id}>
                                    {pIndex ? ", " : ""}
                                    <Link to={lessonHref(id)}>
                                      {lessonById.get(id)?.title ??
                                        prettyId(id)}
                                    </Link>
                                  </span>
                                ))
                              : "No prior C knowledge. We start with source files and a first program."}
                          </p>
                        </details>
                      </div>
                      <Link
                        className="lesson-open"
                        to={lessonHref(lesson.id)}
                        aria-label={`Open ${lesson.title}`}
                      >
                        <ArrowRight size={18} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ol>
              {course.projects
                .filter((project) =>
                  project.prerequisites.includes(
                    moduleLessons.at(-1)?.id ?? "",
                  ),
                )
                .map((project) => (
                  <Link
                    className="chapter-project"
                    key={project.id}
                    to={`/projects?project=${project.id}`}
                  >
                    <FolderOpen size={19} aria-hidden="true" />
                    <div>
                      <span className="section-label">Put it together</span>
                      <strong>{project.title}</strong>
                    </div>
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                ))}
            </section>
          );
        })}
      </div>
      <p className="notice">
        C17 is the deliberate baseline, not the latest C standard. Later notes
        may describe C23 features. This course never blends C with C++ syntax.
      </p>
    </div>
  );
}

function ReviewQuestion({
  item,
  timezone,
  onAnswered,
}: {
  item: ReviewItem;
  timezone: string;
  onAnswered: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<"again" | "good" | "easy">(
    "good",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<ReviewResult>(
          `/api/review/${encodeURIComponent(item.exerciseId)}`,
          {
            method: "POST",
            body: JSON.stringify({
              answer,
              confidence,
              mutationId: crypto.randomUUID(),
            }),
          },
        ),
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel review-question">
      <div className="section-top">
        <h2>{item.title}</h2>
        <span className="review-stage">Review {item.stage + 1}</span>
      </div>
      <p className="review-reason">
        <Lightbulb size={15} aria-hidden="true" />
        {item.reason}
      </p>
      <p className="retrieval-question">{item.question}</p>
      {result ? (
        <div role="status">
          <div className={`notice ${result.correct ? "success" : "caution"}`}>
            <strong>
              {result.correct
                ? "Your answer matches the expected answer."
                : "Compare the expected answer."}
            </strong>
            <p>{result.explanation}</p>
            {!result.correct ? (
              <p className="muted">
                This deterministic check compares wording. A different phrasing
                can still contain a correct idea; compare the reasoning above.
              </p>
            ) : null}
            <p className="muted">
              Next review: {formattedDate(result.dueAt, timezone)}
            </p>
          </div>
          <div className="review-result-actions">
            <Link
              className="button secondary"
              to={lessonHref(item.lessonId, item.exerciseId)}
            >
              Practice in the editor
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <button className="text-link" onClick={onAnswered}>
              Update review list
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor={`review-${item.exerciseId}`}>
            Recall it in a short answer
          </label>
          <textarea
            id={`review-${item.exerciseId}`}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={3}
            required
            maxLength={3000}
            placeholder="Think first, then write a short answer."
          />
          <fieldset className="confidence-options">
            <legend>How did recalling it feel?</legend>
            {(
              [
                ["again", "Needs another look"],
                ["good", "Some effort"],
                ["easy", "Comfortable"],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`confidence-${item.exerciseId}`}
                  value={value}
                  checked={confidence === value}
                  onChange={() => setConfidence(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <button className="button" disabled={busy || !answer.trim()}>
            {busy ? "Checking…" : "Compare recall"}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          {error ? <RequestError error={error} /> : null}
        </form>
      )}
    </article>
  );
}

export function ReviewPage({ course, state, onRefresh }: PageProps) {
  const due = state.reviews.filter(
    (r) => new Date(r.dueAt).getTime() <= Date.now(),
  );
  const upcoming = state.reviews.filter(
    (r) => new Date(r.dueAt).getTime() > Date.now(),
  );
  const practice = state.progress.filter(
    (p) => p.completed && (!p.proficient || p.helpUsed),
  );
  return (
    <div className="page academy-page">
      <PageHeading
        eyebrow="PRACTICE & REVIEW"
        title="Make the ideas yours."
        description="Recall a concept without looking, then use it again. A mistake points to a next step; it is not a penalty."
        icon={RotateCcw}
      />
      <div className="review-layout">
        <div>
          <div className="section-top">
            <h2>Ready to revisit</h2>
            <span className="muted">
              {due.length} {due.length === 1 ? "question" : "questions"}
            </span>
          </div>
          {due.length ? (
            <div className="review-question-list">
              {due.slice(0, 5).map((item) => (
                <ReviewQuestion
                  key={`${item.exerciseId}-${item.dueAt}`}
                  item={item}
                  timezone={state.preferences.timezone}
                  onAnswered={onRefresh}
                />
              ))}
              {due.length > 5 ? (
                <p className="muted">
                  Start with these five. Refresh the list after your answers for
                  the next set.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="panel empty-state">
              <CheckCircle2 size={30} aria-hidden="true" />
              <h2>
                {state.reviews.length
                  ? "Nothing due right now."
                  : "Your first review is ahead."}
              </h2>
              <p>
                {state.reviews.length
                  ? "You can choose a practice item below, or return to your next lesson."
                  : "Finish a checked exercise to schedule its retrieval question. Your first session can be just one lesson."}
              </p>
              <Link className="button secondary" to="/path">
                Choose a lesson
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          )}
          {practice.length ? (
            <section className="practice-section">
              <h2>Try it independently.</h2>
              <p className="muted">
                These exercises appeared because help was used or independent
                proficiency is still developing. You choose what to revisit.
              </p>
              <ul className="plain-link-list">
                {practice.slice(0, 8).map((item) => {
                  const lesson = course.lessons.find(
                    (l) => l.id === item.lessonId,
                  );
                  return (
                    <li key={item.exerciseId}>
                      <Link to={lessonHref(item.lessonId, item.exerciseId)}>
                        <Code2 size={17} aria-hidden="true" />
                        <span>
                          {lesson?.title ?? prettyId(item.lessonId)}
                          <small>
                            {item.helpUsed
                              ? "A hint or solution was used"
                              : "An independent check is still needed"}
                          </small>
                        </span>
                        <ArrowRight size={16} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
        <aside className="review-sidebar">
          <section className="panel">
            <span className="section-label">Review schedule</span>
            <h2>Spacing, without pressure.</h2>
            <p className="muted">
              The interval sequence is 1, 3, 7, 14, and 30 days. A matching
              answer advances one stage; comfortable recall advances two. A
              mismatch or “needs another look” returns to one day.
            </p>
            <p className="muted">
              Lesson completion, independent proficiency, and review status are
              separate. You can practice before a review is due. This is a
              deterministic schedule, not a medically validated personalization
              system.
            </p>
          </section>
          <section className="panel">
            <h2>Coming up</h2>
            {upcoming.length ? (
              <ul className="upcoming-reviews">
                {upcoming.slice(0, 5).map((item) => (
                  <li key={item.exerciseId}>
                    <Link to={lessonHref(item.lessonId, item.exerciseId)}>
                      {item.title}
                    </Link>
                    <small className="muted">
                      {formattedDate(item.dueAt, state.preferences.timezone)}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No future reviews scheduled yet.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

export function ProjectsPage({ course, state }: PageProps) {
  const [params, setParams] = useSearchParams();
  const routeParams = useParams<{ projectId: string }>();
  const selectedId =
    params.get("project") ?? routeParams.projectId ?? course.projects[0]?.id;
  const projectQuery = useQuery({
    queryKey: ["project", selectedId, getLocalOwner()],
    queryFn: () =>
      api<PublicProject>(
        `/api/projects/${encodeURIComponent(selectedId ?? "")}`,
      ),
    enabled: !!selectedId,
  });
  const [reference, setReference] = useState<{
    reference: SourceFiles;
    explanation: string[];
  } | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [activeFile, setActiveFile] = useState("");
  useEffect(() => {
    setReference(null);
    setError(null);
    setActiveFile("");
  }, [selectedId]);
  async function reveal() {
    if (
      !selectedId ||
      !window.confirm(
        "Reveal the explained reference implementation? This records help used. It does not mark any milestone as independently passed.",
      )
    )
      return;
    setRevealBusy(true);
    setError(null);
    try {
      setReference(
        await api(`/api/projects/${encodeURIComponent(selectedId)}/solution`, {
          method: "POST",
        }),
      );
    } catch (failure) {
      setError(failure);
    } finally {
      setRevealBusy(false);
    }
  }
  const project = projectQuery.data;
  return (
    <div className="page academy-page">
      <PageHeading
        eyebrow="GUIDED PROJECTS"
        title="Build something worth keeping."
        description="Bring the concepts together in small, useful programs. Milestones have real checks; your earlier lesson versions stay intact."
        icon={FolderOpen}
      />
      <div
        className="project-chooser"
        role="group"
        aria-label="Choose a guided project"
      >
        {course.projects.map((item, index) => (
          <button
            key={item.id}
            className={`project-choice ${item.id === selectedId ? "active" : ""}`}
            onClick={() => setParams({ project: item.id })}
            aria-pressed={item.id === selectedId}
          >
            <span className={`chapter-marker marker-${index % 3}`}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>
              <small>Project {index + 1}</small>
              <strong>{item.title}</strong>
            </span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
      {projectQuery.isPending ? (
        <div className="panel" role="status">
          Loading the project brief…
        </div>
      ) : projectQuery.error ? (
        <RequestError
          error={projectQuery.error}
          retry={() => void projectQuery.refetch()}
        />
      ) : project ? (
        <div className="project-layout">
          <div>
            <section className="panel project-brief">
              <span className="section-label">The brief</span>
              <h2>{project.title}</h2>
              <p>{project.brief}</p>
              <div className="project-prerequisites">
                <h3>Before you begin</h3>
                <ul>
                  {project.prerequisites.map((id) => (
                    <li key={id}>
                      <Link to={lessonHref(id)}>
                        {course.lessons.find((l) => l.id === id)?.title ??
                          prettyId(id)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
            <section className="milestone-section">
              <h2>A program, one milestone at a time.</h2>
              <ol className="milestone-list">
                {project.milestones.map((milestone, index) => {
                  const progress = state.progress.find(
                    (p) => p.exerciseId === milestone.exerciseId,
                  );
                  const exercise = project.exercises?.find(
                    (e) => e.id === milestone.exerciseId,
                  );
                  const lessonId =
                    exercise?.lessonId ??
                    course.lessons.find((l) =>
                      l.exerciseIds.includes(milestone.exerciseId),
                    )?.id;
                  return (
                    <li className="panel milestone-card" key={milestone.id}>
                      <span
                        className={`milestone-number ${progress?.completed ? "complete" : ""}`}
                      >
                        {progress?.completed ? (
                          <Check size={17} aria-label="Completed" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <div>
                        <span className="section-label">
                          Milestone {index + 1}
                        </span>
                        <h3>{milestone.title}</h3>
                        <ul>
                          {milestone.requirements.map((requirement) => (
                            <li key={requirement}>{requirement}</li>
                          ))}
                        </ul>
                        <p className="muted milestone-status">
                          {progress?.proficient
                            ? "Passed independently"
                            : progress?.completed
                              ? "Completed with support · a fresh independent attempt is available"
                              : "Not checked yet"}
                        </p>
                        {lessonId ? (
                          <Link
                            className="button secondary small"
                            to={lessonHref(
                              lessonId,
                              milestone.exerciseId,
                              project.id,
                            )}
                          >
                            Open workspace
                            <ArrowRight size={16} aria-hidden="true" />
                          </Link>
                        ) : (
                          <p className="notice caution">
                            This milestone is missing its lesson link. Its
                            workspace cannot be opened.
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
          <aside className="project-sidebar">
            <section className="panel">
              <span className="section-label">Success criteria</span>
              <h2>The final rubric</h2>
              <ul className="rubric-list">
                {project.rubric.map((criterion) => (
                  <li key={criterion}>
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>{criterion}</span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                Passing tests is evidence about tested behavior. It does not
                prove a C program correct for every input.
              </p>
            </section>
            <section className="panel">
              <h2>Starter files</h2>
              <p className="muted">
                Milestone workspaces save your source files, active file, and
                stdin to your account.
              </p>
              <ul className="file-manifest">
                {Object.keys(project.starter).map((file) => (
                  <li key={file}>
                    <FileCode2 size={15} aria-hidden="true" />
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
              <details className="starter-preview">
                <summary>Inspect the project starter</summary>
                {Object.entries(project.starter).map(([file, code]) => (
                  <div key={file}>
                    <h3>
                      <code>{file}</code>
                    </h3>
                    <pre className="code">
                      <code>{code}</code>
                    </pre>
                  </div>
                ))}
              </details>
            </section>
            <section className="panel">
              <h2>An explained reference</h2>
              <p className="muted">
                Compare after your own attempt. Revealing the implementation
                records help; it does not award independent proficiency.
              </p>
              <button
                className="button secondary small"
                disabled={revealBusy}
                onClick={() => void reveal()}
              >
                {revealBusy
                  ? "Loading reference…"
                  : reference
                    ? "Reveal again"
                    : "Reveal reference"}
                <BookOpen size={16} aria-hidden="true" />
              </button>
              {error ? <RequestError error={error} /> : null}
            </section>
          </aside>
        </div>
      ) : (
        <div className="panel empty-state">
          <p>No project content is available.</p>
        </div>
      )}
      {reference ? (
        <section
          className="panel reference-implementation"
          aria-labelledby="reference-implementation-heading"
        >
          <div className="section-top">
            <h2 id="reference-implementation-heading">
              Reference implementation
            </h2>
            <button
              className="button secondary small"
              onClick={() => setReference(null)}
            >
              Hide reference
            </button>
          </div>
          <p className="notice caution">
            Help used is recorded. Use the explanation, then try a fresh
            independent attempt.
          </p>
          {reference.explanation.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          <div className="file-tabs" role="group" aria-label="Reference files">
            {Object.keys(reference.reference).map((file) => (
              <button
                className={
                  file === (activeFile || Object.keys(reference.reference)[0])
                    ? "active"
                    : ""
                }
                key={file}
                onClick={() => setActiveFile(file)}
                aria-pressed={
                  file === (activeFile || Object.keys(reference.reference)[0])
                }
              >
                <FileCode2 size={14} aria-hidden="true" />
                {file}
              </button>
            ))}
          </div>
          <pre className="code">
            <code>
              {
                reference.reference[
                  activeFile || Object.keys(reference.reference)[0]
                ]
              }
            </code>
          </pre>
        </section>
      ) : null}
    </div>
  );
}

export function ReferencePage(_props: Partial<PageProps>) {
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search);
  const reference = useQuery({
    queryKey: ["reference", query, getLocalOwner()],
    queryFn: () =>
      api<Reference[]>(`/api/reference?q=${encodeURIComponent(query)}`),
  });
  return (
    <div className="page academy-page reference-page">
      <PageHeading
        eyebrow="THE FIELD GUIDE"
        title="A clear explanation, close at hand."
        description="Look up a concept, format specifier, library function, or compiler diagnostic. Short examples link back to the lesson."
        icon={BookOpen}
      />
      <label className="reference-search" htmlFor="reference-search">
        <Search size={20} aria-hidden="true" />
        <input
          id="reference-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search pointers, printf, bounds, compiler errors…"
        />
        <span className="sr-only">Search reference entries</span>
      </label>
      <p className="muted search-meta" role="status">
        {reference.isFetching
          ? "Searching…"
          : `${reference.data?.length ?? 0} entries${query ? ` matching “${query}”` : ""}`}
      </p>
      {reference.error ? (
        <RequestError
          error={reference.error}
          retry={() => void reference.refetch()}
        />
      ) : reference.isPending ? (
        <div className="panel" role="status">
          Loading the reference…
        </div>
      ) : reference.data?.length ? (
        <div className="reference-list">
          {reference.data.map((entry) => (
            <article
              className="panel reference-entry"
              key={entry.id}
              id={entry.id}
            >
              <div className="section-top">
                <h2>{entry.title}</h2>
                <Link className="text-link" to={lessonHref(entry.lessonId)}>
                  Related lesson
                  <ArrowUpRight size={15} aria-hidden="true" />
                </Link>
              </div>
              {entry.body
                .split("\n")
                .filter(Boolean)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              {entry.example ? (
                <pre className="code">
                  <code>{entry.example}</code>
                </pre>
              ) : null}
              <div className="concept-tags" aria-label="Concepts">
                {entry.tags.map((tag) => (
                  <button key={tag} onClick={() => setSearch(tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel empty-state">
          <Search size={30} aria-hidden="true" />
          <h2>No matching entry.</h2>
          <p>Try a shorter term such as “array”, “input”, or “printf”.</p>
          <button className="button secondary" onClick={() => setSearch("")}>
            Show all entries
          </button>
        </div>
      )}
    </div>
  );
}

export function SettingsPage({ state, onRefresh }: PageProps) {
  const [preferences, setPreferences] = useState<Preferences>(
    state.preferences,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [importPreview, setImportPreview] = useState<ImportEffects | null>(
    null,
  );
  const [importMode, setImportMode] = useState<"preserve" | "replace">(
    "preserve",
  );
  const [dataBusy, setDataBusy] = useState(false);
  const [dataError, setDataError] = useState<unknown>(null);
  const [dataMessage, setDataMessage] = useState("");
  const [addressNotice, setAddressNotice] = useState("");
  const workshopAddress = new URL(appBasePath, window.location.origin).href;
  const localAddress = ["localhost", "127.0.0.1", "[::1]"].includes(
    window.location.hostname,
  );
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ["sessions", getLocalOwner()],
    queryFn: () => api<Session[]>("/api/auth/sessions"),
  });
  useEffect(() => {
    setPreferences(state.preferences);
  }, [state.preferencesRevision, state.preferences]);
  const changed =
    JSON.stringify(preferences) !== JSON.stringify(state.preferences);
  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
    setMessage("");
  }
  async function savePreferences(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      new Intl.DateTimeFormat("en", { timeZone: preferences.timezone });
      await api("/api/preferences", {
        method: "POST",
        body: JSON.stringify({
          revision: state.preferencesRevision,
          preferences,
        }),
      });
      setMessage("Preferences saved to your account.");
      onRefresh();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function exportData() {
    setDataBusy(true);
    setDataError(null);
    setDataMessage("");
    try {
      const data = await api<unknown>("/api/data/export");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `c-forge-learner-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setDataMessage(
        "Your learner export was prepared. Keep it somewhere you control.",
      );
    } catch (failure) {
      setDataError(failure);
    } finally {
      setDataBusy(false);
    }
  }
  async function previewImport(file: File | undefined) {
    if (!file) return;
    setDataBusy(true);
    setDataError(null);
    setDataMessage("");
    setImportPreview(null);
    setPayload(null);
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("This file is larger than the 2 MB import limit.");
      const value: unknown = JSON.parse(await file.text());
      const preview = await api<ImportEffects>("/api/data/import/preview", {
        method: "POST",
        body: JSON.stringify({ payload: value }),
      });
      setPayload(value);
      setImportPreview(preview);
      setImportMode("preserve");
    } catch (failure) {
      setDataError(failure);
    } finally {
      setDataBusy(false);
    }
  }
  async function importData() {
    if (!payload || !importPreview) return;
    if (
      !window.confirm(
        importMode === "preserve"
          ? "Import this validated learner export while preserving existing work? Conflicting drafts will be kept for recovery."
          : "Replace your existing learner data with this export? Export your current data first. This also clears unsynced draft recovery on this device.",
      )
    )
      return;
    setDataBusy(true);
    setDataError(null);
    try {
      await api("/api/data/import", {
        method: "POST",
        body: JSON.stringify({ payload, mode: importMode }),
      });
      if (importMode === "replace") {
        const owner = getLocalOwner();
        try {
          await purgeLocal({ preserveAccount: true });
        } catch {
          setDataError(
            new Error(
              "The server import completed, but device recovery could not be cleared. Inspect draft conflicts before editing.",
            ),
          );
        } finally {
          setLocalOwner(owner);
        }
      }
      setImportPreview(null);
      setPayload(null);
      setDataMessage("Import completed. Your account data has been refreshed.");
      onRefresh();
    } catch (failure) {
      setDataError(failure);
    } finally {
      setDataBusy(false);
    }
  }
  async function revokeSession(session: Session) {
    if (
      !window.confirm(
        session.current
          ? "Sign out this browser session?"
          : "Revoke this session? That browser will need to sign in again.",
      )
    )
      return;
    try {
      await api(`/api/auth/sessions/${encodeURIComponent(session.id)}`, {
        method: "DELETE",
      });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (session.current) {
        await purgeLocal();
        queryClient.clear();
        window.location.assign(appBasePath);
      }
    } catch (failure) {
      setError(failure);
    }
  }
  return (
    <div className="page academy-page settings-page">
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title="Make room for your attention."
        description="Adjust reading and coding independently. Your preferences and saved work belong to your account."
        icon={Settings2}
      />
      <form className="settings-form" onSubmit={savePreferences}>
        <section className="panel">
          <div className="settings-section-heading">
            <h2>Reading & appearance</h2>
            <p className="muted">
              Readable type and steady spacing. Choose what feels comfortable.
            </p>
          </div>
          <div className="settings-fields">
            <label>
              Theme
              <select
                aria-label="Theme"
                value={preferences.theme}
                onChange={(event) =>
                  update("theme", event.target.value as Preferences["theme"])
                }
              >
                <option value="dark">Forge dark</option>
                <option value="light">Paper light</option>
                <option value="system">Follow system</option>
              </select>
            </label>
            <label>
              Prose size <output>{preferences.proseSize} px</output>
              <input
                type="range"
                min={16}
                max={24}
                step={1}
                value={preferences.proseSize}
                onChange={(event) =>
                  update("proseSize", Number(event.target.value))
                }
              />
            </label>
            <label>
              Editor size <output>{preferences.editorSize} px</output>
              <input
                type="range"
                min={12}
                max={24}
                step={1}
                value={preferences.editorSize}
                onChange={(event) =>
                  update("editorSize", Number(event.target.value))
                }
              />
            </label>
            <label>
              Reading line spacing{" "}
              <output>{preferences.lineSpacing.toFixed(2)}</output>
              <input
                type="range"
                min={1.4}
                max={2.2}
                step={0.05}
                value={preferences.lineSpacing}
                onChange={(event) =>
                  update("lineSpacing", Number(event.target.value))
                }
              />
            </label>
          </div>
          <div
            className="reading-preview"
            style={{
              fontSize: preferences.proseSize,
              lineHeight: preferences.lineSpacing,
            }}
          >
            <span className="section-label">Reading preview</span>
            <p>
              A variable is a named object that stores a value. Initialize it
              before reading it. One small idea, then a chance to use it.
            </p>
            <code style={{ fontSize: preferences.editorSize }}>
              int count = 3;
            </code>
          </div>
        </section>
        <section className="panel">
          <h2>Attention & pace</h2>
          <div className="settings-fields">
            <label className="toggle-label">
              <span>
                <strong>Focus mode</strong>
                <small>
                  Hide nonessential navigation while working in a lesson.
                </small>
              </span>
              <input
                type="checkbox"
                checked={preferences.focusMode}
                onChange={(event) => update("focusMode", event.target.checked)}
              />
            </label>
            <label className="toggle-label">
              <span>
                <strong>Reduce motion</strong>
                <small>
                  Use steady transitions. System reduced-motion settings are
                  also respected.
                </small>
              </span>
              <input
                type="checkbox"
                checked={preferences.reducedMotion}
                onChange={(event) =>
                  update("reducedMotion", event.target.checked)
                }
              />
            </label>
            <label>
              Suggested session length
              <select
                value={preferences.sessionMinutes}
                onChange={(event) =>
                  update(
                    "sessionMinutes",
                    Number(event.target.value) as 5 | 15 | 30,
                  )
                }
              >
                <option value={5}>5 minutes · one small step</option>
                <option value={15}>15 minutes · learn and practice</option>
                <option value={30}>30 minutes · a deeper session</option>
              </select>
            </label>
            <label>
              Timezone
              <input
                type="text"
                value={preferences.timezone}
                onChange={(event) => update("timezone", event.target.value)}
                required
                maxLength={80}
                placeholder="Asia/Shanghai"
              />
              <small className="muted">
                An IANA timezone, for example Asia/Shanghai or Europe/London.
              </small>
            </label>
          </div>
        </section>
        <div className="settings-save">
          <button className="button" disabled={busy || !changed}>
            {busy ? "Saving preferences…" : "Save preferences"}
            <Check size={16} aria-hidden="true" />
          </button>
          {message ? (
            <p className="status-text" role="status">
              {message}
            </p>
          ) : changed ? (
            <p className="muted">You have unsaved preference changes.</p>
          ) : null}
        </div>
        {error ? <RequestError error={error} /> : null}
      </form>
      <section className="panel settings-data" aria-labelledby="data-heading">
        <div className="settings-section-heading">
          <h2 id="data-heading">Your learning data</h2>
          <p className="muted">
            A versioned JSON export includes your drafts, progress, notes,
            preferences, and review state. It excludes passwords, sessions, and
            hidden grading material.
          </p>
        </div>
        <div className="data-actions">
          <button
            className="button secondary"
            onClick={() => void exportData()}
            disabled={dataBusy}
          >
            <Download size={17} aria-hidden="true" />
            Export learner data
          </button>
          <label className="button secondary import-file">
            <Upload size={17} aria-hidden="true" />
            Preview an import
            <input
              type="file"
              accept="application/json,.json"
              disabled={dataBusy}
              onChange={(event) => {
                void previewImport(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="muted data-limit">
          Import limit: 2 MB. A learner export complements a consistent server
          database backup; it does not replace it.
        </p>
        {dataBusy ? <p role="status">Preparing your data…</p> : null}
        {dataError ? <RequestError error={dataError} /> : null}
        {dataMessage ? (
          <p className="notice success" role="status">
            {dataMessage}
          </p>
        ) : null}
        {importPreview ? (
          <div className="import-preview">
            <h3>Review the import before applying it.</h3>
            <dl>
              {Object.entries(importPreview.counts).map(([key, count]) => (
                <div key={key}>
                  <dt>{prettyId(key)}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            {importPreview.warnings.length ? (
              <ul className="notice caution">
                {importPreview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <fieldset>
              <legend>How should existing work be handled?</legend>
              <label className="choice-label">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === "preserve"}
                  onChange={() => setImportMode("preserve")}
                />
                <span>
                  <strong>Preserve existing work</strong>
                  <small>
                    Keep current records. Preserve conflicting drafts for
                    recovery.
                  </small>
                </span>
              </label>
              <label className="choice-label">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === "replace"}
                  onChange={() => setImportMode("replace")}
                />
                <span>
                  <strong>Replace learner data</strong>
                  <small>
                    Replace existing drafts and progress with this export.
                    Export first.
                  </small>
                </span>
              </label>
            </fieldset>
            <div className="row">
              <button
                className="button"
                disabled={dataBusy}
                onClick={() => void importData()}
              >
                Confirm{" "}
                {importMode === "preserve" ? "preserving" : "replacement"}{" "}
                import
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setImportPreview(null);
                  setPayload(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        <div className="notice">
          <strong>Storage and offline recovery</strong>
          <p>
            The server database is your account's source of truth. The browser
            keeps a local recovery buffer for drafts and queued writes. Offline
            execution is unavailable. A browser crash before a local write
            finishes can still lose the newest keystrokes.
          </p>
          <p>
            Cloud development storage may disappear with its workspace. For
            durable self-hosting, use the persistent volume and backup procedure
            in the README.
          </p>
        </div>
      </section>
      <section
        className="panel device-access"
        aria-labelledby="device-access-heading"
      >
        <h2 id="device-access-heading">Your phone and Linux PC</h2>
        <p className="muted">
          Open the same workshop address in both browsers and sign in with your
          owner account. Work marked “Saved to account” is available on your
          other device.
        </p>
        <label htmlFor="workshop-address">Workshop address</label>
        <input
          id="workshop-address"
          type="url"
          value={workshopAddress}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(workshopAddress);
              setAddressNotice("Workshop address copied.");
            } catch {
              setAddressNotice(
                "Clipboard access was unavailable. Select the address above and copy it manually.",
              );
            }
          }}
        >
          Copy workshop address
        </button>
        {addressNotice ? <p role="status">{addressNotice}</p> : null}
        {localAddress ? (
          <p className="notice caution">
            This address opens only on this computer. Use your Ubuntu server’s
            HTTPS address to reach C Forge from another device.
          </p>
        ) : null}
        <p className="muted">
          On your phone, use the browser’s “Add to Home Screen” or “Install app”
          action. On Linux, bookmark this address or install it from Chromium’s
          menu. Availability depends on your browser. Opening a new session
          still needs your server connection.
        </p>
      </section>
      <section
        className="panel sessions-panel"
        aria-labelledby="sessions-heading"
      >
        <h2 id="sessions-heading">Signed-in sessions</h2>
        <p className="muted">
          Revoke a browser you no longer use. Owner recovery is
          administrator-controlled and documented in the README.
        </p>
        {sessions.isPending ? (
          <p role="status">Loading sessions…</p>
        ) : sessions.error ? (
          <RequestError
            error={sessions.error}
            retry={() => void sessions.refetch()}
          />
        ) : (
          <ul className="session-management-list">
            {sessions.data?.map((session) => (
              <li key={session.id}>
                <div>
                  <strong>
                    {session.current
                      ? "This browser"
                      : "Another signed-in browser"}
                  </strong>
                  <small className="muted">
                    Started{" "}
                    {formattedDate(session.createdAt, preferences.timezone)}
                  </small>
                  <small className="muted">
                    Expires{" "}
                    {formattedDate(session.expiresAt, preferences.timezone)}
                  </small>
                </div>
                <button
                  className="button secondary small"
                  onClick={() => void revokeSession(session)}
                >
                  {session.current ? "Sign out" : "Revoke session"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
