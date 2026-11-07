# Production keri-ts image built from the published npm package, not from source.
#
# Installs the exact @keri-ts/tufa bytes released to npm, with its published
# cesr-ts, keri-ts and scoped application dependencies. Every deployable
# service is a `tufa` subcommand selected by the container command, for example
# `witness start`, `registrar start` or `verifier run`. Keystores live under
# /usr/local/var/keri, Tufa's primary store root.
ARG NODE_IMAGE_TAG=25.9.0-bookworm-slim
FROM node:${NODE_IMAGE_TAG}

ARG TUFA_VERSION
RUN test -n "${TUFA_VERSION}" || { echo "TUFA_VERSION build arg is required" >&2; exit 1; }

RUN npm install --global --omit=dev --no-audit --no-fund "@keri-ts/tufa@${TUFA_VERSION}" \
  && npm cache clean --force \
  && tufa version

RUN mkdir -p /usr/local/var/keri && chown node:node /usr/local/var/keri

LABEL org.opencontainers.image.title="keri-ts-tufa" \
  org.opencontainers.image.description="Tufa KERI CLI and services (@keri-ts/tufa from npm)" \
  org.opencontainers.image.version="${TUFA_VERSION}" \
  org.opencontainers.image.licenses="Apache-2.0" \
  org.opencontainers.image.source="https://github.com/kentbull/keri-ts"

USER node
WORKDIR /home/node
VOLUME ["/usr/local/var/keri"]
ENTRYPOINT ["tufa"]
CMD ["--help"]
