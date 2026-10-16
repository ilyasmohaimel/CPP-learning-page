import {
  useEffect,
  useState,
  useSyncExternalStore,
  lazy,
  Suspense,
} from "react";
import {
  NavLink,
  Routes,
  Route,
  useLocation,
  useNavigate,
  Link,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Play,
  Route as RouteIcon,
  RotateCcw,
  FolderCode,
  BookOpen,
  Settings,
  Menu,
  LogOut,
  ChevronRight,
  PanelLeftClose,
  Sun,
  Moon,
  Focus,
} from "lucide-react";
import type { CourseMap, LearnerState } from "../shared/app";
import { api, purgeLocal, getLocalOwner, subscribeLocalOwner } from "./lib/api";
import { Brand } from "./components/Brand";
import { Auth } from "./components/Auth";
import { useTheme } from "./lib/theme";
import {
  HomePage,
  PathPage,
  ReviewPage,
  ProjectsPage,
  ReferencePage,
  SettingsPage,
} from "./components/Pages";
const LessonPage = lazy(() => import("./components/Lesson"));
const navigation = [
  { to: "/", label: "Continue", icon: Play },
  { to: "/path", label: "Learning path", icon: RouteIcon },
  { to: "/review", label: "Practice & review", icon: RotateCcw },
  { to: "/projects", label: "Projects", icon: FolderCode },
  { to: "/reference", label: "Reference", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: Settings },
];
export default function App() {
  const localOwner = useSyncExternalStore(
    subscribeLocalOwner,
    getLocalOwner,
    () => null,
  );
  const client = useQueryClient(),
    location = useLocation(),
    navigate = useNavigate();
  const [menu, setMenu] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine),
    [error, setError] = useState(""),
    [preferenceBusy, setPreferenceBusy] = useState(false);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ id: string; username: string }>("/api/auth/me"),
    retry: false,
  });
  const state = useQuery({
    queryKey: ["state", me.data?.id],
    queryFn: () => api<LearnerState>("/api/state"),
    enabled: !!me.data,
  });
  const routeCourse = location.pathname.startsWith("/lesson/")
    ? location.pathname.split("/")[2]?.startsWith("cpp-")
      ? "cpp20"
      : "c17"
    : location.pathname.startsWith("/projects/")
      ? location.pathname.split("/")[2]?.startsWith("cpp-")
        ? "cpp20"
        : "c17"
      : new URLSearchParams(location.search).get("project")
        ? new URLSearchParams(location.search)
            .get("project")!
            .startsWith("cpp-")
          ? "cpp20"
          : "c17"
        : null;
  const courseId = routeCourse ?? state.data?.preferences.courseId ?? "c17";
  const course = useQuery({
    queryKey: ["course", me.data?.id, courseId],
    queryFn: () => api<CourseMap>(`/api/course?course=${courseId}`),
    enabled: !!me.data,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["state"] });
  };
  useEffect(() => {
    const cb = () => setOffline(!navigator.onLine);
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => {
      window.removeEventListener("online", cb);
      window.removeEventListener("offline", cb);
    };
  }, []);
  useEffect(() => {
    setMenu(false);
  }, [location.pathname]);
  const prefs = state.data?.preferences;
  const theme = useTheme(prefs?.theme);
  useEffect(() => {
    if (!prefs) return;
    document.documentElement.style.setProperty(
      "--prose-size",
      `${prefs.proseSize}px`,
    );
    document.documentElement.style.setProperty(
      "--editor-size",
      `${prefs.editorSize}px`,
    );
    document.documentElement.style.setProperty(
      "--line-spacing",
      `${prefs.lineSpacing}`,
    );
    document.documentElement.dataset.reducedMotion = String(
      prefs.reducedMotion,
    );
  }, [prefs]);
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      await purgeLocal();
      client.clear();
      navigate("/");
      void me.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed.");
    }
  }
  async function quickPreference(patch: Partial<NonNullable<typeof prefs>>) {
    if (!state.data || preferenceBusy) return;
    setPreferenceBusy(true);
    try {
      await api("/api/preferences", {
        method: "POST",
        body: JSON.stringify({
          revision: state.data.preferencesRevision,
          preferences: { ...state.data.preferences, ...patch },
        }),
      });
      await client.invalidateQueries({ queryKey: ["state"] });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preference save failed.");
      return false;
    } finally {
      setPreferenceBusy(false);
    }
  }
  if (me.isLoading)
    return (
      <div className="loading-screen">
        <Brand />
        <p role="status">Opening your workshop…</p>
      </div>
    );
  if (!me.data || localOwner !== me.data.id)
    return (
      <Auth
        onSuccess={() => {
          void me.refetch();
        }}
      />
    );
  if (!course.data || !state.data)
    return (
      <div className="loading-screen">
        <Brand />
        <p role="status">
          {course.error || state.error
            ? "The learning data could not be loaded."
            : "Loading your course and saved progress…"}
        </p>
        <button
          onClick={() => {
            void course.refetch();
            void state.refetch();
          }}
        >
          Retry
        </button>
        <button className="secondary" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    );
  const lessonIds = new Set(course.data.lessons.map((l) => l.id));
  const exerciseIds = new Set(
    course.data.lessons.flatMap((l) => l.exerciseIds),
  );
  const scopedState: LearnerState = {
    ...state.data,
    resume:
      state.data.courseResumes?.[courseId] ??
      (state.data.resume && lessonIds.has(state.data.resume.lessonId)
        ? state.data.resume
        : null),
    progress: state.data.progress.filter((p) => lessonIds.has(p.lessonId)),
    reviews: state.data.reviews.filter((r) => lessonIds.has(r.lessonId)),
    activity: state.data.activity.filter((a) => exerciseIds.has(a.exerciseId)),
  };
  const props = { course: course.data, state: scopedState, onRefresh: refresh };
  const languageName = courseId === "cpp20" ? "C++" : "C";
  const lessonId = location.pathname.startsWith("/lesson/")
      ? location.pathname.split("/")[2]
      : null,
    lesson = course.data.lessons.find((l) => l.id === lessonId),
    module = course.data.modules.find((m) => m.id === lesson?.moduleId);
  const focus = prefs?.focusMode;
  return (
    <div
      key={me.data.id}
      className={`app-shell ${collapsed ? "collapsed" : ""} ${focus ? "focus-mode" : ""}`}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {menu ? (
        <button
          className="menu-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      ) : null}
      <aside
        className={`sidebar ${menu ? "open" : ""}`}
        aria-label="Workshop navigation"
      >
        <Link to="/" className="brand-link" aria-label="C Forge home">
          <Brand />
        </Link>
        <nav>
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink end={to === "/"} to={to} key={to}>
              <Icon size={19} />
              <span>{label}</span>
              {to === "/" ? (
                <ChevronRight className="nav-arrow" size={16} />
              ) : null}
            </NavLink>
          ))}
        </nav>
        {module ? (
          <section className="chapter-outline">
            <small>In this chapter</small>
            <h3>
              <span className="chapter-dot">
                {String(course.data.modules.indexOf(module) + 1).padStart(
                  2,
                  "0",
                )}
              </span>
              {module.title}
            </h3>
            {module.lessonIds.map((id) => {
              const l = course.data.lessons.find((l) => l.id === id)!;
              const complete = l.exerciseIds.every((e) =>
                state.data!.progress.some(
                  (p) => p.exerciseId === e && p.completed,
                ),
              );
              return (
                <Link
                  key={id}
                  className={id === lessonId ? "current" : ""}
                  to={`/lesson/${id}`}
                >
                  <span
                    className={`outline-point ${complete ? "complete" : ""}`}
                  >
                    {complete ? "✓" : ""}
                  </span>
                  {l.title}
                </Link>
              );
            })}
          </section>
        ) : (
          <div className="sidebar-note">
            <span
              className={`language-logo ${courseId === "cpp20" ? "cpp-logo" : ""}`}
            >
              {languageName}
            </span>
            <div>
              <strong>{course.data.course.title}</strong>
              <small>
                {course.data.lessons.length} lessons ·{" "}
                {course.data.course.standard}
              </small>
            </div>
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="avatar">
            {me.data.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{me.data.username}</strong>
            <small>Your private workshop</small>
          </div>
          <button
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void logout()}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Menu size={22} />
            </button>
            <button
              className="desktop-collapse icon-button"
              aria-label={
                collapsed ? "Expand navigation" : "Collapse navigation"
              }
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeftClose size={19} />
            </button>
            <span>{course.data.course.title}</span>
            {module ? (
              <>
                <ChevronRight size={14} />
                <span>{module.title}</span>
              </>
            ) : null}
          </div>
          <div className="topbar-actions">
            <label className="course-picker">
              <span className="sr-only">Course</span>
              <select
                aria-label="Course"
                value={courseId}
                disabled={preferenceBusy}
                onChange={async (event) => {
                  const next = event.target.value as "c17" | "cpp20";
                  if (await quickPreference({ courseId: next })) navigate("/");
                }}
              >
                <option value="c17">C17</option>
                <option value="cpp20">C++20</option>
              </select>
            </label>
            <span className="standard-label">
              <span />
              {course.data.course.standard} course
            </span>
            <button
              className="icon-button"
              aria-label={
                theme === "light"
                  ? "Switch to dark theme"
                  : "Switch to light theme"
              }
              title={
                theme === "light"
                  ? "Switch to dark theme"
                  : "Switch to light theme"
              }
              disabled={preferenceBusy}
              onClick={() =>
                void quickPreference({
                  theme: theme === "light" ? "dark" : "light",
                })
              }
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button
              className={`icon-button ${focus ? "selected" : ""}`}
              aria-label={focus ? "Exit focus mode" : "Enter focus mode"}
              title={focus ? "Exit focus mode" : "Enter focus mode"}
              disabled={preferenceBusy}
              onClick={() => void quickPreference({ focusMode: !focus })}
            >
              <Focus size={19} />
            </button>
          </div>
        </header>
        {offline ? (
          <div className="offline-banner" role="status">
            Offline drafting · Opened lessons remain readable in this tab.
            Server execution and account sync need a connection.
          </div>
        ) : null}
        {error ? (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        ) : null}
        <main id="main" tabIndex={-1}>
          <Suspense
            fallback={
              <p className="loading" role="status">
                Opening the lesson workspace…
              </p>
            }
          >
            <Routes>
              <Route path="/" element={<HomePage {...props} />} />
              <Route path="/path" element={<PathPage {...props} />} />
              <Route path="/review" element={<ReviewPage {...props} />} />
              <Route path="/projects" element={<ProjectsPage {...props} />} />
              <Route
                path="/projects/:projectId"
                element={<ProjectsPage {...props} />}
              />
              <Route path="/reference" element={<ReferencePage {...props} />} />
              <Route path="/settings" element={<SettingsPage {...props} />} />
              <Route path="/lesson/:id" element={<LessonPage {...props} />} />
              <Route
                path="*"
                element={
                  <div className="page">
                    <h1>This page isn’t in the workshop.</h1>
                    <Link to="/">Return to your course</Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <footer className="app-footer">
          Made for deliberate practice.{" "}
          <span>C and C++ have separate courses and saved work.</span>
        </footer>
      </div>
    </div>
  );
}
