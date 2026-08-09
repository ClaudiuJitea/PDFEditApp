def test_health_endpoint(app_client):
    client, _token = app_client
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["status"] == "ok"
    assert "data_dir" in payload


def test_api_requires_auth_token(app_client):
    client, _token = app_client
    response = client.post("/api/new", json={"size": "A4"})
    assert response.status_code == 401


def test_create_new_pdf_with_auth(app_client):
    client, token = app_client
    response = client.post(
        "/api/new",
        json={"size": "A4"},
        headers={"X-PDFEdit-Token": token},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["session_id"]
    assert payload["page_count"] == 1
