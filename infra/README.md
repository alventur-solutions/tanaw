# TANAW AWS infrastructure

Terraform provisions the frontend bucket and CloudFront distribution, the API
ECR repository, and optionally the two Lambda deployments and their direct
Function URLs. It does not build or upload application artifacts.

## Resources

- Private S3 bucket with versioning and server-side encryption for frontend files.
- CloudFront distribution with Origin Access Control; the bucket stays private.
- Next.js frontend deployed as static files. Configure `output: "export"` and
  run `pnpm build` from `client/` to produce `client/out/`.
- ECR repository for the API Lambda container image.
- Optional IoT Lambda using a Python zip package and `receiver.handler`.
- Optional API Lambda using a pushed Lambda-compatible container image.
- One direct Lambda Function URL per function. No API Gateway is used.
- Separate IoT and API execution roles. The IoT role can write CloudWatch Logs;
  both roles exist after the first apply, before code is deployed.

Both Function URLs use `NONE` authentication so the IoT device and browser can
call them directly over HTTPS. The IoT receiver checks its bearer token when
configured. Without one, ingest requests are unauthenticated.
The API URL only allows browser CORS requests from the CloudFront domain by
default. CORS does not restrict non-browser clients.

The Next.js site is static at runtime. It can load baked, read-only data from its
own static JSON assets and call the API Function URL from the browser for live
sensor readings and on-demand analysis. Keep dynamic API handling in the API
Lambda; static export does not run a Next.js server.

## Prerequisites

- Terraform 1.6 or later.
- AWS credentials configured for an account with permissions to manage the
  resources above.
- A Lambda-compatible IoT zip before creating its Function URL. Build it from
  the repository root with `./.venv/bin/python scripts/build_iot_lambda.py`. The script
  prints the path to use for `iot_lambda_zip_path` and excludes `.env` files.
- The Neon pooled URL supplied as the sensitive `iot_database_url` value when
  deploying the zip. `iot_station_token` is optional.
- A built and pushed API image before creating the API Lambda. The image must
  target `linux/amd64` and implement the Lambda Runtime API, for example by
  using an AWS Lambda base image.

## Deploy

From this directory:

```sh
cp dev.tfvars.example dev.tfvars
terraform init
terraform plan -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars
```

The first apply creates the frontend hosting, CloudFront, and ECR repository.
The Lambda functions and Function URLs are omitted until their artifact inputs
are set. Push the API image to the `api_ecr_repository_url` output, build the
IoT zip, then set `api_lambda_image_uri`, `iot_lambda_zip_path`, and
`iot_database_url` in `dev.tfvars`, with `iot_station_token` only if you want
bearer-token checks, and apply again.
Run `alembic upgrade head` against Neon before enabling the receiver so the
raw water sensor columns are present.

Build the Next.js static export, upload `client/out/` to the bucket from
`frontend_bucket_name`, then open `frontend_url`:

```sh
pnpm --dir ../client build
aws s3 sync ../client/out "s3://$(terraform output -raw frontend_bucket_name)/" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform output -raw frontend_distribution_id)" \
  --paths '/*'
```

The client lives in `../client/`. Its browser API connection remains unset until
the API route and response schema are agreed.

## State and cleanup

Terraform uses its default local state for now. Keep `terraform.tfstate` out of
version control. Before sharing this stack or using it for production, configure
a remote state backend with locking and encryption. Sensitive Terraform
variables are masked in normal output but remain in state, so protect the local
state file. `terraform destroy` does not empty the frontend bucket because
`force_destroy` is disabled.
