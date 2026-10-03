output "frontend_bucket_name" {
  description = "Private S3 bucket for frontend build assets."
  value       = aws_s3_bucket.frontend.bucket
}

output "frontend_url" {
  description = "CloudFront URL for the frontend."
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "frontend_distribution_id" {
  description = "CloudFront distribution ID for cache invalidations."
  value       = aws_cloudfront_distribution.frontend.id
}

output "api_ecr_repository_url" {
  description = "Push the Lambda-compatible API image to this ECR repository."
  value       = aws_ecr_repository.api.repository_url
}

output "iot_lambda_execution_role_arn" {
  description = "Trust-only execution role ARN for the IoT Lambda."
  value       = aws_iam_role.iot_lambda.arn
}

output "api_lambda_execution_role_arn" {
  description = "Trust-only execution role ARN for the API Lambda."
  value       = aws_iam_role.api_lambda.arn
}

output "iot_function_url" {
  description = "Public HTTPS Function URL for IoT readings; null until an IoT zip is configured."
  value       = try(aws_lambda_function_url.iot[0].function_url, null)
}

output "api_function_url" {
  description = "Public HTTPS Function URL for the API; null until an API image is configured."
  value       = try(aws_lambda_function_url.api[0].function_url, null)
}
