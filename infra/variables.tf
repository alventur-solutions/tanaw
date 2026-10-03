variable "aws_region" {
  description = "AWS region for Lambda, S3, ECR, and CloudFront resources."
  type        = string
  default     = "ap-southeast-1"
}

variable "project_name" {
  description = "Short lowercase project name used in resource names."
  type        = string
  default     = "tanaw"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,15}$", var.project_name))
    error_message = "project_name must be 2 to 16 lowercase letters, numbers, or hyphens and start with a letter."
  }
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,7}$", var.environment))
    error_message = "environment must be 1 to 8 lowercase letters, numbers, or hyphens and start with a letter."
  }
}

variable "iot_lambda_zip_path" {
  description = "Path to a prebuilt IoT Lambda zip containing receiver.handler. Leave null to provision the rest of the infrastructure first."
  type        = string
  default     = null
  nullable    = true
}

variable "iot_database_url" {
  description = "Neon pooled DATABASE_URL for the IoT receiver Lambda. Required when deploying the IoT zip."
  type        = string
  default     = null
  nullable    = true
  sensitive   = true
}

variable "iot_station_token" {
  description = "Optional bearer token for the public IoT Function URL. When unset, ingest requests are unauthenticated."
  type        = string
  default     = null
  nullable    = true
  sensitive   = true
}

variable "api_lambda_image_uri" {
  description = "URI of a pushed Lambda-compatible API container image in ECR. Leave null until the image has been pushed."
  type        = string
  default     = null
  nullable    = true
}

variable "api_database_url" {
  description = "Neon pooled DATABASE_URL for the API Lambda. Required when deploying the API image."
  type        = string
  default     = null
  nullable    = true
  sensitive   = true
}

variable "api_cors_origins" {
  description = "Optional explicit browser origins for the API Function URL. Defaults to this stack's CloudFront domain."
  type        = list(string)
  default     = []
}

variable "iot_memory_size" {
  description = "IoT receiver Lambda memory in MB."
  type        = number
  default     = 256

  validation {
    condition     = var.iot_memory_size >= 128 && var.iot_memory_size <= 10240
    error_message = "iot_memory_size must be between 128 and 10240 MB."
  }
}

variable "iot_timeout_seconds" {
  description = "IoT receiver Lambda timeout in seconds."
  type        = number
  default     = 15

  validation {
    condition     = var.iot_timeout_seconds >= 1 && var.iot_timeout_seconds <= 900
    error_message = "iot_timeout_seconds must be between 1 and 900 seconds."
  }
}

variable "api_memory_size" {
  description = "API Lambda memory in MB."
  type        = number
  default     = 512

  validation {
    condition     = var.api_memory_size >= 128 && var.api_memory_size <= 10240
    error_message = "api_memory_size must be between 128 and 10240 MB."
  }
}

variable "api_timeout_seconds" {
  description = "API Lambda timeout in seconds."
  type        = number
  default     = 30

  validation {
    condition     = var.api_timeout_seconds >= 1 && var.api_timeout_seconds <= 900
    error_message = "api_timeout_seconds must be between 1 and 900 seconds."
  }
}

variable "tags" {
  description = "Additional tags applied to supported AWS resources."
  type        = map(string)
  default     = {}
}
