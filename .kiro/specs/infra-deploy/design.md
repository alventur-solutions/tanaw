# Design: Infrastructure and Deploy

Status: draft
Traces: requirements.md (FR1-FR8, NFR1-NFR4)

## Overview

Terraform (AWS provider ~> 6, Terraform >= 1.6) provisions a private frontend
bucket, a CloudFront distribution, an ECR repository, and optional IoT and API
Lambdas with direct Function URLs. Application artifacts are built and uploaded
outside Terraform.

## Resources

- Frontend (`storage.tf`): `aws_s3_bucket` (private, versioned, AES256,
  `force_destroy = false`); `aws_s3_bucket_public_access_block` (all blocked);
  `aws_cloudfront_origin_access_control`; `aws_cloudfront_distribution`
  (OAC origin, redirect-to-HTTPS, compress, 403/404 -> `/index.html`,
  PriceClass_100, default cert); `aws_s3_bucket_policy` allowing `s3:GetObject`
  only from this distribution ARN (FR1-FR3).
- API image (`lambdas.tf`): `aws_ecr_repository` (immutable tags, scan on push)
  with a lifecycle policy keeping the last 20 images (FR4).
- IoT Lambda (`lambdas.tf`): `count = deploy_iot_lambda`; `python3.12`,
  `handler = main.handler`, zip package; `aws_lambda_function_url` with
  `authorization_type = NONE` (FR5, FR7).
- API Lambda (`lambdas.tf`): `count = deploy_api_lambda`; `package_type = Image`
  from `api_lambda_image_uri`; `aws_lambda_function_url` with CORS to
  `api_cors_origins` (FR6, FR7).
- Roles: `iot_lambda` and `api_lambda` assume-role only, no policies attached
  (NFR1).

## Inputs (variables.tf, dev.tfvars.example)

- `aws_region` (default ap-southeast-1), `project_name` (default tanaw),
  `environment` (default dev), both validated.
- `iot_lambda_zip_path` and `api_lambda_image_uri`: null until artifacts exist;
  their presence gates the Lambdas via `deploy_iot_lambda` / `deploy_api_lambda`
  locals (NFR2).
- `api_cors_origins`: defaults to `[https://<cloudfront domain>]`.
- Memory/timeout knobs for both Lambdas, validated to AWS limits.

## Naming and outputs

- `local.name = "<project>-<environment>"`; bucket name adds account id and region
  (NFR3).
- Outputs (FR8): `frontend_bucket_name`, `frontend_url`,
  `frontend_distribution_id`, `api_ecr_repository_url`, the two role ARNs, and
  `iot_function_url` / `api_function_url` (via `try(..., null)` until created).

## Deploy workflow

```
cp dev.tfvars.example dev.tfvars
terraform init
terraform plan  -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars        # phase 1: bucket, CloudFront, ECR, roles

# build and push the API image to api_ecr_repository_url; build the IoT zip
# set api_lambda_image_uri and iot_lambda_zip_path in dev.tfvars
terraform apply -var-file=dev.tfvars        # phase 2: Lambdas + Function URLs

# upload the static site
pnpm --dir ../client build
aws s3 sync ../client/out "s3://$(terraform output -raw frontend_bucket_name)/" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform output -raw frontend_distribution_id)" --paths '/*'
```

## Decisions

- D1: Infrastructure and artifacts are separate. Terraform never builds code, so the
  stack can exist before the image/zip and apply is deterministic.
- D2: Function URLs with `NONE` auth, not API Gateway, for a direct public HTTPS
  endpoint; the handlers must validate device/API access themselves.
- D3: Private bucket + CloudFront OAC so the site is never publicly listable; SPA
  error mapping serves `/index.html` for client-side routes.
- D4: Permission-less roles by default; attach only what a handler needs when it is
  implemented (NFR1).

## Risks

- R1: `NONE` auth means anyone with a Function URL can call it. Mitigate with the
  IoT bearer token and server-side validation (see iot-station-ingest spec).
- R2: Local state is not safe for sharing; configure a remote backend with locking
  before team or production use (NFR4).
- R3: The IoT Lambda needs a real `main.handler` that writes to Neon; none exists in
  the repo yet (tracked in the iot-station-ingest spec, OQ1).
