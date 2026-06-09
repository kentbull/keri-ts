#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-build}"
IMAGE_NAMESPACE="${DID_WEBS_TS_IMAGE_NAMESPACE:-ghcr.io/kentbull}"
RUNTIME_IMAGE="${DID_WEBS_TS_RUNTIME_IMAGE:-${IMAGE_NAMESPACE}/did-webs-ts-tufa}"
INTEROP_IMAGE="${DID_WEBS_TS_INTEROP_IMAGE:-${IMAGE_NAMESPACE}/did-webs-ts-interop}"
TAG="${DID_WEBS_TS_TAG:-$(git rev-parse --short HEAD)}"
DOCKERFILE="${DID_WEBS_TS_DOCKERFILE:-docker/did-webs-ts/Dockerfile}"
NODE_IMAGE_TAG="${DID_WEBS_TS_NODE_IMAGE_TAG:-25.9.0-bookworm-slim}"

build_image() {
  local target="$1"
  local image="$2"
  docker build \
    --file "${DOCKERFILE}" \
    --build-arg "NODE_IMAGE_TAG=${NODE_IMAGE_TAG}" \
    --target "${target}" \
    --tag "${image}:${TAG}" \
    --tag "${image}:latest" \
    .
}

push_image() {
  local image="$1"
  docker push "${image}:${TAG}"
  docker push "${image}:latest"
}

case "${ACTION}" in
  build)
    build_image runtime "${RUNTIME_IMAGE}"
    build_image interop "${INTEROP_IMAGE}"
    ;;
  test)
    build_image interop "${INTEROP_IMAGE}"
    docker run --rm "${INTEROP_IMAGE}:${TAG}"
    ;;
  push)
    push_image "${RUNTIME_IMAGE}"
    push_image "${INTEROP_IMAGE}"
    ;;
  build-push)
    build_image runtime "${RUNTIME_IMAGE}"
    build_image interop "${INTEROP_IMAGE}"
    push_image "${RUNTIME_IMAGE}"
    push_image "${INTEROP_IMAGE}"
    ;;
  *)
    echo "Usage: $0 {build|test|push|build-push}" >&2
    exit 64
    ;;
esac
