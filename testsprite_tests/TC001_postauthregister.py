import requests
import uuid

BASE_URL = "http://localhost:8000"
REGISTER_ENDPOINT = f"{BASE_URL}/auth/register"

def test_postauthregister():
    unique_suffix = str(uuid.uuid4())
    name = f"Test Club {unique_suffix}"
    email = f"testclub_{unique_suffix}@example.com"
    password = "TestPass123!"

    headers = {"Content-Type": "application/json"}

    # Register a new club - expect 201 with message, club_id, email
    payload = {"name": name, "email": email, "password": password}
    response = requests.post(REGISTER_ENDPOINT, json=payload, headers=headers, timeout=30)
    assert response.status_code == 201, f"Expected 201 but got {response.status_code}, response text: {response.text}"
    json_resp = response.json()
    assert "message" in json_resp and isinstance(json_resp["message"], str)
    assert "club_id" in json_resp and json_resp["club_id"]
    assert "email" in json_resp and json_resp["email"] == email

    # Attempt to register again with the same email - expect 400 with "Email already registered"
    response_dup = requests.post(REGISTER_ENDPOINT, json=payload, headers=headers, timeout=30)
    assert response_dup.status_code == 400, f"Expected 400 but got {response_dup.status_code}, response text: {response_dup.text}"
    json_dup = response_dup.json()
    # Validate error message contains "Email already registered"
    error_message = json_dup.get("detail") or json_dup.get("error") or json_dup.get("message") or ""
    assert "Email already registered" in error_message or "email" in error_message.lower()

test_postauthregister()