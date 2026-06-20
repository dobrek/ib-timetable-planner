import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GroupingCourse } from "../../model/grouping";
import { groupBy, unique } from "@/shared/lib/collections";

export const loadFixtureCourses = (dir: string): GroupingCourse[] => {
  const studentRows = parseCSV(join(dir, "students_subjects.csv"));
  const teacherRows = parseCSV(join(dir, "teachers_subjects.csv"));
  const overlapRows = parseCSV(join(dir, "subjects_overlap.csv"));
  const mergeRows = parseCSV(join(dir, "merge_subjects.csv"));

  const studentChoices = studentRows.map((row) => ({
    student: row[0],
    subject: subjectName(row[1], row[2], row[3]),
  }));

  const metaList = teacherRows.map((row) => ({
    subject: subjectName(row[1], row[2], row[3]),
    teacher: row[0],
    hours: Number(row[4]) || 0,
  }));

  const overlapList = overlapRows.map((row) => ({
    subject: subjectName(row[0], row[1], row[2]),
    overlap: subjectName(row[3], row[4], row[5]),
  }));

  const mergeList = mergeRows.map((row) => ({
    subject: subjectName(row[0], row[1]),
    merge: subjectName(row[2], row[3]),
  }));

  const bySubject = groupBy(studentChoices, ({ subject }) => subject);

  const allStudentsFor = (subject: string): string[] => (bySubject.get(subject) ?? []).map(({ student }) => student);

  const overlapsFor = (subject: string): string[] =>
    overlapList.filter((r) => r.subject === subject).map((r) => r.overlap);

  // A subject may have multiple teacher rows (co-teaching) — collect the whole set.
  const teachersFor = (subject: string): string[] =>
    metaList.filter((m) => m.subject === subject).map((m) => m.teacher);

  const courses: GroupingCourse[] = [...bySubject].map(([key, values]) => {
    const studentKeys = unique(values.map(({ student }) => student).concat(overlapsFor(key).flatMap(allStudentsFor)));
    const meta = metaList.find((m) => m.subject === key);
    return { id: key, teacherKeys: teachersFor(key), studentKeys, hours: meta?.hours ?? 0 };
  });

  const virtualCourses: GroupingCourse[] = [...groupBy(mergeList, ({ subject }) => subject)].map(([key, values]) => {
    const meta = metaList.find((m) => m.subject === key);
    return {
      id: key,
      teacherKeys: teachersFor(key),
      studentKeys: values.flatMap(({ merge }) => allStudentsFor(merge)),
      hours: meta?.hours ?? 0,
    };
  });

  return [...courses, ...virtualCourses];
};

const subjectName = (subject: string, level?: string, group?: string): string =>
  [subject, level, group].filter(Boolean).join("-").replaceAll(/ /g, "_");

const parseCSV = (filePath: string): string[][] =>
  readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(",").map((cell) => cell.trim()));
