from fastapi import APIRouter
from .general import router as general_router
from .auth import router as auth_router
from .labeling import router as labeling_router
from .attendance import router as attendance_router

router = APIRouter()
router.include_router(general_router)
router.include_router(auth_router, prefix="/auth")
router.include_router(labeling_router, prefix="/labeling")
router.include_router(attendance_router, prefix="/attendance")