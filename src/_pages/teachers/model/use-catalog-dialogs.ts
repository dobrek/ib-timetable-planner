import { useState } from "react";
import type { TeacherRow } from "./teacher";

export type TeacherDialogState = {
  formOpen: boolean;
  formTeacher: TeacherRow | null;
  openCreate: () => void;
  openEdit: (teacher: TeacherRow) => void;
  closeForm: () => void;

  deleteTarget: TeacherRow | null;
  openDelete: (teacher: TeacherRow) => void;
  closeDelete: () => void;
};

/**
 * Owns which teacher catalog dialog is open and its target row.
 */
export function useCatalogDialogs(): TeacherDialogState {
  const [formOpen, setFormOpen] = useState(false);
  const [formTeacher, setFormTeacher] = useState<TeacherRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeacherRow | null>(null);

  const openCreate = () => {
    setFormTeacher(null);
    setFormOpen(true);
  };

  const openEdit = (teacher: TeacherRow) => {
    setFormTeacher(teacher);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
  };

  const openDelete = (teacher: TeacherRow) => {
    setDeleteTarget(teacher);
  };

  const closeDelete = () => {
    setDeleteTarget(null);
  };

  return {
    formOpen,
    formTeacher,
    openCreate,
    openEdit,
    closeForm,
    deleteTarget,
    openDelete,
    closeDelete,
  };
}
