.PHONY: backend frontend

backend:
	cd backend && ./venv/Scripts/uvicorn main:app --host 0.0.0.0 --port 8000 --reload

frontend:
	cd frontend && npm run dev

