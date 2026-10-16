export type Language = "c" | "cpp";
export type SourceFiles = Record<string, string>;
export type Assessment =
  "stdout" | "numeric" | "function" | "prediction" | "diagnosis" | "reflection";
export interface Case {
  stdin: string;
  expected: string;
  label: string;
  tolerance?: number;
  harness?: string;
  fixtures?: SourceFiles;
  args?: string[];
}
export interface Exercise {
  language?: Language;
  id: string;
  version: number;
  lessonId: string;
  prerequisites: string[];
  objective: string;
  type: Assessment;
  prompt: string;
  starter: SourceFiles;
  allowedInputs: string;
  examples: Case[];
  tests: Case[];
  hints: [string, string, string];
  solution: SourceFiles;
  explanation: string;
  concepts: string[];
  prediction?: { question: string; answer: string; explanation: string };
}
export interface Lesson {
  id: string;
  version: number;
  moduleId: string;
  title: string;
  objective: string;
  prerequisites: string[];
  minutes: number;
  concepts: string[];
  explanation: string[];
  workedExample: SourceFiles;
  workedExampleInput?: {
    stdin: string;
    fixtures?: SourceFiles;
    args?: string[];
  };
  walkthrough: string[];
  prediction: { question: string; answer: string; explanation: string };
  recap: string;
  retrieval: { question: string; answer: string };
  exerciseIds: string[];
  visualization?: "loop" | "array" | "pointer" | "function";
  checkpoint?: boolean;
  brokenExample?: boolean;
}
export interface Module {
  id: string;
  title: string;
  objective: string;
  prerequisites: string[];
  lessonIds: string[];
}
export interface Project {
  id: string;
  title: string;
  brief: string;
  prerequisites: string[];
  starter: SourceFiles;
  milestones: {
    id: string;
    title: string;
    requirements: string[];
    exerciseId: string;
  }[];
  rubric: string[];
  reference: SourceFiles;
  explanation: string[];
  checks?: Case[];
  referenceInput?: { stdin: string; fixtures?: SourceFiles; args?: string[] };
}
export interface Reference {
  id: string;
  title: string;
  body: string;
  example: string;
  lessonId: string;
  tags: string[];
}
export interface Curriculum {
  version: number;
  course: { id: string; title: string; standard: string };
  modules: Module[];
  lessons: Lesson[];
  exercises: Exercise[];
  projects: Project[];
  references: Reference[];
}
export type PublicExercise = Omit<
  Exercise,
  "solution" | "tests" | "prediction" | "explanation" | "hints"
> & { prediction?: { question: string } };
export type PublicLesson = Omit<Lesson, "prediction" | "retrieval"> & {
  prediction: { question: string };
  retrieval: { question: string };
};
