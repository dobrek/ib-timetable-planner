  SELECT t.code, c.name,
    CASE WHEN c.level='none' THEN '' ELSE c.level END        AS level,
    CASE WHEN c.group_index=0 THEN '' ELSE c.group_index::text END AS group_index,
    c.hours_per_week
  FROM courses c
  JOIN teachers t ON t.id = c.teacher_id
  WHERE c.cohort_id = (SELECT id FROM cohorts WHERE name='Diploma Programme Year 1')
  ORDER BY t.code, c.name, c.level, c.group_index;
  