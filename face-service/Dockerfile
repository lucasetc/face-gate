# syntax=docker/dockerfile:1
# face-service: FastAPI + OpenCV (YuNet + SFace)
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PASTA_MODELOS=/app/modelos

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Modelos do OpenCV Zoo (https://github.com/opencv/opencv_zoo), baixados no build.
# O checksum SHA-256 garante que o arquivo é exatamente o publicado pelo OpenCV.
# A pasta é criada antes: o --chmod do ADD também valeria para ela (sem permissão de acesso).
RUN mkdir -p /app/modelos
ADD --chmod=644 --checksum=sha256:8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4 \
    https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx \
    /app/modelos/face_detection_yunet_2023mar.onnx
ADD --chmod=644 --checksum=sha256:0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79 \
    https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx \
    /app/modelos/face_recognition_sface_2021dec.onnx

COPY app ./app

# Executa sem privilégios de root
RUN useradd --system --no-create-home facegate
USER facegate

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
