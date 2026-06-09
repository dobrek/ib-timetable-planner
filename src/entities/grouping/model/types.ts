export type GroupingCourse = {
  id: string;
  teacherKey: string | null;
  studentKeys: string[];
  hours: number;
};

export type GroupingVariant = {
  size: number;
  coverageCount: number;
  rank: number;
  score: number;
  memberIds: string[];
};

export type GroupingResult = {
  seedId: string;
  variants: GroupingVariant[];
};

export type ComputeWarning = {
  courseId: string;
  kind: "no-teacher" | "no-students" | "zero-hours";
  message: string;
};

/** A palette hint box: a deduped member-set read from `course_groupings`. */
export type PlannerGrouping = {
  id: string;
  memberIds: string[];
  coverageCount: number;
  score: number;
};
