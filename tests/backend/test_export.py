def test_get_page_for_new_pdf(app_client):
    client, token = app_client
    headers = {"X-PDFEdit-Token": token}
    create = client.post("/api/new", json={"size": "A4"}, headers=headers)
    session_id = create.get_json()["session_id"]

    page = client.get(f"/api/page/{session_id}/0", headers=headers)
    assert page.status_code == 200
    payload = page.get_json()
    assert "image" in payload
    assert payload["pdf_width"] > 0
