# Fixed compiler release. Record the built image ID with the deployment backup;
# RUNNER_IMAGE may be set to that sha256 ID for an immutable local deployment.
FROM docker.io/library/gcc:14.2.0-bookworm
RUN mkdir -p /program /src /build /fixtures /work && touch /program/main
COPY --chmod=755 runner/run.sh /opt/c-forge/run
COPY --chmod=755 runner/preflight.sh /opt/c-forge/preflight
WORKDIR /work
USER 65532:65532
CMD ["/opt/c-forge/preflight"]
