import json
import os
import subprocess

with open("/company-brain/consts.json", "r", encoding="utf-8") as handle:
    config = json.load(handle)

services = config["services"]
models = config["models"]
ingestion = config["ingestion"]
openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")

settings = {
    "HOST": "0.0.0.0",
    "PORT": "9621",
    "WORKING_DIR": "/data/rag_storage",
    "INPUT_DIR": "/data/inputs",
    "LLM_BINDING": "openai",
    "LLM_BINDING_HOST": "https://openrouter.ai/api/v1",
    "LLM_BINDING_API_KEY": openrouter_key,
    "LLM_MODEL": models["fast"],
    "EMBEDDING_BINDING": "openai",
    "EMBEDDING_BINDING_HOST": "https://openrouter.ai/api/v1",
    "EMBEDDING_BINDING_API_KEY": openrouter_key,
    "EMBEDDING_MODEL": models["embedding"],
    "EMBEDDING_DIM": str(models["embeddingDimensions"]),
    "EMBEDDING_SEND_DIM": "true",
    "EMBEDDING_TOKEN_LIMIT": "8192",
    "EMBEDDING_BATCH_NUM": str(ingestion["embeddingBatchSize"]),
    "RERANK_BINDING": "null",
    "LIGHTRAG_KV_STORAGE": "PGKVStorage",
    "LIGHTRAG_DOC_STATUS_STORAGE": "PGDocStatusStorage",
    "LIGHTRAG_GRAPH_STORAGE": "PGTableGraphStorage",
    "LIGHTRAG_VECTOR_STORAGE": "PGVectorStorage",
    "POSTGRES_HOST": "postgres",
    "POSTGRES_PORT": "5432",
    "POSTGRES_USER": "brain",
    "POSTGRES_PASSWORD": "brain",
    "POSTGRES_DATABASE": "lightrag",
    "POSTGRES_WORKSPACE": "aperture_lightrag",
    "POSTGRES_MAX_CONNECTIONS": str(services["postgresPoolMax"]),
    "POSTGRES_VECTOR_INDEX_TYPE": "HNSW",
    "MAX_ASYNC": "4",
    "MAX_PARALLEL_INSERT": "2",
    "LIGHTRAG_API_KEY": services["lightRagApiKey"],
    "WHITELIST_PATHS": "/health"
}

os.environ.update(settings)
subprocess.run(["lightrag-server"], check=True)
