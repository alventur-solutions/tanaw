# Tasks: Infrastructure and Deploy

Status: draft
Traces: requirements.md, design.md

Each task lists its demo and the requirements it covers.

## Task 1: Private frontend bucket + CloudFront
- [x] Private, versioned, encrypted S3; CloudFront with OAC and SPA error mapping.
- Covers: FR1, FR2, FR3; D3
- Files: `infra/storage.tf`
- Demo: `terraform apply` creates the bucket and distribution; bucket is private.
- Status: defined in Terraform.

## Task 2: ECR repository for the API image
- [x] Immutable tags, scan on push, keep last 20 images.
- Covers: FR4
- Files: `infra/lambdas.tf`
- Demo: `api_ecr_repository_url` output points to the repo.
- Status: defined.

## Task 3: Optional IoT and API Lambdas with Function URLs
- [x] Gated by artifact inputs; `NONE` auth; API CORS to CloudFront origin.
- Covers: FR5, FR6, FR7; D1, D2
- Files: `infra/lambdas.tf`, `infra/variables.tf`
- Demo: with artifacts null, no Lambdas; with them set, Lambdas + URLs appear.
- Status: defined.

## Task 4: Permission-less execution roles
- [x] Trust-only roles for both Lambdas.
- Covers: NFR1
- Files: `infra/lambdas.tf`
- Demo: role ARNs output; no policies attached.
- Status: defined.

## Task 5: Outputs and validated inputs
- [x] Outputs for bucket, URL, distribution, ECR, roles, Function URLs; validated
  variables.
- Covers: FR8, NFR3
- Files: `infra/outputs.tf`, `infra/variables.tf`, `infra/dev.tfvars.example`
- Demo: `terraform output` lists all values; invalid inputs are rejected.
- Status: defined.

## Task 6: Phase 1 apply (infrastructure only)
- [ ] Run `terraform init` and `apply` with artifact inputs null.
- Covers: AC1, NFR2
- Files: `infra/`
- Demo: bucket, CloudFront, ECR, and roles exist after apply.
- Status: pending an AWS apply.

## Task 7: Build and push the API image, provide the IoT zip
- [ ] Build a Lambda-compatible API container image (linux/amd64) and push to ECR;
  build the IoT zip with `main.handler` (writes to Neon).
- Covers: FR5, FR6; resolves infra side of iot-station-ingest OQ1
- Files: `api/` (image), IoT handler (to be written)
- Demo: image in ECR; zip ready; phase-2 apply creates both Lambdas.
- Status: pending; no IoT handler exists yet.

## Task 8: Deploy the static client and set CORS
- [ ] `pnpm build`, `aws s3 sync out/`, CloudFront invalidation; confirm API CORS.
- Covers: AC2, AC5
- Files: `client/`, `infra/`
- Demo: the CloudFront `frontend_url` serves the client and it loads live API data.
- Status: pending phase-1 apply and the API endpoint.

## Task 9: Remote state backend (before sharing/production)
- [ ] Configure a remote backend with locking and encryption; keep tfstate out of
  git.
- Covers: NFR4; R2 mitigation
- Files: `infra/`
- Demo: state stored remotely with locking.
- Status: pending; local state for now.
