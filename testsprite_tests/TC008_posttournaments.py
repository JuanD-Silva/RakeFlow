import requests
import uuid
import time

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

def test_post_tournaments():
    # Generate unique user details
    unique_suffix = str(uuid.uuid4())
    name = f"TestUser_{unique_suffix}"
    email = f"testuser_{unique_suffix}@example.com"
    password = "TestPass123!"

    headers = {"Content-Type": "application/json"}

    def register_user():
        url = f"{BASE_URL}/auth/register"
        payload = {
            "name": name,
            "email": email,
            "password": password
        }
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
        assert response.status_code == 201, f"Registration failed: {response.text}"
        return response.json()

    def login_user():
        url = f"{BASE_URL}/auth/login"
        payload = {
            "username": email,
            "password": password
        }
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data and "token_type" in data
        return data["access_token"], data["token_type"]

    def delete_account(token):
        url = f"{BASE_URL}/me/delete-account"
        auth_headers = {"Authorization": f"Bearer {token}"}
        response = requests.delete(url, headers=auth_headers, timeout=TIMEOUT)
        assert response.status_code == 200, f"Account deletion failed: {response.text}"

    def create_tournament(token, name, buyin_amount, rake_percentage, payout_structure):
        url = f"{BASE_URL}/tournaments/"
        auth_headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        payload = {
            "name": name,
            "buyin_amount": buyin_amount,
            "rake_percentage": rake_percentage,
            "payout_structure": payout_structure
        }
        response = requests.post(url, json=payload, headers=auth_headers, timeout=TIMEOUT)
        return response

    # Register and login
    register_user()
    access_token, token_type = login_user()

    auth_header = f"{token_type.capitalize()} {access_token}"

    created_tournament_id = None

    try:
        # 1) Create a tournament with valid data - expect 200 and tournament data
        tournament_name = f"My Tournament {unique_suffix}"
        buyin_amount = 1000
        rake_percentage = 5
        payout_structure = [50, 30, 20]  # Example distribution

        resp1 = create_tournament(access_token, tournament_name, buyin_amount, rake_percentage, payout_structure)
        assert resp1.status_code == 200, f"Failed to create tournament: {resp1.text}"
        tournament_data = resp1.json()
        assert "id" in tournament_data or "tournament_id" in tournament_data, "Tournament ID missing in response"
        created_tournament_id = tournament_data.get("id") or tournament_data.get("tournament_id")
        # Verify response content for expected keys
        for key in ["name", "buyin_amount", "rake_percentage", "payout_structure"]:
            assert key in tournament_data, f"Key {key} missing in tournament response"
        assert tournament_data["name"] == tournament_name
        assert tournament_data["buyin_amount"] == buyin_amount
        assert tournament_data["rake_percentage"] == rake_percentage
        assert tournament_data["payout_structure"] == payout_structure

        # 2) Attempt to create a second tournament while the first is active - expect 409 Conflict
        second_tournament_name = f"My Second Tournament {unique_suffix}"
        resp2 = create_tournament(access_token, second_tournament_name, buyin_amount, rake_percentage, payout_structure)
        assert resp2.status_code == 409, f"Expected 409 conflict on second active tournament, got {resp2.status_code}, response: {resp2.text}"

    finally:
        # Clean up: delete created tournament if possible
        if created_tournament_id:
            delete_url = f"{BASE_URL}/tournaments/{created_tournament_id}"
            headers_del = {"Authorization": f"Bearer {access_token}"}
            del_resp = requests.delete(delete_url, headers=headers_del, timeout=TIMEOUT)
            # Accept 204 No Content or 200 success or 404 not found (already deleted)
            assert del_resp.status_code in (204, 200, 404), f"Failed to delete tournament: {del_resp.text}"
        # Delete the registered user account
        delete_account(access_token)

test_post_tournaments()