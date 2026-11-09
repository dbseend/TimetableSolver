from fastapi import APIRouter

from app.api import catalog, constraints, explain, health, profile, solve

api_router = APIRouter()
for module in (health, catalog, profile, constraints, solve, explain):
    api_router.include_router(module.router)
