import requests
import uuid
import time

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

def test_postauthlogin():
    unique_suffix = str(uuid.uuid4())
    name = f"Test User {unique_suffix}"
    email = f"testuser_{unique_suffix}@example.com"
    password = f"Pass!{unique_suffix[:8]}"

    register_url = f"{BASE_URL}/auth/register"
    login_url = f"{BASE_URL}/auth/login"
    delete_account_url = f"{BASE_URL}/me/delete-account"

    headers_json = {"Content-Type": "application/json"}

    # Register a new user
    register_payload = {
        "name": name,
        "email": email,
        "password": password
    }
    response = requests.post(register_url, json=register_payload, timeout=TIMEOUT)
    assert response.status_code == 201, f"Registration failed: {response.status_code} {response.text}"
    data = response.json()
    assert "message" in data
    assert "club_id" in data
    assert data.get("email") == email

    try:
        # Login with valid credentials
        login_payload_valid = {
            "username": email,
            "password": password
        }
        response_valid = requests.post(login_url, json=login_payload_valid, timeout=TIMEOUT)
        assert response_valid.status_code == 200, f"Valid login failed: {response_valid.status_code} {response_valid.text}"
        login_data = response_valid.json()
        assert "access_token" in login_data
        assert "token_type" in login_data
        assert login_data["token_type"].lower() == "bearer"

        # Login with invalid credentials (wrong password)
        login_payload_invalid = {
            "username": email,
            "password": "wrongpassword123!"
        }
        response_invalid = requests.post(login_url, json=login_payload_invalid, timeout=TIMEOUT)
        assert response_invalid.status_code == 401, f"Invalid login did not fail as expected: {response_invalid.status_code} {response_invalid.text}"
        error_data = response_invalid.json()
        assert ("Invalid credentials" in response_invalid.text) or ("detail" in error_data and "Invalid credentials" in str(error_data["detail"]))

    finally:
        # Cleanup: login again to get token for deleting account
        login_payload = {
            "username": email,
            "password": password
        }
        login_resp = requests.post(login_url, json=login_payload, timeout=TIMEOUT)
        if login_resp.status_code == 200:
            token = login_resp.json().get("access_token")
            if token:
                headers_auth = {
                    "Authorization": f"Bearer {token}"
                }
                del_resp = requests.delete(delete_account_url, headers=headers_auth, timeout=TIMEOUT)
                assert del_resp.status_code == 200, f"Account deletion failed: {del_resp.status_code} {del_resp.text}"
                del_data = del_resp.json()
                assert "message" in del_data


test_postauthlogin()
