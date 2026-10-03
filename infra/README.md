# TANAW AWS infrastructure

Terraform creates the private dashboard bucket and CloudFront distribution, an
ECR repository for the API image, and optional Lambda deployments. It does not
build or publish application artifacts.

## Resources

- Private, versioned S3 bucket for the static React/Vite dashboard in `dashboard/`.
- CloudFront distribution with Origin Access Control. The bucket stays private.
- ECR repository and optional container-image Lambda for `api/`.
- Optional Python zip Lambda for the separate IoT receiver in `iot/server/receiver.py`.
- Public HTTPS Function URLs for the API and IoT receiver. `/ingest` is handled
  by the IoT receiver; the dashboard API serves study-area and project data.
- Separate Lambda execution roles with CloudWatch Logs permissions.

The API Function URL allows browser requests from the CloudFront hostname by
default. CORS controls browser access only; it does not authenticate other clients.
The IoT Function URL accepts a bearer token only when `iot_station_token` is set.

## Prerequisites

- Terraform 1.6 or later, AWS CLI v2, Docker with buildx, Node.js and npm.
- AWS credentials with permissions to manage the listed resources.
- A Neon pooled URL for `api_database_url`. Set it in `dev.tfvars` as a sensitive
  Terraform input. Run Alembic migrations with the direct URL before deploying
  the API image.

## Initial infrastructure

From this directory:

```sh
cp dev.tfvars.example dev.tfvars
terraform init
terraform plan -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars
```

With the artifact inputs left `null`, this creates the dashboard hosting and ECR
repository without creating either Lambda function.

## Build and deploy the API

From `infra/`, log in to the ECR registry and build a Lambda-compatible image
from the repository root. Use a unique tag because the repository rejects tag
overwrites:

```sh
REPO_URI="$(terraform output -raw api_ecr_repository_url)"
IMAGE_TAG="api-$(git -C .. rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)"
aws ecr get-login-password --region ap-southeast-1 \
  | docker login --username AWS --password-stdin "${REPO_URI%%/*}"
docker buildx build --platform linux/amd64 --provenance=false --push \
  -f ../api/Dockerfile -t "${REPO_URI}:${IMAGE_TAG}" ..
```

Set `api_lambda_image_uri` to `${REPO_URI}:${IMAGE_TAG}` and `api_database_url`
to the Neon pooled URL in `dev.tfvars`, then apply:

```sh
terraform plan -var-file=dev.tfvars
terraform apply -var-file=dev.tfvars
```

The API image uses the AWS Python 3.12 Lambda base image and the `Mangum` ASGI
adapter. The database URL is injected as `DATABASE_URL`; it is not copied into
the image. The dashboard reads metric rows already stored in Neon. The API's
on demand `/analyze` route still uses an in-process FastAPI background task and
requires Earth Engine credentials; do not rely on that route in Lambda until a
separate worker and its credentials are configured.

## Build and publish the dashboard

Run this from the repository root after the API Function URL exists. The API URL
is compiled into the static dashboard bundle, so rebuild after changing it:

```sh
API_URL="$(terraform -chdir=infra output -raw api_function_url)"
npm ci --prefix dashboard
VITE_API_BASE_URL="$API_URL" npm run build --prefix dashboard
aws s3 sync dashboard/dist \
  "s3://$(terraform -chdir=infra output -raw frontend_bucket_name)/" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform -chdir=infra output -raw frontend_distribution_id)" \
  --paths '/*'
```

The local Vite development server keeps using its `/api` proxy to `localhost:8000`.
Production builds require `VITE_API_BASE_URL` and call the API Function URL
directly. The default API CORS origin is the CloudFront hostname.

## Database and IoT receiver

From the repository root, with `DATABASE_URL_DIRECT` set to the Neon direct URL:

```sh
./.venv/bin/python -m alembic upgrade head
```

The IoT receiver deploys separately from the API. Build its zip with
`./.venv/bin/python scripts/build_iot_lambda.py`, then set `iot_lambda_zip_path`
and `iot_database_url` in `dev.tfvars`. Set `iot_station_token` only when bearer
token checks are wanted.

## State and cleanup

Terraform uses local state. Keep `terraform.tfstate` out of version control and
protect it because sensitive variable values are stored there. Before sharing
this stack or using it for production, configure remote state with locking and
encryption. `terraform destroy` does not empty the dashboard bucket because
`force_destroy` is disabled.
