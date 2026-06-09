import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { CourseRow } from "./course";

export type CatalogDialogState = {
  formOpen: boolean;
  formCourse: CourseRow | null;
  openCreate: () => void;
  openEdit: (course: CourseRow) => void;
  closeForm: () => void;

  deleteTarget: CourseRow | null;
  openDelete: (course: CourseRow) => void;
  closeDelete: () => void;

  overlapCourse: CourseRow | null;
  openOverlaps: (course: CourseRow) => void;
  closeOverlaps: () => void;

  mergeOpen: boolean;
  openMergeBuilder: () => void;
  closeMergeBuilder: () => void;

  mergeManageCourse: CourseRow | null;
  openMergeManage: (course: CourseRow) => void;
  closeMergeManage: () => void;

  coursesById: Map<string, CourseRow>;
  updateOverlaps: (courseId: string, nextOverlaps: string[]) => void;
};

/**
 * Owns which catalog dialog is open and its target row. Also exposes the shared
 * `coursesById` lookup and the in-memory overlap update path.
 */
export function useCatalogDialogs(
  courses: CourseRow[],
  setCourses: Dispatch<SetStateAction<CourseRow[]>>,
): CatalogDialogState {
  const [formOpen, setFormOpen] = useState(false);
  const [formCourse, setFormCourse] = useState<CourseRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseRow | null>(null);
  const [overlapTargetId, setOverlapTargetId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeManageTargetId, setMergeManageTargetId] = useState<string | null>(null);

  const coursesById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const overlapCourse = overlapTargetId !== null ? (coursesById.get(overlapTargetId) ?? null) : null;
  const mergeManageCourse = mergeManageTargetId !== null ? (coursesById.get(mergeManageTargetId) ?? null) : null;

  const openCreate = () => {
    setFormCourse(null);
    setFormOpen(true);
  };

  const openEdit = (course: CourseRow) => {
    setFormCourse(course);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
  };

  const openDelete = (course: CourseRow) => {
    setDeleteTarget(course);
  };

  const closeDelete = () => {
    setDeleteTarget(null);
  };

  const openOverlaps = (course: CourseRow) => {
    setOverlapTargetId(course.id);
  };

  const closeOverlaps = () => {
    setOverlapTargetId(null);
  };

  const openMergeBuilder = () => {
    setMergeOpen(true);
  };

  const closeMergeBuilder = () => {
    setMergeOpen(false);
  };

  const openMergeManage = (course: CourseRow) => {
    setMergeManageTargetId(course.id);
  };

  const closeMergeManage = () => {
    setMergeManageTargetId(null);
  };

  const updateOverlaps = (courseId: string, nextOverlaps: string[]) => {
    setCourses((current) =>
      current.map((course) => (course.id === courseId ? { ...course, overlaps: nextOverlaps } : course)),
    );
  };

  return {
    formOpen,
    formCourse,
    openCreate,
    openEdit,
    closeForm,
    deleteTarget,
    openDelete,
    closeDelete,
    overlapCourse,
    openOverlaps,
    closeOverlaps,
    mergeOpen,
    openMergeBuilder,
    closeMergeBuilder,
    mergeManageCourse,
    openMergeManage,
    closeMergeManage,
    coursesById,
    updateOverlaps,
  };
}
