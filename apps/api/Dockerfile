# Hugging Face Spaces (16GB RAM Free Docker) / Koyeb / Render Deployment
FROM python:3.11-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

COPY apps/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY packages /app/packages
COPY services /app/services
COPY tools /app/tools
COPY apps/api /app/apps/api

ENV EGY_SCOUT_DATA_DIR=/tmp/egy-scout-data
ENV EGY_SCOUT_COMPUTE_PROVIDER=local
ENV EGY_SCOUT_STORAGE_PROVIDER=local

EXPOSE 7860
CMD ["uvicorn", "apps.api.main:app", "--host", "0.0.0.0", "--port", "7860"]
