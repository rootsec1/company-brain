FROM ghcr.io/hkuds/lightrag:v1.5.6
COPY docker/lightrag/entrypoint.py /company-brain/entrypoint.py
COPY config/consts.json /company-brain/consts.json
ENTRYPOINT ["python", "/company-brain/entrypoint.py"]
