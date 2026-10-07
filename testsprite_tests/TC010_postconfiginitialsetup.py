import requests
import uuid
import time

BASE_URL = "http://localhost:8000"
TIMEOUT = 30


def test_post_config_initial_setup():
    # Generate unique user credentials
    unique_suffix = str(uuid.uuid4())
    user_name = f"Test User {unique_suffix}"
    user_email = f"testuser_{unique_suffix}@example.com"
    user_password = "TestPass123!"

    headers = {"Content-Type": "application/json"}

    # Register user
    register_payload = {
        "name": user_name,
        "email": user_email,
        "password": user_password
    }
    register_resp = requests.post(f"{BASE_URL}/auth/register", json=register_payload, headers=headers, timeout=TIMEOUT)
    assert register_resp.status_code == 201, f"Registration failed: {register_resp.text}"
    register_data = register_resp.json()
    assert "message" in register_data and "club_id" in register_data and register_data.get("email") == user_email

    try:
        # Login user
        login_payload = {"username": user_email, "password": user_password}
        login_resp = requests.post(f"{BASE_URL}/auth/login", json=login_payload, headers=headers, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        login_data = login_resp.json()
        token = login_data.get("access_token")
        token_type = login_data.get("token_type")
        assert token and token_type and token_type.lower() == "bearer"

        auth_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Prepare config initial setup payload
        setup_payload = {
            "monthly_goal": 10000,
            "partners": [
                {"name": "Partner A", "percentage": 50},
                {"name": "Partner B", "percentage": 30},
                {"name": "Partner C", "percentage": 20}
            ]
        }

        # POST /config/initial-setup
        setup_resp = requests.post(f"{BASE_URL}/config/initial-setup", json=setup_payload, headers=auth_headers, timeout=TIMEOUT)
        assert setup_resp.status_code == 200, f"Initial setup post failed: {setup_resp.text}"
        setup_data = setup_resp.json()
        assert "message" in setup_data and isinstance(setup_data["message"], str) and len(setup_data["message"]) > 0

    finally:
        # Cleanup: delete account using DELETE /me/delete-account
        if 'token' in locals():
            delete_headers = {"Authorization": f"Bearer {token}"}
            del_resp = requests.delete(f"{BASE_URL}/me/delete-account", headers=delete_headers, timeout=TIMEOUT)
            assert del_resp.status_code == 200, f"Account deletion failed: {del_resp.text}"

test_post_config_initial_setup()