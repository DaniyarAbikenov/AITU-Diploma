FROM oven/bun:1
WORKDIR /app
# bun.lock is not used: it pins tarballs to a private Lovable mirror that returns 403 outside it.
COPY package.json bunfig.toml ./
RUN bun install
COPY . .
EXPOSE 8080
CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "8080"]
