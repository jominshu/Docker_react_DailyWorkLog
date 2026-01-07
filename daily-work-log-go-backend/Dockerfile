# Build stage
FROM golang:1.23-alpine AS builder
WORKDIR /app

# 安裝編譯所需工具 (CGO 需要 gcc)
RUN apk add --no-cache build-base

# 先拷 go.mod / go.sum 以利用快取
COPY go.mod go.sum ./
RUN go mod download

# 拷整個專案（包含 web/build）
COPY . .

# 編譯
RUN CGO_ENABLED=1 GOOS=linux go build -o app

# Runtime stage
FROM alpine:3.20
WORKDIR /srv

# 如果你 Oracle driver 需要 libaio，可加：
# RUN apk add --no-cache libaio

COPY --from=builder /app/app .

EXPOSE 5000
CMD ["/srv/app"]
