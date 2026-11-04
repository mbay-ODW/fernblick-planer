# Fernblick-Planer: ein Image für Oberfläche/API/MCP (uvicorn) und Render-Worker (Blender Cycles via bpy)
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.13-slim
ARG GIT_SHA=dev
# Laufzeitbibliotheken für bpy (headless, nur CPU)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libx11-6 libxrender1 libxfixes3 libxi6 libxkbcommon0 libxext6 libxxf86vm1 libsm6 libice6 libgl1 libegl1 \
      libvulkan1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/pyproject.toml ./
COPY server/planer ./planer
RUN pip install --no-cache-dir . "bpy==5.2.3" numpy \
    && python -c "import bpy; print('bpy', bpy.app.version_string)"
COPY --from=web /web/dist /app/web
ENV PLANER_WEB=/app/web PLANER_DATA=/data PLANER_BUILD=${GIT_SHA} PYTHONUNBUFFERED=1 TZ=Europe/Berlin
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status == 200 else 1)"
# Ohne --proxy-headers: die Absenderadresse muss Traefik bleiben (Prüfung des Remote-User-Headers)
CMD ["uvicorn", "planer.app:app", "--host", "0.0.0.0", "--port", "8000"]
