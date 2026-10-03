"""AWS Lambda entry point for the FastAPI application."""

from mangum import Mangum

from api.main import app

handler = Mangum(app)
