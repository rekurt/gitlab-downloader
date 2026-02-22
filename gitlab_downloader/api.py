"""FastAPI application for Electron backend."""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import signal
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint

from .api_routes import _cleanup_old_migrations, router

# Configure logging for API server
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)


OPENAPI_TAGS = [
    {
        "name": "health",
        "description": "Service health and version endpoints.",
    },
    {
        "name": "repositories",
        "description": "Operations with local cloned repositories.",
    },
    {
        "name": "mappings",
        "description": "Author and committer mapping management.",
    },
    {
        "name": "migration",
        "description": "Repository migration workflow endpoints.",
    },
    {
        "name": "config",
        "description": "Read and write migration configuration files.",
    },
]


def create_app() -> FastAPI:
    """Create and configure FastAPI application.

    Returns:
        Configured FastAPI application instance
    """
    cleanup_task: asyncio.Task[None] | None = None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        """Handle startup and shutdown of the application."""
        nonlocal cleanup_task
        # Startup
        logger.info("API server starting up")
        cleanup_task = asyncio.create_task(_cleanup_old_migrations())
        try:
            yield
        finally:
            # Shutdown
            logger.info("API server shutting down")
            if cleanup_task and not cleanup_task.done():
                cleanup_task.cancel()
                try:
                    await cleanup_task
                except asyncio.CancelledError:
                    pass

    app = FastAPI(
        title="GitLab Dump API",
        description=(
            "REST API for GitLab Dump desktop and CLI flows. "
            "Use `/api/status` for health checks, `/api/repos` to inspect local repositories, "
            "and migration endpoints to run history rewrite tasks."
        ),
        version="0.1.0",
        summary="GitLab Dump backend API",
        contact={"name": "GitLab Dump Team"},
        license_info={"name": "MIT"},
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        openapi_tags=OPENAPI_TAGS,
        lifespan=lifespan,
    )

    # SECURITY: API token protects all API endpoints from unauthorized access.
    # The Electron main process generates a random token and passes it via
    # GITLAB_DUMP_API_TOKEN env var. All requests (except OPTIONS for CORS preflight)
    # must include it in the X-API-Token header. This prevents sandboxed contexts
    # (data: URLs, file:// iframes) from reading sensitive data via GET endpoints,
    # while still allowing "null" origin needed for Electron's file:// protocol.
    api_token = os.environ.get("GITLAB_DUMP_API_TOKEN", "")

    @app.middleware("http")
    async def verify_api_token(
        request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """Verify API token for all API requests."""
        if api_token and request.method != "OPTIONS":
            provided_token = request.headers.get("X-API-Token", "")
            if not secrets.compare_digest(provided_token, api_token):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Invalid or missing API token"},
                )
        return await call_next(request)

    # Add CORS middleware for Electron communication
    # Restrict to localhost only since this is for the local Electron app
    # "null" origin is needed for Electron production builds (file:// protocol).
    # The API token middleware above protects mutating endpoints from CSRF.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost",
            "http://127.0.0.1",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "null",  # file:// protocol sends Origin: null (Electron production builds)
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-API-Token"],
    )

    # Include API routes
    app.include_router(router)

    return app


def generate_api_token() -> str:
    """Generate a random API token for securing mutating endpoints.

    Returns:
        Random URL-safe token string
    """
    return secrets.token_urlsafe(32)


async def run_api_server_async(host: str = "127.0.0.1", port: int = 8000) -> None:
    """Run the API server asynchronously from within an event loop.

    Args:
        host: Host to bind to
        port: Port to bind to
    """
    import uvicorn

    app = create_app()

    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)

    logger.info(f"Starting API server on {host}:{port}")
    try:
        await server.serve()
    except Exception as e:  # pylint: disable=broad-except
        logger.error(f"Server error: {e}", exc_info=True)


def run_api_server(host: str = "127.0.0.1", port: int = 8000) -> None:
    """Run the API server.

    Args:
        host: Host to bind to
        port: Port to bind to
    """
    import uvicorn

    app = create_app()

    # Set up signal handlers for graceful shutdown
    def signal_handler(sig: int, frame: object) -> None:
        """Handle shutdown signals."""
        logger.info(f"Received signal {sig}, shutting down...")
        sys.exit(0)

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    logger.info(f"Starting API server on {host}:{port}")
    try:
        uvicorn.run(app, host=host, port=port, log_level="info")
    except KeyboardInterrupt:
        logger.info("Server interrupted by user")
    except Exception as e:  # pylint: disable=broad-except
        logger.error(f"Server error: {e}", exc_info=True)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="GitLab Dump API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to (default: 8000)")
    args = parser.parse_args()

    run_api_server(host=args.host, port=args.port)
