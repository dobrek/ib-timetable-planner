  -- ============================================================================
  -- A. SCHEMA SANITY (items 2.1 / 2.2)
  -- ============================================================================
  
  -- A1. catalog_hash column exists and is nullable text  -- expect: 1 row, text, YES
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'course_groupings' AND column_name = 'catalog_hash';
  
  -- A2. RPC exists and is SECURITY INVOKER (not DEFINER)  -- expect: is_security_definer = f
  SELECT p.proname,
         p.prosecdef AS is_security_definer,
         pg_get_function_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'replace_cohort_groupings';

  
  -- ============================================================================
  -- B. SEED ROW COUNTS match the dp2 CSV fixtures (item 2.6)
  --    Compare against: 35 students, 280 choices, 44 courses, 8 overlaps, 4 merges
  -- ============================================================================
  SELECT 'courses'         AS entity, count(*) AS n
    FROM courses c JOIN cohorts co ON co.id = c.cohort_id
    WHERE co.name = 'Diploma Programme Year 2'                              -- expect 44
  UNION ALL
  SELECT 'students', count(*)
    FROM students s JOIN cohorts co ON co.id = s.cohort_id
    WHERE co.name = 'Diploma Programme Year 2'                              -- expect 35
  UNION ALL
  SELECT 'student_choices', count(*)
    FROM student_choices sc
    JOIN students s ON s.id = sc.student_id
    JOIN cohorts co ON co.id = s.cohort_id
    WHERE co.name = 'Diploma Programme Year 2'                              -- expect 280
  UNION ALL
  SELECT 'course_overlaps', count(*)
    FROM course_overlaps o
    JOIN courses c ON c.id = o.base_course_id
    JOIN cohorts co ON co.id = c.cohort_id
    WHERE co.name = 'Diploma Programme Year 2'                              -- expect 8
  UNION ALL
  SELECT 'course_merges', count(*)
    FROM course_merges m
    JOIN courses c ON c.id = m.parent_course_id
    JOIN cohorts co ON co.id = c.cohort_id
    WHERE co.name = 'Diploma Programme Year 2';                             -- expect 4
  
  
  -- ============================================================================
  -- C. OVERLAP DIRECTION (item 2.8) — base receives dependent's students.
  --    Each row should read base <- dependent, matching data/dp2/subjects_overlap.csv
  --    where col0-2 (subject) is base and col3-5 (overlap) is dependent.
  --    e.g. English_A-SL  <-  English_A-HL
  -- ============================================================================
  SELECT replace(concat_ws('-', b.name, nullif(b.level,'none'), nullif(b.group_index,0)::text), ' ', '_') AS base_receives,
         replace(concat_ws('-', d.name, nullif(d.level,'none'), nullif(d.group_index,0)::text), ' ', '_') AS from_dependent
  FROM course_overlaps o
  JOIN courses b ON b.id = o.base_course_id
  JOIN courses d ON d.id = o.dependent_course_id
  JOIN cohorts co ON co.id = b.cohort_id
  WHERE co.name = 'Diploma Programme Year 2'
  ORDER BY base_receives;
  
  -- C2. Concrete effect: English_A-SL's effective roster = its own choosers
  --     UNIONed with English_A-HL's choosers (the dependent). Shows the union is
  --     strictly larger than either alone.  (own + dependent, deduped)
  WITH y2 AS (SELECT id FROM cohorts WHERE name = 'Diploma Programme Year 2'),
  sl AS (SELECT id FROM courses WHERE cohort_id = (SELECT id FROM y2)
           AND name='English A' AND level='SL' AND group_index=0),
  hl AS (SELECT id FROM courses WHERE cohort_id = (SELECT id FROM y2)
           AND name='English A' AND level='HL' AND group_index=0)
  SELECT
    (SELECT count(*) FROM student_choices WHERE course_id = (SELECT id FROM sl)) AS direct_sl,
    (SELECT count(*) FROM student_choices WHERE course_id = (SELECT id FROM hl)) AS direct_hl,
    (SELECT count(DISTINCT student_id) FROM student_choices
       WHERE course_id IN ((SELECT id FROM sl),(SELECT id FROM hl)))           AS effective_sl_roster;
  -- expect effective_sl_roster = |direct_sl ∪ direct_hl|  (≥ max(direct_sl, direct_hl))

  
  -- ============================================================================
  -- D. PERSISTED GROUPINGS (item 2.7)
  -- ============================================================================

  -- D1. Counts + a single catalog_hash  -- expect groupings=491, members=2141, hashes=1
  SELECT count(*)                          AS groupings,
         count(DISTINCT cg.catalog_hash)   AS distinct_hashes,
         count(*) FILTER (WHERE cg.catalog_hash IS NULL) AS null_hashes  -- expect 0
  FROM course_groupings cg
  JOIN cohorts co ON co.id = cg.cohort_id
  WHERE co.name = 'Diploma Programme Year 2';

  SELECT count(*) AS member_rows
  FROM course_grouping_members m
  JOIN course_groupings cg ON cg.id = m.grouping_id
  JOIN cohorts co ON co.id = cg.cohort_id
  WHERE co.name = 'Diploma Programme Year 2';                              -- expect 2141

  -- D2. Coverage/score are sane (positive, scores in 0..1)  -- expect min_cov>0, scores in range
  SELECT min(coverage_count) AS min_cov, max(coverage_count) AS max_cov,
         min(score) AS min_score, max(score) AS max_score
  FROM course_groupings cg
  JOIN cohorts co ON co.id = cg.cohort_id
  WHERE co.name = 'Diploma Programme Year 2';
  
  -- D3. No empty groupings (every grouping has ≥1 member)  -- expect 0
  SELECT count(*) AS empty_groupings
  FROM course_groupings cg
  JOIN cohorts co ON co.id = cg.cohort_id
  LEFT JOIN course_grouping_members m ON m.grouping_id = cg.id
  WHERE co.name = 'Diploma Programme Year 2' AND m.grouping_id IS NULL;
  
  -- D4. Dedup held: no two groupings share an identical member-set  -- expect 0 rows
  SELECT member_set, count(*) AS dupes
  FROM (
    SELECT m.grouping_id, array_agg(m.course_id ORDER BY m.course_id) AS member_set
    FROM course_grouping_members m
    JOIN course_groupings cg ON cg.id = m.grouping_id
    JOIN cohorts co ON co.id = cg.cohort_id
    WHERE co.name = 'Diploma Programme Year 2'
    GROUP BY m.grouping_id
  ) x
  GROUP BY member_set
  HAVING count(*) > 1;

  -- D5. GOLDEN SPOT-CHECK — the golden file's top row is
  --     "35,0.89,English_A-SL,English_B-HL-1,English_B-HL-2".
  --     This finds the persisted grouping with exactly those 3 members.
  --     -- expect: coverage_count=35, score=0.89
  SELECT cg.coverage_count, cg.score,
         array_agg(replace(concat_ws('-', c.name, nullif(c.level,'none'), nullif(c.group_index,0)::text), ' ', '_')
                   ORDER BY 1) AS members
  FROM course_groupings cg
  JOIN cohorts co ON co.id = cg.cohort_id
  JOIN course_grouping_members m ON m.grouping_id = cg.id
  JOIN courses c ON c.id = m.course_id
  WHERE co.name = 'Diploma Programme Year 2'
  GROUP BY cg.id, cg.coverage_count, cg.score
  HAVING array_agg(replace(concat_ws('-', c.name, nullif(c.level,'none'), nullif(c.group_index,0)::text), ' ', '_')
                   ORDER BY 1)
         = ARRAY['English_A-SL','English_B-HL-1','English_B-HL-2'];
  
  -- D6. Human-readable top groupings by coverage (composite member names)
  SELECT cg.coverage_count, cg.score,
         string_agg(replace(concat_ws('-', c.name, nullif(c.level,'none'), nullif(c.group_index,0)::text), ' ', '_'),
                    ', ' ORDER BY 1) AS members
  FROM course_groupings cg
  JOIN cohorts co ON co.id = cg.cohort_id
  JOIN course_grouping_members m ON m.grouping_id = cg.id
  JOIN courses c ON c.id = m.course_id
  WHERE co.name = 'Diploma Programme Year 2'
  GROUP BY cg.id, cg.coverage_count, cg.score
  ORDER BY cg.coverage_count DESC, cg.score DESC
  LIMIT 10;