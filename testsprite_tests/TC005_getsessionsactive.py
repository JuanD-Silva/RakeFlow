import requests
import uuid
import time

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

def test_getsessionsactive():
    # Generate unique user details using UUID and timestamp
    suffix = f"{uuid.uuid4()}_{int(time.time())}"
    name = f"TestUser_{suffix}"
    email = f"test_{suffix}@example.com"
    password = "TestPassword123!"

    headers = {"Content-Type": "application/json"}

    # Register user
    register_payload = {"name": name, "email": email, "password": password}
    r_register = requests.post(f"{BASE_URL}/auth/register", json=register_payload, headers=headers, timeout=TIMEOUT)
    assert r_register.status_code == 201, f"Expected 201 on register, got {r_register.status_code}"
    register_response = r_register.json()
    assert "email" in register_response and register_response["email"] == email

    try:
        # Login user
        login_payload = {"username": email, "password": password}
        r_login = requests.post(f"{BASE_URL}/auth/login", json=login_payload, headers=headers, timeout=TIMEOUT)
        assert r_login.status_code == 200, f"Expected 200 on login, got {r_login.status_code}"
        login_response = r_login.json()
        assert "access_token" in login_response and "token_type" in login_response
        token = f"Bearer {login_response['access_token']}"

        auth_headers = {"Authorization": token}

        # Attempt to create a session - send empty JSON payload to avoid 422 error
        r_create_session = requests.post(f"{BASE_URL}/sessions/", json={}, headers=auth_headers, timeout=TIMEOUT)
        if r_create_session.status_code == 200:
            created_session = r_create_session.json()
            session_id = created_session.get("id")
        elif r_create_session.status_code == 409:
            session_id = None
        else:
            # Unexpected status on create session
            assert False, f"Unexpected status {r_create_session.status_code} on session creation"

        # Fetch active open session
        r_active = requests.get(f"{BASE_URL}/sessions/active", headers=auth_headers, timeout=TIMEOUT)
        assert r_active.status_code == 200, f"Expected 200 on get active session, got {r_active.status_code}"
        active_session = r_active.json()  # May be session object or null (None)

        # Validate type of returned data (either dict for session or None)
        assert (active_session is None) or isinstance(active_session, dict)

        # If we created a session, the active session returned should be that session or None
        if session_id is not None:
            # Active session should not be None and id should match created session id
            assert active_session is not None, "Expected active session data, got None"
            assert "id" in active_session, "Active session object missing 'id'"
            assert active_session["id"] == session_id

        # If no session created, active_session may be None or an existing active session object,
        # both are acceptable per description.

    finally:
        # Clean up: delete the session if created
        if 'session_id' in locals() and session_id is not None:
            try:
                requests.delete(f"{BASE_URL}/sessions/{session_id}", headers=auth_headers, timeout=TIMEOUT)
            except Exception:
                pass
        # Delete the user/club account to clean up
        try:
            requests.delete(f"{BASE_URL}/me/delete-account", headers=auth_headers, timeout=TIMEOUT)
        except Exception:
            pass

test_getsessionsactive()
