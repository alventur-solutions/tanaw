# Requirements: Infrastructure and Deploy

Status: draft
Owner: TANAW
Related code: `infra/versions.tf`, `storage.tf`, `lambdas.tf`, `variables.tf`,
`outputs.tf`, `dev.tfvars.example`, `infra/README.md`

## Problem statement

TANAW needs AWS hosting for the static frontend and public HTTPS endpoints for the
API and IoT ingest, provisioned reproducibly with Terraform. The stack must stand
up before application artifacts exist (image, zip), and keep the frontend bucket
private behind CloudFront.

## Goals

- A private, versioned, encrypted S3 bucket for the frontend, served only through
  CloudFront with Origin Access Control.
- An ECR repository for the API container image.
- Optional IoT and API Lambdas, each with a public HTTPS Function URL, created only
  once their artifacts are provided.
- Clear outputs so operators know where to push the image, upload the site, and
  find the Function URLs.

## Non-goals

- Building or uploading application artifacts (image, zip, site files); Terraform
  provisions infrastructure only.
- A remote state backend in this iteration (local state for now).
- Granting the Lambda roles permissions beyond trust (handlers validate access
  themselves; roles start permission-less).

## User stories

1. As an operator, I want `terraform apply` to create the frontend hosting and ECR
   before any code is built.
2. As an operator, I want to set the API image and IoT zip later and apply again to
   create the Lambdas and their Function URLs.
3. As a client, I want the API Function URL to allow browser CORS from the
   CloudFront origin by default.

## Functional requirements

- FR1: The stack SHALL create a private S3 bucket (public access blocked,
  versioning on, AES256 encryption, `force_destroy = false`).
- FR2: The stack SHALL create a CloudFront distribution with Origin Access Control,
  redirect-to-HTTPS, and SPA-style 403/404 to `/index.html`.
- FR3: The bucket policy SHALL allow read only to this CloudFront distribution.
- FR4: The stack SHALL create an ECR repository for the API image (immutable tags,
  scan on push, keep last 20 images).
- FR5: The IoT Lambda and its Function URL SHALL be created only when
  `iot_lambda_zip_path` is set (`main.handler`, zip package).
- FR6: The API Lambda and its Function URL SHALL be created only when
  `api_lambda_image_uri` is set (container image).
- FR7: Both Function URLs SHALL use `authorization_type = NONE`; the API URL SHALL
  set CORS to `api_cors_origins`, defaulting to this stack's CloudFront domain.
- FR8: Outputs SHALL expose `frontend_bucket_name`, `frontend_url`,
  `frontend_distribution_id`, `api_ecr_repository_url`, the two role ARNs, and the
  two Function URLs (null until artifacts exist).

## Non-functional requirements

- NFR1 (least privilege): Lambda execution roles SHALL start with trust only and no
  attached permissions.
- NFR2 (two-phase apply): The stack SHALL apply cleanly with artifact inputs null,
  then again once they are set.
- NFR3 (naming/validation): Resource names SHALL derive from
  `project_name`-`environment`-account-region; inputs SHALL be validated.
- NFR4 (state hygiene): `terraform.tfstate` SHALL be kept out of version control;
  `terraform destroy` SHALL NOT empty the frontend bucket (force_destroy disabled).

## Acceptance criteria

- AC1: `terraform apply -var-file=dev.tfvars` with null artifacts creates the
  bucket, CloudFront, ECR, and the two permission-less roles.
- AC2: The frontend bucket is private; the site is reachable only via the
  CloudFront `frontend_url`.
- AC3: Setting `api_lambda_image_uri` and applying creates the API Lambda and its
  Function URL; the URL is then non-null in outputs.
- AC4: Setting `iot_lambda_zip_path` and applying creates the IoT Lambda and its
  Function URL.
- AC5: The API Function URL allows browser requests from the CloudFront origin by
  default.
