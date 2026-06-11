import { useState } from "react";
import type { StudentRow } from "./student";

export type StudentDialogState = {
  formOpen: boolean;
  formStudent: StudentRow | null;
  openCreate: () => void;
  openEdit: (student: StudentRow) => void;
  closeForm: () => void;

  deleteTarget: StudentRow | null;
  openDelete: (student: StudentRow) => void;
  closeDelete: () => void;
};

/**
 * Owns which student catalog dialog is open and its target row.
 */
export function useCatalogDialogs(): StudentDialogState {
  const [formOpen, setFormOpen] = useState(false);
  const [formStudent, setFormStudent] = useState<StudentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentRow | null>(null);

  const openCreate = () => {
    setFormStudent(null);
    setFormOpen(true);
  };

  const openEdit = (student: StudentRow) => {
    setFormStudent(student);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
  };

  const openDelete = (student: StudentRow) => {
    setDeleteTarget(student);
  };

  const closeDelete = () => {
    setDeleteTarget(null);
  };

  return {
    formOpen,
    formStudent,
    openCreate,
    openEdit,
    closeForm,
    deleteTarget,
    openDelete,
    closeDelete,
  };
}
