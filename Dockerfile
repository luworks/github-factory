FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun --no-env-file install --frozen-lockfile --ignore-scripts
COPY . .
ARG MOONSHOT_BASE_PATH=/github-factory/
ENV MOONSHOT_BASE_PATH=$MOONSHOT_BASE_PATH
RUN bun run build

FROM oven/bun:1.4.4
WORKDIR /app
COPY --from=build /app/.output ./.output
ARG SOURCE_SHA=unknown
RUN printf '%s\n' "$SOURCE_SHA" > SOURCE_SHA && mkdir -p .data && chown -R bun:bun /app
ENV HOST=0.0.0.0 PORT=4177 MOONSHOT_DATA_DIR=/app/.data MOONSHOT_BUDGET_USD=0
USER bun
EXPOSE 4177
CMD ["bun", "--no-env-file", ".output/server/index.mjs"]
