  SELECT s.full_name, c.name,
    CASE WHEN c.level='none' THEN '' ELSE c.level END        AS level,
    CASE WHEN c.group_index=0 THEN '' ELSE c.group_index::text END AS group_index
  FROM student_choices sc
  JOIN students s ON s.id = sc.student_id
  JOIN courses  c ON c.id = sc.course_id
  WHERE s.cohort_id = (SELECT id FROM cohorts WHERE name='Diploma Programme Year 1')
  ORDER BY s.full_name, c.name, c.level, c.group_index;