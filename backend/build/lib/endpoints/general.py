from fastapi import APIRouter
from starlette.responses import HTMLResponse

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
def root():
    return """
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>API Status</title>
        </head>
        <body>
            we live
        </body>
        </html>
    """


@router.get("/ping")
def ping():
    return {"ping": "pong"}
