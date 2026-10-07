import requests
import uuid

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

def test_deletemedeleteaccount():
    # Generate unique user data
    unique_suffix = str(uuid.uuid4())
    name = f"Test User {unique_suffix}"
    email = f"testuser_{unique_suffix}@example.com"
    password = "StrongPass123!"

    headers = {"Content-Type": "application/json"}

    # Register new user
    register_payload = {
        "name": name,
        "email": email,
        "password": password
    }
    register_resp = requests.post(f"{BASE_URL}/auth/register", json=register_payload, headers=headers, timeout=TIMEOUT)
    assert register_resp.status_code == 201, f"Registration failed: {register_resp.text}"
    register_data = register_resp.json()
    assert "email" in register_data and register_data["email"] == email
    assert "club_id" in register_data

    try:
        # Login to get token
        login_payload = {
            "username": email,
            "password": password
        }
        login_resp = requests.post(f"{BASE_URL}/auth/login", json=login_payload, headers=headers, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        login_data = login_resp.json()
        assert "access_token" in login_data
        assert "token_type" in login_data and login_data["token_type"].lower() == "bearer"
        token = login_data["access_token"]

        auth_headers = {
            "Authorization": f"Bearer {token}"
        }

        # DELETE /me/delete-account with valid authorization
        delete_auth_resp = requests.delete(f"{BASE_URL}/me/delete-account", headers=auth_headers, timeout=TIMEOUT)
        assert delete_auth_resp.status_code == 200, f"Authorized account delete failed: {delete_auth_resp.text}"
        delete_auth_data = delete_auth_resp.json()
        # The spec mentions a message field in 200 response
        assert "message" in delete_auth_data and isinstance(delete_auth_data["message"], str) and len(delete_auth_data["message"]) > 0

        # Attempt DELETE /me/delete-account without authorization header
        delete_noauth_resp = requests.delete(f"{BASE_URL}/me/delete-account", timeout=TIMEOUT)
        assert delete_noauth_resp.status_code == 401, f"Unauthorized account delete should fail with 401 but got {delete_noauth_resp.status_code}"
        if delete_noauth_resp.headers.get("Content-Type", "").startswith("application/json"):
            err_data = delete_noauth_resp.json()
            assert "detail" in err_data or "message" in err_data

    finally:
        # Cleanup if account not deleted (e.g. if test fails before delete)
        # Try login to check if the user still exists
        try:
            login_check = requests.post(f"{BASE_URL}/auth/login", json=login_payload, headers=headers, timeout=TIMEOUT)
            if login_check.status_code == 200:
                # If login still succeeds, delete the account now
                token = login_check.json().get("access_token")
                if token:
                    requests.delete(f"{BASE_URL}/me/delete-account", headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT)
        except Exception:
            pass

test_deletemedeleteaccount()