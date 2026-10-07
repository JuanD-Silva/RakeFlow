import requests
import uuid
import time

BASE_URL = "http://localhost:8000"
TIMEOUT = 30


def test_postplayers():
    # Generate unique user data
    unique_suffix = str(uuid.uuid4())
    register_name = f"Test Club {unique_suffix}"
    register_email = f"test{unique_suffix}@example.com"
    register_password = "TestPass123!"

    headers = {"Content-Type": "application/json"}

    # Register new user (club)
    try:
        resp_register = requests.post(
            f"{BASE_URL}/auth/register",
            json={"name": register_name, "email": register_email, "password": register_password},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert resp_register.status_code == 201, f"Registration failed: {resp_register.text}"
        data_register = resp_register.json()
        assert "club_id" in data_register and data_register["email"] == register_email

        # Login to get token
        resp_login = requests.post(
            f"{BASE_URL}/auth/login",
            json={"username": register_email, "password": register_password},
            headers=headers,
            timeout=TIMEOUT,
        )
        assert resp_login.status_code == 200, f"Login failed: {resp_login.text}"
        data_login = resp_login.json()
        assert "access_token" in data_login and data_login.get("token_type") == "bearer"
        token = data_login["access_token"]

        auth_headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        # Test creating a new player with valid name and phone
        player_name = "Valid Player Name"
        player_phone = "+1234567890"
        resp_create_player = requests.post(
            f"{BASE_URL}/players/",
            headers=auth_headers,
            json={"name": player_name, "phone": player_phone},
            timeout=TIMEOUT,
        )
        assert resp_create_player.status_code == 200, f"Create player failed: {resp_create_player.text}"
        player_data = resp_create_player.json()
        assert player_data.get("name") == player_name
        assert player_data.get("phone") == player_phone
        assert "id" in player_data
        player_id = player_data["id"]

        # Test creating a player with invalid (empty after trimming) name
        invalid_name = "   "  # spaces only after trimming
        resp_invalid_player = requests.post(
            f"{BASE_URL}/players/",
            headers=auth_headers,
            json={"name": invalid_name, "phone": "+10000000000"},
            timeout=TIMEOUT,
        )
        assert resp_invalid_player.status_code == 400, f"Expected 400 for invalid name but got {resp_invalid_player.status_code}"
        error_data = resp_invalid_player.json()
        assert isinstance(error_data, dict)
        # Collect all string values to search for validation error keywords
        error_msg = "".join(str(v).lower() for v in flatten_dict_values(error_data))
        assert "name" in error_msg and "length" in error_msg, "Name length validation error expected"

    finally:
        # Clean up: delete the registered user and all data
        # Requires the Authorization header with valid token
        if 'token' in locals():
            try:
                resp_delete = requests.delete(
                    f"{BASE_URL}/me/delete-account",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=TIMEOUT,
                )
                # 200 expected on successful deletion
                assert resp_delete.status_code == 200
            except Exception:
                # ignore errors in cleanup to not mask test results
                pass

def flatten_dict_values(d):
    """Helper to flatten all string values from nested dicts and lists."""
    for v in d.values():
        if isinstance(v, dict):
            yield from flatten_dict_values(v)
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    yield from flatten_dict_values(item)
                else:
                    yield str(item)
        else:
            yield str(v)


test_postplayers()
