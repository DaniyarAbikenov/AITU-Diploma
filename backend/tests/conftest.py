import os
import tempfile

# Must be set before the app is imported: settings are read at import time.
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["APP_AS_OF"] = "2026-10-20"
os.environ["MC_PATHS"] = "600"
os.environ["SEED_DEMO"] = "1"
os.environ["NBK_RATES"] = "0"  # no network in tests

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

DEMO = {"email": "demo@zapas.kz", "password": "demo1234"}
API = "/api/v1"


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth(client):
    r = client.post(f"{API}/auth/login", json=DEMO)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def new_user(client):
    """A fresh registered user with no data (unique e-mail per test)."""
    import uuid

    email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post(f"{API}/auth/register", json={"email": email, "password": "secret12", "name": "Тест"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
