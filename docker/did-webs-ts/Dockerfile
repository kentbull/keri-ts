ARG NODE_IMAGE_TAG=25.9.0-bookworm-slim
FROM node:${NODE_IMAGE_TAG} AS base

ARG DENO_VERSION=2.8.2
ENV DENO_INSTALL=/usr/local \
  DENO_DIR=/deno-dir \
  XDG_CACHE_HOME=/root/.cache \
  PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    libsodium-dev \
    libsodium23 \
    pkg-config \
    python3 \
    unzip \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deno.land/install.sh | sh -s "v${DENO_VERSION}" \
  && deno --version

RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
  && uv --version

WORKDIR /app

COPY package.json package-lock.json deno.json deno.lock dprint.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY docker/did-webs-ts/run-interop.sh /usr/local/bin/did-webs-ts-interop

RUN chmod +x /usr/local/bin/did-webs-ts-interop
RUN npm ci --ignore-scripts
RUN npm install -g node-gyp
RUN cd packages/keri && deno task setup:compat-lmdb
RUN deno cache --unstable-ffi \
  packages/tufa/mod.ts \
  packages/keri/test/integration/app/interop-did-webs-resolver-matrix.test.ts

FROM base AS runtime

ENTRYPOINT ["deno", "run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts"]
CMD ["--help"]

FROM base AS interop

RUN uv python install 3.13 3.14

ENTRYPOINT ["did-webs-ts-interop"]
