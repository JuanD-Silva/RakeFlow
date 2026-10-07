import requests
import uuid
import time

BASE_URL = "http://localhost:8000"
TIMEOUT = 30

def test_postsessionssessionidclose():
    # Generate unique user data
    unique_suffix = str(uuid.uuid4())
    register_data = {
        "name": f"Test User {unique_suffix}",
        "email": f"test{unique_suffix}@rakeflow.com",
        "password": "TestPass123!"
    }

    # Register user
    register_resp = requests.post(f"{BASE_URL}/auth/register", json=register_data, timeout=TIMEOUT)
    assert register_resp.status_code == 201, f"Register failed: {register_resp.text}"
    reg_json = register_resp.json()
    assert "email" in reg_json and reg_json["email"] == register_data["email"]

    # Login user
    login_data = {"username": register_data["email"], "password": register_data["password"]}
    login_resp = requests.post(f"{BASE_URL}/auth/login", json=login_data, timeout=TIMEOUT)
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    login_json = login_resp.json()
    assert "access_token" in login_json and "token_type" in login_json
    token = login_json["access_token"]
    token_type = login_json["token_type"]
    headers = {"Authorization": f"{token_type.capitalize()} {token}"}

    session_id = None
    try:
        # Create new session
        create_sess_resp = requests.post(f"{BASE_URL}/sessions/", headers=headers, json={}, timeout=TIMEOUT)
        assert create_sess_resp.status_code == 200, f"Session creation failed: {create_sess_resp.text}"
        sess_json = create_sess_resp.json()
        assert "id" in sess_json
        session_id = sess_json["id"]

        # Get audit report for session to get expected rake and jackpot cash
        audit_resp = requests.get(f"{BASE_URL}/sessions/{session_id}/audit", headers=headers, timeout=TIMEOUT)
        assert audit_resp.status_code == 200, f"Audit fetch failed: {audit_resp.text}"
        audit_json = audit_resp.json()

        # The audit response schema isn't detailed in PRD,
        # but we expect it to return declared totals for rake and jackpot cash or expected values for validation.
        # Let's assume audit_json contains "expected_rake_cash" and "expected_jackpot_cash"
        expected_rake = audit_json.get("expected_rake_cash")
        expected_jackpot = audit_json.get("expected_jackpot_cash")

        # If audit response does not have these keys, fallback to 0.0 for test safety (assuming 0 close session)
        if expected_rake is None or expected_jackpot is None:
            # As no explicit schema, try common keys or fallback 0
            expected_rake = audit_json.get("declared_rake_cash", 0.0)
            expected_jackpot = audit_json.get("declared_jackpot_cash", 0.0)
            if expected_rake is None:
                expected_rake = 0.0
            if expected_jackpot is None:
                expected_jackpot = 0.0

        # 1) Close session with matching declared rake and jackpot cash
        close_data_match = {
            "declared_rake_cash": expected_rake,
            "declared_jackpot_cash": expected_jackpot,
            "force_close": False
        }
        close_resp_match = requests.post(f"{BASE_URL}/sessions/{session_id}/close", headers=headers, json=close_data_match, timeout=TIMEOUT)
        assert close_resp_match.status_code == 200, f"Close with matching totals failed: {close_resp_match.text}"
        close_json = close_resp_match.json()
        # Assert some expected key in CloseResult, e.g. "result" present (per PRD description)
        assert "result" in close_json or len(close_json) > 0

        # Assume session is closed now, reopen a new session to test mismatch close
        create_sess_resp2 = requests.post(f"{BASE_URL}/sessions/", headers=headers, json={}, timeout=TIMEOUT)
        assert create_sess_resp2.status_code == 200, f"Second session creation failed: {create_sess_resp2.text}"
        sess_json2 = create_sess_resp2.json()
        session_id2 = sess_json2["id"]

        # Get audit data for new session
        audit_resp2 = requests.get(f"{BASE_URL}/sessions/{session_id2}/audit", headers=headers, timeout=TIMEOUT)
        assert audit_resp2.status_code == 200, f"Audit for second session failed: {audit_resp2.text}"
        audit_json2 = audit_resp2.json()

        expected_rake2 = audit_json2.get("expected_rake_cash")
        expected_jackpot2 = audit_json2.get("expected_jackpot_cash")
        if expected_rake2 is None or expected_jackpot2 is None:
            expected_rake2 = audit_json2.get("declared_rake_cash", 0.0)
            expected_jackpot2 = audit_json2.get("declared_jackpot_cash", 0.0)
            if expected_rake2 is None:
                expected_rake2 = 0.0
            if expected_jackpot2 is None:
                expected_jackpot2 = 0.0

        # 2) Close session with mismatched declared totals to trigger 409 Mismatch
        close_data_mismatch = {
            "declared_rake_cash": (expected_rake2 or 0) + 10.0,  # Add discrepancy
            "declared_jackpot_cash": (expected_jackpot2 or 0) + 5.0,
            "force_close": False
        }
        close_resp_mismatch = requests.post(f"{BASE_URL}/sessions/{session_id2}/close", headers=headers, json=close_data_mismatch, timeout=TIMEOUT)
        assert close_resp_mismatch.status_code == 409, f"Close with mismatched totals should return 409 but got {close_resp_mismatch.status_code}"
        mismatch_json = close_resp_mismatch.json()
        # Assert error message keys or content for mismatch
        assert "Mismatch" in str(mismatch_json) or "mismatch" in str(mismatch_json).lower()

        # Cleanup second session
        del_resp2 = requests.delete(f"{BASE_URL}/sessions/{session_id2}", headers=headers, timeout=TIMEOUT)
        assert del_resp2.status_code == 200, f"Delete second session failed: {del_resp2.text}"

    finally:
        # Clean up first session if exists
        if session_id:
            del_resp = requests.delete(f"{BASE_URL}/sessions/{session_id}", headers=headers, timeout=TIMEOUT)
            assert del_resp.status_code == 200, f"Delete session failed: {del_resp.text}"

        # Clean up user account by deleting registered club/account
        del_acc_resp = requests.delete(f"{BASE_URL}/me/delete-account", headers=headers, timeout=TIMEOUT)
        assert del_acc_resp.status_code == 200, f"Delete account failed: {del_acc_resp.text}"

test_postsessionssessionidclose()