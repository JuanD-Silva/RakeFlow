import requests
import uuid
import time

BASE_URL = "http://localhost:8000"
TIMEOUT = 30


def test_getstatsdashboard():
    # Create unique user data
    suffix = str(uuid.uuid4())
    name = f"Test User {suffix}"
    email = f"testuser_{suffix}@example.com"
    password = "TestPass123!"

    headers = {"Content-Type": "application/json"}

    # Register user
    register_payload = {
        "name": name,
        "email": email,
        "password": password
    }
    resp_register = requests.post(
        f"{BASE_URL}/auth/register",
        json=register_payload,
        headers=headers,
        timeout=TIMEOUT
    )
    assert resp_register.status_code == 201
    register_data = resp_register.json()
    assert "email" in register_data and register_data["email"] == email

    try:
        # Login user to get valid token
        login_payload = {
            "username": email,
            "password": password
        }
        resp_login = requests.post(
            f"{BASE_URL}/auth/login",
            json=login_payload,
            headers=headers,
            timeout=TIMEOUT
        )
        assert resp_login.status_code == 200
        login_data = resp_login.json()
        assert "access_token" in login_data and "token_type" in login_data
        valid_token = login_data["access_token"]
        token_type = login_data["token_type"]
        auth_header_valid = {"Authorization": f"{token_type.capitalize()} {valid_token}"}

        # Test valid authorized request to /stats/dashboard
        resp_dashboard_valid = requests.get(
            f"{BASE_URL}/stats/dashboard",
            headers=auth_header_valid,
            timeout=TIMEOUT
        )
        assert resp_dashboard_valid.status_code == 200
        dashboard_data = resp_dashboard_valid.json()
        assert isinstance(dashboard_data, dict)

        # Test invalid token returns 401
        invalid_tokens = [
            "invalidtoken123",
            valid_token[:-1] + "x",  # slightly altered token (likely invalid)
            "",  # empty token
            "Bearer expired.token.here"  # format token that is invalid
        ]
        for invalid_token in invalid_tokens:
            auth_header_invalid = {"Authorization": f"Bearer {invalid_token}"}
            resp_dashboard_invalid = requests.get(
                f"{BASE_URL}/stats/dashboard",
                headers=auth_header_invalid,
                timeout=TIMEOUT
            )
            assert resp_dashboard_invalid.status_code == 401

        # Test missing Authorization header returns 401
        resp_dashboard_no_auth = requests.get(
            f"{BASE_URL}/stats/dashboard",
            timeout=TIMEOUT
        )
        assert resp_dashboard_no_auth.status_code == 401

    finally:
        # Cleanup: delete the created account
        try:
            headers_auth = {
                "Authorization": f"{token_type.capitalize()} {valid_token}"
            }
            resp_delete = requests.delete(
                f"{BASE_URL}/me/delete-account",
                headers=headers_auth,
                timeout=TIMEOUT
            )
            assert resp_delete.status_code == 200
        except Exception:
            # If cleanup fails, do not mask original test results
            pass


test_getstatsdashboard()