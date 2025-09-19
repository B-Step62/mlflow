# MLflow Home Landing Page Spec

**Document owner:** Yuki Watanabe
**Drafted:** September 19, 2025
**Target release:** MLflow 3.5 (tentative)

## Overview
Introduce a new landing experience at the root MLflow route (`/`) that welcomes users, highlights major workflows, and accelerates activation for first-time and returning users. The page will live in the web UI, leaving existing deep links intact.

## Background
Currently `http://localhost:5000/` routes directly to the Experiments list. As MLflow spans experiments, traces, evaluations, and prompts, users—especially new ones—lack guidance on where to start. Design mocks (`.design/MLflow Landing.png`) and competitive reference (`.design/Opik.png`) show a richer home that frames capabilities and latest activity. This spec captures the requirements to ship that experience.

## Goals and Success Metrics
- Help users discover core workflows and onboarding guides.
- Surface recent experiment activity for quick resumption.
- Promote MLflow updates and announcements.

## Non-Goals
- Redesigning experiment detail, model registry, or prompts pages.
- Introducing new backend APIs or authentication flows.
- Changing existing REST contracts or routing outside the new home page.

## Users and Use Cases
- New practitioners installing MLflow locally seeking guidance.
- Returning users expanding into GenAI-centric features (traces, evaluations, prompts).
- Workspace owners monitoring recent activity and feature adoption.

Primary use cases: onboarding (understanding next steps), resuming work (jumping to recent experiments), staying informed (announcements and docs links).

## In-Scope Functionality
- Add a React route at `RoutePaths.home` registered as `PageId.home`, rendered when visiting `/`.
- Hero section with "Welcome to MLflow".
- Four "Get started" cards (Log traces, Run evaluation, Train models, Register prompts) with iconography, short description, analytics IDs, and configurable link targets.
- The cards are clickable and navigate to the corresponding page,which can be either another page in the MLflow UI or an external link.
- Condensed experiments table showing the five most recently modified experiments, matching existing column definitions (Name, Time created, Last modified, Description) and linking into experiment detail pages.
- Persistent "See all experiments" link directing to `/experiments`.
- "Explore news" section rendering four announcement cards with thumbnail, title, description, and CTA (supporting internal or external links).
- Loading skeletons for hero cards and experiments table; table empty state with CTA to create first experiment.
- Clicking MLflow logo or "Home" (new) in the sidebar navigates to the home page.

## Out-of-Scope Items
- User-personalized recommendation algorithms.
- New backend pagination or caching behavior.
- Server-rendered CMS integration.
- Mobile-specific breakpoints below 768px beyond standard responsive behavior.
- i18n support.

## Experience Design
- Layout follows `.design/MLflow Landing.png`. Side navigation gains a top-level "Home" item (icon TBD); `Experiments` remains second.
- Hero copy: "Welcome to MLflow". Quick actions arranged horizontally with hover affordances and accessible focus rings.
- Experiments section defaults to descending last modified order; rows clickable. Empty state text: "Create your first experiment to start tracking ML workflows."
- News cards arranged in a four-card grid; include fallback alt text and open external links in a new tab.
- Global header (GitHub, Docs, settings) remains unchanged.
- Provide anchor targets for skip links and ensure keyboard navigation order is logical.

## Content Strategy
- Copy uses verbs that map to MLflow workflows (Log, Run, Train, Register).
- Card descriptions capped at 100 characters to avoid wrapping.
- News data stored in `mlflow/server/js/src/home/news-items.ts` as a curated array with `id`, `title`, `description`, `imageSrc`, `link`, and `linkType` (internal/external).
- Images stored under `mlflow/server/js/src/home/assets`, optimized to <200 KB WebP.

## Technical Approach
- Create `mlflow/server/js/src/home/HomePage.tsx` composed of existing shared components (`Card`, `SimpleTable`, `LoadingSpinner`).
- Extend `mlflow/server/js/src/experiment-tracking/routes.ts` with `PageId.home` and `RoutePaths.home = '/'`.
- Update `experiment-tracking/route-defs.ts` to register the new route via `createLazyRouteElement(() => import('../home/HomePage'))`.
- Add a Redux selector (e.g., `homeSelectors.latestExperiments`) that reuses `ExperimentListView` fetch logic but limits results client-side to the top three entries to avoid new backend endpoints.

## References
- `.design/MLflow Landing.png` (primary mock)  
- `.design/Opik.png` (competitive reference)  
- `mlflow/server/js/src/experiment-tracking/route-defs.ts`, `.../routes.ts` (existing routing)  
- `mlflow/server/js/src/experiment-tracking/components/ExperimentListView.tsx` (table patterns)
