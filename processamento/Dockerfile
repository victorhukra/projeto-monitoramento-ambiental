FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY backend/requirements-lock.txt ./requirements-lock.txt
RUN pip install --no-cache-dir -r requirements-lock.txt gunicorn==23.0.0
COPY backend/config.py ./config.py
COPY backend/src ./src
COPY backend/src/models/weather_ensemble.joblib ./models/weather_ensemble.joblib
COPY backend/src/models/manifest.json ./models/manifest.json
COPY processamento/app.py ./app.py

EXPOSE 8100
CMD ["gunicorn", "--bind", "0.0.0.0:8100", "--workers", "1", "--timeout", "120", "app:app"]
