import { readFileSync } from "node:fs";
import type {
  Curriculum,
  PublicLesson,
  PublicExercise,
  Exercise,
  Lesson,
} from "../shared/content.js";
export function loadContent(): Curriculum {
  return JSON.parse(
    readFileSync("content/curriculum.json", "utf8"),
  ) as Curriculum;
}
export function loadCourses(): Curriculum[] {
  const courses = [
    loadContent(),
    JSON.parse(
      readFileSync("content/cpp-curriculum.json", "utf8"),
    ) as Curriculum,
  ];
  for (const kind of [
    "modules",
    "lessons",
    "exercises",
    "projects",
    "references",
  ] as const) {
    const ids = courses.flatMap((course) =>
      course[kind].map((item) => item.id),
    );
    if (new Set(ids).size !== ids.length)
      throw new Error(`Duplicate ${kind} IDs across courses.`);
  }
  return courses;
}
export function publicLesson(l: Lesson): PublicLesson {
  return {
    ...l,
    prediction: { question: l.prediction.question },
    retrieval: { question: l.retrieval.question },
  };
}
export function publicExercise(e: Exercise): PublicExercise {
  const {
    tests: _,
    solution: __,
    explanation: ___,
    hints: ____,
    prediction,
    ...rest
  } = e;
  return {
    ...rest,
    ...(prediction ? { prediction: { question: prediction.question } } : {}),
  };
}
