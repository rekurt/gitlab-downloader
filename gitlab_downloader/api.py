"""FastAPI application for Electron backend."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api_routes import router

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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins for Electron app
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
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
    uvicorn.run(app, host=host, port=port, log_level="info")
