from fastapi import APIRouter
from .general import router as general_router
from .auth import router as auth_router
from .labeling import router as labeling_router
from .attendance import router as attendance_router
from .members import router as members_router
from .meeting_hours import router as meeting_hours_router
from .notifications import router as notifications_router
from .push import router as push_router

router = APIRouter()
router.include_router(general_router)
router.include_router(auth_router, prefix="/auth")
router.include_router(labeling_router, prefix="/labeling")
router.include_router(attendance_router, prefix="/attendance")
router.include_router(members_router, prefix="/members")
router.include_router(meeting_hours_router, prefix="/meeting-hours")
router.include_router(notifications_router, prefix="/notifications")
router.include_router(push_router, prefix="/push")