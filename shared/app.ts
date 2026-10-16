import type {
  SourceFiles,
  Module,
  PublicLesson,
  PublicExercise,
  Reference,
} from "./content.js";
export interface Preferences {
  displayName?: string;
  avatarDataUrl?: string | null;
  courseId?: "c17" | "cpp20";
  theme: "dark" | "light" | "system";
  proseSize: number;
  editorSize: number;
  lineSpacing: number;
  reducedMotion: boolean;
  focusMode: boolean;
  sessionMinutes: 5 | 15 | 30;
  timezone: string;
}
export const defaultPreferences: Preferences = {
  theme: "light",
  proseSize: 18,
  editorSize: 15,
  lineSpacing: 1.75,
  reducedMotion: false,
  focusMode: false,
  sessionMinutes: 15,
  timezone: "Asia/Shanghai",
};
export interface DraftData {
  files: SourceFiles;
  stdin: string;
  activeFile: string;
  step: number;
  cursor: { anchor: number; head: number };
  scrollAnchor: number;
  paneSize: number;
  notes: string;
  bookmark: boolean;
  prediction?: string;
  sanitize?: boolean;
  mobileTab?: "learn" | "code" | "results";
}
export interface Draft {
  exerciseId: string;
  contentVersion: number;
  revision: number;
  data: DraftData;
  updatedAt: string;
}
export interface DraftSave {
  revision: number;
  mutationId: string;
  contentVersion: number;
  data: DraftData;
}
export interface DraftConflict {
  id: string;
  local: Draft;
  remote: Draft;
}
export interface LessonSummary {
  id: string;
  moduleId: string;
  title: string;
  objective: string;
  prerequisites: string[];
  minutes: number;
  exerciseIds: string[];
  checkpoint?: boolean;
}
export interface CourseMap {
  course: { id: string; title: string; standard: string };
  modules: Module[];
  lessons: LessonSummary[];
  projects: {
    id: string;
    title: string;
    brief: string;
    prerequisites: string[];
  }[];
}
export interface Progress {
  exerciseId: string;
  lessonId: string;
  completed: boolean;
  proficient: boolean;
  helpUsed: boolean;
  reviewStage: number;
  dueAt: string;
  lastResult: string;
}
export interface Activity {
  id: string;
  exerciseId: string;
  mode: string;
  state: string;
  passed: boolean | null;
  createdAt: string;
}
export interface ReviewItem {
  exerciseId: string;
  lessonId: string;
  title: string;
  question: string;
  dueAt: string;
  stage: number;
  reason: string;
}
export interface Resume {
  lessonId: string;
  exerciseId: string;
  step: number;
}
export interface LearnerState {
  preferences: Preferences;
  preferencesRevision: number;
  resume: Resume | null;
  progress: Progress[];
  activity: Activity[];
  reviews: ReviewItem[];
  enrolled: boolean;
  courseResumes?: Record<string, Resume | null>;
}
export interface LessonResponse {
  lesson: PublicLesson;
  exercises: PublicExercise[];
}
export interface ImportPreview {
  format: "c-forge";
  version: 1;
  exportedAt: string;
  data: unknown;
}
export type ReferenceResponse = Reference[];
