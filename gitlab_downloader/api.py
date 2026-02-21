"""FastAPI application for Electron backend."""

from __future__ import annotations

import logging
import signal
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api_routes import router

# Configure logging for API server
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Create and configure FastAPI application.

    Returns:
        Configured FastAPI application instance
    """
    app = FastAPI(
        title="GitLab Dump API",
        description="API for Electron desktop application",
        version="0.1.0",
    )

    # Add CORS middleware for Electron communication
    # Restrict to localhost only since this is for the local Electron app
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost",
            "http://127.0.0.1",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )

    # Include API routes
    app.include_router(router)

    @app.on_event("startup")
    async def startup_event() -> None:
        """Log startup event."""
        logger.info("API server starting up")

    @app.on_event("shutdown")
    async def shutdown_event() -> None:
        """Log shutdown event."""
        logger.info("API server shutting down")

    return app


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
    parser.add_argument("--port", type=int, default=5000, help="Port to bind to (default: 5000)")
    args = parser.parse_args()

    run_api_server(host=args.host, port=args.port)
