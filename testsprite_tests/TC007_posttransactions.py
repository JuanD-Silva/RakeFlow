import requests
import uuid
import time

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

def test_posttransactions():
    # Generate unique user info
    unique_suffix = str(uuid.uuid4())
    register_data = {
        "name": f"Test User {unique_suffix}",
        "email": f"testuser_{unique_suffix}@example.com",
        "password": "testpassword123"
    }
    # Register user
    r = requests.post(f"{BASE_URL}/auth/register", json=register_data, timeout=TIMEOUT)
    assert r.status_code == 201, f"User registration failed: {r.text}"

    token = None
    player_id = None
    session_id = None
    headers = {}

    try:
        # Login user
        login_data = {
            "username": register_data["email"],
            "password": register_data["password"]
        }
        r = requests.post(f"{BASE_URL}/auth/login", json=login_data, timeout=TIMEOUT)
        assert r.status_code == 200, f"Login failed: {r.text}"
        token = r.json().get("access_token")
        assert token, "No access_token in login response"
        headers = {"Authorization": f"Bearer {token}"}

        # Create player
        player_data = {
            "name": f"Player {unique_suffix}",
            "phone": "1234567890"
        }
        r = requests.post(f"{BASE_URL}/players/", json=player_data, headers=headers, timeout=TIMEOUT)
        assert r.status_code == 200, f"Player creation failed: {r.text}"
        player = r.json()
        player_id = player.get("id")
        assert isinstance(player_id, int), "Invalid player_id"

        # Create session
        r = requests.post(f"{BASE_URL}/sessions/", headers=headers, timeout=TIMEOUT)
        assert r.status_code == 200, f"Session creation failed: {r.text}"
        session = r.json()
        session_id = session.get("id")
        assert isinstance(session_id, int), "Invalid session_id"

        # Function to create transaction
        def create_transaction(amount, method="CASH"):
            body = {
                "player_id": player_id,
                "session_id": session_id,
                "amount": amount,
                "method": method
            }
            return requests.post(f"{BASE_URL}/transactions/", json=body, headers=headers, timeout=TIMEOUT)

        # 1) Create valid transaction (amount > 0)
        r = create_transaction(100)
        assert r.status_code == 200, f"Valid transaction creation failed: {r.text}"
        transaction = r.json()
        assert transaction.get("player_id") == player_id
        assert transaction.get("session_id") == session_id
        assert transaction.get("amount") == 100
        assert transaction.get("method") == "CASH"

        # 2) Create invalid transaction (amount = 0)
        r = create_transaction(0)
        assert r.status_code == 400, f"Transaction with zero amount should fail but got: {r.status_code}, {r.text}"

    finally:
        # Cleanup - delete session
        try:
            if session_id and headers:
                requests.delete(f"{BASE_URL}/sessions/{session_id}", headers=headers, timeout=TIMEOUT)
        except Exception:
            pass
        # Delete user account
        try:
            if headers:
                requests.delete(f"{BASE_URL}/me/delete-account", headers=headers, timeout=TIMEOUT)
        except Exception:
            pass

test_posttransactions()