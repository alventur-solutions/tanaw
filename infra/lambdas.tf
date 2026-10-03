data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_ecr_repository" "api" {
  name                 = "${local.name}-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the most recent 20 API images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_iam_role" "iot_lambda" {
  name               = "${local.name}-iot-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "iot_lambda_logs" {
  role       = aws_iam_role.iot_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "iot" {
  count = local.deploy_iot_lambda ? 1 : 0

  function_name    = "${local.name}-iot"
  role             = aws_iam_role.iot_lambda.arn
  runtime          = "python3.12"
  handler          = "receiver.handler"
  filename         = var.iot_lambda_zip_path
  source_code_hash = try(filebase64sha256(var.iot_lambda_zip_path), null)
  package_type     = "Zip"
  architectures    = ["x86_64"]
  memory_size      = var.iot_memory_size
  timeout          = var.iot_timeout_seconds
  publish          = true

  depends_on = [aws_iam_role_policy_attachment.iot_lambda_logs]

  lifecycle {
    precondition {
      condition     = try(trimspace(var.iot_database_url) != "", false)
      error_message = "Set iot_database_url before deploying the IoT Lambda."
    }
  }

  environment {
    variables = merge(
      { TANAW_ENV = var.environment },
      var.iot_database_url == null ? {} : { DATABASE_URL = var.iot_database_url },
      var.iot_station_token == null ? {} : { STATION_TOKEN = var.iot_station_token }
    )
  }
}

resource "aws_lambda_function_url" "iot" {
  count = local.deploy_iot_lambda ? 1 : 0

  function_name      = aws_lambda_function.iot[0].function_name
  authorization_type = "NONE"
}

resource "aws_iam_role" "api_lambda" {
  name               = "${local.name}-api-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_lambda_function" "api" {
  count = local.deploy_api_lambda ? 1 : 0

  function_name = "${local.name}-api"
  role          = aws_iam_role.api_lambda.arn
  package_type  = "Image"
  image_uri     = var.api_lambda_image_uri
  architectures = ["x86_64"]
  memory_size   = var.api_memory_size
  timeout       = var.api_timeout_seconds
  publish       = true

  environment {
    variables = {
      TANAW_ENV = var.environment
    }
  }
}

resource "aws_lambda_function_url" "api" {
  count = local.deploy_api_lambda ? 1 : 0

  function_name      = aws_lambda_function.api[0].function_name
  authorization_type = "NONE"

  cors {
    allow_credentials = false
    allow_headers     = ["authorization", "content-type"]
    allow_methods     = ["GET", "POST", "OPTIONS"]
    allow_origins     = local.api_cors_origins
    max_age           = 300
  }
}
