FROM public.ecr.aws/lambda/python:3.12

COPY pyproject.toml README.md ${LAMBDA_TASK_ROOT}/
COPY api ${LAMBDA_TASK_ROOT}/api
COPY pipeline ${LAMBDA_TASK_ROOT}/pipeline
COPY funding ${LAMBDA_TASK_ROOT}/funding

ENV GOOGLE_APPLICATION_CREDENTIALS=${LAMBDA_TASK_ROOT}/api/google-credentials.json

RUN pip install --no-cache-dir .

CMD ["api.lambda_handler.handler"]
