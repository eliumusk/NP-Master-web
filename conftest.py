import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "web: serve/ web-service pipeline tests; require GPU + Supabase + fixtures",
    )
