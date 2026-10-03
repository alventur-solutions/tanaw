terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "${var.project_name}-${var.environment}"

  frontend_bucket_name = "${local.name}-${data.aws_caller_identity.current.account_id}-${var.aws_region}"

  deploy_iot_lambda = var.iot_lambda_zip_path != null && trimspace(var.iot_lambda_zip_path) != ""
  deploy_api_lambda = var.api_lambda_image_uri != null && trimspace(var.api_lambda_image_uri) != ""

  api_cors_origins = length(var.api_cors_origins) > 0 ? var.api_cors_origins : [
    "https://${aws_cloudfront_distribution.frontend.domain_name}"
  ]

  common_tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }, var.tags)
}
