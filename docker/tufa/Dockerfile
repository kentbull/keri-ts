# Production keri-ts images built from the published npm package, not from source.
#
# The `tufa` stage installs the exact @keri-ts/tufa bytes released to npm, with
# its published cesr-ts, keri-ts and scoped application dependencies. Each
# deployable service is a `tufa` subcommand, so every role target below is the
# same installation with that service's command as its entrypoint; arguments
# passed to `docker run` are that command's options. Keystores live under
# /usr/local/var/keri, Tufa's primary store root. The role list is mirrored in
# .github/workflows/tufa-docker.yml.
ARG NODE_IMAGE_TAG=25.9.0-bookworm-slim
FROM node:${NODE_IMAGE_TAG} AS tufa

ARG TUFA_VERSION
RUN test -n "${TUFA_VERSION}" || { echo "TUFA_VERSION build arg is required" >&2; exit 1; }

RUN npm install --global --omit=dev --no-audit --no-fund "@keri-ts/tufa@${TUFA_VERSION}" \
  && npm cache clean --force \
  && tufa version

RUN mkdir -p /usr/local/var/keri && chown node:node /usr/local/var/keri

LABEL org.opencontainers.image.title="keri-ts-tufa" \
  org.opencontainers.image.description="Tufa KERI CLI (@keri-ts/tufa from npm)" \
  org.opencontainers.image.version="${TUFA_VERSION}" \
  org.opencontainers.image.licenses="Apache-2.0" \
  org.opencontainers.image.source="https://github.com/kentbull/keri-ts"

USER node
WORKDIR /home/node
VOLUME ["/usr/local/var/keri"]
ENTRYPOINT ["tufa"]
CMD ["--help"]

FROM tufa AS agent
LABEL org.opencontainers.image.title="keri-ts-agent" \
  org.opencontainers.image.description="KERI agent server (tufa agent)"
ENTRYPOINT ["tufa", "agent"]

FROM tufa AS witness
LABEL org.opencontainers.image.title="keri-ts-witness" \
  org.opencontainers.image.description="KERI witness node (tufa witness start)"
ENTRYPOINT ["tufa", "witness", "start"]

FROM tufa AS hosted-witness
LABEL org.opencontainers.image.title="keri-ts-hosted-witness" \
  org.opencontainers.image.description="Hosted witness backend (tufa witness backend)"
ENTRYPOINT ["tufa", "witness", "backend"]

FROM tufa AS watcher
LABEL org.opencontainers.image.title="keri-ts-watcher" \
  org.opencontainers.image.description="Hosted key-state watcher (tufa watcher backend)"
ENTRYPOINT ["tufa", "watcher", "backend"]

FROM tufa AS mailbox
LABEL org.opencontainers.image.title="keri-ts-mailbox" \
  org.opencontainers.image.description="Mailbox relay (tufa mailbox start)"
ENTRYPOINT ["tufa", "mailbox", "start"]

FROM tufa AS registrar
LABEL org.opencontainers.image.title="keri-ts-registrar" \
  org.opencontainers.image.description="Registry registrar service (tufa registrar start)"
ENTRYPOINT ["tufa", "registrar", "start"]

FROM tufa AS observer
LABEL org.opencontainers.image.title="keri-ts-observer" \
  org.opencontainers.image.description="Registry observer service (tufa observer start)"
ENTRYPOINT ["tufa", "observer", "start"]

FROM tufa AS verifier
LABEL org.opencontainers.image.title="keri-ts-verifier" \
  org.opencontainers.image.description="Credential verifier webhook agent (tufa verifier run)"
ENTRYPOINT ["tufa", "verifier", "run"]

FROM tufa AS boot
LABEL org.opencontainers.image.title="keri-ts-boot" \
  org.opencontainers.image.description="KERI Foundation boot provisioning service (tufa boot backend)"
ENTRYPOINT ["tufa", "boot", "backend"]

FROM tufa AS dws-resolver
LABEL org.opencontainers.image.title="keri-ts-dws-resolver" \
  org.opencontainers.image.description="DID Webs Universal Resolver service (tufa dws resolver)"
ENTRYPOINT ["tufa", "dws", "resolver"]
