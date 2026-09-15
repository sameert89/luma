# Stage 3
- Was able to successfully run the project, although clearer instructions towards the front of the README would be appreciated, had to run asp net core backend and frontend separately
- Could not verify docker, no Dockerfiles/docker-compose.yaml was found
- The ui was verified on desktop and mobile
- Do not like the font being used, roboto or inter would be preferred, maybe this needs to be added in product requirements
- Svgs are manually drawn which makes it a nighmare to maintain, a dependency could be justifiable here
- Did not find git tracking being done periodically

## Addressed in stages 4–5

- Added a Docker quick start at the front of README plus a single-service Dockerfile and Compose configuration.
- Rewrote local development startup as two numbered terminals and explained why both processes run.
- Switched the interface to locally bundled Inter and recorded it in the product contract.
- Replaced maintained SVG path markup with Lucide React icons.
- Added checkpoint commits after the stage 3 baseline and stage 4 backend before continuing the UI and verification work.
