---
change_id: architecture-refactor
title: Architecture refactor
status: preparing
created: 2026-06-08
updated: 2026-06-09
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

The project is in its early phase. There is an initial setup for the core elements. UI components, CURD functionalities (course), Core business features (planner, auth). There is a working skeleton for the pages and navigations. Infrastructure elements are in place. Database integration is settle. Authentication flow works. CI process is working as well. Unit test and integration test are provided.

Unfortunately, the current state seems to be a bit of a caustic. There is a lot of generated code and mixed convention. 
Problems that we noticed so far
- Leaks between layers (function for fecthing data from database inside page component)
- UI elements on the same folder level as the features
- Lib folder as a generic bucket for utilities, apis calls, domain
- Astro Actions, APIs Combining HTML requests with database logic
...

We are looking for fixing those smells, By applying a proper and mature convention so the new modules and new features will follow the well-defined standards.

reference links
Feature-Sliced Design (https://fsd.how/docs/llms/) skill aviable with /feature-sliced-design command
shadcn https://ui.shadcn.com/
Astro https://docs.astro.build/
